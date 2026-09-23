-- T11 / V4.7 authoritative incremental ASSIGN/UNASSIGN boundary.
--
-- Incremental construction now uses the same pinned server Constraint IR authority
-- as T10 MOVE. This service-role-only transaction rechecks the exact coherent
-- context, active identities, duplicate/lock guards, and canonical duration before
-- creating a new ScheduleVersion. It intentionally does not delegate to V2.5,
-- whose aggregate CLASS_FREQUENCY gate conflates draft completeness with placement
-- legality. The legacy authenticated V2.5 entry point remains a tracked T13 bypass.

create or replace function public.apply_authoritative_incremental_command_v47(
  p_operation text,
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_assignment_id text,
  p_session_id text,
  p_changes jsonb,
  p_reason text,
  p_expected_context jsonb,
  p_application_validation jsonb,
  p_draft_status jsonb,
  p_ai_proposed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_operation text := upper(coalesce(p_operation,''));
  v_selected_role text;
  v_actor_context jsonb;
  v_actor_label text;
  v_current_context jsonb;
  v_current public.schedule_versions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_assignment_id text;
  v_session_id text;
  v_duration integer;
  v_session_locked boolean;
  v_assignment_locked boolean;
  v_day text;
  v_start_time time;
  v_end_time time;
  v_teacher_id text;
  v_room_id text;
  v_status text;
  v_new_id uuid;
  v_new_version integer;
  v_legacy_validation jsonb;
  v_validation jsonb;
  v_unscheduled integer;
begin
  if v_operation not in ('ASSIGN','UNASSIGN') then raise exception 'Unsupported incremental operation: %',p_operation; end if;
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  if p_application_validation is null or jsonb_typeof(p_application_validation)<>'object' then
    raise exception 'Authoritative application Constraint IR validation is required';
  end if;
  if p_draft_status is null or jsonb_typeof(p_draft_status)<>'object' then
    raise exception 'Authoritative draft status is required';
  end if;

  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id;
  if v_selected_role not in ('OWNER','EDITOR') then raise exception 'Editor membership required for selected workspace'; end if;

  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  v_actor_context:=private.assert_editor_context();
  if (v_actor_context->>'studio_id')::uuid is distinct from p_studio_id then
    raise exception 'WORKSPACE_SELECTION_MISMATCH: selected %, legacy active %',p_studio_id,v_actor_context->>'studio_id';
  end if;
  v_actor_label:=v_actor_context->>'actor';

  if p_expected_context is null or jsonb_typeof(p_expected_context)<>'object'
     or p_expected_context->>'schemaVersion'<>'1.0'
     or p_expected_context->>'studioId' is distinct from p_studio_id::text
     or coalesce(p_expected_context->>'scheduleId','')=''
     or coalesce(p_expected_context->>'scheduleAssignmentsHash','')=''
     or coalesce(p_expected_context->>'constraintModelVersion','')='' then
    raise exception 'INCREMENTAL_CONTEXT_INVALID: exact pinned scheduling context is required';
  end if;
  if p_expected_context->>'scheduleRulebookVersion' is distinct from p_expected_context->>'rulebookVersion'
     or p_expected_context->>'scheduleEnforcementVersion' is distinct from p_expected_context->>'enforcementVersion'
     or p_expected_context->>'schedulePlanningDatasetVersion' is distinct from p_expected_context->>'planningDatasetVersion'
     or p_expected_context->>'scheduleConstraintModelVersion' is distinct from p_expected_context->>'constraintModelVersion' then
    raise exception 'INCREMENTAL_CONTEXT_STALE: current schedule is not linked to the pinned policy/planning/model context';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  v_current_context:=private.build_solver_context_token_v43(p_studio_id);
  if v_current_context is distinct from p_expected_context then
    raise exception 'STALE_INCREMENTAL_CONTEXT: ScheduleVersion/locks/policy/planning/model context changed after server validation';
  end if;

  select * into v_current
  from public.schedule_versions sv
  where sv.id=(p_expected_context->>'scheduleId')::uuid
    and sv.studio_id=p_studio_id
    and sv.is_current;
  if v_current.id is null then raise exception 'STALE_INCREMENTAL_CONTEXT: pinned current ScheduleVersion is missing'; end if;

  if v_operation='UNASSIGN' then
    if coalesce(btrim(p_assignment_id),'')='' then raise exception 'Assignment is required for UNASSIGN'; end if;
    select to_jsonb(a),a.session_id,a.locked into v_before,v_session_id,v_assignment_locked
    from public.assignments a
    where a.schedule_version_id=v_current.id and a.id=p_assignment_id;
    if v_before is null then raise exception 'Assignment % does not exist',p_assignment_id; end if;
    if coalesce(v_assignment_locked,false) then raise exception 'LOCKED_ASSIGNMENT: % is locked',p_assignment_id; end if;
    select s.locked into v_session_locked
    from public.class_sessions s
    join public.class_definitions c on c.id=s.class_id and c.studio_id=p_studio_id and c.archived_at is null
    where s.id=v_session_id and s.studio_id=p_studio_id and s.archived_at is null;
    if not found then raise exception 'ARCHIVED_OR_UNKNOWN_SESSION: %',v_session_id; end if;
    if coalesce(v_session_locked,false) then raise exception 'LOCKED_SESSION: % is locked',v_session_id; end if;
    v_assignment_id:=p_assignment_id;
  else
    v_session_id:=nullif(btrim(coalesce(p_session_id,'')),'');
    if v_session_id is null then raise exception 'Session is required for ASSIGN'; end if;
    select coalesce(s.duration_minutes,c.duration_minutes),s.locked into v_duration,v_session_locked
    from public.class_sessions s
    join public.class_definitions c on c.id=s.class_id and c.studio_id=p_studio_id and c.archived_at is null
    where s.id=v_session_id and s.studio_id=p_studio_id and s.archived_at is null;
    if not found or v_duration is null then raise exception 'ARCHIVED_OR_UNKNOWN_SESSION: %',v_session_id; end if;
    if exists(select 1 from public.assignments a where a.schedule_version_id=v_current.id and a.session_id=v_session_id) then
      raise exception 'SESSION_ALREADY_ASSIGNED: %',v_session_id;
    end if;
    v_assignment_id:=nullif(btrim(coalesce(p_assignment_id,'')),'');
    if v_assignment_id is null then raise exception 'Assignment is required for ASSIGN'; end if;
    if exists(select 1 from public.assignments a where a.schedule_version_id=v_current.id and a.id=v_assignment_id) then
      raise exception 'ASSIGNMENT_ID_ALREADY_EXISTS: %',v_assignment_id;
    end if;
    if p_changes is null or jsonb_typeof(p_changes)<>'object' then raise exception 'Canonical ASSIGN changes are required'; end if;
    v_day:=p_changes->>'day';
    v_start_time:=(p_changes->>'startTime')::time;
    v_teacher_id:=nullif(p_changes->>'teacherId','');
    v_room_id:=nullif(p_changes->>'roomId','');
    v_status:=coalesce(nullif(p_changes->>'status',''),'NORMAL');
    if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') then raise exception 'Invalid schedule day: %',v_day; end if;
    if v_start_time is null then raise exception 'startTime is required for ASSIGN'; end if;
    if extract(second from v_start_time)<>0 or mod(extract(minute from v_start_time)::integer,15)<>0 then
      raise exception 'TIME_GRID: start time must be on a 15-minute boundary';
    end if;
    if v_teacher_id is null or not exists(
      select 1 from public.teachers t where t.id=v_teacher_id and t.studio_id=p_studio_id and t.archived_at is null
    ) then raise exception 'ARCHIVED_OR_UNKNOWN_TEACHER: %',coalesce(v_teacher_id,''); end if;
    if v_room_id is null or not exists(
      select 1 from public.rooms r where r.id=v_room_id and r.studio_id=p_studio_id and r.archived_at is null
    ) then raise exception 'ARCHIVED_OR_UNKNOWN_ROOM: %',coalesce(v_room_id,''); end if;
    if v_status not in ('NORMAL','WARNING','AI_PROPOSED') then raise exception 'Invalid assignment status: %',v_status; end if;
    v_end_time:=v_start_time+make_interval(mins=>v_duration);
    if v_end_time<=v_start_time then raise exception 'Assignment may not cross midnight'; end if;
  end if;

  v_new_version:=v_current.version+1;
  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,planning_dataset_version,constraint_model_version,
    actor_user_id,actor_label,reason,is_current
  ) values(
    p_studio_id,v_new_version,(p_expected_context->>'rulebookVersion')::integer,
    (p_expected_context->>'enforcementVersion')::integer,(p_expected_context->>'planningDatasetVersion')::integer,
    (p_expected_context->>'constraintModelVersion')::integer,p_actor_user_id,v_actor_label,p_reason,false
  ) returning id into v_new_id;

  insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
  select v_new_id,a.id,a.studio_id,a.session_id,a.day,a.start_time,a.end_time,a.teacher_id,a.room_id,a.locked,a.status
  from public.assignments a where a.schedule_version_id=v_current.id;

  if v_operation='ASSIGN' then
    insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
    values(v_new_id,v_assignment_id,p_studio_id,v_session_id,v_day,v_start_time,v_end_time,v_teacher_id,v_room_id,coalesce(v_session_locked,false),v_status);
  else
    delete from public.assignments a where a.schedule_version_id=v_new_id and a.id=v_assignment_id;
  end if;

  select public.validate_schedule_hard_v25(v_new_id) into v_legacy_validation;
  select count(*)::integer into v_unscheduled
  from public.class_sessions s
  join public.class_definitions c on c.id=s.class_id and c.studio_id=p_studio_id and c.archived_at is null
  where s.studio_id=p_studio_id and s.archived_at is null
    and not exists(select 1 from public.assignments a where a.schedule_version_id=v_new_id and a.session_id=s.id);

  if coalesce((p_draft_status->>'scheduleComplete')::boolean,false) and v_unscheduled<>0 then
    raise exception 'DRAFT_STATUS_MISMATCH: server claimed complete but % active sessions remain unscheduled',v_unscheduled;
  end if;
  if coalesce((p_draft_status->>'publishable')::boolean,false)
     and not coalesce((p_draft_status->>'scheduleComplete')::boolean,false) then
    raise exception 'DRAFT_STATUS_MISMATCH: publishable draft must be complete';
  end if;

  v_validation:=coalesce(v_legacy_validation,'{}'::jsonb) || jsonb_build_object(
    'unscheduledSessions',v_unscheduled,
    'scheduleComplete',coalesce((p_draft_status->>'scheduleComplete')::boolean,false),
    'publishable',coalesce((p_draft_status->>'publishable')::boolean,false),
    'authoritativeConstraintIr',p_application_validation,
    'draftStatus',p_draft_status
  );

  update public.schedule_versions set is_current=false where id=v_current.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;
  select to_jsonb(a) into v_after from public.assignments a where a.schedule_version_id=v_new_id and a.id=v_assignment_id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(p_studio_id,p_actor_user_id,v_actor_label,'SCHEDULE_COMMAND','ASSIGNMENT',v_assignment_id,p_reason,
    jsonb_build_object(
      'operation',v_operation,'sessionId',v_session_id,'before',v_before,'after',v_after,
      'scheduleVersion',v_new_version,'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
      'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
      'planningDatasetVersion',(p_expected_context->>'planningDatasetVersion')::integer,
      'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
      'authority','SERVER_CONSTRAINT_IR_V47','authoritativeConstraintIr',true,
      'expectedSolverContext',p_expected_context,'applicationConstraintIrValidation',p_application_validation,
      'draftStatus',p_draft_status,'legacyValidation',v_legacy_validation,
      'aiProposed',p_ai_proposed,'legacyWriteBypassRetirementTask','T13'
    ));

  return jsonb_build_object(
    'operation',v_operation,'scheduleId',v_new_id,'scheduleVersion',v_new_version,
    'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
    'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
    'planningDatasetVersion',(p_expected_context->>'planningDatasetVersion')::integer,
    'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
    'assignmentId',v_assignment_id,'sessionId',v_session_id,'before',v_before,'after',v_after,
    'validation',v_validation,'unscheduledSessions',v_unscheduled,
    'authority','SERVER_CONSTRAINT_IR_V47','authoritativeConstraintIr',true
  );
end
$function$;

revoke all on function public.apply_authoritative_incremental_command_v47(text,uuid,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.apply_authoritative_incremental_command_v47(text,uuid,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,boolean)
  to service_role;

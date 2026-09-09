-- T12 / V4.8 authoritative schedule recovery boundary.
--
-- REBASE and one-step UNDO treat historical/current assignments as source
-- material only. The application server reconstructs one coherent current
-- policy/planning/model snapshot, normalizes the source placements against
-- current active facts and durations, evaluates the complete Constraint IR,
-- then this service-role-only transaction proves the exact context and source
-- still match before creating a new ScheduleVersion. Historical assignments
-- are never rewritten. Legacy authenticated recovery remains a tracked T13
-- bypass until grant retirement.

create or replace function public.apply_authoritative_schedule_recovery_v48(
  p_operation text,
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_source_schedule_id uuid,
  p_reason text,
  p_expected_context jsonb,
  p_candidate jsonb,
  p_application_validation jsonb,
  p_draft_status jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_operation text:=upper(coalesce(p_operation,''));
  v_selected_role text;
  v_actor_context jsonb;
  v_actor_label text;
  v_current_context jsonb;
  v_current public.schedule_versions%rowtype;
  v_source public.schedule_versions%rowtype;
  v_candidate_count integer:=0;
  v_candidate_distinct_ids integer:=0;
  v_candidate_distinct_sessions integer:=0;
  v_source_active_count integer:=0;
  v_source_incompatible integer:=0;
  v_invalid integer:=0;
  v_locked_changed integer:=0;
  v_unresolved_lock integer:=0;
  v_new_id uuid;
  v_new_version integer;
  v_legacy_validation jsonb;
  v_validation jsonb;
  v_unscheduled integer:=0;
  v_unscheduled_ids jsonb:='[]'::jsonb;
  v_retired_ids jsonb:='[]'::jsonb;
  v_complete_expected boolean:=false;
  v_action text;
begin
  if v_operation not in ('REBASE','UNDO') then raise exception 'Unsupported recovery operation: %',p_operation; end if;
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if p_source_schedule_id is null then raise exception 'Recovery source ScheduleVersion is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  if p_candidate is null or jsonb_typeof(p_candidate)<>'array' then raise exception 'Recovery candidate must be a JSON array'; end if;
  if p_application_validation is null or jsonb_typeof(p_application_validation)<>'object' then
    raise exception 'Authoritative application Constraint IR validation is required';
  end if;
  if p_draft_status is null or jsonb_typeof(p_draft_status)<>'object' then
    raise exception 'Authoritative recovery draft status is required';
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
     or coalesce(p_expected_context->>'rulebookVersion','')=''
     or coalesce(p_expected_context->>'enforcementVersion','')=''
     or coalesce(p_expected_context->>'planningDatasetVersion','')=''
     or coalesce(p_expected_context->>'constraintModelVersion','')=''
     or coalesce(p_expected_context->>'planningConfirmedForSchedulingAt','')='' then
    raise exception 'RECOVERY_CONTEXT_INVALID: exact current schedule/policy/planning/model context is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  v_current_context:=private.build_solver_context_token_v43(p_studio_id);
  if v_current_context is distinct from p_expected_context then
    raise exception 'STALE_RECOVERY_CONTEXT: ScheduleVersion/locks/policy/planning/model context changed after server validation';
  end if;

  select * into v_current
  from public.schedule_versions sv
  where sv.id=(p_expected_context->>'scheduleId')::uuid
    and sv.studio_id=p_studio_id
    and sv.is_current;
  if v_current.id is null then raise exception 'STALE_RECOVERY_CONTEXT: pinned current ScheduleVersion is missing'; end if;

  if not exists(
    select 1 from public.constraint_model_versions cm
    where cm.studio_id=p_studio_id and cm.status='CURRENT'
      and cm.version=(p_expected_context->>'constraintModelVersion')::integer
      and cm.complete_hard_constraint_compilation=true
  ) then raise exception 'RECOVERY_CONSTRAINT_MODEL_NOT_CURRENT: pinned complete model is unavailable'; end if;

  if v_operation='REBASE' then
    if p_source_schedule_id is distinct from v_current.id then
      raise exception 'RECOVERY_REBASE_SOURCE_MISMATCH: REBASE source must be the pinned current ScheduleVersion';
    end if;
    v_source:=v_current;
  else
    select * into v_source
    from public.schedule_versions sv
    where sv.id=p_source_schedule_id and sv.studio_id=p_studio_id
      and sv.version=v_current.version-1 and sv.is_current=false;
    if v_source.id is null then
      raise exception 'RECOVERY_UNDO_SOURCE_NOT_PREVIOUS: UNDO may adopt only the immediately previous historical ScheduleVersion';
    end if;
  end if;

  select count(*)::integer into v_invalid
  from jsonb_array_elements(p_candidate) elem
  where jsonb_typeof(elem)<>'object'
     or not (elem ?& array['assignmentId','sessionId','day','startTime','endTime','teacherId','roomId','status'])
     or (elem - array['assignmentId','sessionId','day','startTime','endTime','teacherId','roomId','status'])<>'{}'::jsonb
     or jsonb_typeof(elem->'assignmentId')<>'string'
     or jsonb_typeof(elem->'sessionId')<>'string'
     or jsonb_typeof(elem->'day')<>'string'
     or jsonb_typeof(elem->'startTime')<>'string'
     or jsonb_typeof(elem->'endTime')<>'string'
     or jsonb_typeof(elem->'teacherId')<>'string'
     or jsonb_typeof(elem->'roomId')<>'string'
     or jsonb_typeof(elem->'status')<>'string'
     or btrim(elem->>'assignmentId')=''
     or btrim(elem->>'sessionId')=''
     or btrim(elem->>'teacherId')=''
     or btrim(elem->>'roomId')='';
  if v_invalid>0 then raise exception 'RECOVERY_CANDIDATE_INVALID: % row(s) have a non-canonical shape',v_invalid; end if;

  select count(*)::integer,count(distinct elem->>'assignmentId')::integer,count(distinct elem->>'sessionId')::integer
  into v_candidate_count,v_candidate_distinct_ids,v_candidate_distinct_sessions
  from jsonb_array_elements(p_candidate) elem;
  if v_candidate_count<>v_candidate_distinct_ids then raise exception 'RECOVERY_CANDIDATE_DUPLICATE_ASSIGNMENT_ID'; end if;
  if v_candidate_count<>v_candidate_distinct_sessions then raise exception 'RECOVERY_CANDIDATE_DUPLICATE_SESSION'; end if;

  -- Historical sessions/classes are retired source material and are not
  -- reintroduced. A REBASE also retires current placements whose resource
  -- was archived, leaving the still-active session visibly unscheduled.
  -- UNDO fails instead when an otherwise-active historical placement uses
  -- an inactive resource, because silently skipping it would misrepresent
  -- what was restored.
  select count(*)::integer into v_source_incompatible
  from public.assignments a
  join public.class_sessions s on s.studio_id=p_studio_id and s.id=a.session_id and s.archived_at is null
  join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
  left join public.teachers t on t.studio_id=p_studio_id and t.id=a.teacher_id and t.archived_at is null
  left join public.rooms r on r.studio_id=p_studio_id and r.id=a.room_id and r.archived_at is null
  where a.schedule_version_id=v_source.id and (t.id is null or r.id is null);
  if v_operation='UNDO' and v_source_incompatible>0 then
    raise exception 'RECOVERY_SOURCE_RESOURCE_INACTIVE: % historical active-session placement(s) use an archived/unknown teacher or room',v_source_incompatible;
  end if;

  select count(*)::integer into v_source_active_count
  from public.assignments a
  join public.class_sessions s on s.studio_id=p_studio_id and s.id=a.session_id and s.archived_at is null
  join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
  join public.teachers t on t.studio_id=p_studio_id and t.id=a.teacher_id and t.archived_at is null
  join public.rooms r on r.studio_id=p_studio_id and r.id=a.room_id and r.archived_at is null
  where a.schedule_version_id=v_source.id;
  if v_candidate_count<>v_source_active_count then
    raise exception 'RECOVERY_SOURCE_CANDIDATE_MISMATCH: expected % recoverable source placement(s), received %',v_source_active_count,v_candidate_count;
  end if;

  if exists(
    select 1
    from public.assignments a
    join public.class_sessions s on s.studio_id=p_studio_id and s.id=a.session_id and s.archived_at is null
    join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
    join public.teachers t on t.studio_id=p_studio_id and t.id=a.teacher_id and t.archived_at is null
    join public.rooms r on r.studio_id=p_studio_id and r.id=a.room_id and r.archived_at is null
    where a.schedule_version_id=v_source.id
    group by a.session_id having count(*)>1
  ) then raise exception 'RECOVERY_SOURCE_DUPLICATE_SESSION'; end if;

  select count(*)::integer into v_invalid
  from jsonb_array_elements(p_candidate) elem
  left join public.assignments src
    on src.schedule_version_id=v_source.id
   and src.id=elem->>'assignmentId'
   and src.session_id=elem->>'sessionId'
  left join public.class_sessions s
    on s.studio_id=p_studio_id and s.id=elem->>'sessionId' and s.archived_at is null
  left join public.class_definitions c
    on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
  left join public.teachers t
    on t.studio_id=p_studio_id and t.id=elem->>'teacherId' and t.archived_at is null
  left join public.rooms r
    on r.studio_id=p_studio_id and r.id=elem->>'roomId' and r.archived_at is null
  where src.id is null or s.id is null or c.id is null or t.id is null or r.id is null
     or elem->>'day' not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
     or elem->>'startTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
     or elem->>'endTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
     or elem->>'status' not in ('NORMAL','WARNING','AI_PROPOSED')
     or elem->>'day' is distinct from src.day
     or (elem->>'startTime')::time is distinct from src.start_time
     or elem->>'teacherId' is distinct from src.teacher_id
     or elem->>'roomId' is distinct from src.room_id
     or elem->>'status' is distinct from src.status
     or mod(extract(minute from (elem->>'startTime')::time)::integer,15)<>0
     or (elem->>'endTime')::time <= (elem->>'startTime')::time
     or (elem->>'endTime')::time is distinct from
        ((elem->>'startTime')::time + make_interval(mins=>coalesce(s.duration_minutes,c.duration_minutes)));
  if v_invalid>0 then
    raise exception 'RECOVERY_CANDIDATE_INVALID: % row(s) differ from recoverable source placement/current duration or fail active canonical validation',v_invalid;
  end if;

  select coalesce(jsonb_agg(a.id order by a.id),'[]'::jsonb) into v_retired_ids
  from public.assignments a
  left join public.class_sessions s on s.studio_id=p_studio_id and s.id=a.session_id and s.archived_at is null
  left join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
  left join public.teachers t on t.studio_id=p_studio_id and t.id=a.teacher_id and t.archived_at is null
  left join public.rooms r on r.studio_id=p_studio_id and r.id=a.room_id and r.archived_at is null
  where a.schedule_version_id=v_source.id
    and (s.id is null or c.id is null or (v_operation='REBASE' and (t.id is null or r.id is null)));

  -- Same effective runtime lock precedence as T09: active session lock OR
  -- current assignment lock. Recovery cannot remove or relocate either.
  select count(*)::integer into v_unresolved_lock
  from public.class_sessions s
  join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
  left join public.assignments current_a on current_a.schedule_version_id=v_current.id and current_a.session_id=s.id
  where s.studio_id=p_studio_id and s.archived_at is null and s.locked=true and current_a.id is null;
  if v_unresolved_lock>0 then
    raise exception 'LOCKED_SESSION_PLACEMENT_UNRESOLVED: % active locked session(s) have no current placement',v_unresolved_lock;
  end if;

  select count(*)::integer into v_locked_changed
  from public.class_sessions s
  join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
  join public.assignments current_a on current_a.schedule_version_id=v_current.id and current_a.session_id=s.id
  left join lateral (
    select elem from jsonb_array_elements(p_candidate) elem where elem->>'sessionId'=s.id limit 1
  ) candidate on true
  where s.studio_id=p_studio_id and s.archived_at is null
    and (s.locked=true or current_a.locked=true)
    and (
      candidate.elem is null
      or candidate.elem->>'day' is distinct from current_a.day
      or (candidate.elem->>'startTime')::time is distinct from current_a.start_time
      or candidate.elem->>'teacherId' is distinct from current_a.teacher_id
      or candidate.elem->>'roomId' is distinct from current_a.room_id
    );
  if v_locked_changed>0 then raise exception 'LOCKED_SESSION_PLACEMENT_CHANGED: % effective locked placement(s) changed',v_locked_changed; end if;

  select count(*)::integer,coalesce(jsonb_agg(s.id order by s.id),'[]'::jsonb)
  into v_unscheduled,v_unscheduled_ids
  from public.class_sessions s
  join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
  where s.studio_id=p_studio_id and s.archived_at is null
    and not exists(select 1 from jsonb_array_elements(p_candidate) elem where elem->>'sessionId'=s.id);

  if jsonb_typeof(coalesce(p_draft_status->'unscheduledSessionIds','[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_draft_status->'duplicateSessionIds','[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_draft_status->'unknownAssignmentSessionIds','[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_draft_status->'completenessObligationKeys','[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_draft_status->'retiredAssignmentIds','[]'::jsonb))<>'array' then
    raise exception 'DRAFT_STATUS_MISMATCH: recovery draft arrays are malformed';
  end if;
  if coalesce(p_draft_status->'unscheduledSessionIds','[]'::jsonb) is distinct from v_unscheduled_ids then
    raise exception 'DRAFT_STATUS_MISMATCH: unscheduled session identity differs from database reconstruction';
  end if;
  if coalesce(p_draft_status->'retiredAssignmentIds','[]'::jsonb) is distinct from v_retired_ids then
    raise exception 'DRAFT_STATUS_MISMATCH: retired source assignment identity differs from database reconstruction';
  end if;
  if jsonb_array_length(coalesce(p_draft_status->'duplicateSessionIds','[]'::jsonb))<>0
     or jsonb_array_length(coalesce(p_draft_status->'unknownAssignmentSessionIds','[]'::jsonb))<>0 then
    raise exception 'DRAFT_STATUS_MISMATCH: canonical recovery candidate cannot contain duplicate/unknown sessions';
  end if;
  v_complete_expected:=v_unscheduled=0
    and jsonb_array_length(coalesce(p_draft_status->'completenessObligationKeys','[]'::jsonb))=0;
  if coalesce((p_draft_status->>'scheduleComplete')::boolean,false) is distinct from v_complete_expected then
    raise exception 'DRAFT_STATUS_MISMATCH: scheduleComplete does not match active-session/completeness reconstruction';
  end if;
  if coalesce((p_draft_status->>'publishable')::boolean,false)
     and not coalesce((p_draft_status->>'scheduleComplete')::boolean,false) then
    raise exception 'DRAFT_STATUS_MISMATCH: publishable recovery must be complete';
  end if;

  select coalesce(max(version),0)+1 into v_new_version from public.schedule_versions where studio_id=p_studio_id;
  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,planning_dataset_version,constraint_model_version,
    actor_user_id,actor_label,reason,is_current
  ) values(
    p_studio_id,v_new_version,(p_expected_context->>'rulebookVersion')::integer,
    (p_expected_context->>'enforcementVersion')::integer,(p_expected_context->>'planningDatasetVersion')::integer,
    (p_expected_context->>'constraintModelVersion')::integer,p_actor_user_id,v_actor_label,p_reason,false
  ) returning id into v_new_id;

  insert into public.assignments(
    schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
  )
  select
    v_new_id,elem->>'assignmentId',p_studio_id,elem->>'sessionId',elem->>'day',
    (elem->>'startTime')::time,(elem->>'endTime')::time,elem->>'teacherId',elem->>'roomId',
    (s.locked or coalesce(current_a.locked,false)),elem->>'status'
  from jsonb_array_elements(p_candidate) elem
  join public.class_sessions s on s.studio_id=p_studio_id and s.id=elem->>'sessionId' and s.archived_at is null
  join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
  join public.teachers t on t.studio_id=p_studio_id and t.id=elem->>'teacherId' and t.archived_at is null
  join public.rooms r on r.studio_id=p_studio_id and r.id=elem->>'roomId' and r.archived_at is null
  left join public.assignments current_a on current_a.schedule_version_id=v_current.id and current_a.session_id=s.id;

  select public.validate_schedule_hard_v25(v_new_id) into v_legacy_validation;
  if coalesce((p_draft_status->>'publishable')::boolean,false)
     and (
       coalesce((p_application_validation->>'valid')::boolean,false) is not true
       or coalesce((p_application_validation->>'hardViolations')::integer,0)<>0
       or coalesce((v_legacy_validation->>'valid')::boolean,false) is not true
       or coalesce((v_legacy_validation->>'fullyValidated')::boolean,false) is not true
     ) then
    raise exception 'RECOVERY_PUBLISHABILITY_MISMATCH: publishable recovery is not independently/legacy valid';
  end if;

  v_validation:=coalesce(v_legacy_validation,'{}'::jsonb) || jsonb_build_object(
    'unscheduledSessions',v_unscheduled,
    'scheduleComplete',coalesce((p_draft_status->>'scheduleComplete')::boolean,false),
    'publishable',coalesce((p_draft_status->>'publishable')::boolean,false),
    'authoritativeConstraintIr',p_application_validation,
    'draftStatus',p_draft_status,
    'recoveryOperation',v_operation,
    'recoverySourceScheduleVersion',v_source.version
  );

  update public.schedule_versions set is_current=false where id=v_current.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;

  v_action:=case when v_operation='REBASE' then 'SCHEDULE_REBASE' else 'SCHEDULE_UNDO' end;
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(p_studio_id,p_actor_user_id,v_actor_label,v_action,'SCHEDULE_VERSION',v_new_id::text,p_reason,
    jsonb_build_object(
      'operation',v_operation,'scheduleVersion',v_new_version,'previousScheduleVersion',v_current.version,
      'sourceScheduleId',v_source.id,'sourceScheduleVersion',v_source.version,
      'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
      'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
      'planningDatasetVersion',(p_expected_context->>'planningDatasetVersion')::integer,
      'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
      'authority','SERVER_CONSTRAINT_IR_V48','authoritativeConstraintIr',true,
      'expectedSolverContext',p_expected_context,'applicationConstraintIrValidation',p_application_validation,
      'draftStatus',p_draft_status,'retiredAssignmentIds',v_retired_ids,'legacyValidation',v_legacy_validation,
      'legacyWriteBypassRetirementTask','T13'
    ));

  return jsonb_build_object(
    'operation',v_operation,'scheduleId',v_new_id,'scheduleVersion',v_new_version,
    'previousScheduleVersion',v_current.version,'sourceScheduleId',v_source.id,'sourceScheduleVersion',v_source.version,
    'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
    'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
    'planningDatasetVersion',(p_expected_context->>'planningDatasetVersion')::integer,
    'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
    'validation',v_validation,'unscheduledSessions',v_unscheduled,'retiredAssignmentIds',v_retired_ids,
    'authority','SERVER_CONSTRAINT_IR_V48','authoritativeConstraintIr',true
  );
end
$function$;

revoke all on function public.apply_authoritative_schedule_recovery_v48(
  text,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.apply_authoritative_schedule_recovery_v48(
  text,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

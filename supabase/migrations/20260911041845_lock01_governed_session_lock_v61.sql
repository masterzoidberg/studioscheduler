-- LOCK-01 / V6.1 governed session lock transition.
--
-- A manager lock is one atomic command. It changes the planning-session fact,
-- materializes the resulting PlanningDatasetVersion, and copies the current
-- schedule into a new current ScheduleVersion whose target assignment carries
-- the same lock value. Historical schedule and assignment rows are never
-- rewritten. Effective runtime protection remains SESSION OR ASSIGNMENT.

create or replace function public.apply_authoritative_session_lock_v61(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_actor_label text,
  p_session_id text,
  p_locked boolean,
  p_reason text,
  p_expected_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_selected_role text;
  v_current_context jsonb;
  v_actor_label text := coalesce(nullif(btrim(p_actor_label),''), 'Studio manager');
  v_current public.schedule_versions%rowtype;
  v_session public.class_sessions%rowtype;
  v_before_session jsonb;
  v_current_assignment public.assignments%rowtype;
  v_before_assignment jsonb;
  v_assignment_count integer;
  v_new_planning_version integer;
  v_new_schedule_id uuid;
  v_new_schedule_version integer;
  v_validation jsonb;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if coalesce(btrim(p_session_id),'')='' then raise exception 'Session is required'; end if;
  if p_locked is null then raise exception 'Lock state is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  if p_expected_context is null or jsonb_typeof(p_expected_context)<>'object'
     or p_expected_context->>'schemaVersion'<>'1.0'
     or p_expected_context->>'studioId' is distinct from p_studio_id::text
     or coalesce(p_expected_context->>'scheduleId','')=''
     or coalesce(p_expected_context->>'scheduleAssignmentsHash','')=''
     or coalesce(p_expected_context->>'rulebookVersion','')=''
     or coalesce(p_expected_context->>'enforcementVersion','')=''
     or coalesce(p_expected_context->>'planningDatasetVersion','')=''
     or coalesce(p_expected_context->>'constraintModelVersion','')='' then
    raise exception 'SESSION_LOCK_CONTEXT_INVALID: exact pinned scheduling context is required';
  end if;

  -- The service key is transport authority only. Recheck and serialize the
  -- exact human membership row before any scheduling-significant write.
  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id
  for update;
  if not found or v_selected_role not in ('OWNER','EDITOR') then
    raise exception 'Editor membership required for selected workspace';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  v_current_context:=private.build_solver_context_token_v43(p_studio_id);
  if v_current_context is distinct from p_expected_context then
    raise exception 'STALE_SESSION_LOCK_CONTEXT: ScheduleVersion/locks/policy/planning/model context changed before lock commit';
  end if;

  select * into v_current
  from public.schedule_versions sv
  where sv.id=(p_expected_context->>'scheduleId')::uuid
    and sv.studio_id=p_studio_id
    and sv.is_current
  for update;
  if v_current.id is null then
    raise exception 'STALE_SESSION_LOCK_CONTEXT: pinned current ScheduleVersion is missing';
  end if;

  select s.* into v_session
  from public.class_sessions s
  join public.class_definitions c
    on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
  where s.studio_id=p_studio_id and s.id=p_session_id and s.archived_at is null;
  if not found then raise exception 'SESSION_LOCK_SESSION_NOT_FOUND: active session does not belong to the selected studio'; end if;
  v_before_session:=to_jsonb(v_session);

  select count(*)::integer into v_assignment_count
  from public.assignments a
  where a.studio_id=p_studio_id and a.schedule_version_id=v_current.id and a.session_id=p_session_id;
  if v_assignment_count=0 then
    raise exception 'SESSION_LOCK_PLACEMENT_REQUIRED: lock changes require exactly one current assignment';
  end if;
  if v_assignment_count<>1 then
    raise exception 'SESSION_LOCK_PLACEMENT_AMBIGUOUS: lock changes require exactly one current assignment';
  end if;

  select * into v_current_assignment
  from public.assignments a
  where a.studio_id=p_studio_id and a.schedule_version_id=v_current.id and a.session_id=p_session_id;
  v_before_assignment:=to_jsonb(v_current_assignment);
  if v_session.locked=p_locked and v_current_assignment.locked=p_locked then
    raise exception 'SESSION_LOCK_STATE_UNCHANGED: the session and current placement already have that lock state';
  end if;

  -- The deferred PlanningDataset trigger is retained for all other session
  -- writes. Materialize its exact result here so the new ScheduleVersion can
  -- pin the changed planning authority before this command returns.
  update public.class_sessions
  set locked=p_locked,updated_at=now()
  where studio_id=p_studio_id and id=p_session_id;

  v_new_planning_version:=private.ensure_planning_dataset_version_v25(
    p_studio_id,p_actor_user_id,v_actor_label,
    'Session lock changed: '||btrim(p_reason)
  );

  select coalesce(max(version),0)+1 into v_new_schedule_version
  from public.schedule_versions
  where studio_id=p_studio_id;

  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,planning_dataset_version,
    constraint_model_version,actor_user_id,actor_label,reason,is_current
  ) values(
    p_studio_id,v_new_schedule_version,
    (p_expected_context->>'rulebookVersion')::integer,
    (p_expected_context->>'enforcementVersion')::integer,
    v_new_planning_version,
    (p_expected_context->>'constraintModelVersion')::integer,
    p_actor_user_id,v_actor_label,btrim(p_reason),false
  ) returning id into v_new_schedule_id;

  insert into public.assignments(
    schedule_version_id,id,studio_id,session_id,day,start_time,end_time,
    teacher_id,room_id,locked,status
  )
  select
    v_new_schedule_id,a.id,a.studio_id,a.session_id,a.day,a.start_time,a.end_time,
    a.teacher_id,a.room_id,
    case when a.session_id=p_session_id then p_locked else a.locked end,
    a.status
  from public.assignments a
  where a.studio_id=p_studio_id and a.schedule_version_id=v_current.id;

  select public.validate_schedule_hard_v25(v_new_schedule_id) into v_validation;
  v_validation:=coalesce(v_validation,'{}'::jsonb) || jsonb_build_object(
    'lockChange',jsonb_build_object(
      'sessionId',p_session_id,
      'locked',p_locked,
      'effectiveLock',p_locked,
      'previousSessionLocked',v_session.locked,
      'previousAssignmentLocked',v_current_assignment.locked
    ),
    'planningDatasetVersion',v_new_planning_version,
    'certificationStale',true,
    'candidateStale',true
  );

  update public.schedule_versions set is_current=false where id=v_current.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_schedule_id;

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    p_studio_id,p_actor_user_id,v_actor_label,'SCHEDULE_SESSION_LOCK_CHANGED',
    'CLASS_SESSION',p_session_id,btrim(p_reason),jsonb_build_object(
      'sessionId',p_session_id,
      'locked',p_locked,
      'effectiveLock',p_locked,
      'beforeSession',v_before_session,
      'beforeAssignment',v_before_assignment,
      'scheduleVersion',v_new_schedule_version,
      'previousScheduleVersion',v_current.version,
      'planningDatasetVersion',v_new_planning_version,
      'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
      'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
      'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
      'certificationStale',true,
      'candidateStale',true,
      'authority','SERVER_SESSION_LOCK_V61',
      'expectedSolverContext',p_expected_context
    )
  );

  return jsonb_build_object(
    'status',case when p_locked then 'LOCKED' else 'UNLOCKED' end,
    'studioId',p_studio_id,
    'sessionId',p_session_id,
    'locked',p_locked,
    'effectiveLock',p_locked,
    'scheduleId',v_new_schedule_id,
    'scheduleVersion',v_new_schedule_version,
    'previousScheduleVersion',v_current.version,
    'planningDatasetVersion',v_new_planning_version,
    'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
    'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
    'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
    'certificationStale',true,
    'candidateStale',true,
    'validation',v_validation,
    'authority','SERVER_SESSION_LOCK_V61'
  );
end
$function$;

revoke all on function public.apply_authoritative_session_lock_v61(
  uuid,uuid,text,text,boolean,text,jsonb
) from public,anon,authenticated;
grant execute on function public.apply_authoritative_session_lock_v61(
  uuid,uuid,text,text,boolean,text,jsonb
) to service_role;

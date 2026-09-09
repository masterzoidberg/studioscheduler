-- V4.2 archive-aware solver candidate adoption.
--
-- The canonical solver state and Planning Dataset contain ACTIVE inventory only.
-- Keep the service-role adoption transaction on the same boundary: archived
-- sessions are historical identities, not completeness obligations, and archived
-- classes/teachers/rooms may not be reintroduced into a new active schedule.

create or replace function public.adopt_solver_candidate_v33(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_actor_label text,
  p_reason text,
  p_expected_schedule_version integer,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,
  p_expected_planning_dataset_version integer,
  p_expected_constraint_model_version integer,
  p_candidate jsonb,
  p_application_validation jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_current_schedule public.schedule_versions%rowtype;
  v_current_rulebook integer;
  v_current_enforcement integer;
  v_current_planning integer;
  v_current_constraint integer;
  v_planning_confirmed timestamptz;
  v_new_id uuid;
  v_new_version integer;
  v_validation jsonb;
  v_hard integer;
  v_expected_sessions integer;
  v_candidate_sessions integer;
  v_distinct_candidate_sessions integer;
  v_invalid integer;
  v_locked_changed integer;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor user is required'; end if;
  if coalesce(btrim(p_actor_label),'')='' then raise exception 'Actor label is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'array' then raise exception 'Candidate must be a JSON array'; end if;
  if coalesce((p_application_validation->>'valid')::boolean,false) is not true
     or coalesce((p_application_validation->>'hardViolations')::integer,0) <> 0 then
    raise exception 'APPLICATION_VALIDATION_REQUIRED: candidate must have zero independently validated HARD violations';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  select * into v_current_schedule
  from public.schedule_versions
  where studio_id=p_studio_id and is_current
  limit 1;
  if v_current_schedule.id is null then raise exception 'No current schedule exists'; end if;

  select version into v_current_rulebook
  from public.rulebook_versions
  where studio_id=p_studio_id and status='CURRENT'
  limit 1;

  select version into v_current_enforcement
  from public.rule_enforcement_versions
  where studio_id=p_studio_id and status='CURRENT'
  limit 1;

  select version, confirmed_for_scheduling_at into v_current_planning, v_planning_confirmed
  from public.planning_dataset_versions
  where studio_id=p_studio_id and status='CURRENT'
  limit 1;

  select version into v_current_constraint
  from public.constraint_model_versions
  where studio_id=p_studio_id
    and status='CURRENT'
    and complete_hard_constraint_compilation=true
  limit 1;

  if v_current_schedule.version<>p_expected_schedule_version then
    raise exception 'STALE_SCHEDULE: expected %, current %',p_expected_schedule_version,v_current_schedule.version;
  end if;
  if v_current_rulebook is distinct from p_expected_rulebook_version then
    raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_current_rulebook;
  end if;
  if v_current_enforcement is distinct from p_expected_enforcement_version then
    raise exception 'STALE_ENFORCEMENT: expected %, current %',p_expected_enforcement_version,v_current_enforcement;
  end if;
  if v_current_planning is distinct from p_expected_planning_dataset_version then
    raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_current_planning;
  end if;
  if v_current_constraint is distinct from p_expected_constraint_model_version then
    raise exception 'STALE_CONSTRAINT_MODEL: expected %, current %',p_expected_constraint_model_version,v_current_constraint;
  end if;
  if v_planning_confirmed is null then
    raise exception 'PLANNING_DATASET_NOT_CONFIRMED: Planning Dataset v% is not confirmed for scheduling',v_current_planning;
  end if;

  select count(*)::integer into v_invalid
  from jsonb_array_elements(p_candidate) elem
  where jsonb_typeof(elem) <> 'object'
     or not (elem ?& array['sessionId','day','startTime','endTime','teacherId','roomId'])
     or (elem - array['sessionId','day','startTime','endTime','teacherId','roomId']) <> '{}'::jsonb
     or jsonb_typeof(elem->'sessionId') <> 'string'
     or jsonb_typeof(elem->'day') <> 'string'
     or jsonb_typeof(elem->'startTime') <> 'string'
     or jsonb_typeof(elem->'endTime') <> 'string'
     or jsonb_typeof(elem->'teacherId') <> 'string'
     or jsonb_typeof(elem->'roomId') <> 'string'
     or btrim(elem->>'sessionId')=''
     or btrim(elem->>'teacherId')=''
     or btrim(elem->>'roomId')='';
  if v_invalid>0 then
    raise exception 'CANDIDATE_INVALID_ASSIGNMENTS: % assignment row(s) have a non-canonical shape',v_invalid;
  end if;

  select count(*)::integer,
         count(distinct elem->>'sessionId')::integer
    into v_candidate_sessions, v_distinct_candidate_sessions
  from jsonb_array_elements(p_candidate) elem;

  -- Completeness is defined by the active Planning Dataset inventory. A session
  -- is active only when both the session and its parent class are active.
  select count(*)::integer into v_expected_sessions
  from public.class_sessions s
  join public.class_definitions c
    on c.studio_id=s.studio_id and c.id=s.class_id and c.archived_at is null
  where s.studio_id=p_studio_id
    and s.archived_at is null;

  if v_candidate_sessions<>v_expected_sessions
     or v_distinct_candidate_sessions<>v_expected_sessions then
    raise exception 'CANDIDATE_SESSION_SET_MISMATCH: expected % active sessions, received % rows / % distinct sessions',
      v_expected_sessions,v_candidate_sessions,v_distinct_candidate_sessions;
  end if;

  -- Resolve only ACTIVE identities. The service already validates against the
  -- active canonical state; this repeats that boundary transactionally so an
  -- archived identity cannot be smuggled into adoption by a stale or malicious
  -- caller.
  select count(*)::integer into v_invalid
  from jsonb_array_elements(p_candidate) elem
  left join public.class_sessions s
    on s.studio_id=p_studio_id
   and s.id=elem->>'sessionId'
   and s.archived_at is null
  left join public.class_definitions c
    on c.studio_id=p_studio_id
   and c.id=s.class_id
   and c.archived_at is null
  left join public.teachers t
    on t.studio_id=p_studio_id
   and t.id=elem->>'teacherId'
   and t.archived_at is null
  left join public.rooms r
    on r.studio_id=p_studio_id
   and r.id=elem->>'roomId'
   and r.archived_at is null
  where s.id is null
     or c.id is null
     or t.id is null
     or r.id is null
     or elem->>'day' not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
     or elem->>'startTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
     or elem->>'endTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
     or case when elem->>'startTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             then extract(second from (elem->>'startTime')::time)<>0
             else true end
     or case when elem->>'endTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             then extract(second from (elem->>'endTime')::time)<>0
             else true end
     or case when elem->>'startTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                  and elem->>'endTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             then mod(extract(minute from (elem->>'startTime')::time)::integer,15)<>0
             else true end
     or case when elem->>'startTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                  and elem->>'endTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             then mod(extract(minute from (elem->>'endTime')::time)::integer,15)<>0
             else true end
     or case when elem->>'startTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                  and elem->>'endTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             then (elem->>'endTime')::time <= (elem->>'startTime')::time
             else true end
     or case when s.id is not null and c.id is not null
                  and elem->>'startTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                  and elem->>'endTime' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             then (elem->>'endTime')::time is distinct from
               ((elem->>'startTime')::time + make_interval(mins=>coalesce(s.duration_minutes,c.duration_minutes)))
             else false end;
  if v_invalid>0 then
    raise exception 'CANDIDATE_INVALID_ASSIGNMENTS: % assignment row(s) failed active canonical ID/day/time-grid/interval validation',v_invalid;
  end if;

  -- A stale schedule is not a general source of planning truth. Preserve locks
  -- only for sessions that are still active. Archived sessions remain resolvable
  -- through historical ScheduleVersions but no longer constrain a new schedule.
  select count(*)::integer into v_locked_changed
  from public.class_sessions s
  join public.class_definitions c
    on c.studio_id=s.studio_id and c.id=s.class_id and c.archived_at is null
  join public.assignments old_a
    on old_a.schedule_version_id=v_current_schedule.id and old_a.session_id=s.id
  left join lateral (
    select elem
    from jsonb_array_elements(p_candidate) elem
    where elem->>'sessionId'=s.id
    limit 1
  ) candidate on true
  where s.studio_id=p_studio_id
    and s.archived_at is null
    and s.locked=true
    and (
      candidate.elem is null
      or candidate.elem->>'day' is distinct from old_a.day
      or (candidate.elem->>'startTime')::time is distinct from old_a.start_time
      or candidate.elem->>'teacherId' is distinct from old_a.teacher_id
      or candidate.elem->>'roomId' is distinct from old_a.room_id
    );
  if v_locked_changed>0 then
    raise exception 'LOCKED_SESSION_PLACEMENT_CHANGED: % active locked placement(s) changed',v_locked_changed;
  end if;

  if exists (
    select 1
    from public.class_sessions s
    join public.class_definitions c
      on c.studio_id=s.studio_id and c.id=s.class_id and c.archived_at is null
    where s.studio_id=p_studio_id
      and s.archived_at is null
      and s.locked=true
      and not exists (
        select 1 from public.assignments a
        where a.schedule_version_id=v_current_schedule.id and a.session_id=s.id
      )
  ) then
    raise exception 'LOCKED_SESSION_PLACEMENT_UNRESOLVED: an active locked session has no current assignment';
  end if;

  select coalesce(max(version),0)+1 into v_new_version
  from public.schedule_versions
  where studio_id=p_studio_id;

  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,planning_dataset_version,
    constraint_model_version,actor_user_id,actor_label,reason,is_current
  ) values(
    p_studio_id,v_new_version,v_current_rulebook,v_current_enforcement,v_current_planning,
    v_current_constraint,p_actor_user_id,p_actor_label,p_reason,false
  ) returning id into v_new_id;

  insert into public.assignments(
    schedule_version_id,id,studio_id,session_id,day,start_time,end_time,
    teacher_id,room_id,locked,status
  )
  select
    v_new_id,
    'solver:'||(elem->>'sessionId'),
    p_studio_id,
    elem->>'sessionId',
    elem->>'day',
    (elem->>'startTime')::time,
    (elem->>'endTime')::time,
    elem->>'teacherId',
    elem->>'roomId',
    s.locked,
    'NORMAL'
  from jsonb_array_elements(p_candidate) elem
  join public.class_sessions s
    on s.studio_id=p_studio_id
   and s.id=elem->>'sessionId'
   and s.archived_at is null
  join public.class_definitions c
    on c.studio_id=p_studio_id
   and c.id=s.class_id
   and c.archived_at is null
  join public.teachers t
    on t.studio_id=p_studio_id
   and t.id=elem->>'teacherId'
   and t.archived_at is null
  join public.rooms r
    on r.studio_id=p_studio_id
   and r.id=elem->>'roomId'
   and r.archived_at is null;

  if exists (
    select 1 from public.assignments
    where schedule_version_id=v_new_id and end_time<=start_time
  ) then
    raise exception 'CANDIDATE_INVALID_ASSIGNMENTS: an assignment crosses midnight';
  end if;

  select public.validate_schedule_hard_v25(v_new_id) into v_validation;
  v_hard:=coalesce((v_validation->>'hardViolations')::integer,0);
  if v_hard<>0 or coalesce((v_validation->>'fullyValidated')::boolean,false) is not true then
    raise exception 'LEGACY_HARD_VALIDATION_FAILED: %',v_validation::text;
  end if;

  v_validation:=coalesce(v_validation,'{}'::jsonb)
    || jsonb_build_object(
      'unscheduledSessions',0,
      'scheduleComplete',true,
      'constraintIrValidation',p_application_validation,
      'adoptionSource','CP_SAT'
    );

  update public.schedule_versions
  set is_current=false
  where id=v_current_schedule.id;

  update public.schedule_versions
  set is_current=true, validation_result=v_validation
  where id=v_new_id;

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    p_studio_id,p_actor_user_id,p_actor_label,'SOLVER_CANDIDATE_ADOPTED','SCHEDULE',v_new_id::text,p_reason,
    jsonb_build_object(
      'scheduleVersion',v_new_version,
      'previousScheduleVersion',v_current_schedule.version,
      'rulebookVersion',v_current_rulebook,
      'enforcementVersion',v_current_enforcement,
      'planningDatasetVersion',v_current_planning,
      'constraintModelVersion',v_current_constraint,
      'assignmentCount',v_expected_sessions,
      'applicationValidation',p_application_validation,
      'legacyValidation',v_validation
    )
  );

  return jsonb_build_object(
    'scheduleId',v_new_id,
    'scheduleVersion',v_new_version,
    'previousScheduleVersion',v_current_schedule.version,
    'rulebookVersion',v_current_rulebook,
    'enforcementVersion',v_current_enforcement,
    'planningDatasetVersion',v_current_planning,
    'constraintModelVersion',v_current_constraint,
    'assignmentCount',v_expected_sessions,
    'validation',v_validation
  );
end
$function$;

revoke execute on function public.adopt_solver_candidate_v33(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) from public, anon, authenticated;

grant execute on function public.adopt_solver_candidate_v33(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) to service_role;

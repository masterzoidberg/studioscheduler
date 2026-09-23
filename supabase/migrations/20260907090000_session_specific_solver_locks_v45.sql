-- T09 / V4.5 session-specific runtime solver locks.
--
-- Runtime lock precedence is SESSION OR ASSIGNMENT. A true planning-session lock
-- or a true lock on the current ScheduleVersion assignment protects that exact
-- stable session ID and placement. The previous V3.3 writer is retained under a
-- non-service-role name and wrapped so every adoption path carries assignment
-- locks forward while preserving the T08 reviewed-context transaction.

alter function public.adopt_solver_candidate_v33(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) rename to adopt_solver_candidate_v33_pre_v45;

revoke all on function public.adopt_solver_candidate_v33_pre_v45(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) from public,anon,authenticated,service_role;

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
security definer
set search_path=''
as $function$
declare
  v_current_schedule public.schedule_versions%rowtype;
  v_locked_changed integer := 0;
  v_unresolved integer := 0;
  v_result jsonb;
  v_new_id uuid;
  v_preserved_assignment_locks integer := 0;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_candidate is null or jsonb_typeof(p_candidate)<>'array' then raise exception 'Candidate must be a JSON array'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  select * into v_current_schedule
  from public.schedule_versions
  where studio_id=p_studio_id and is_current
  limit 1;
  if v_current_schedule.id is null then raise exception 'No current schedule exists'; end if;

  -- A planning-session lock cannot be resolved without exactly one current
  -- assignment. Assignment-only locks necessarily have the assignment row that
  -- carries the lock. Archived sessions/classes are historical and excluded.
  select count(*)::integer into v_unresolved
  from public.class_sessions s
  join public.class_definitions c
    on c.studio_id=s.studio_id and c.id=s.class_id and c.archived_at is null
  where s.studio_id=p_studio_id
    and s.archived_at is null
    and s.locked=true
    and (
      select count(*) from public.assignments old_a
      where old_a.schedule_version_id=v_current_schedule.id and old_a.session_id=s.id
    )<>1;
  if v_unresolved>0 then
    raise exception 'LOCKED_SESSION_PLACEMENT_UNRESOLVED: % active session lock(s) do not have exactly one current assignment',v_unresolved;
  end if;

  -- Effective lock precedence is OR. Assignment false never cancels session true,
  -- and session false never cancels a current assignment lock. Compare the exact
  -- stable session placement before invoking the historical canonical writer.
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
    and (s.locked=true or old_a.locked=true)
    and (
      candidate.elem is null
      or candidate.elem->>'day' is distinct from old_a.day
      or candidate.elem->>'startTime' is distinct from to_char(old_a.start_time,'HH24:MI')
      or candidate.elem->>'teacherId' is distinct from old_a.teacher_id
      or candidate.elem->>'roomId' is distinct from old_a.room_id
    );
  if v_locked_changed>0 then
    raise exception 'LOCKED_SESSION_PLACEMENT_CHANGED: % effective locked placement(s) changed',v_locked_changed;
  end if;

  v_result := public.adopt_solver_candidate_v33_pre_v45(
    p_studio_id,
    p_actor_user_id,
    p_actor_label,
    p_reason,
    p_expected_schedule_version,
    p_expected_rulebook_version,
    p_expected_enforcement_version,
    p_expected_planning_dataset_version,
    p_expected_constraint_model_version,
    p_candidate,
    p_application_validation
  );
  v_new_id := (v_result->>'scheduleId')::uuid;

  -- The historical writer already carries session locks from class_sessions.
  -- Reapply current assignment-only locks so the OR precedence survives adoption.
  update public.assignments new_a
  set locked=true
  from public.assignments old_a
  where new_a.schedule_version_id=v_new_id
    and old_a.schedule_version_id=v_current_schedule.id
    and old_a.session_id=new_a.session_id
    and old_a.locked=true
    and new_a.locked is distinct from true;
  get diagnostics v_preserved_assignment_locks = row_count;

  if exists (
    select 1
    from public.class_sessions s
    join public.class_definitions c
      on c.studio_id=s.studio_id and c.id=s.class_id and c.archived_at is null
    left join public.assignments old_a
      on old_a.schedule_version_id=v_current_schedule.id and old_a.session_id=s.id
    left join public.assignments new_a
      on new_a.schedule_version_id=v_new_id and new_a.session_id=s.id
    where s.studio_id=p_studio_id
      and s.archived_at is null
      and (s.locked=true or coalesce(old_a.locked,false)=true)
      and coalesce(new_a.locked,false) is distinct from true
  ) then
    raise exception 'LOCKED_SESSION_PERSISTENCE_FAILED: effective lock was lost during adoption';
  end if;

  update public.audit_events
  set payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
    'runtimeLockPrecedence','SESSION_OR_ASSIGNMENT',
    'preservedAssignmentLocks',v_preserved_assignment_locks
  )
  where studio_id=p_studio_id
    and action='SOLVER_CANDIDATE_ADOPTED'
    and entity_id=v_new_id::text;

  return v_result || jsonb_build_object(
    'runtimeLockPrecedence','SESSION_OR_ASSIGNMENT',
    'preservedAssignmentLocks',v_preserved_assignment_locks
  );
end
$function$;

revoke all on function public.adopt_solver_candidate_v33(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.adopt_solver_candidate_v33(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,jsonb,jsonb
) to service_role;

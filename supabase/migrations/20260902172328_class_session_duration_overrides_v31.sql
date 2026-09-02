-- Milestone 2 / V3.1 atomic per-session duration overrides.
-- Class-level duration remains the default; individual weekly sessions may override it.
-- This is scheduling-significant planning data, so one atomic edit advances PlanningDatasetVersion.

create or replace function public.update_class_session_durations_v31(
  p_class_id text,
  p_session_durations jsonb,
  p_reason text,
  p_expected_planning_dataset_version integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  ctx jsonb := private.assert_editor_context();
  v_uid uuid := (ctx->>'user_id')::uuid;
  v_studio uuid := (ctx->>'studio_id')::uuid;
  v_actor text := ctx->>'actor';
  v_current_planning integer;
  v_planning_version integer;
  v_class_name text;
  v_before jsonb;
  v_after jsonb;
  v_missing text[];
  v_extra text[];
  v_invalid text[];
  v_changed integer := 0;
begin
  if coalesce(btrim(p_class_id),'')='' then raise exception 'Class ID is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  if jsonb_typeof(coalesce(p_session_durations,'null'::jsonb)) <> 'object' then
    raise exception 'Session durations must be a JSON object keyed by session ID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-entity:'||v_studio::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||v_studio::text,0));

  select version into v_current_planning
  from public.planning_dataset_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;
  if v_current_planning is null then raise exception 'No current PlanningDatasetVersion exists'; end if;
  if v_current_planning <> p_expected_planning_dataset_version then
    raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_current_planning;
  end if;

  select name into v_class_name
  from public.class_definitions
  where studio_id=v_studio and id=p_class_id;
  if v_class_name is null then raise exception 'Class % is not part of this studio',p_class_id; end if;

  select array_agg(s.id order by s.id) into v_missing
  from public.class_sessions s
  where s.studio_id=v_studio and s.class_id=p_class_id
    and not (p_session_durations ? s.id);
  if coalesce(array_length(v_missing,1),0)>0 then
    raise exception 'Session duration payload is missing current session IDs: %',array_to_string(v_missing,', ');
  end if;

  select array_agg(e.key order by e.key) into v_extra
  from jsonb_each(p_session_durations) e
  where not exists(
    select 1 from public.class_sessions s
    where s.studio_id=v_studio and s.class_id=p_class_id and s.id=e.key
  );
  if coalesce(array_length(v_extra,1),0)>0 then
    raise exception 'Session duration payload contains unknown session IDs: %',array_to_string(v_extra,', ');
  end if;

  select array_agg(e.key order by e.key) into v_invalid
  from jsonb_each(p_session_durations) e
  where jsonb_typeof(e.value) not in ('number','null')
     or (jsonb_typeof(e.value)='number' and (
       (e.value #>> '{}') !~ '^[0-9]+$'
       or (e.value #>> '{}')::numeric <= 0
       or (e.value #>> '{}')::numeric > 1440
     ));
  if coalesce(array_length(v_invalid,1),0)>0 then
    raise exception 'Session durations must be positive whole minutes or null to inherit the class duration. Invalid session IDs: %',array_to_string(v_invalid,', ');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,
    'ordinal',s.ordinal,
    'durationMinutes',s.duration_minutes,
    'effectiveDurationMinutes',coalesce(s.duration_minutes,c.duration_minutes)
  ) order by s.ordinal),'[]'::jsonb)
  into v_before
  from public.class_sessions s
  join public.class_definitions c on c.id=s.class_id and c.studio_id=s.studio_id
  where s.studio_id=v_studio and s.class_id=p_class_id;

  with requested as (
    select e.key as session_id,
      case when jsonb_typeof(e.value)='null' then null::integer else (e.value #>> '{}')::integer end as duration_minutes
    from jsonb_each(p_session_durations) e
  ), changed as (
    update public.class_sessions s
    set duration_minutes=r.duration_minutes
    from requested r
    where s.studio_id=v_studio
      and s.class_id=p_class_id
      and s.id=r.session_id
      and s.duration_minutes is distinct from r.duration_minutes
    returning s.id
  )
  select count(*)::integer into v_changed from changed;

  v_planning_version := private.ensure_planning_dataset_version_v25(v_studio,v_uid,v_actor,p_reason);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,
    'ordinal',s.ordinal,
    'durationMinutes',s.duration_minutes,
    'effectiveDurationMinutes',coalesce(s.duration_minutes,c.duration_minutes)
  ) order by s.ordinal),'[]'::jsonb)
  into v_after
  from public.class_sessions s
  join public.class_definitions c on c.id=s.class_id and c.studio_id=s.studio_id
  where s.studio_id=v_studio and s.class_id=p_class_id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(
    v_studio,v_uid,v_actor,'CLASS_SESSION_DURATIONS_UPDATE','CLASS',p_class_id,p_reason,
    jsonb_build_object(
      'className',v_class_name,
      'before',v_before,
      'after',v_after,
      'changedSessions',v_changed,
      'planningDatasetVersion',v_planning_version,
      'previousPlanningDatasetVersion',v_current_planning,
      'scheduleRequiresRevalidation',v_planning_version<>v_current_planning
    )
  );

  return jsonb_build_object(
    'classId',p_class_id,
    'className',v_class_name,
    'changedSessions',v_changed,
    'planningDatasetVersion',v_planning_version,
    'previousPlanningDatasetVersion',v_current_planning,
    'scheduleRequiresRevalidation',v_planning_version<>v_current_planning,
    'before',v_before,
    'after',v_after
  );
end
$function$;

revoke all on function public.update_class_session_durations_v31(text,jsonb,text,integer) from public,anon;
grant execute on function public.update_class_session_durations_v31(text,jsonb,text,integer) to authenticated,service_role;

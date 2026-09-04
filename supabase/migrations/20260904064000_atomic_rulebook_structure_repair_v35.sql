-- V3.5 atomic existing-class Rulebook structure repair.
--
-- A reviewed structural repair must never persist a half-repaired class between
-- frequency and per-session duration edits. The browser supplies only the class
-- identity and concurrency token. The database derives the verified Ballet/Pointe
-- structure from the canonical class name and applies it in one transaction.

create or replace function public.apply_rulebook_structure_repair_v35(
  p_class_id text,
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
  v_name text;
  v_key text;
  v_frequency integer;
  v_old_frequency integer;
  v_durations integer[];
  v_uniform_duration integer;
  v_ordinal integer;
  v_session_id text;
  v_before jsonb;
  v_after jsonb;
  v_entity_version integer;
begin
  if coalesce(btrim(p_class_id),'')='' then raise exception 'Class ID is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

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

  select c.name,c.weekly_frequency
  into v_name,v_old_frequency
  from public.class_definitions c
  where c.studio_id=v_studio and c.id=p_class_id;
  if v_name is null then raise exception 'Class % is not part of this studio',p_class_id; end if;

  v_key := regexp_replace(lower(btrim(v_name)), '[^a-z0-9]+', '', 'g');

  if v_key='elementaryballet1' then v_frequency:=1; v_durations:=array[60];
  elsif v_key='elementaryballet2' then v_frequency:=2; v_durations:=array[75,75];
  elsif v_key='ballet1' then v_frequency:=2; v_durations:=array[90,90];
  elsif v_key='ballet2' then v_frequency:=2; v_durations:=array[90,90];
  elsif v_key='ballet3' then v_frequency:=2; v_durations:=array[90,90];
  elsif v_key='ballet4a' then v_frequency:=1; v_durations:=null;
  elsif v_key='ballet4a4b' then v_frequency:=1; v_durations:=array[90];
  elsif v_key='ballet4b5' then v_frequency:=2; v_durations:=array[90,105];
  elsif v_key='ballet5' then v_frequency:=1; v_durations:=array[90];
  elsif v_key='prepointe' then v_frequency:=1; v_durations:=array[30];
  elsif v_key='pointe1' then v_frequency:=1; v_durations:=array[30];
  elsif v_key='pointe23' then v_frequency:=1; v_durations:=array[60];
  else
    raise exception 'RULEBOOK_STRUCTURE_REPAIR_UNSUPPORTED: % is not a verified Ballet/Pointe structure target',v_name;
  end if;

  if (
    select count(*)
    from public.class_definitions c
    where c.studio_id=v_studio
      and regexp_replace(lower(btrim(c.name)), '[^a-z0-9]+', '', 'g')=v_key
  ) <> 1 then
    raise exception 'RULEBOOK_STRUCTURE_REPAIR_AMBIGUOUS: % does not resolve to exactly one current class',v_name;
  end if;

  select jsonb_build_object(
    'class',to_jsonb(c),
    'sessions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,
        'ordinal',s.ordinal,
        'locked',s.locked,
        'durationMinutes',s.duration_minutes,
        'effectiveDurationMinutes',coalesce(s.duration_minutes,c.duration_minutes)
      ) order by s.ordinal)
      from public.class_sessions s
      where s.studio_id=v_studio and s.class_id=c.id
    ),'[]'::jsonb)
  ) into v_before
  from public.class_definitions c
  where c.studio_id=v_studio and c.id=p_class_id;

  if v_frequency < v_old_frequency and exists(
    select 1
    from public.class_sessions s
    join public.assignments a on a.session_id=s.id
    where s.studio_id=v_studio and s.class_id=p_class_id and s.ordinal>v_frequency
  ) then
    raise exception 'CLASS_FREQUENCY_REDUCTION_BLOCKED: a removed session is referenced by schedule history';
  end if;

  if v_durations is not null and array_length(v_durations,1)>0
     and (select count(distinct x) from unnest(v_durations) x)=1 then
    v_uniform_duration:=v_durations[1];
  else
    v_uniform_duration:=null;
  end if;

  update public.class_definitions
  set weekly_frequency=v_frequency,
      duration_minutes=coalesce(v_uniform_duration,duration_minutes),
      updated_at=now()
  where studio_id=v_studio and id=p_class_id;

  if v_frequency < v_old_frequency then
    delete from public.class_sessions
    where studio_id=v_studio and class_id=p_class_id and ordinal>v_frequency;
  end if;

  for v_ordinal in 1..v_frequency loop
    if not exists(
      select 1 from public.class_sessions
      where studio_id=v_studio and class_id=p_class_id and ordinal=v_ordinal
    ) then
      v_session_id:='session-'||regexp_replace(p_class_id,'^class-','')||'-'||v_ordinal::text;
      if exists(select 1 from public.class_sessions where id=v_session_id) then
        v_session_id:=v_session_id||'-'||substr(gen_random_uuid()::text,1,8);
      end if;
      insert into public.class_sessions(id,studio_id,class_id,ordinal,locked,duration_minutes)
      values(v_session_id,v_studio,p_class_id,v_ordinal,false,null);
    end if;
  end loop;

  if v_durations is not null then
    if v_uniform_duration is not null then
      update public.class_sessions
      set duration_minutes=null
      where studio_id=v_studio and class_id=p_class_id;
    else
      -- The Rulebook establishes the duration multiset, not weekday semantics.
      -- Ordinal order is the canonical storage normalization for that multiset.
      for v_ordinal in 1..v_frequency loop
        update public.class_sessions
        set duration_minutes=v_durations[v_ordinal]
        where studio_id=v_studio and class_id=p_class_id and ordinal=v_ordinal;
      end loop;
    end if;
  end if;

  select jsonb_build_object(
    'class',to_jsonb(c),
    'sessions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,
        'ordinal',s.ordinal,
        'locked',s.locked,
        'durationMinutes',s.duration_minutes,
        'effectiveDurationMinutes',coalesce(s.duration_minutes,c.duration_minutes)
      ) order by s.ordinal)
      from public.class_sessions s
      where s.studio_id=v_studio and s.class_id=c.id
    ),'[]'::jsonb)
  ) into v_after
  from public.class_definitions c
  where c.studio_id=v_studio and c.id=p_class_id;

  if v_before = v_after then
    return jsonb_build_object(
      'classId',p_class_id,
      'className',v_name,
      'changed',false,
      'planningDatasetVersion',v_current_planning,
      'scheduleRequiresRevalidation',false,
      'before',v_before,
      'after',v_after
    );
  end if;

  select coalesce(max(version),0)+1 into v_entity_version
  from public.entity_versions
  where studio_id=v_studio and entity_type='CLASS' and entity_id=p_class_id;

  insert into public.entity_versions(
    studio_id,entity_type,entity_id,version,actor_user_id,actor_label,reason,before_entity,after_entity
  ) values(
    v_studio,'CLASS',p_class_id,v_entity_version,v_uid,v_actor,p_reason,v_before,v_after
  );

  v_planning_version:=private.ensure_planning_dataset_version_v25(v_studio,v_uid,v_actor,p_reason);

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    v_studio,v_uid,v_actor,'RULEBOOK_STRUCTURE_REPAIR','CLASS',p_class_id,p_reason,
    jsonb_build_object(
      'className',v_name,
      'before',v_before,
      'after',v_after,
      'entityVersion',v_entity_version,
      'planningDatasetVersion',v_planning_version,
      'previousPlanningDatasetVersion',v_current_planning,
      'scheduleRequiresRevalidation',true
    )
  );

  return jsonb_build_object(
    'classId',p_class_id,
    'className',v_name,
    'changed',true,
    'entityVersion',v_entity_version,
    'planningDatasetVersion',v_planning_version,
    'previousPlanningDatasetVersion',v_current_planning,
    'scheduleRequiresRevalidation',true,
    'before',v_before,
    'after',v_after
  );
end
$function$;

revoke all on function public.apply_rulebook_structure_repair_v35(text,text,integer) from public,anon;
grant execute on function public.apply_rulebook_structure_repair_v35(text,text,integer) to authenticated,service_role;

-- Milestone 2 / V2.5 session-level curriculum duration + planning-aware rebase.
--
-- The reviewed Rulebook contains repeated classes whose weekly meetings can have
-- different durations (notably Ballet 4B/5 at 105 and 90 minutes). A duration
-- only on class_definitions cannot faithfully represent that approved fact.

alter table public.class_sessions
  add column if not exists duration_minutes integer;

alter table public.class_sessions
  drop constraint if exists class_sessions_duration_minutes_check;
alter table public.class_sessions
  add constraint class_sessions_duration_minutes_check
  check (duration_minutes is null or duration_minutes > 0);

-- Planning Dataset schema 1.1 adds the nullable per-session duration override.
-- NULL means the session inherits class_definitions.duration_minutes.
create or replace function private.build_planning_dataset_snapshot_v25(p_studio uuid)
returns jsonb
language sql
stable
set search_path=''
as $function$
  select jsonb_build_object(
    'schemaVersion', '1.1',
    'studioId', p_studio::text,
    'teacherIds', coalesce((
      select jsonb_agg(t.id order by t.id)
      from public.teachers t
      where t.studio_id=p_studio
    ), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'capacity', r.capacity,
          'features', private.sorted_text_array_jsonb_v25(r.features)
        ) order by r.id
      )
      from public.rooms r
      where r.studio_id=p_studio
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'level', s.level,
          'cohortIds', private.sorted_text_array_jsonb_v25(s.cohort_ids)
        ) order by s.id
      )
      from public.students s
      where s.studio_id=p_studio
    ), '[]'::jsonb),
    'cohorts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'studentIds', private.sorted_text_array_jsonb_v25(c.student_ids)
        ) order by c.id
      )
      from public.cohorts c
      where c.studio_id=p_studio
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'subject', c.subject,
          'level', c.level,
          'durationMinutes', c.duration_minutes,
          'weeklyFrequency', c.weekly_frequency,
          'rosterStudentIds', private.sorted_text_array_jsonb_v25(c.roster_student_ids),
          'companyOnly', c.company_only
        ) order by c.id
      )
      from public.class_definitions c
      where c.studio_id=p_studio
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'classId', s.class_id,
          'ordinal', s.ordinal,
          'durationMinutes', s.duration_minutes,
          'locked', s.locked
        ) order by s.id
      )
      from public.class_sessions s
      where s.studio_id=p_studio
    ), '[]'::jsonb)
  )
$function$;

-- Create a new PlanningDatasetVersion only because the canonical snapshot schema
-- changed. Existing ScheduleVersions stay pinned to their historical snapshot.
do $block$
declare
  v_studio uuid;
begin
  for v_studio in select id from public.studios loop
    perform private.ensure_planning_dataset_version_v25(
      v_studio,
      null,
      'V2.5 session duration migration',
      'Planning Dataset schema 1.1 adds session duration overrides'
    );
  end loop;
end
$block$;

-- V2.5 validator adapter preserves the existing enforcement engine while replacing
-- CLASS_DURATION evaluation with effective session duration semantics.
create or replace function public.validate_schedule_hard_v25(p_schedule_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_studio uuid;
  v_enforcement_version integer;
  v_base jsonb;
  v_duration_rule_ids text[];
  v_kept jsonb := '[]'::jsonb;
  v_duration_violations jsonb := '[]'::jsonb;
  v_violations jsonb := '[]'::jsonb;
  v_hard integer := 0;
  v_total integer := 0;
  v_unimplemented integer := 0;
  v_partial integer := 0;
begin
  select sv.studio_id, sv.enforcement_version
  into v_studio, v_enforcement_version
  from public.schedule_versions sv
  where sv.id=p_schedule_version_id;

  if v_studio is null then raise exception 'Schedule version not found'; end if;

  v_base := public.validate_schedule_hard_v22(p_schedule_version_id);

  select array_agg(m.elem->>'ruleId' order by m.elem->>'ruleId')
  into v_duration_rule_ids
  from public.rule_enforcement_versions ev
  cross join lateral jsonb_array_elements(ev.snapshot) as m(elem)
  join public.rules r
    on r.studio_id=v_studio
   and r.id=m.elem->>'ruleId'
   and r.status='ACTIVE'
   and upper(r.classification_raw)='HARD'
  where ev.studio_id=v_studio
    and ev.version=v_enforcement_version
    and m.elem->>'type'='CLASS_DURATION';

  if coalesce(cardinality(v_duration_rule_ids),0)=0 then
    return v_base;
  end if;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  into v_kept
  from jsonb_array_elements(coalesce(v_base->'violations','[]'::jsonb)) elem
  where not ((elem->>'constraintId') = any(v_duration_rule_ids));

  select coalesce(jsonb_agg(obj order by rule_id, assignment_id), '[]'::jsonb)
  into v_duration_violations
  from (
    select
      m.elem->>'ruleId' as rule_id,
      a.id as assignment_id,
      jsonb_build_object(
        'constraintId', m.elem->>'ruleId',
        'severity', 'HARD',
        'message', c.name||' must preserve its '||coalesce(s.duration_minutes,c.duration_minutes)||'-minute session duration.',
        'assignmentIds', jsonb_build_array(a.id),
        'affectedEntityIds', jsonb_build_array(c.id,s.id)
      ) as obj
    from public.rule_enforcement_versions ev
    cross join lateral jsonb_array_elements(ev.snapshot) as m(elem)
    join public.rules r
      on r.studio_id=v_studio
     and r.id=m.elem->>'ruleId'
     and r.status='ACTIVE'
     and upper(r.classification_raw)='HARD'
    join public.assignments a on a.schedule_version_id=p_schedule_version_id
    join public.class_sessions s on s.id=a.session_id and s.studio_id=v_studio
    join public.class_definitions c on c.id=s.class_id and c.studio_id=v_studio
    where ev.studio_id=v_studio
      and ev.version=v_enforcement_version
      and m.elem->>'type'='CLASS_DURATION'
      and (extract(epoch from (a.end_time-a.start_time))/60)::integer <> coalesce(s.duration_minutes,c.duration_minutes)
  ) duration_rows;

  v_violations := coalesce(v_kept,'[]'::jsonb) || coalesce(v_duration_violations,'[]'::jsonb);
  v_total := jsonb_array_length(v_violations);
  select count(*)::integer into v_hard
  from jsonb_array_elements(v_violations) elem
  where elem->>'severity'='HARD';

  v_unimplemented := coalesce((v_base->'coverage'->>'notImplementedHardRules')::integer,0);
  v_partial := coalesce((v_base->'coverage'->>'partialHardRules')::integer,0);

  return v_base || jsonb_build_object(
    'valid', v_hard=0,
    'fullyValidated', v_hard=0 and v_unimplemented=0 and v_partial=0,
    'hardViolations', v_hard,
    'warnings', v_total-v_hard,
    'violations', v_violations
  );
end
$function$;

revoke all on function public.validate_schedule_hard_v25(uuid) from public, anon;
grant execute on function public.validate_schedule_hard_v25(uuid) to authenticated, service_role;

-- Rebase now treats RulebookVersion + EnforcementVersion + PlanningDatasetVersion
-- as the complete versioned policy/data context for the current manual schedule.
create or replace function public.rebase_current_schedule_v25(
  p_expected_schedule_version integer,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,
  p_expected_planning_dataset_version integer,
  p_reason text default 'Revalidate unchanged assignments against current scheduling context'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  ctx jsonb:=private.assert_editor_context();
  v_uid uuid:=(ctx->>'user_id')::uuid;
  v_studio uuid:=(ctx->>'studio_id')::uuid;
  v_actor text:=ctx->>'actor';
  v_old public.schedule_versions%rowtype;
  v_rb integer;
  v_ev integer;
  v_pdv integer;
  v_new_id uuid;
  v_new_version integer;
  v_validation jsonb;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||v_studio::text,0));

  select * into v_old
  from public.schedule_versions
  where studio_id=v_studio and is_current
  limit 1;
  select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_ev from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
  select version into v_pdv from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT';

  if v_old.id is null then raise exception 'No current schedule exists'; end if;
  if v_old.version<>p_expected_schedule_version then raise exception 'STALE_SCHEDULE: expected %, current %',p_expected_schedule_version,v_old.version; end if;
  if v_rb<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rb; end if;
  if v_ev<>p_expected_enforcement_version then raise exception 'STALE_ENFORCEMENT: expected %, current %',p_expected_enforcement_version,v_ev; end if;
  if v_pdv<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_pdv; end if;

  if v_old.rulebook_version=v_rb
     and v_old.enforcement_version=v_ev
     and v_old.planning_dataset_version=v_pdv then
    select public.validate_schedule_hard_v25(v_old.id) into v_validation;
    update public.schedule_versions set validation_result=v_validation where id=v_old.id;
    return jsonb_build_object(
      'scheduleVersion',v_old.version,
      'rulebookVersion',v_rb,
      'enforcementVersion',v_ev,
      'planningDatasetVersion',v_pdv,
      'validation',v_validation,
      'alreadyCurrent',true
    );
  end if;

  v_new_version:=v_old.version+1;
  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,planning_dataset_version,
    actor_user_id,actor_label,reason,is_current
  ) values(
    v_studio,v_new_version,v_rb,v_ev,v_pdv,v_uid,v_actor,p_reason,false
  ) returning id into v_new_id;

  insert into public.assignments(
    schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
  )
  select
    v_new_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
  from public.assignments
  where schedule_version_id=v_old.id;

  select public.validate_schedule_hard_v25(v_new_id) into v_validation;

  update public.schedule_versions set is_current=false where id=v_old.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    v_studio,v_uid,v_actor,'SCHEDULE_REBASE','SCHEDULE_VERSION',v_new_id::text,p_reason,
    jsonb_build_object(
      'fromScheduleVersion',v_old.version,
      'toScheduleVersion',v_new_version,
      'fromRulebookVersion',v_old.rulebook_version,
      'toRulebookVersion',v_rb,
      'fromEnforcementVersion',v_old.enforcement_version,
      'toEnforcementVersion',v_ev,
      'fromPlanningDatasetVersion',v_old.planning_dataset_version,
      'toPlanningDatasetVersion',v_pdv,
      'validation',v_validation
    )
  );

  return jsonb_build_object(
    'scheduleVersion',v_new_version,
    'rulebookVersion',v_rb,
    'enforcementVersion',v_ev,
    'planningDatasetVersion',v_pdv,
    'validation',v_validation,
    'alreadyCurrent',false
  );
end
$function$;

revoke all on function public.rebase_current_schedule_v25(integer,integer,integer,integer,text) from public, anon;
grant execute on function public.rebase_current_schedule_v25(integer,integer,integer,integer,text) to authenticated, service_role;

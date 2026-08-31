-- V2.2 deterministic validator.
-- Validation is driven by the EnforcementVersion snapshot attached to the ScheduleVersion.
-- Human-reviewed Rulebook rows supply authority/severity/text, but no hidden machine interpretation.

create or replace function public.validate_schedule_hard_v22(p_schedule_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_studio uuid;
  v_enforcement_version integer;
  v_snapshot jsonb;
  v_violations jsonb;
  v_hard integer;
  v_applicable integer;
  v_implemented integer;
  v_uncovered text[];
begin
  select sv.studio_id,sv.enforcement_version
  into v_studio,v_enforcement_version
  from public.schedule_versions sv
  where sv.id=p_schedule_version_id;

  if v_studio is null then raise exception 'Schedule version not found'; end if;
  if auth.uid() is not null and not private.is_studio_member(v_studio) then
    raise exception 'Studio membership required';
  end if;

  select ev.snapshot into v_snapshot
  from public.rule_enforcement_versions ev
  where ev.studio_id=v_studio and ev.version=v_enforcement_version;

  if v_snapshot is null then
    raise exception 'Enforcement version % not found for schedule',v_enforcement_version;
  end if;

  with mappings as (
    select elem as mapping
    from jsonb_array_elements(v_snapshot) elem
    join public.rules r
      on r.studio_id=v_studio
     and r.id=elem->>'ruleId'
     and r.status='ACTIVE'
     and upper(r.classification_raw)='HARD'
  ),
  assignment_base as (
    select
      a.id,a.day,a.start_time,a.end_time,a.teacher_id,a.room_id,a.session_id,
      s.class_id,c.name as class_name,c.subject,c.level,c.duration_minutes,c.weekly_frequency,c.roster_student_ids
    from public.assignments a
    join public.class_sessions s on s.id=a.session_id
    join public.class_definitions c on c.id=s.class_id
    where a.schedule_version_id=p_schedule_version_id
  ),
  teacher_gap_rows as (
    select
      a.*,
      lag(a.id) over(partition by a.teacher_id,a.day order by a.start_time,a.end_time,a.id) as previous_id,
      lag(a.end_time) over(partition by a.teacher_id,a.day order by a.start_time,a.end_time,a.id) as previous_end
    from assignment_base a
  ),
  student_assignment_rows as (
    select
      a.id,a.day,a.start_time,a.end_time,a.class_id,a.class_name,
      student_id,
      lag(a.id) over(partition by student_id,a.day order by a.start_time,a.end_time,a.id) as previous_id,
      lag(a.end_time) over(partition by student_id,a.day order by a.start_time,a.end_time,a.id) as previous_end
    from assignment_base a
    cross join lateral unnest(a.roster_student_ids) student_id
  ),
  violations as (
    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',a.class_name||' must preserve its '||a.duration_minutes||'-minute curriculum duration.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id)
    ) as obj
    from mappings m
    join assignment_base a on true
    where m.mapping->>'type'='CLASS_DURATION'
      and (extract(epoch from (a.end_time-a.start_time))/60)::integer<>a.duration_minutes

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',a.class_name||' must start and end on the 15-minute scheduling grid.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id)
    )
    from mappings m
    join assignment_base a on true
    where m.mapping->>'type'='TIME_GRID'
      and ((extract(minute from a.start_time)::integer % 15)<>0 or (extract(minute from a.end_time)::integer % 15)<>0)

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',coalesce(r.name,a1.room_id)||' is double-booked on '||a1.day||'.',
      'assignmentIds',jsonb_build_array(a1.id,a2.id),'affectedEntityIds',jsonb_build_array(a1.room_id)
    )
    from mappings m
    join assignment_base a1 on true
    join assignment_base a2 on a2.id>a1.id and a2.day=a1.day and a2.room_id=a1.room_id
      and a1.start_time<a2.end_time and a2.start_time<a1.end_time
    left join public.rooms r on r.id=a1.room_id
    where m.mapping->>'type'='ROOM_NO_OVERLAP'

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',coalesce(t.name,a1.teacher_id)||' is double-booked on '||a1.day||'.',
      'assignmentIds',jsonb_build_array(a1.id,a2.id),'affectedEntityIds',jsonb_build_array(a1.teacher_id)
    )
    from mappings m
    join assignment_base a1 on true
    join assignment_base a2 on a2.id>a1.id and a2.day=a1.day and a2.teacher_id=a1.teacher_id
      and a1.start_time<a2.end_time and a2.start_time<a1.end_time
    left join public.teachers t on t.id=a1.teacher_id
    where m.mapping->>'type'='TEACHER_NO_OVERLAP'

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message','A dancer is double-booked between '||a1.class_name||' and '||a2.class_name||' on '||a1.day||'.',
      'assignmentIds',jsonb_build_array(a1.id,a2.id),
      'affectedEntityIds',to_jsonb(array(select unnest(a1.roster_student_ids) intersect select unnest(a2.roster_student_ids)))
    )
    from mappings m
    join assignment_base a1 on true
    join assignment_base a2 on a2.id>a1.id and a2.day=a1.day
      and a1.start_time<a2.end_time and a2.start_time<a1.end_time
    where m.mapping->>'type'='STUDENT_NO_OVERLAP'
      and a1.roster_student_ids && a2.roster_student_ids

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',c.name||' has '||count(a.id)||' scheduled weekly session(s); curriculum frequency is '||c.weekly_frequency||'.',
      'assignmentIds',to_jsonb(coalesce(array_agg(a.id order by a.id) filter(where a.id is not null),'{}'::text[])),
      'affectedEntityIds',jsonb_build_array(c.id)
    )
    from mappings m
    join public.class_definitions c on c.studio_id=v_studio
    left join public.class_sessions s on s.class_id=c.id
    left join public.assignments a on a.schedule_version_id=p_schedule_version_id and a.session_id=s.id
    where m.mapping->>'type'='CLASS_FREQUENCY'
    group by m.mapping,c.id,c.name,c.weekly_frequency
    having count(a.id)<>c.weekly_frequency

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',a.class_name||' starts before '||(m.mapping->'parameters'->>'time')||'.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id)
    )
    from mappings m
    join assignment_base a on true
    where m.mapping->>'type'='EARLIEST_START'
      and a.start_time < (m.mapping->'parameters'->>'time')::time
      and (
        coalesce(jsonb_array_length(m.mapping->'parameters'->'days'),0)=0
        or (m.mapping->'parameters'->'days') ? a.day
      )
      and (
        coalesce(jsonb_array_length(m.mapping->'affectedEntityIds'),0)=0
        or (m.mapping->'affectedEntityIds') ? a.class_id
      )

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',a.class_name||' ends after '||(m.mapping->'parameters'->>'time')||'.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id)
    )
    from mappings m
    join assignment_base a on true
    where m.mapping->>'type'='LATEST_FINISH'
      and a.end_time > (m.mapping->'parameters'->>'time')::time
      and (
        coalesce(jsonb_array_length(m.mapping->'parameters'->'days'),0)=0
        or (m.mapping->'parameters'->'days') ? a.day
      )
      and (
        coalesce(jsonb_array_length(m.mapping->'affectedEntityIds'),0)=0
        or (m.mapping->'affectedEntityIds') ? a.class_id
      )

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',a.class_name||' cannot be scheduled on '||a.day||'.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id)
    )
    from mappings m
    join assignment_base a on true
    where m.mapping->>'type'='NO_DAY'
      and (m.mapping->'parameters'->'days') ? a.day
      and (
        coalesce(jsonb_array_length(m.mapping->'affectedEntityIds'),0)=0
        or (m.mapping->'affectedEntityIds') ? a.class_id
      )

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',coalesce(t.name,g.teacher_id)||' has a gap longer than '||(m.mapping->'parameters'->>'minutes')||' minutes on '||g.day||'.',
      'assignmentIds',jsonb_build_array(g.previous_id,g.id),'affectedEntityIds',jsonb_build_array(g.teacher_id)
    )
    from mappings m
    join teacher_gap_rows g on g.previous_end is not null
    left join public.teachers t on t.id=g.teacher_id
    where m.mapping->>'type'='MAX_TEACHER_GAP'
      and extract(epoch from (g.start_time-g.previous_end))/60 > (m.mapping->'parameters'->>'minutes')::numeric
      and (
        nullif(m.mapping->'parameters'->>'teacher_id','') is null
        or m.mapping->'parameters'->>'teacher_id'=g.teacher_id
      )

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',coalesce(s.name,g.student_id)||' has a gap longer than '||(m.mapping->'parameters'->>'minutes')||' minutes on '||g.day||'.',
      'assignmentIds',jsonb_build_array(g.previous_id,g.id),'affectedEntityIds',jsonb_build_array(g.student_id)
    )
    from mappings m
    join student_assignment_rows g on g.previous_end is not null
    left join public.students s on s.id=g.student_id
    where m.mapping->>'type'='MAX_STUDENT_GAP'
      and extract(epoch from (g.start_time-g.previous_end))/60 > (m.mapping->'parameters'->>'minutes')::numeric

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',coalesce(t.name,a.teacher_id)||' is scheduled on '||count(distinct a.day)||' days; maximum is '||(m.mapping->'parameters'->>'max_days')||'.',
      'assignmentIds',to_jsonb(array_agg(a.id order by a.id)),'affectedEntityIds',jsonb_build_array(a.teacher_id)
    )
    from mappings m
    join assignment_base a on a.teacher_id=m.mapping->'parameters'->>'teacher_id'
    left join public.teachers t on t.id=a.teacher_id
    where m.mapping->>'type'='MAX_TEACHER_WORKDAYS'
    group by m.mapping,t.name,a.teacher_id
    having count(distinct a.day)>(m.mapping->'parameters'->>'max_days')::integer

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',a.class_name||' requires '||coalesce(r.name,m.mapping->'parameters'->>'required_room_id')||'.',
      'assignmentIds',jsonb_build_array(a.id),
      'affectedEntityIds',jsonb_build_array(a.class_id,m.mapping->'parameters'->>'required_room_id')
    )
    from mappings m
    join assignment_base a on (m.mapping->'affectedEntityIds') ? a.class_id
    left join public.rooms r on r.id=m.mapping->'parameters'->>'required_room_id'
    where m.mapping->>'type'='REQUIRED_ROOM'
      and a.room_id<>m.mapping->'parameters'->>'required_room_id'

    union all

    select jsonb_build_object(
      'constraintId',m.mapping->>'ruleId','severity','HARD',
      'message',a.class_name||' requires '||coalesce(t.name,m.mapping->'parameters'->>'teacher_id')||'.',
      'assignmentIds',jsonb_build_array(a.id),
      'affectedEntityIds',jsonb_build_array(a.class_id,m.mapping->'parameters'->>'teacher_id')
    )
    from mappings m
    join assignment_base a on (m.mapping->'affectedEntityIds') ? a.class_id
    left join public.teachers t on t.id=m.mapping->'parameters'->>'teacher_id'
    where m.mapping->>'type'='REQUIRED_TEACHER'
      and a.teacher_id<>m.mapping->'parameters'->>'teacher_id'
  )
  select count(*)::integer,coalesce(jsonb_agg(obj),'[]'::jsonb)
  into v_hard,v_violations
  from violations;

  select count(*)::integer
  into v_applicable
  from public.rules r
  where r.studio_id=v_studio and r.status='ACTIVE' and upper(r.classification_raw)='HARD';

  select count(distinct elem->>'ruleId')::integer
  into v_implemented
  from jsonb_array_elements(v_snapshot) elem
  join public.rules r
    on r.studio_id=v_studio and r.id=elem->>'ruleId'
   and r.status='ACTIVE' and upper(r.classification_raw)='HARD';

  select coalesce(array_agg(r.id order by r.id),'{}'::text[])
  into v_uncovered
  from public.rules r
  where r.studio_id=v_studio
    and r.status='ACTIVE'
    and upper(r.classification_raw)='HARD'
    and not exists (
      select 1 from jsonb_array_elements(v_snapshot) elem where elem->>'ruleId'=r.id
    );

  return jsonb_build_object(
    'valid',v_hard=0,
    'fullyValidated',v_hard=0 and cardinality(v_uncovered)=0,
    'hardViolations',v_hard,
    'warnings',0,
    'violations',v_violations,
    'enforcementVersion',v_enforcement_version,
    'coverage',jsonb_build_object(
      'applicableHardRules',v_applicable,
      'implementedHardRules',v_implemented,
      'partialHardRules',0,
      'notImplementedHardRules',greatest(v_applicable-v_implemented,0),
      'notApplicableHardRules',0,
      'uncoveredHardRuleIds',to_jsonb(v_uncovered)
    )
  );
end
$function$;

revoke all on function public.validate_schedule_hard_v22(uuid) from public,anon;
grant execute on function public.validate_schedule_hard_v22(uuid) to authenticated,service_role;
create or replace function public.validate_schedule_hard_v21(p_schedule_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_studio uuid;
  v_violations jsonb;
  v_hard integer;
  v_impl integer;
  v_partial integer;
  v_missing integer;
  v_na integer;
  v_applicable integer;
begin
  select sv.studio_id into v_studio from public.schedule_versions sv where sv.id=p_schedule_version_id;
  if v_studio is null then raise exception 'Schedule version not found'; end if;
  if auth.uid() is not null and not private.is_studio_member(v_studio) then raise exception 'Studio membership required'; end if;

  select coalesce(jsonb_agg(v.obj),'[]'::jsonb) into v_violations
  from (
    select jsonb_build_object(
      'constraintId','OPS-017','severity','HARD',
      'message','Schedule start and end times must use 15-minute increments.',
      'assignmentIds',jsonb_build_array(a.id),'ruleIds',jsonb_build_array('OPS-017')
    ) as obj
    from public.assignments a
    where a.schedule_version_id=p_schedule_version_id
      and ((extract(minute from a.start_time)::integer % 15)<>0 or (extract(minute from a.end_time)::integer % 15)<>0)

    union all

    select jsonb_build_object(
      'constraintId','CUR-005','severity','HARD',
      'message',c.name||' is scheduled for '||(extract(epoch from (a.end_time-a.start_time))/60)::integer||' minutes but its curriculum duration is '||c.duration_minutes||' minutes.',
      'assignmentIds',jsonb_build_array(a.id),'ruleIds',jsonb_build_array('CUR-005')
    )
    from public.assignments a
    join public.class_sessions s on s.id=a.session_id
    join public.class_definitions c on c.id=s.class_id
    where a.schedule_version_id=p_schedule_version_id
      and (extract(epoch from (a.end_time-a.start_time))/60)::integer<>c.duration_minutes

    union all

    select jsonb_build_object(
      'constraintId','OPS-008','severity','HARD',
      'message','Room '||coalesce(r.name,a1.room_id)||' is double-booked on '||a1.day||'.',
      'assignmentIds',jsonb_build_array(a1.id,a2.id),'ruleIds',jsonb_build_array('OPS-008')
    )
    from public.assignments a1
    join public.assignments a2 on a2.schedule_version_id=a1.schedule_version_id and a2.id>a1.id
      and a2.day=a1.day and a2.room_id=a1.room_id
      and a1.start_time<a2.end_time and a2.start_time<a1.end_time
    left join public.rooms r on r.id=a1.room_id
    where a1.schedule_version_id=p_schedule_version_id

    union all

    select jsonb_build_object(
      'constraintId','OPS-009','severity','HARD',
      'message',coalesce(t.name,a1.teacher_id)||' is double-booked on '||a1.day||'.',
      'assignmentIds',jsonb_build_array(a1.id,a2.id),'ruleIds',jsonb_build_array('OPS-009')
    )
    from public.assignments a1
    join public.assignments a2 on a2.schedule_version_id=a1.schedule_version_id and a2.id>a1.id
      and a2.day=a1.day and a2.teacher_id=a1.teacher_id
      and a1.start_time<a2.end_time and a2.start_time<a1.end_time
    left join public.teachers t on t.id=a1.teacher_id
    where a1.schedule_version_id=p_schedule_version_id

    union all

    select jsonb_build_object(
      'constraintId','OPS-010','severity','HARD',
      'message','A dancer is double-booked between '||c1.name||' and '||c2.name||' on '||a1.day||'.',
      'assignmentIds',jsonb_build_array(a1.id,a2.id),'ruleIds',jsonb_build_array('OPS-010')
    )
    from public.assignments a1
    join public.assignments a2 on a2.schedule_version_id=a1.schedule_version_id and a2.id>a1.id
      and a2.day=a1.day and a1.start_time<a2.end_time and a2.start_time<a1.end_time
    join public.class_sessions s1 on s1.id=a1.session_id
    join public.class_sessions s2 on s2.id=a2.session_id
    join public.class_definitions c1 on c1.id=s1.class_id
    join public.class_definitions c2 on c2.id=s2.class_id
    where a1.schedule_version_id=p_schedule_version_id
      and c1.roster_student_ids && c2.roster_student_ids
  ) v;

  v_hard:=jsonb_array_length(v_violations);
  select
    count(*) filter (where r.enforcement_status='IMPLEMENTED')::integer,
    count(*) filter (where r.enforcement_status='PARTIAL')::integer,
    count(*) filter (where r.enforcement_status='NOT_IMPLEMENTED')::integer,
    count(*) filter (where r.enforcement_status='NOT_APPLICABLE')::integer,
    count(*) filter (where r.enforcement_status<>'NOT_APPLICABLE')::integer
  into v_impl,v_partial,v_missing,v_na,v_applicable
  from public.rules r
  where r.studio_id=v_studio and r.status='ACTIVE' and upper(r.classification_raw)='HARD';

  return jsonb_build_object(
    'valid',v_hard=0,
    'fullyValidated',v_hard=0 and v_impl=v_applicable,
    'hardViolations',v_hard,
    'warnings',0,
    'violations',v_violations,
    'coverage',jsonb_build_object(
      'applicableHardRules',v_applicable,
      'implementedHardRules',v_impl,
      'partialHardRules',v_partial,
      'notImplementedHardRules',v_missing,
      'notApplicableHardRules',v_na
    )
  );
end
$function$;

revoke all on function public.validate_schedule_hard_v21(uuid) from public, anon;
grant execute on function public.validate_schedule_hard_v21(uuid) to authenticated, service_role;
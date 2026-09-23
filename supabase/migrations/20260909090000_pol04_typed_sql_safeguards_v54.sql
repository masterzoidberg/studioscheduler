-- POL-04 / V5.4 closes the typed HARD safeguard gap found by R0.
--
-- The application and pinned Python runtimes already evaluate these typed
-- families.  The effective SQL boundary must independently evaluate the
-- immutable ConstraintModelVersion against the ScheduleVersion's pinned
-- PlanningDatasetVersion.  p_application_validation remains an audit input;
-- it is never used as proof of legality.

create or replace function private.validate_typed_schedule_v54(
  p_schedule_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_schedule public.schedule_versions%rowtype;
  v_model public.constraint_model_versions%rowtype;
  v_planning public.planning_dataset_versions%rowtype;
  v_model_version integer;
  v_planning_version integer;
  v_typed_rule_ids jsonb := '[]'::jsonb;
  v_model_errors jsonb := '[]'::jsonb;
  v_model_error_count integer := 0;
  v_violations jsonb := '[]'::jsonb;
begin
  select * into v_schedule
  from public.schedule_versions
  where id=p_schedule_version_id;

  if v_schedule.id is null then
    raise exception 'Schedule version not found';
  end if;

  v_model_version:=v_schedule.constraint_model_version;
  if v_model_version is null then
    select cm.version into v_model_version
    from public.constraint_model_versions cm
    where cm.studio_id=v_schedule.studio_id and cm.status='CURRENT'
    order by cm.version desc limit 1;
  end if;
  if v_model_version is null then
    return jsonb_build_object('modelPresent',false,'typedRuleIds','[]'::jsonb,'violations','[]'::jsonb,'modelErrors','[]'::jsonb);
  end if;

  select * into v_model
  from public.constraint_model_versions cm
  where cm.studio_id=v_schedule.studio_id and cm.version=v_model_version;
  if v_model.id is null then
    return jsonb_build_object(
      'modelPresent',true,'modelVersion',v_model_version,'typedRuleIds','[]'::jsonb,
      'violations','[]'::jsonb,
      'modelErrors',jsonb_build_array('Pinned ConstraintModelVersion is unavailable')
    );
  end if;

  v_planning_version:=v_schedule.planning_dataset_version;
  if v_planning_version is null then
    select pd.version into v_planning_version
    from public.planning_dataset_versions pd
    where pd.studio_id=v_schedule.studio_id and pd.status='CURRENT'
    order by pd.version desc limit 1;
  end if;
  select * into v_planning
  from public.planning_dataset_versions pd
  where pd.studio_id=v_schedule.studio_id and pd.version=v_planning_version;

  with nodes as (
    select node
    from jsonb_array_elements(
      case when jsonb_typeof(v_model.snapshot->'hardConstraints')='array'
        then v_model.snapshot->'hardConstraints' else '[]'::jsonb end
    ) node
  ), model_errors as (
    select 'ConstraintModel snapshot must be a schema 1.0 object' as detail
    where jsonb_typeof(v_model.snapshot)<>'object' or v_model.snapshot->>'schemaVersion' <> '1.0'
    union all
    select 'ConstraintModelVersion must be complete' as detail
    where v_model.complete_hard_constraint_compilation is not true
    union all
    select 'ConstraintModel contains uncompiled HARD rule IDs' as detail
    where jsonb_typeof(v_model.snapshot->'uncompiledConstraintRuleIds')<>'array'
       or jsonb_array_length(v_model.snapshot->'uncompiledConstraintRuleIds')<>0
    union all
    select 'ConstraintModel hardConstraints must be an array' as detail
    where jsonb_typeof(v_model.snapshot->'hardConstraints')<>'array'
    union all
    select 'ConstraintModel contains duplicate node IDs' as detail
    from nodes
    group by node->>'id'
    having count(*)>1
    union all
    select 'Typed ConstraintModel node has an invalid ruleIds array' as detail
    from nodes
    where node->>'kind' in (
      'STUDIO_OPERATING_WINDOWS','ROOM_UNAVAILABLE_WINDOWS','TEACHER_CLASS_DOMAIN',
      'REQUIRED_TEACHER','REQUIRED_ROOM','ROOM_CAPACITY','ROOM_REQUIRED_FEATURES'
    )
      and (
        jsonb_typeof(node->'ruleIds')<>'array'
        or jsonb_array_length(node->'ruleIds')=0
        or exists(select 1 from jsonb_array_elements(node->'ruleIds') value where jsonb_typeof(value)<>'string' or btrim(value #>> '{}')='')
      )
    union all
    select 'Typed ConstraintModel node repeats a stable class reference' as detail
    from nodes
    where jsonb_typeof(node->'selector'->'classIds')='array'
      and exists(
        select 1
        from jsonb_array_elements_text(node->'selector'->'classIds') value
        group by value
        having count(*)>1
      )
    union all
    select 'Typed ConstraintModel node repeats a stable teacher reference' as detail
    from nodes
    where jsonb_typeof(node->'selector'->'teacherIds')='array'
      and exists(
        select 1
        from jsonb_array_elements_text(node->'selector'->'teacherIds') value
        group by value
        having count(*)>1
      )
    union all
    select 'Typed ConstraintModel node repeats a stable room reference' as detail
    from nodes
    where jsonb_typeof(node->'selector'->'roomIds')='array'
      and exists(
        select 1
        from jsonb_array_elements_text(node->'selector'->'roomIds') value
        group by value
        having count(*)>1
      )
    union all
    select 'Typed ConstraintModel node repeats an exempt class reference' as detail
    from nodes
    where jsonb_typeof(node->'parameters'->'exemptClassIds')='array'
      and exists(
        select 1
        from jsonb_array_elements_text(node->'parameters'->'exemptClassIds') value
        group by value
        having count(*)>1
      )
    union all
    select 'Typed ConstraintModel node repeats a required feature' as detail
    from nodes
    where jsonb_typeof(node->'parameters'->'requiredFeatures')='array'
      and exists(
        select 1
        from jsonb_array_elements_text(node->'parameters'->'requiredFeatures') value
        group by value
        having count(*)>1
      )
    union all
    select 'Typed ConstraintModel node has an invalid selector or parameters object' as detail
    from nodes
    where node->>'kind' in (
      'STUDIO_OPERATING_WINDOWS','ROOM_UNAVAILABLE_WINDOWS','TEACHER_CLASS_DOMAIN',
      'REQUIRED_TEACHER','REQUIRED_ROOM','ROOM_CAPACITY','ROOM_REQUIRED_FEATURES'
    )
      and (jsonb_typeof(node->'selector')<>'object' or jsonb_typeof(node->'parameters')<>'object')
    union all
    select 'Typed ConstraintModel node has a malformed stable-ID array' as detail
    from nodes
    where node->>'kind' in ('ROOM_UNAVAILABLE_WINDOWS','TEACHER_CLASS_DOMAIN','REQUIRED_TEACHER','REQUIRED_ROOM','ROOM_CAPACITY','ROOM_REQUIRED_FEATURES')
      and (
        (node->>'kind' in ('ROOM_UNAVAILABLE_WINDOWS','ROOM_CAPACITY') and (jsonb_typeof(node->'selector'->'roomIds')<>'array' or jsonb_array_length(node->'selector'->'roomIds')=0))
        or (node->>'kind' in ('TEACHER_CLASS_DOMAIN','REQUIRED_TEACHER') and (jsonb_typeof(node->'selector'->'teacherIds')<>'array' or jsonb_array_length(node->'selector'->'teacherIds')=0))
        or (node->>'kind' in ('REQUIRED_TEACHER','REQUIRED_ROOM','ROOM_REQUIRED_FEATURES') and (jsonb_typeof(node->'selector'->'classIds')<>'array' or jsonb_array_length(node->'selector'->'classIds')=0))
      )
    union all
    select 'Typed ConstraintModel node has an invalid class domain' as detail
    from nodes
    where node->>'kind'='TEACHER_CLASS_DOMAIN'
      and jsonb_typeof(node->'parameters'->'classIds')<>'array'
    union all
    select 'Typed ConstraintModel node has an invalid required-feature list' as detail
    from nodes
    where node->>'kind'='ROOM_REQUIRED_FEATURES'
      and (jsonb_typeof(node->'parameters'->'requiredFeatures')<>'array' or jsonb_array_length(node->'parameters'->'requiredFeatures')=0)
    union all
    select 'Typed ConstraintModel node has an invalid capacity source' as detail
    from nodes
    where node->>'kind'='ROOM_CAPACITY'
      and node->'parameters'->>'capacitySource' is distinct from 'PLANNING_DATASET'
    union all
    select 'Typed ConstraintModel node has malformed policy windows' as detail
    from nodes
    where node->>'kind' in ('STUDIO_OPERATING_WINDOWS','ROOM_UNAVAILABLE_WINDOWS')
      and (
        jsonb_typeof(node->'parameters'->'windows')<>'array'
        or jsonb_array_length(node->'parameters'->'windows')=0
        or exists(
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(node->'parameters'->'windows')='array' then node->'parameters'->'windows' else '[]'::jsonb end
          ) window_item
          where jsonb_typeof(window_item)<>'object'
             or window_item->>'day' not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
             or window_item->>'start' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             or window_item->>'end' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             or case when window_item->>'start' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' and window_item->>'end' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
                  then (window_item->>'start')::time >= (window_item->>'end')::time else false end
        )
      )
    union all
    select 'Pinned PlanningDatasetVersion is unavailable or has the wrong studio identity' as detail
    where v_planning.id is null
       or v_planning.snapshot->>'studioId' is distinct from v_schedule.studio_id::text
  ), reference_errors as (
    select 'Typed ConstraintModel references a missing PlanningDataset class' as detail
    from nodes n
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(n.node->'selector'->'classIds')='array' then n.node->'selector'->'classIds' else '[]'::jsonb end
    ) ref_id
    where n.node->>'kind' in ('REQUIRED_TEACHER','REQUIRED_ROOM','ROOM_REQUIRED_FEATURES')
      and not exists(
        select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'classes','[]'::jsonb)) item
        where item->>'id'=ref_id.value
      )
    union all
    select 'Typed ConstraintModel references a missing PlanningDataset teacher' as detail
    from nodes n
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(n.node->'selector'->'teacherIds')='array' then n.node->'selector'->'teacherIds' else '[]'::jsonb end
    ) ref_id
    where n.node->>'kind' in ('TEACHER_CLASS_DOMAIN','REQUIRED_TEACHER')
      and not exists(
        select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'teacherIds','[]'::jsonb)) item
        where item #>> '{}'=ref_id.value
      )
    union all
    select 'Typed ConstraintModel references a missing PlanningDataset room' as detail
    from nodes n
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(n.node->'selector'->'roomIds')='array' then n.node->'selector'->'roomIds' else '[]'::jsonb end
    ) ref_id
    where n.node->>'kind' in ('ROOM_UNAVAILABLE_WINDOWS','REQUIRED_ROOM','ROOM_CAPACITY')
      and not exists(
        select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'rooms','[]'::jsonb)) item
        where item->>'id'=ref_id.value
      )
  ), all_errors as (
    select detail from model_errors
    union all
    select detail from reference_errors
  )
  select count(*)::integer,coalesce(jsonb_agg(to_jsonb(detail) order by detail),'[]'::jsonb)
  into v_model_error_count,v_model_errors
  from all_errors;

  select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb)
  into v_typed_rule_ids
  from (
    select rule_id.value as value
    from jsonb_array_elements(
      case when jsonb_typeof(v_model.snapshot->'hardConstraints')='array'
        then v_model.snapshot->'hardConstraints' else '[]'::jsonb end
    ) node
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(node->'ruleIds')='array' then node->'ruleIds' else '[]'::jsonb end
    ) rule_id
    where node->>'kind' in (
      'STUDIO_OPERATING_WINDOWS','ROOM_UNAVAILABLE_WINDOWS','TEACHER_CLASS_DOMAIN',
      'REQUIRED_TEACHER','REQUIRED_ROOM','ROOM_CAPACITY','ROOM_REQUIRED_FEATURES'
    )
  ) typed_ids;

  if v_model_error_count>0 then
    return jsonb_build_object(
      'modelPresent',true,'modelVersion',v_model.version,'planningDatasetVersion',v_planning_version,
      'typedRuleIds',v_typed_rule_ids,'violations','[]'::jsonb,'modelErrors',v_model_errors
    );
  end if;

  with nodes as (
    select node
    from jsonb_array_elements(v_model.snapshot->'hardConstraints') node
  ), assignment_base as (
    select a.id,a.day,a.start_time,a.end_time,a.teacher_id,a.room_id,a.session_id,
      session_item->>'classId' as class_id,
      class_item as class_item,
      room_item as room_item
    from public.assignments a
    left join lateral jsonb_array_elements(coalesce(v_planning.snapshot->'sessions','[]'::jsonb)) session_item
      on session_item->>'id'=a.session_id
    left join lateral jsonb_array_elements(coalesce(v_planning.snapshot->'classes','[]'::jsonb)) class_item
      on class_item->>'id'=session_item->>'classId'
    left join lateral jsonb_array_elements(coalesce(v_planning.snapshot->'rooms','[]'::jsonb)) room_item
      on room_item->>'id'=a.room_id
    where a.schedule_version_id=p_schedule_version_id
  ), violations as (
    select n.node->>'id' constraint_id,a.id assignment_id,jsonb_build_object(
      'constraintId',n.node->>'id','ruleIds',n.node->'ruleIds','severity','HARD',
      'message',coalesce(a.class_item->>'name',a.class_id)||' is outside the studio operating windows on '||a.day||'.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id)
    ) obj
    from nodes n join assignment_base a on true
    where n.node->>'kind'='STUDIO_OPERATING_WINDOWS'
      and (
        (coalesce(n.node->'parameters'->'closedDays','[]'::jsonb) ? a.day)
        or not exists(
          select 1 from jsonb_array_elements(n.node->'parameters'->'windows') window_item
          where window_item->>'day'=a.day
            and a.start_time >= (window_item->>'start')::time
            and a.end_time <= (window_item->>'end')::time
        )
      )
    union all
    select n.node->>'id',a.id,jsonb_build_object(
      'constraintId',n.node->>'id','ruleIds',n.node->'ruleIds','severity','HARD',
      'message',coalesce(a.room_item->>'name',a.room_id)||' is unavailable during '||coalesce(a.class_item->>'name',a.class_id)||'.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id,a.room_id)
    )
    from nodes n join assignment_base a on true
    where n.node->>'kind'='ROOM_UNAVAILABLE_WINDOWS'
      and (n.node->'selector'->'roomIds' ? a.room_id)
      and exists(
        select 1 from jsonb_array_elements(n.node->'parameters'->'windows') window_item
        where window_item->>'day'=a.day
          and a.start_time < (window_item->>'end')::time
          and (window_item->>'start')::time < a.end_time
      )
    union all
    select n.node->>'id',a.id,jsonb_build_object(
      'constraintId',n.node->>'id','ruleIds',n.node->'ruleIds','severity','HARD',
      'message',coalesce(a.teacher_id,'Teacher')||' is not qualified by the current Rulebook domain for '||coalesce(a.class_item->>'name',a.class_id)||'.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.teacher_id,a.class_id)
    )
    from nodes n join assignment_base a on true
    where n.node->>'kind'='TEACHER_CLASS_DOMAIN'
      and (n.node->'selector'->'teacherIds' ? a.teacher_id)
      and not (n.node->'parameters'->'classIds' ? a.class_id)
    union all
    select n.node->>'id',a.id,jsonb_build_object(
      'constraintId',n.node->>'id','ruleIds',n.node->'ruleIds','severity','HARD',
      'message',coalesce(a.class_item->>'name',a.class_id)||' requires '||coalesce(n.node->'parameters'->>'teacherId',n.node->'selector'->'teacherIds'->>0)||'.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id,coalesce(n.node->'parameters'->>'teacherId',n.node->'selector'->'teacherIds'->>0))
    )
    from nodes n join assignment_base a on true
    where n.node->>'kind'='REQUIRED_TEACHER'
      and (n.node->'selector'->'classIds' ? a.class_id)
      and a.teacher_id is distinct from coalesce(n.node->'parameters'->>'teacherId',n.node->'selector'->'teacherIds'->>0)
    union all
    select n.node->>'id',a.id,jsonb_build_object(
      'constraintId',n.node->>'id','ruleIds',n.node->'ruleIds','severity','HARD',
      'message',coalesce(a.class_item->>'name',a.class_id)||' requires '||coalesce(n.node->'parameters'->>'roomId',n.node->'selector'->'roomIds'->>0)||'.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id,coalesce(n.node->'parameters'->>'roomId',n.node->'selector'->'roomIds'->>0))
    )
    from nodes n join assignment_base a on true
    where n.node->>'kind'='REQUIRED_ROOM'
      and (n.node->'selector'->'classIds' ? a.class_id)
      and a.room_id is distinct from coalesce(n.node->'parameters'->>'roomId',n.node->'selector'->'roomIds'->>0)
    union all
    select n.node->>'id',a.id,jsonb_build_object(
      'constraintId',n.node->>'id','ruleIds',n.node->'ruleIds','severity','HARD',
      'message',case when a.room_item is null or a.room_item->>'capacity' is null
        then coalesce(a.room_id,'Room')||' has no reviewed planning capacity, so '||coalesce(a.class_item->>'name',a.class_id)||' cannot be capacity-validated.'
        else coalesce(a.class_item->>'name',a.class_id)||' has '||jsonb_array_length(coalesce(a.class_item->'rosterStudentIds','[]'::jsonb))||' dancers, exceeding '||coalesce(a.room_item->>'name',a.room_id)||'''s planning capacity of '||(a.room_item->>'capacity')||'.' end,
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id,a.room_id)
    )
    from nodes n join assignment_base a on true
    where n.node->>'kind'='ROOM_CAPACITY'
      and (n.node->'selector'->'roomIds' ? a.room_id)
      and not (coalesce(n.node->'parameters'->'exemptClassIds','[]'::jsonb) ? a.class_id)
      and (
        a.room_item is null or a.room_item->>'capacity' is null
        or jsonb_array_length(coalesce(a.class_item->'rosterStudentIds','[]'::jsonb)) > (a.room_item->>'capacity')::integer
      )
    union all
    select n.node->>'id',a.id,jsonb_build_object(
      'constraintId',n.node->>'id','ruleIds',n.node->'ruleIds','severity','HARD',
      'message',coalesce(a.class_item->>'name',a.class_id)||' requires room feature(s): '||(
        select string_agg(feature.value,', ' order by feature.value)
        from jsonb_array_elements_text(n.node->'parameters'->'requiredFeatures') feature
        where not (coalesce(a.room_item->'features','[]'::jsonb) ? feature.value)
      )||'.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.class_id,a.room_id)
    )
    from nodes n join assignment_base a on true
    where n.node->>'kind'='ROOM_REQUIRED_FEATURES'
      and (n.node->'selector'->'classIds' ? a.class_id)
      and exists(
        select 1 from jsonb_array_elements_text(n.node->'parameters'->'requiredFeatures') feature
        where not (coalesce(a.room_item->'features','[]'::jsonb) ? feature.value)
      )
    union all
    select 'teacher-qualification-default-deny',a.id,jsonb_build_object(
      'constraintId','teacher-qualification-default-deny','ruleIds',jsonb_build_array('CUR-007'),'severity','HARD',
      'message',coalesce(a.teacher_id,'Teacher')||' has no compiled Rulebook qualification domain, so '||coalesce(a.class_item->>'name',a.class_id)||' cannot be assigned to that teacher yet.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(a.teacher_id,a.class_id)
    )
    from assignment_base a
    where exists(select 1 from jsonb_array_elements(coalesce(v_model.snapshot->'governanceAssertions','[]'::jsonb)) assertion where assertion->>'ruleId'='CUR-007')
      and not exists(
        select 1 from nodes q
        where q.node->>'kind'='TEACHER_CLASS_DOMAIN'
          and (q.node->'selector'->'teacherIds' ? a.teacher_id)
      )
  )
  select coalesce(jsonb_agg(obj order by constraint_id,assignment_id),'[]'::jsonb)
  into v_violations
  from violations;

  return jsonb_build_object(
    'modelPresent',true,'modelVersion',v_model.version,'planningDatasetVersion',v_planning_version,
    'typedRuleIds',v_typed_rule_ids,'violations',v_violations,'modelErrors','[]'::jsonb
  );
end
$function$;

revoke all on function private.validate_typed_schedule_v54(uuid) from public,anon,authenticated;

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
  v_typed jsonb := '{}'::jsonb;
  v_violations jsonb := '[]'::jsonb;
  v_uncovered jsonb := '[]'::jsonb;
  v_hard integer := 0;
  v_total integer := 0;
  v_unimplemented integer := 0;
  v_partial integer := 0;
  v_model_errors integer := 0;
  v_typed_implemented integer := 0;
begin
  select sv.studio_id,sv.enforcement_version
  into v_studio,v_enforcement_version
  from public.schedule_versions sv
  where sv.id=p_schedule_version_id;
  if v_studio is null then raise exception 'Schedule version not found'; end if;

  v_base:=public.validate_schedule_hard_v22(p_schedule_version_id);

  select array_agg(m.elem->>'ruleId' order by m.elem->>'ruleId')
  into v_duration_rule_ids
  from public.rule_enforcement_versions ev
  cross join lateral jsonb_array_elements(ev.snapshot) m(elem)
  join public.rules r on r.studio_id=v_studio and r.id=m.elem->>'ruleId'
    and r.status='ACTIVE' and upper(r.classification_raw)='HARD'
  where ev.studio_id=v_studio and ev.version=v_enforcement_version
    and m.elem->>'type'='CLASS_DURATION';

  select coalesce(jsonb_agg(elem),'[]'::jsonb) into v_kept
  from jsonb_array_elements(coalesce(v_base->'violations','[]'::jsonb)) elem
  where v_duration_rule_ids is null or not ((elem->>'constraintId')=any(v_duration_rule_ids));

  select coalesce(jsonb_agg(obj order by rule_id,assignment_id),'[]'::jsonb)
  into v_duration_violations
  from (
    select m.elem->>'ruleId' rule_id,a.id assignment_id,jsonb_build_object(
      'constraintId',m.elem->>'ruleId','severity','HARD',
      'message',c.name||' must preserve its '||coalesce(s.duration_minutes,c.duration_minutes)||'-minute session duration.',
      'assignmentIds',jsonb_build_array(a.id),'affectedEntityIds',jsonb_build_array(c.id,s.id)
    ) obj
    from public.rule_enforcement_versions ev
    cross join lateral jsonb_array_elements(ev.snapshot) m(elem)
    join public.rules r on r.studio_id=v_studio and r.id=m.elem->>'ruleId'
      and r.status='ACTIVE' and upper(r.classification_raw)='HARD'
    join public.assignments a on a.schedule_version_id=p_schedule_version_id
    join public.class_sessions s on s.id=a.session_id and s.studio_id=v_studio
    join public.class_definitions c on c.id=s.class_id and c.studio_id=v_studio
    where ev.studio_id=v_studio and ev.version=v_enforcement_version
      and m.elem->>'type'='CLASS_DURATION'
      and (extract(epoch from (a.end_time-a.start_time))/60)::integer<>coalesce(s.duration_minutes,c.duration_minutes)
  ) duration_rows;

  v_typed:=private.validate_typed_schedule_v54(p_schedule_version_id);
  select coalesce(jsonb_agg(item order by item),'[]'::jsonb)
  into v_uncovered
  from jsonb_array_elements(coalesce(v_base->'coverage'->'uncoveredHardRuleIds','[]'::jsonb)) item
  where not (coalesce(v_typed->'typedRuleIds','[]'::jsonb) ? (item #>> '{}'));
  v_model_errors:=jsonb_array_length(coalesce(v_typed->'modelErrors','[]'::jsonb));

  select count(*)::integer into v_typed_implemented
  from public.rules r
  where r.studio_id=v_studio and r.status='ACTIVE' and upper(r.classification_raw)='HARD'
    and coalesce(v_typed->'typedRuleIds','[]'::jsonb) ? r.id;

  v_violations:=coalesce(v_kept,'[]'::jsonb)||coalesce(v_duration_violations,'[]'::jsonb)
    ||coalesce(v_typed->'violations','[]'::jsonb);
  v_total:=jsonb_array_length(v_violations);
  select count(*)::integer into v_hard from jsonb_array_elements(v_violations) elem where elem->>'severity'='HARD';
  v_unimplemented:=jsonb_array_length(v_uncovered)+v_model_errors;
  v_partial:=coalesce((v_base->'coverage'->>'partialHardRules')::integer,0);

  return v_base||jsonb_build_object(
    'valid',v_hard=0 and v_model_errors=0,
    'fullyValidated',v_hard=0 and v_unimplemented=0 and v_partial=0 and v_model_errors=0,
    'hardViolations',v_hard,'warnings',v_total-v_hard,'violations',v_violations,
    'typedSqlSafeguard',jsonb_build_object(
      'authority','PINNED_CONSTRAINT_MODEL_V54','modelPresent',coalesce((v_typed->>'modelPresent')::boolean,false),
      'modelVersion',v_typed->>'modelVersion','planningDatasetVersion',v_typed->>'planningDatasetVersion',
      'typedRuleIds',coalesce(v_typed->'typedRuleIds','[]'::jsonb),'modelErrors',coalesce(v_typed->'modelErrors','[]'::jsonb)
    ),
    'coverage',jsonb_build_object(
      'applicableHardRules',coalesce((v_base->'coverage'->>'applicableHardRules')::integer,0),
      'implementedHardRules',greatest(coalesce((v_base->'coverage'->>'implementedHardRules')::integer,0),v_typed_implemented),
      'partialHardRules',v_partial,'notImplementedHardRules',v_unimplemented,
      'notApplicableHardRules',coalesce((v_base->'coverage'->>'notApplicableHardRules')::integer,0),
      'uncoveredHardRuleIds',v_uncovered
    )
  );
end
$function$;

revoke all on function public.validate_schedule_hard_v25(uuid) from public,anon;
grant execute on function public.validate_schedule_hard_v25(uuid) to authenticated,service_role;

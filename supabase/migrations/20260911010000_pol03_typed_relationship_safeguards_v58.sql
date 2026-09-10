-- POL-03 / V5.8 extends the effective typed schedule safeguard for the
-- stable-ID participant, attendance, direct-after and linked-arrival families.
-- The prior evaluator remains immutable as the base of this forward wrapper.

do $block$
begin
  if to_regprocedure('private.validate_typed_schedule_v54(uuid)') is not null
     and to_regprocedure('private.validate_typed_schedule_v54_pol03_base(uuid)') is null then
    alter function private.validate_typed_schedule_v54(uuid) rename to validate_typed_schedule_v54_pol03_base;
  end if;
end
$block$;

create or replace function private.validate_typed_schedule_v54(p_schedule_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_base jsonb; v_schedule public.schedule_versions%rowtype; v_model public.constraint_model_versions%rowtype; v_planning public.planning_dataset_versions%rowtype;
  v_node jsonb; v_kind text; v_rule_ids jsonb; v_params jsonb; v_selector jsonb; v_id text; v_other text; v_count integer;
  v_typed_rule_ids jsonb:='[]'::jsonb; v_model_errors jsonb:='[]'::jsonb; v_violations jsonb:='[]'::jsonb;
  v_predecessor record; v_successor record; v_day text; v_teacher_start time; v_participant_start time; v_delta integer;
begin
  if to_regprocedure('private.validate_typed_schedule_v54_pol03_base(uuid)') is null then
    return jsonb_build_object('modelPresent',false,'typedRuleIds','[]'::jsonb,'violations','[]'::jsonb,'modelErrors',jsonb_build_array('V58 typed safeguard base evaluator is unavailable'));
  end if;
  v_base:=private.validate_typed_schedule_v54_pol03_base(p_schedule_version_id);
  select * into v_schedule from public.schedule_versions where id=p_schedule_version_id;
  if v_schedule.id is null then return v_base; end if;
  select * into v_model from public.constraint_model_versions cm where cm.studio_id=v_schedule.studio_id and cm.version=v_schedule.constraint_model_version;
  if v_model.id is null then return v_base; end if;
  select * into v_planning from public.planning_dataset_versions pd where pd.studio_id=v_schedule.studio_id and pd.version=v_schedule.planning_dataset_version;
  if v_planning.id is null then return v_base||jsonb_build_object('violations','[]'::jsonb,'modelErrors',coalesce(v_base->'modelErrors','[]'::jsonb)||jsonb_build_array('Pinned PlanningDatasetVersion is unavailable')); end if;

  for v_node in select value from jsonb_array_elements(case when jsonb_typeof(v_model.snapshot->'hardConstraints')='array' then v_model.snapshot->'hardConstraints' else '[]'::jsonb end) item(value) loop
    v_kind:=v_node->>'kind';
    if v_kind not in ('PARTICIPANT_NO_OVERLAP','MAX_ATTENDANCE_DAYS','DIRECTLY_AFTER','LINKED_ARRIVAL') then continue; end if;
    v_rule_ids:=case when jsonb_typeof(v_node->'ruleIds')='array' then v_node->'ruleIds' else '[]'::jsonb end;
    v_typed_rule_ids:=v_typed_rule_ids||v_rule_ids;
    v_selector:=case when jsonb_typeof(v_node->'selector')='object' then v_node->'selector' else '{}'::jsonb end;
    v_params:=case when jsonb_typeof(v_node->'parameters')='object' then v_node->'parameters' else '{}'::jsonb end;
    if jsonb_array_length(v_rule_ids)=0 then v_model_errors:=v_model_errors||jsonb_build_array(v_kind||' ConstraintModel node has an invalid ruleIds array'); end if;

    if v_kind in ('PARTICIPANT_NO_OVERLAP','MAX_ATTENDANCE_DAYS','LINKED_ARRIVAL') then
      if jsonb_typeof(v_selector->'participantIds')<>'array' or jsonb_array_length(v_selector->'participantIds')=0 then
        v_model_errors:=v_model_errors||jsonb_build_array(v_kind||' ConstraintModel node requires participantIds'); continue;
      end if;
      if jsonb_array_length(v_selector->'participantIds')<>(select count(distinct value) from jsonb_array_elements_text(v_selector->'participantIds') item(value)) then
        v_model_errors:=v_model_errors||jsonb_build_array(v_kind||' repeats a stable participant reference');
      end if;
      for v_id in select value from jsonb_array_elements_text(v_selector->'participantIds') item(value) loop
        if not exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'students','[]'::jsonb)) item(value) where item.value->>'id'=v_id) then
          v_model_errors:=v_model_errors||jsonb_build_array(v_kind||' references a missing PlanningDataset participant');
        end if;
        if not exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'classes','[]'::jsonb)) item(value) where coalesce(item.value->'rosterStudentIds','[]'::jsonb) ? v_id) then
          v_model_errors:=v_model_errors||jsonb_build_array(v_kind||' participant is absent from every class roster');
        end if;
        if exists(
          select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'classes','[]'::jsonb)) c(value)
          where coalesce(c.value->'rosterStudentIds','[]'::jsonb) ? v_id
            and (select count(*) from jsonb_array_elements(coalesce(v_planning.snapshot->'sessions','[]'::jsonb)) s(value) where s.value->>'classId'=c.value->>'id')
                <>coalesce((c.value->>'weeklyFrequency')::integer,0)
        ) then v_model_errors:=v_model_errors||jsonb_build_array(v_kind||' participant has an incomplete required session set'); end if;
      end loop;
    end if;
    if v_kind='MAX_ATTENDANCE_DAYS' and (jsonb_typeof(v_params->'maxDays') is distinct from 'number' or (v_params->>'maxDays')::integer not between 1 and 6) then
      v_model_errors:=v_model_errors||jsonb_build_array('MAX_ATTENDANCE_DAYS maxDays must be an integer from 1 to 6');
    end if;
    if v_kind='DIRECTLY_AFTER' then
      v_id:=v_params->>'predecessorSessionId'; v_other:=v_params->>'successorSessionId';
      if coalesce(v_id,'')='' or coalesce(v_other,'')='' or v_id=v_other or jsonb_typeof(v_selector->'sessionIds')<>'array' or jsonb_array_length(v_selector->'sessionIds')<>2 or v_selector->'sessionIds'->>0 is distinct from v_id or v_selector->'sessionIds'->>1 is distinct from v_other then v_model_errors:=v_model_errors||jsonb_build_array('DIRECTLY_AFTER requires distinct ordered session endpoints'); continue; end if;
      if not exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'sessions','[]'::jsonb)) item(value) where item.value->>'id'=v_id)
         or not exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'sessions','[]'::jsonb)) item(value) where item.value->>'id'=v_other) then
        v_model_errors:=v_model_errors||jsonb_build_array('DIRECTLY_AFTER references a missing PlanningDataset session endpoint');
      end if;
    end if;
    if v_kind='LINKED_ARRIVAL' then
      if jsonb_typeof(v_selector->'teacherIds')<>'array' or jsonb_array_length(v_selector->'teacherIds')<>1 or jsonb_array_length(v_selector->'participantIds')<>1
         or v_params->>'teacherId' is distinct from v_selector->'teacherIds'->>0 or v_params->>'participantId' is distinct from v_selector->'participantIds'->>0
         or jsonb_typeof(v_params->'minOffsetMinutes') is distinct from 'number' or jsonb_typeof(v_params->'maxOffsetMinutes') is distinct from 'number'
         or (v_params->>'minOffsetMinutes')::integer>(v_params->>'maxOffsetMinutes')::integer
         or mod((v_params->>'minOffsetMinutes')::integer,15)<>0 or mod((v_params->>'maxOffsetMinutes')::integer,15)<>0 then
        v_model_errors:=v_model_errors||jsonb_build_array('LINKED_ARRIVAL has malformed stable IDs or offset interval');
      elsif not exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'teachers','[]'::jsonb)) item(value) where item.value->>'id'=v_params->>'teacherId')
            and not (coalesce(v_planning.snapshot->'teacherIds','[]'::jsonb) ? (v_params->>'teacherId')) then
        v_model_errors:=v_model_errors||jsonb_build_array('LINKED_ARRIVAL references a missing PlanningDataset teacher');
      end if;
    end if;
  end loop;
  if exists(
    with recursive edges as (
      select value->'parameters'->>'predecessorSessionId' as source_id,value->'parameters'->>'successorSessionId' as target_id
      from jsonb_array_elements(v_model.snapshot->'hardConstraints') item(value) where value->>'kind'='DIRECTLY_AFTER'
    ), walk(origin,current_id) as (
      select source_id,target_id from edges
      union
      select walk.origin,edges.target_id from walk join edges on edges.source_id=walk.current_id
    )
    select 1 from walk where origin=current_id
  ) then v_model_errors:=v_model_errors||jsonb_build_array('DIRECTLY_AFTER relationship graph contains a cycle or reversed edge'); end if;
  select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) into v_typed_rule_ids from jsonb_array_elements(v_typed_rule_ids) item(value);
  if jsonb_array_length(coalesce(v_base->'modelErrors','[]'::jsonb))>0 or jsonb_array_length(v_model_errors)>0 then
    return v_base||jsonb_build_object('typedRuleIds',coalesce(v_base->'typedRuleIds','[]'::jsonb)||v_typed_rule_ids,'violations','[]'::jsonb,'modelErrors',coalesce(v_base->'modelErrors','[]'::jsonb)||v_model_errors);
  end if;

  for v_node in select value from jsonb_array_elements(v_model.snapshot->'hardConstraints') item(value) where value->>'kind' in ('PARTICIPANT_NO_OVERLAP','MAX_ATTENDANCE_DAYS','DIRECTLY_AFTER','LINKED_ARRIVAL') loop
    v_kind:=v_node->>'kind'; v_params:=v_node->'parameters'; v_selector:=v_node->'selector';
    if v_kind='DIRECTLY_AFTER' then
      select a.id,a.day,a.start_time,a.end_time into v_predecessor from public.assignments a where a.schedule_version_id=p_schedule_version_id and a.session_id=v_params->>'predecessorSessionId';
      select a.id,a.day,a.start_time,a.end_time into v_successor from public.assignments a where a.schedule_version_id=p_schedule_version_id and a.session_id=v_params->>'successorSessionId';
      if v_predecessor.id is null or v_successor.id is null or v_predecessor.day is distinct from v_successor.day or v_predecessor.end_time is distinct from v_successor.start_time then
        v_violations:=v_violations||jsonb_build_array(jsonb_build_object('constraintId',v_node->>'id','ruleIds',v_node->'ruleIds','severity','HARD','message','Direct-after endpoints must both be placed on the same day with exact end/start equality.','assignmentIds',jsonb_build_array(v_predecessor.id,v_successor.id),'affectedEntityIds',jsonb_build_array(v_params->>'predecessorSessionId',v_params->>'successorSessionId')));
      end if;
    elsif v_kind='PARTICIPANT_NO_OVERLAP' then
      select count(*) into v_count from public.assignments a1 join public.assignments a2 on a2.schedule_version_id=a1.schedule_version_id and a2.id>a1.id and a2.day=a1.day and a1.start_time<a2.end_time and a2.start_time<a1.end_time
      where a1.schedule_version_id=p_schedule_version_id and exists(select 1 from jsonb_array_elements(v_planning.snapshot->'sessions') s1(value) join jsonb_array_elements(v_planning.snapshot->'classes') c1(value) on c1.value->>'id'=s1.value->>'classId' where s1.value->>'id'=a1.session_id and exists(select 1 from jsonb_array_elements_text(v_selector->'participantIds') p(value) where coalesce(c1.value->'rosterStudentIds','[]'::jsonb) ? p.value))
      and exists(select 1 from jsonb_array_elements(v_planning.snapshot->'sessions') s2(value) join jsonb_array_elements(v_planning.snapshot->'classes') c2(value) on c2.value->>'id'=s2.value->>'classId' where s2.value->>'id'=a2.session_id and exists(select 1 from jsonb_array_elements_text(v_selector->'participantIds') p(value) where coalesce(c2.value->'rosterStudentIds','[]'::jsonb) ? p.value));
      if v_count>0 then v_violations:=v_violations||jsonb_build_array(jsonb_build_object('constraintId',v_node->>'id','ruleIds',v_node->'ruleIds','severity','HARD','message','Sessions attended by this participant group overlap.','assignmentIds','[]'::jsonb,'affectedEntityIds',v_selector->'participantIds')); end if;
    elsif v_kind='MAX_ATTENDANCE_DAYS' then
      for v_id in select value from jsonb_array_elements_text(v_selector->'participantIds') item(value) loop
        select count(distinct a.day) into v_count from public.assignments a where a.schedule_version_id=p_schedule_version_id and exists(select 1 from jsonb_array_elements(v_planning.snapshot->'sessions') s(value) join jsonb_array_elements(v_planning.snapshot->'classes') c(value) on c.value->>'id'=s.value->>'classId' where s.value->>'id'=a.session_id and coalesce(c.value->'rosterStudentIds','[]'::jsonb) ? v_id);
        if v_count>(v_params->>'maxDays')::integer then v_violations:=v_violations||jsonb_build_array(jsonb_build_object('constraintId',v_node->>'id','ruleIds',v_node->'ruleIds','severity','HARD','message','Participant exceeds the maximum distinct attendance days.','assignmentIds','[]'::jsonb,'affectedEntityIds',jsonb_build_array(v_id))); end if;
      end loop;
    elsif v_kind='LINKED_ARRIVAL' then
      for v_day,v_teacher_start in select a.day,min(a.start_time) from public.assignments a where a.schedule_version_id=p_schedule_version_id and a.teacher_id=v_params->>'teacherId' group by a.day loop
        select min(a.start_time) into v_participant_start from public.assignments a where a.schedule_version_id=p_schedule_version_id and a.day=v_day and exists(select 1 from jsonb_array_elements(v_planning.snapshot->'sessions') s(value) join jsonb_array_elements(v_planning.snapshot->'classes') c(value) on c.value->>'id'=s.value->>'classId' where s.value->>'id'=a.session_id and coalesce(c.value->'rosterStudentIds','[]'::jsonb) ? (v_params->>'participantId'));
        v_delta:=case when v_participant_start is null then null else extract(epoch from (v_teacher_start-v_participant_start))/60 end;
        if v_delta is null or v_delta<(v_params->>'minOffsetMinutes')::integer or v_delta>(v_params->>'maxOffsetMinutes')::integer then v_violations:=v_violations||jsonb_build_array(jsonb_build_object('constraintId',v_node->>'id','ruleIds',v_node->'ruleIds','severity','HARD','message','Linked participant attendance or inclusive arrival offset is invalid for a teacher workday.','assignmentIds','[]'::jsonb,'affectedEntityIds',jsonb_build_array(v_params->>'teacherId',v_params->>'participantId'))); end if;
      end loop;
    end if;
  end loop;
  return v_base||jsonb_build_object('typedRuleIds',coalesce(v_base->'typedRuleIds','[]'::jsonb)||v_typed_rule_ids,'violations',coalesce(v_base->'violations','[]'::jsonb)||v_violations,'modelErrors',coalesce(v_base->'modelErrors','[]'::jsonb)||v_model_errors);
end
$function$;

revoke all on function private.validate_typed_schedule_v54(uuid) from public,anon,authenticated;

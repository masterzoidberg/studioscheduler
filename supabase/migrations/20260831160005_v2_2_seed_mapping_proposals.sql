-- Seed only mechanically lossless proposals. These rows do not change validation.
-- They remain PROPOSED until an authenticated editor reviews and approves them.

do $block$
declare
  v_studio uuid;
  v_rb integer;
  v_ev integer;
  v_teacher_cami text;
begin
  for v_studio in select id from public.studios loop
    select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
    select version into v_ev from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
    if v_rb is null or v_ev is null then continue; end if;
    select id into v_teacher_cami from public.teachers where studio_id=v_studio and lower(name)='cami' limit 1;

    if exists(select 1 from public.rules where studio_id=v_studio and id='OPS-005' and status='ACTIVE')
       and not exists(select 1 from public.rule_enforcement_proposals where studio_id=v_studio and rule_id='OPS-005' and status='PROPOSED') then
      insert into public.rule_enforcement_proposals(studio_id,rule_id,base_rulebook_version,base_enforcement_version,proposed_mapping,rationale,proposal_source)
      values(v_studio,'OPS-005',v_rb,v_ev,
        jsonb_build_object('ruleId','OPS-005','type','EARLIEST_START','parameters',jsonb_build_object('time','09:00','days',jsonb_build_array('Saturday')),'affectedEntityIds','[]'::jsonb,'exceptions','[]'::jsonb),
        'Lossless mapping of reviewed wording: Saturday classes may not start before 9:00 AM.','SYSTEM');
    end if;

    if exists(select 1 from public.rules where studio_id=v_studio and id='OPS-006' and status='ACTIVE')
       and not exists(select 1 from public.rule_enforcement_proposals where studio_id=v_studio and rule_id='OPS-006' and status='PROPOSED') then
      insert into public.rule_enforcement_proposals(studio_id,rule_id,base_rulebook_version,base_enforcement_version,proposed_mapping,rationale,proposal_source)
      values(v_studio,'OPS-006',v_rb,v_ev,
        jsonb_build_object('ruleId','OPS-006','type','LATEST_FINISH','parameters',jsonb_build_object('time','15:00','days',jsonb_build_array('Saturday')),'affectedEntityIds','[]'::jsonb,'exceptions','[]'::jsonb),
        'Lossless mapping of reviewed wording: Saturday has a HARD closing time of 3:00 PM.','SYSTEM');
    end if;

    if exists(select 1 from public.rules where studio_id=v_studio and id='OPS-013' and status='ACTIVE')
       and not exists(select 1 from public.rule_enforcement_proposals where studio_id=v_studio and rule_id='OPS-013' and status='PROPOSED') then
      insert into public.rule_enforcement_proposals(studio_id,rule_id,base_rulebook_version,base_enforcement_version,proposed_mapping,rationale,proposal_source)
      values(v_studio,'OPS-013',v_rb,v_ev,
        jsonb_build_object('ruleId','OPS-013','type','MAX_TEACHER_GAP','parameters',jsonb_build_object('minutes',60),'affectedEntityIds','[]'::jsonb,'exceptions','[]'::jsonb),
        'Lossless mapping of reviewed wording: teacher same-day gaps may not exceed 60 minutes.','SYSTEM');
    end if;

    if exists(select 1 from public.rules where studio_id=v_studio and id='OPS-014' and status='ACTIVE')
       and not exists(select 1 from public.rule_enforcement_proposals where studio_id=v_studio and rule_id='OPS-014' and status='PROPOSED') then
      insert into public.rule_enforcement_proposals(studio_id,rule_id,base_rulebook_version,base_enforcement_version,proposed_mapping,rationale,proposal_source)
      values(v_studio,'OPS-014',v_rb,v_ev,
        jsonb_build_object('ruleId','OPS-014','type','MAX_STUDENT_GAP','parameters',jsonb_build_object('minutes',60),'affectedEntityIds','[]'::jsonb,'exceptions','[]'::jsonb),
        'Lossless mapping of reviewed wording: dancer same-day gaps may not exceed 60 minutes.','SYSTEM');
    end if;

    if v_teacher_cami is not null
       and exists(select 1 from public.rules where studio_id=v_studio and id='CAM-006' and status='ACTIVE')
       and not exists(select 1 from public.rule_enforcement_proposals where studio_id=v_studio and rule_id='CAM-006' and status='PROPOSED') then
      insert into public.rule_enforcement_proposals(studio_id,rule_id,base_rulebook_version,base_enforcement_version,proposed_mapping,rationale,proposal_source)
      values(v_studio,'CAM-006',v_rb,v_ev,
        jsonb_build_object('ruleId','CAM-006','type','MAX_TEACHER_WORKDAYS','parameters',jsonb_build_object('teacher_id',v_teacher_cami,'max_days',4),'affectedEntityIds',jsonb_build_array(v_teacher_cami),'exceptions','[]'::jsonb),
        'Lossless mapping of reviewed wording: Cami may teach regular Monday-Saturday classes on no more than four days.','SYSTEM');
    end if;

    if exists(select 1 from public.rules where studio_id=v_studio and id='CUR-006' and status='ACTIVE')
       and not exists(select 1 from public.rule_enforcement_proposals where studio_id=v_studio and rule_id='CUR-006' and status='PROPOSED') then
      insert into public.rule_enforcement_proposals(studio_id,rule_id,base_rulebook_version,base_enforcement_version,proposed_mapping,rationale,proposal_source)
      values(v_studio,'CUR-006',v_rb,v_ev,
        jsonb_build_object('ruleId','CUR-006','type','CLASS_FREQUENCY','parameters','{}'::jsonb,'affectedEntityIds','[]'::jsonb,'exceptions','[]'::jsonb),
        'Lossless mapping of reviewed wording: established weekly class frequency must be preserved.','SYSTEM');
    end if;
  end loop;
end $block$;
-- V2.2 schedule mutations are optimistic against RulebookVersion + EnforcementVersion + ScheduleVersion.
-- When newly approved enforcement reveals existing HARD violations, edits may proceed only when
-- they strictly reduce the HARD-violation count. Clean schedules must remain clean.

create or replace function public.apply_schedule_patch_v22(
  p_assignment_id text,
  p_changes jsonb,
  p_reason text,
  p_expected_schedule_version integer,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,
  p_ai_proposed boolean default false
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
  v_current public.schedule_versions%rowtype;
  v_current_rulebook integer;
  v_current_enforcement integer;
  v_new_id uuid;
  v_new_version integer;
  v_before jsonb;
  v_after jsonb;
  v_before_validation jsonb;
  v_validation jsonb;
  v_unknown text;
  v_before_hard integer;
  v_after_hard integer;
begin
  select string_agg(k,',') into v_unknown
  from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) as k
  where k not in ('day','startTime','endTime','teacherId','roomId','status');
  if v_unknown is not null then raise exception 'Unsupported schedule fields: %',v_unknown; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
  select * into v_current from public.schedule_versions where studio_id=v_studio and is_current limit 1;
  if v_current.id is null then raise exception 'No current schedule exists'; end if;
  select version into v_current_rulebook from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_current_enforcement from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';

  if v_current.version<>p_expected_schedule_version then raise exception 'STALE_SCHEDULE: expected %, current %',p_expected_schedule_version,v_current.version; end if;
  if v_current_rulebook<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_current_rulebook; end if;
  if v_current_enforcement<>p_expected_enforcement_version then raise exception 'STALE_ENFORCEMENT: expected %, current %',p_expected_enforcement_version,v_current_enforcement; end if;
  if v_current.rulebook_version<>v_current_rulebook then raise exception 'STALE_RULEBOOK_LINK: Schedule v% uses Rulebook v%, current Rulebook is v%',v_current.version,v_current.rulebook_version,v_current_rulebook; end if;
  if v_current.enforcement_version<>v_current_enforcement then raise exception 'STALE_ENFORCEMENT_LINK: Schedule v% uses Enforcement v%, current Enforcement is v%',v_current.version,v_current.enforcement_version,v_current_enforcement; end if;

  select to_jsonb(a) into v_before from public.assignments a where a.schedule_version_id=v_current.id and a.id=p_assignment_id;
  if v_before is null then raise exception 'Assignment % does not exist',p_assignment_id; end if;
  if coalesce((v_before->>'locked')::boolean,false) then raise exception 'LOCKED_ASSIGNMENT: % is locked',p_assignment_id; end if;

  select public.validate_schedule_hard_v22(v_current.id) into v_before_validation;
  v_before_hard:=coalesce((v_before_validation->>'hardViolations')::integer,0);

  v_new_version:=v_current.version+1;
  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,actor_user_id,actor_label,reason,is_current
  ) values(v_studio,v_new_version,v_current_rulebook,v_current_enforcement,v_uid,v_actor,p_reason,false)
  returning id into v_new_id;

  insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
    select v_new_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
    from public.assignments where schedule_version_id=v_current.id;

  update public.assignments set
    day=case when p_changes?'day' then p_changes->>'day' else day end,
    start_time=case when p_changes?'startTime' then (p_changes->>'startTime')::time else start_time end,
    end_time=case when p_changes?'endTime' then (p_changes->>'endTime')::time else end_time end,
    teacher_id=case when p_changes?'teacherId' then p_changes->>'teacherId' else teacher_id end,
    room_id=case when p_changes?'roomId' then p_changes->>'roomId' else room_id end,
    status=case when p_changes?'status' then p_changes->>'status' else status end
  where schedule_version_id=v_new_id and id=p_assignment_id;

  select public.validate_schedule_hard_v22(v_new_id) into v_validation;
  v_after_hard:=coalesce((v_validation->>'hardViolations')::integer,0);

  if v_after_hard>0 and v_before_hard=0 then
    raise exception 'HARD_VALIDATION_FAILED: %',v_validation::text;
  end if;
  if v_before_hard>0 and v_after_hard>=v_before_hard then
    raise exception 'HARD_VALIDATION_NOT_IMPROVED: schedule currently has % HARD violation(s); proposed edit leaves %',v_before_hard,v_after_hard;
  end if;

  update public.schedule_versions set is_current=false where id=v_current.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;
  select to_jsonb(a) into v_after from public.assignments a where a.schedule_version_id=v_new_id and a.id=p_assignment_id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,'SCHEDULE_PATCH','ASSIGNMENT',p_assignment_id,p_reason,
    jsonb_build_object(
      'before',v_before,'after',v_after,'scheduleVersion',v_new_version,
      'rulebookVersion',v_current_rulebook,'enforcementVersion',v_current_enforcement,
      'aiProposed',p_ai_proposed,'beforeValidation',v_before_validation,'validation',v_validation,
      'repairMode',v_before_hard>0
    ));

  return jsonb_build_object(
    'scheduleVersion',v_new_version,'rulebookVersion',v_current_rulebook,'enforcementVersion',v_current_enforcement,
    'assignmentId',p_assignment_id,'before',v_before,'after',v_after,
    'beforeValidation',v_before_validation,'validation',v_validation,'repairMode',v_before_hard>0
  );
end
$function$;

create or replace function public.rebase_current_schedule_v22(
  p_expected_schedule_version integer,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,
  p_reason text default 'Revalidate unchanged assignments against current Rulebook and Enforcement policy'
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
  v_new_id uuid;
  v_new_version integer;
  v_validation jsonb;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
  select * into v_old from public.schedule_versions where studio_id=v_studio and is_current limit 1;
  select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_ev from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
  if v_old.id is null then raise exception 'No current schedule exists'; end if;
  if v_old.version<>p_expected_schedule_version then raise exception 'STALE_SCHEDULE: expected %, current %',p_expected_schedule_version,v_old.version; end if;
  if v_rb<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rb; end if;
  if v_ev<>p_expected_enforcement_version then raise exception 'STALE_ENFORCEMENT: expected %, current %',p_expected_enforcement_version,v_ev; end if;

  if v_old.rulebook_version=v_rb and v_old.enforcement_version=v_ev then
    select public.validate_schedule_hard_v22(v_old.id) into v_validation;
    update public.schedule_versions set validation_result=v_validation where id=v_old.id;
    return jsonb_build_object(
      'scheduleVersion',v_old.version,'rulebookVersion',v_rb,'enforcementVersion',v_ev,
      'validation',v_validation,'alreadyCurrent',true
    );
  end if;

  v_new_version:=v_old.version+1;
  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,actor_user_id,actor_label,reason,is_current
  ) values(v_studio,v_new_version,v_rb,v_ev,v_uid,v_actor,p_reason,false)
  returning id into v_new_id;

  insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
    select v_new_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
    from public.assignments where schedule_version_id=v_old.id;

  select public.validate_schedule_hard_v22(v_new_id) into v_validation;
  update public.schedule_versions set is_current=false where id=v_old.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,detail,payload)
  values(v_studio,v_uid,v_actor,'SCHEDULE_REBASE','SCHEDULE',p_reason,
    jsonb_build_object(
      'fromScheduleVersion',v_old.version,'toScheduleVersion',v_new_version,
      'fromRulebookVersion',v_old.rulebook_version,'toRulebookVersion',v_rb,
      'fromEnforcementVersion',v_old.enforcement_version,'toEnforcementVersion',v_ev,
      'validation',v_validation
    ));

  return jsonb_build_object(
    'scheduleVersion',v_new_version,'rulebookVersion',v_rb,'enforcementVersion',v_ev,
    'validation',v_validation,'alreadyCurrent',false
  );
end
$function$;

revoke all on function public.apply_schedule_patch_v22(text,jsonb,text,integer,integer,integer,boolean) from public,anon;
revoke all on function public.rebase_current_schedule_v22(integer,integer,integer,text) from public,anon;
grant execute on function public.apply_schedule_patch_v22(text,jsonb,text,integer,integer,integer,boolean) to authenticated,service_role;
grant execute on function public.rebase_current_schedule_v22(integer,integer,integer,text) to authenticated,service_role;
drop function if exists public.apply_schedule_patch(text,jsonb,text,jsonb,boolean);
create function public.apply_schedule_patch(p_assignment_id text,p_changes jsonb,p_reason text,p_validation jsonb default null,p_ai_proposed boolean default false,p_expected_schedule_version integer default null,p_expected_rulebook_version integer default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare ctx jsonb:=private.resolve_dwde_actor(); v_uid uuid:=nullif(ctx->>'user_id','')::uuid; v_studio uuid:=(ctx->>'studio_id')::uuid; v_actor text:=ctx->>'actor'; v_current_id uuid; v_current_version int; v_current_rb int; v_rulebook_version int; v_new_id uuid; v_new_version int; v_before jsonb; v_after jsonb; v_db_validation jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
  select id,version,rulebook_version into v_current_id,v_current_version,v_current_rb from public.schedule_versions where studio_id=v_studio and is_current limit 1;
  select version into v_rulebook_version from public.rulebook_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if p_expected_schedule_version is not null and v_current_version<>p_expected_schedule_version then raise exception 'Stale Schedule version'; end if;
  if p_expected_rulebook_version is not null and v_rulebook_version<>p_expected_rulebook_version then raise exception 'Stale Rulebook version'; end if;
  if v_current_rb<>v_rulebook_version then raise exception 'Current Schedule is linked to Rulebook V%, current Rulebook is V%; revalidate first',v_current_rb,v_rulebook_version; end if;
  if exists(select 1 from public.rules where studio_id=v_studio and status='ACTIVE' and classification_raw='HARD' and enforcement_status='IMPLEMENTED' and id not in ('OPS-008','OPS-009','OPS-010','OPS-017','CUR-005')) then raise exception 'Database mutation guard has not yet been extended for all IMPLEMENTED HARD rules'; end if;
  select to_jsonb(a) into v_before from public.assignments a where a.schedule_version_id=v_current_id and a.id=p_assignment_id;
  if v_before is null then raise exception 'Assignment % does not exist',p_assignment_id; end if;
  if coalesce((v_before->>'locked')::boolean,false) then raise exception 'Assignment % is locked',p_assignment_id; end if;
  v_new_version:=v_current_version+1; update public.schedule_versions set is_current=false where id=v_current_id;
  insert into public.schedule_versions(studio_id,version,rulebook_version,actor_user_id,actor_label,reason,is_current) values(v_studio,v_new_version,v_rulebook_version,v_uid,v_actor,p_reason,true) returning id into v_new_id;
  insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status) select v_new_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status from public.assignments where schedule_version_id=v_current_id;
  update public.assignments set day=case when p_changes?'day' then p_changes->>'day' else day end,start_time=case when p_changes?'startTime' then (p_changes->>'startTime')::time else start_time end,end_time=case when p_changes?'endTime' then (p_changes->>'endTime')::time else end_time end,teacher_id=case when p_changes?'teacherId' then p_changes->>'teacherId' else teacher_id end,room_id=case when p_changes?'roomId' then p_changes->>'roomId' else room_id end,status=case when p_ai_proposed then 'AI_PROPOSED' when p_changes?'status' then p_changes->>'status' else status end where schedule_version_id=v_new_id and id=p_assignment_id;
  v_db_validation:=private.validate_schedule_core(v_new_id); if (v_db_validation->>'valid')::boolean is not true then raise exception 'Database validation rejected the proposed schedule patch: %',v_db_validation; end if;
  update public.schedule_versions set validation_result=v_db_validation||jsonb_build_object('serverPreview',p_validation) where id=v_new_id;
  select to_jsonb(a) into v_after from public.assignments a where a.schedule_version_id=v_new_id and a.id=p_assignment_id;
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values(v_studio,v_uid,v_actor,'SCHEDULE_PATCH','ASSIGNMENT',p_assignment_id,p_reason,jsonb_build_object('before',v_before,'after',v_after,'scheduleVersion',v_new_version,'rulebookVersion',v_rulebook_version,'aiProposed',p_ai_proposed,'validation',v_db_validation));
  return jsonb_build_object('scheduleVersion',v_new_version,'assignmentId',p_assignment_id,'before',v_before,'after',v_after,'validation',v_db_validation);
end $$;

create or replace function public.rebase_schedule_to_current_rulebook(p_expected_schedule_version integer,p_expected_rulebook_version integer,p_validation jsonb default null,p_reason text default 'Revalidate schedule against current Rulebook')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare ctx jsonb:=private.resolve_dwde_actor(); v_uid uuid:=nullif(ctx->>'user_id','')::uuid; v_studio uuid:=(ctx->>'studio_id')::uuid; v_actor text:=ctx->>'actor'; v_current_id uuid; v_current_version int; v_current_rb int; v_rulebook_version int; v_new_id uuid; v_new_version int; v_db jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
  select id,version,rulebook_version into v_current_id,v_current_version,v_current_rb from public.schedule_versions where studio_id=v_studio and is_current limit 1;
  select version into v_rulebook_version from public.rulebook_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if v_current_version<>p_expected_schedule_version or v_rulebook_version<>p_expected_rulebook_version then raise exception 'Rulebook or Schedule changed; refresh before revalidation'; end if;
  if v_current_rb=v_rulebook_version then return jsonb_build_object('scheduleVersion',v_current_version,'alreadyCurrent',true,'validation',private.validate_schedule_core(v_current_id)); end if;
  v_new_version:=v_current_version+1; update public.schedule_versions set is_current=false where id=v_current_id;
  insert into public.schedule_versions(studio_id,version,rulebook_version,actor_user_id,actor_label,reason,is_current) values(v_studio,v_new_version,v_rulebook_version,v_uid,v_actor,p_reason,true) returning id into v_new_id;
  insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status) select v_new_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status from public.assignments where schedule_version_id=v_current_id;
  v_db:=private.validate_schedule_core(v_new_id); update public.schedule_versions set validation_result=v_db||jsonb_build_object('serverPreview',p_validation) where id=v_new_id;
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,detail,payload) values(v_studio,v_uid,v_actor,'SCHEDULE_REBASE','SCHEDULE',p_reason,jsonb_build_object('fromScheduleVersion',v_current_version,'toScheduleVersion',v_new_version,'fromRulebookVersion',v_current_rb,'toRulebookVersion',v_rulebook_version,'validation',v_db));
  return jsonb_build_object('scheduleVersion',v_new_version,'rulebookVersion',v_rulebook_version,'validation',v_db,'alreadyCurrent',false);
end $$;

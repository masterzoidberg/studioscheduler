create or replace function public.update_studio_entity_v21(
  p_entity_type text,
  p_entity_id text,
  p_changes jsonb,
  p_reason text,
  p_expected_rulebook_version integer,
  p_expected_schedule_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  ctx jsonb := private.assert_editor_context();
  v_uid uuid := (ctx->>'user_id')::uuid;
  v_studio uuid := (ctx->>'studio_id')::uuid;
  v_actor text := ctx->>'actor';
  v_rb integer;
  v_sv integer;
  v_before jsonb;
  v_after jsonb;
  v_version integer;
  v_unknown text;
begin
  if p_entity_type not in ('TEACHER','ROOM','CLASS') then raise exception 'Unsupported entity type'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
  select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_sv from public.schedule_versions where studio_id=v_studio and is_current;
  if v_rb<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rb; end if;
  if v_sv<>p_expected_schedule_version then raise exception 'STALE_SCHEDULE: expected %, current %',p_expected_schedule_version,v_sv; end if;

  if p_entity_type='TEACHER' then
    select string_agg(k,',') into v_unknown from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) as k where k not in ('name','notes');
    if v_unknown is not null then raise exception 'Teacher qualifications are Rulebook truth. Unsupported teacher fields: %',v_unknown; end if;
    select to_jsonb(t) into v_before from public.teachers t where studio_id=v_studio and id=p_entity_id;
    if v_before is null then raise exception 'Teacher not found'; end if;
    update public.teachers set
      name=case when p_changes?'name' then p_changes->>'name' else name end,
      notes=case when p_changes?'notes' then nullif(p_changes->>'notes','') else notes end,
      updated_at=now()
    where studio_id=v_studio and id=p_entity_id;
    select to_jsonb(t) into v_after from public.teachers t where studio_id=v_studio and id=p_entity_id;
  elsif p_entity_type='ROOM' then
    select string_agg(k,',') into v_unknown from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) as k where k not in ('name','capacity','features');
    if v_unknown is not null then raise exception 'Unsupported room fields: %',v_unknown; end if;
    select to_jsonb(r) into v_before from public.rooms r where studio_id=v_studio and id=p_entity_id;
    if v_before is null then raise exception 'Room not found'; end if;
    update public.rooms set
      name=case when p_changes?'name' then p_changes->>'name' else name end,
      capacity=case when p_changes?'capacity' then nullif(p_changes->>'capacity','')::integer else capacity end,
      features=case when p_changes?'features' then array(select jsonb_array_elements_text(p_changes->'features')) else features end,
      updated_at=now()
    where studio_id=v_studio and id=p_entity_id;
    select to_jsonb(r) into v_after from public.rooms r where studio_id=v_studio and id=p_entity_id;
  else
    select string_agg(k,',') into v_unknown from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) as k where k not in ('name','subject','level','durationMinutes','weeklyFrequency','rosterStudentIds','companyOnly');
    if v_unknown is not null then raise exception 'Teacher eligibility is Rulebook truth. Unsupported class fields: %',v_unknown; end if;
    select to_jsonb(c) into v_before from public.class_definitions c where studio_id=v_studio and id=p_entity_id;
    if v_before is null then raise exception 'Class not found'; end if;
    update public.class_definitions set
      name=case when p_changes?'name' then p_changes->>'name' else name end,
      subject=case when p_changes?'subject' then p_changes->>'subject' else subject end,
      level=case when p_changes?'level' then p_changes->>'level' else level end,
      duration_minutes=case when p_changes?'durationMinutes' then (p_changes->>'durationMinutes')::integer else duration_minutes end,
      weekly_frequency=case when p_changes?'weeklyFrequency' then (p_changes->>'weeklyFrequency')::integer else weekly_frequency end,
      roster_student_ids=case when p_changes?'rosterStudentIds' then array(select jsonb_array_elements_text(p_changes->'rosterStudentIds')) else roster_student_ids end,
      company_only=case when p_changes?'companyOnly' then (p_changes->>'companyOnly')::boolean else company_only end,
      updated_at=now()
    where studio_id=v_studio and id=p_entity_id;
    select to_jsonb(c) into v_after from public.class_definitions c where studio_id=v_studio and id=p_entity_id;
  end if;

  select coalesce(max(version),0)+1 into v_version from public.entity_versions where studio_id=v_studio and entity_type=p_entity_type and entity_id=p_entity_id;
  insert into public.entity_versions(studio_id,entity_type,entity_id,version,actor_user_id,actor_label,reason,before_entity,after_entity)
    values(v_studio,p_entity_type,p_entity_id,v_version,v_uid,v_actor,p_reason,v_before,v_after);
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
    values(v_studio,v_uid,v_actor,p_entity_type||'_UPDATE',p_entity_type,p_entity_id,p_reason,
      jsonb_build_object('before',v_before,'after',v_after,'entityVersion',v_version));
  return jsonb_build_object('entityType',p_entity_type,'entityId',p_entity_id,'version',v_version,'before',v_before,'after',v_after);
end
$function$;

create or replace function public.create_scenario_v21(
  p_name text,p_rule_patches jsonb,p_schedule_patches jsonb,p_expected_rulebook_version integer,p_expected_schedule_version integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare ctx jsonb:=private.assert_editor_context(); v_studio uuid:=(ctx->>'studio_id')::uuid; v_uid uuid:=(ctx->>'user_id')::uuid; v_rb integer; v_sv integer; v_id uuid;
begin
  if coalesce(btrim(p_name),'')='' then raise exception 'Scenario name is required'; end if;
  select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_sv from public.schedule_versions where studio_id=v_studio and is_current;
  if v_rb<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK'; end if;
  if v_sv<>p_expected_schedule_version then raise exception 'STALE_SCHEDULE'; end if;
  insert into public.scenarios(studio_id,name,base_rulebook_version,base_schedule_version,rule_patches,schedule_patches,created_by)
    values(v_studio,p_name,v_rb,v_sv,coalesce(p_rule_patches,'[]'::jsonb),coalesce(p_schedule_patches,'[]'::jsonb),v_uid) returning id into v_id;
  return jsonb_build_object('id',v_id,'baseRulebookVersion',v_rb,'baseScheduleVersion',v_sv);
end
$function$;

create or replace function public.invite_studio_member_v21(p_email text,p_role text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare ctx jsonb:=private.dwde_actor_context(); v_studio uuid:=(ctx->>'studio_id')::uuid; v_uid uuid:=(ctx->>'user_id')::uuid; v_id uuid;
begin
  if ctx->>'role'<>'OWNER' then raise exception 'Owner membership required'; end if;
  if p_role not in ('OWNER','EDITOR','VIEWER') then raise exception 'Invalid role'; end if;
  if coalesce(btrim(p_email),'')='' then raise exception 'Email is required'; end if;
  if exists(select 1 from public.studio_invites where studio_id=v_studio and lower(email)=lower(btrim(p_email)) and accepted_at is null) then
    raise exception 'An active invitation already exists for this email';
  end if;
  insert into public.studio_invites(studio_id,email,role,invited_by)
    values(v_studio,lower(btrim(p_email)),p_role,v_uid) returning id into v_id;
  return jsonb_build_object('id',v_id,'email',lower(btrim(p_email)),'role',p_role);
end
$function$;

create or replace function public.set_studio_member_role_v21(p_user_id uuid,p_role text)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
declare ctx jsonb:=private.dwde_actor_context(); v_studio uuid:=(ctx->>'studio_id')::uuid;
begin
  if ctx->>'role'<>'OWNER' then raise exception 'Owner membership required'; end if;
  if p_role not in ('OWNER','EDITOR','VIEWER') then raise exception 'Invalid role'; end if;
  if p_user_id=auth.uid() and p_role<>'OWNER' and (select count(*) from public.studio_members where studio_id=v_studio and role='OWNER')=1 then
    raise exception 'Cannot demote the only owner';
  end if;
  update public.studio_members set role=p_role where studio_id=v_studio and user_id=p_user_id;
  return found;
end
$function$;

create or replace function public.remove_studio_member_v21(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
declare ctx jsonb:=private.dwde_actor_context(); v_studio uuid:=(ctx->>'studio_id')::uuid;
begin
  if ctx->>'role'<>'OWNER' then raise exception 'Owner membership required'; end if;
  if p_user_id=auth.uid() and (select count(*) from public.studio_members where studio_id=v_studio and role='OWNER')=1 then
    raise exception 'Cannot remove the only owner';
  end if;
  delete from public.studio_members where studio_id=v_studio and user_id=p_user_id;
  return found;
end
$function$;

create or replace function public.record_ai_proposal_v21(
  p_proposal_type text,p_request_text text,p_response_text text,p_patch jsonb,p_impact jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare ctx jsonb:=private.dwde_actor_context(); v_studio uuid:=(ctx->>'studio_id')::uuid; v_uid uuid:=(ctx->>'user_id')::uuid; v_id uuid;
begin
  if p_proposal_type not in ('RULE_PATCH','SCHEDULE_PATCH','QUESTION') then raise exception 'Invalid proposal type'; end if;
  insert into public.ai_proposals(studio_id,user_id,proposal_type,request_text,response_text,patch,impact,status)
    values(v_studio,v_uid,p_proposal_type,p_request_text,p_response_text,p_patch,p_impact,'PROPOSED') returning id into v_id;
  return v_id;
end
$function$;

revoke all on function public.update_studio_entity_v21(text,text,jsonb,text,integer,integer) from public,anon;
revoke all on function public.create_scenario_v21(text,jsonb,jsonb,integer,integer) from public,anon;
revoke all on function public.invite_studio_member_v21(text,text) from public,anon;
revoke all on function public.set_studio_member_role_v21(uuid,text) from public,anon;
revoke all on function public.remove_studio_member_v21(uuid) from public,anon;
revoke all on function public.record_ai_proposal_v21(text,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.update_studio_entity_v21(text,text,jsonb,text,integer,integer) to authenticated,service_role;
grant execute on function public.create_scenario_v21(text,jsonb,jsonb,integer,integer) to authenticated,service_role;
grant execute on function public.invite_studio_member_v21(text,text) to authenticated,service_role;
grant execute on function public.set_studio_member_role_v21(uuid,text) to authenticated,service_role;
grant execute on function public.remove_studio_member_v21(uuid) to authenticated,service_role;
grant execute on function public.record_ai_proposal_v21(text,text,text,jsonb,jsonb) to authenticated,service_role;
create or replace function public.rebase_current_schedule_v21(
  p_expected_schedule_version integer,
  p_expected_rulebook_version integer,
  p_reason text default 'Revalidate unchanged assignments against current Rulebook'
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
  v_new_id uuid;
  v_new_version integer;
  v_validation jsonb;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
  select * into v_old from public.schedule_versions where studio_id=v_studio and is_current limit 1;
  select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  if v_old.id is null then raise exception 'No current schedule exists'; end if;
  if v_old.version<>p_expected_schedule_version then raise exception 'STALE_SCHEDULE: expected %, current %',p_expected_schedule_version,v_old.version; end if;
  if v_rb<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rb; end if;
  if v_old.rulebook_version=v_rb then
    select public.validate_schedule_hard_v21(v_old.id) into v_validation;
    update public.schedule_versions set validation_result=v_validation where id=v_old.id;
    return jsonb_build_object('scheduleVersion',v_old.version,'rulebookVersion',v_rb,'validation',v_validation,'alreadyCurrent',true);
  end if;
  v_new_version:=v_old.version+1;
  insert into public.schedule_versions(studio_id,version,rulebook_version,actor_user_id,actor_label,reason,is_current)
    values(v_studio,v_new_version,v_rb,v_uid,v_actor,p_reason,false) returning id into v_new_id;
  insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
    select v_new_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
    from public.assignments where schedule_version_id=v_old.id;
  select public.validate_schedule_hard_v21(v_new_id) into v_validation;
  update public.schedule_versions set is_current=false where id=v_old.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,detail,payload)
    values(v_studio,v_uid,v_actor,'SCHEDULE_REBASE','SCHEDULE',p_reason,
      jsonb_build_object('fromScheduleVersion',v_old.version,'toScheduleVersion',v_new_version,'fromRulebookVersion',v_old.rulebook_version,'toRulebookVersion',v_rb,'validation',v_validation));
  return jsonb_build_object('scheduleVersion',v_new_version,'rulebookVersion',v_rb,'validation',v_validation,'alreadyCurrent',false);
end
$function$;
revoke all on function public.rebase_current_schedule_v21(integer,integer,text) from public,anon;
grant execute on function public.rebase_current_schedule_v21(integer,integer,text) to authenticated,service_role;
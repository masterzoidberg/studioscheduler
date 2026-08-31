create or replace function public.apply_schedule_patch_v21(
  p_assignment_id text,
  p_changes jsonb,
  p_reason text,
  p_expected_schedule_version integer,
  p_expected_rulebook_version integer,
  p_ai_proposed boolean default false
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
  v_current public.schedule_versions%rowtype;
  v_current_rulebook integer;
  v_new_id uuid;
  v_new_version integer;
  v_before jsonb;
  v_after jsonb;
  v_validation jsonb;
  v_unknown text;
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
  if v_current.version<>p_expected_schedule_version then raise exception 'STALE_SCHEDULE: expected %, current %',p_expected_schedule_version,v_current.version; end if;
  if v_current_rulebook<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_current_rulebook; end if;
  if v_current.rulebook_version<>v_current_rulebook then raise exception 'STALE_RULEBOOK_LINK: Schedule v% uses Rulebook v%, current Rulebook is v%',v_current.version,v_current.rulebook_version,v_current_rulebook; end if;

  select to_jsonb(a) into v_before from public.assignments a where a.schedule_version_id=v_current.id and a.id=p_assignment_id;
  if v_before is null then raise exception 'Assignment % does not exist',p_assignment_id; end if;
  if coalesce((v_before->>'locked')::boolean,false) then raise exception 'LOCKED_ASSIGNMENT: % is locked',p_assignment_id; end if;

  v_new_version:=v_current.version+1;
  insert into public.schedule_versions(studio_id,version,rulebook_version,actor_user_id,actor_label,reason,is_current)
    values(v_studio,v_new_version,v_current_rulebook,v_uid,v_actor,p_reason,false) returning id into v_new_id;

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

  select public.validate_schedule_hard_v21(v_new_id) into v_validation;
  if (v_validation->>'hardViolations')::integer>0 then
    raise exception 'HARD_VALIDATION_FAILED: %',v_validation::text;
  end if;

  update public.schedule_versions set is_current=false where id=v_current.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;
  select to_jsonb(a) into v_after from public.assignments a where a.schedule_version_id=v_new_id and a.id=p_assignment_id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
    values(v_studio,v_uid,v_actor,'SCHEDULE_PATCH','ASSIGNMENT',p_assignment_id,p_reason,
      jsonb_build_object('before',v_before,'after',v_after,'scheduleVersion',v_new_version,'rulebookVersion',v_current_rulebook,'aiProposed',p_ai_proposed,'validation',v_validation));

  return jsonb_build_object('scheduleVersion',v_new_version,'rulebookVersion',v_current_rulebook,'assignmentId',p_assignment_id,'before',v_before,'after',v_after,'validation',v_validation);
end
$function$;

revoke all on function public.apply_schedule_patch_v21(text,jsonb,text,integer,integer,boolean) from public, anon;
grant execute on function public.apply_schedule_patch_v21(text,jsonb,text,integer,integer,boolean) to authenticated, service_role;
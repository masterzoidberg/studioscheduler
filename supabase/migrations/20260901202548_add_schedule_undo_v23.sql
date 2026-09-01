create or replace function public.undo_last_schedule_change_v23(
  p_expected_schedule_version integer,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,
  p_reason text default 'Undo last schedule change'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  ctx jsonb := private.assert_editor_context();
  v_uid uuid := (ctx->>'user_id')::uuid;
  v_studio uuid := (ctx->>'studio_id')::uuid;
  v_actor text := ctx->>'actor';
  v_current public.schedule_versions%rowtype;
  v_previous public.schedule_versions%rowtype;
  v_current_rulebook integer;
  v_current_enforcement integer;
  v_new_id uuid;
  v_new_version integer;
  v_validation jsonb;
  v_current_validation jsonb;
  v_current_hard integer;
  v_after_hard integer;
  v_unscheduled integer;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));

  select * into v_current
  from public.schedule_versions
  where studio_id=v_studio and is_current
  limit 1;
  if v_current.id is null then raise exception 'No current schedule exists'; end if;

  select version into v_current_rulebook
  from public.rulebook_versions
  where studio_id=v_studio and status='CURRENT';

  select version into v_current_enforcement
  from public.rule_enforcement_versions
  where studio_id=v_studio and status='CURRENT';

  if v_current.version<>p_expected_schedule_version then
    raise exception 'STALE_SCHEDULE: expected %, current %',p_expected_schedule_version,v_current.version;
  end if;
  if v_current_rulebook<>p_expected_rulebook_version then
    raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_current_rulebook;
  end if;
  if v_current_enforcement<>p_expected_enforcement_version then
    raise exception 'STALE_ENFORCEMENT: expected %, current %',p_expected_enforcement_version,v_current_enforcement;
  end if;
  if v_current.rulebook_version<>v_current_rulebook then
    raise exception 'STALE_RULEBOOK_LINK: revalidate the current schedule before undo';
  end if;
  if v_current.enforcement_version<>v_current_enforcement then
    raise exception 'STALE_ENFORCEMENT_LINK: revalidate the current schedule before undo';
  end if;

  select * into v_previous
  from public.schedule_versions
  where studio_id=v_studio
    and version=v_current.version-1
    and rulebook_version=v_current_rulebook
    and enforcement_version=v_current_enforcement
  limit 1;

  if v_previous.id is null then
    raise exception 'NO_COMPATIBLE_UNDO: Schedule v% has no immediately previous version using Rulebook v% and Enforcement v%',
      v_current.version,v_current_rulebook,v_current_enforcement;
  end if;

  select public.validate_schedule_hard_v22(v_current.id) into v_current_validation;
  v_current_hard := coalesce((v_current_validation->>'hardViolations')::integer,0);

  v_new_version := v_current.version+1;
  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,actor_user_id,actor_label,reason,is_current
  ) values(
    v_studio,v_new_version,v_current_rulebook,v_current_enforcement,v_uid,v_actor,p_reason,false
  ) returning id into v_new_id;

  insert into public.assignments(
    schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
  )
  select
    v_new_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
  from public.assignments
  where schedule_version_id=v_previous.id;

  select public.validate_schedule_hard_v22(v_new_id) into v_validation;
  v_after_hard := coalesce((v_validation->>'hardViolations')::integer,0);

  if v_current_hard=0 and v_after_hard>0 then
    raise exception 'UNDO_VALIDATION_FAILED: previous schedule would restore % detected HARD violation(s)',v_after_hard;
  end if;
  if v_current_hard>0 and v_after_hard>v_current_hard then
    raise exception 'UNDO_VALIDATION_WORSENED: current schedule has % detected HARD violation(s); previous schedule has %',v_current_hard,v_after_hard;
  end if;

  select count(*)::integer into v_unscheduled
  from public.class_sessions s
  where s.studio_id=v_studio
    and not exists(
      select 1 from public.assignments a
      where a.schedule_version_id=v_new_id and a.session_id=s.id
    );

  v_validation := coalesce(v_validation,'{}'::jsonb)
    || jsonb_build_object('unscheduledSessions',v_unscheduled,'scheduleComplete',v_unscheduled=0);

  update public.schedule_versions set is_current=false where id=v_current.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    v_studio,v_uid,v_actor,'SCHEDULE_UNDO','SCHEDULE_VERSION',v_new_id::text,p_reason,
    jsonb_build_object(
      'undoneScheduleVersion',v_current.version,
      'restoredFromScheduleVersion',v_previous.version,
      'scheduleVersion',v_new_version,
      'rulebookVersion',v_current_rulebook,
      'enforcementVersion',v_current_enforcement,
      'beforeValidation',v_current_validation,
      'validation',v_validation,
      'unscheduledSessions',v_unscheduled
    )
  );

  return jsonb_build_object(
    'scheduleVersion',v_new_version,
    'undoneScheduleVersion',v_current.version,
    'restoredFromScheduleVersion',v_previous.version,
    'rulebookVersion',v_current_rulebook,
    'enforcementVersion',v_current_enforcement,
    'validation',v_validation,
    'unscheduledSessions',v_unscheduled
  );
end
$function$;

revoke all on function public.undo_last_schedule_change_v23(integer,integer,integer,text) from public,anon;
grant execute on function public.undo_last_schedule_change_v23(integer,integer,integer,text) to authenticated,service_role;

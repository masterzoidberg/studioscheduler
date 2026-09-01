create unique index if not exists idx_assignments_schedule_session_unique
  on public.assignments(schedule_version_id, session_id);

create or replace function public.apply_schedule_builder_patch_v23(
  p_operation text,
  p_assignment_id text,
  p_session_id text,
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
  ctx jsonb := private.assert_editor_context();
  v_uid uuid := (ctx->>'user_id')::uuid;
  v_studio uuid := (ctx->>'studio_id')::uuid;
  v_actor text := ctx->>'actor';
  v_operation text := upper(coalesce(p_operation,''));
  v_current public.schedule_versions%rowtype;
  v_current_rulebook integer;
  v_current_enforcement integer;
  v_new_id uuid;
  v_new_version integer;
  v_before jsonb;
  v_after jsonb;
  v_before_validation jsonb;
  v_validation jsonb;
  v_before_hard integer;
  v_after_hard integer;
  v_unknown text;
  v_session_id text;
  v_assignment_id text;
  v_duration integer;
  v_session_locked boolean;
  v_day text;
  v_start_time time;
  v_end_time time;
  v_teacher_id text;
  v_room_id text;
  v_status text;
  v_unscheduled integer;
begin
  if v_operation not in ('MOVE','ASSIGN','UNASSIGN') then
    raise exception 'Unsupported schedule operation: %', p_operation;
  end if;

  select string_agg(k,',') into v_unknown
  from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) as k
  where k not in ('day','startTime','teacherId','roomId','status');
  if v_unknown is not null then
    raise exception 'Unsupported schedule fields: %', v_unknown;
  end if;
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

  select public.validate_schedule_hard_v22(v_current.id) into v_before_validation;
  v_before_hard := coalesce((v_before_validation->>'hardViolations')::integer,0);

  if v_operation in ('MOVE','UNASSIGN') then
    select to_jsonb(a) into v_before
    from public.assignments a
    where a.schedule_version_id=v_current.id and a.id=p_assignment_id;
    if v_before is null then raise exception 'Assignment % does not exist',p_assignment_id; end if;
    if coalesce((v_before->>'locked')::boolean,false) then raise exception 'LOCKED_ASSIGNMENT: % is locked',p_assignment_id; end if;
    v_session_id := v_before->>'session_id';
    v_assignment_id := p_assignment_id;
  else
    v_session_id := nullif(btrim(coalesce(p_session_id,'')),'');
    if v_session_id is null then raise exception 'Session is required for ASSIGN'; end if;
    if exists(select 1 from public.assignments where schedule_version_id=v_current.id and session_id=v_session_id) then
      raise exception 'SESSION_ALREADY_ASSIGNED: %',v_session_id;
    end if;
    v_assignment_id := coalesce(nullif(btrim(coalesce(p_assignment_id,'')),''),'assignment-'||v_session_id);
    if exists(select 1 from public.assignments where schedule_version_id=v_current.id and id=v_assignment_id) then
      raise exception 'ASSIGNMENT_ID_ALREADY_EXISTS: %',v_assignment_id;
    end if;
  end if;

  select c.duration_minutes, s.locked
    into v_duration, v_session_locked
  from public.class_sessions s
  join public.class_definitions c on c.id=s.class_id and c.studio_id=v_studio
  where s.id=v_session_id and s.studio_id=v_studio;
  if v_duration is null then raise exception 'Session % is not part of this studio',v_session_id; end if;
  if v_session_locked and v_operation in ('MOVE','UNASSIGN') then raise exception 'LOCKED_SESSION: % is locked',v_session_id; end if;

  if v_operation='ASSIGN' then
    v_day := p_changes->>'day';
    if v_day is null then raise exception 'day is required for ASSIGN'; end if;
    if not (p_changes ? 'startTime') then raise exception 'startTime is required for ASSIGN'; end if;
    v_start_time := (p_changes->>'startTime')::time;
    v_teacher_id := nullif(p_changes->>'teacherId','');
    v_room_id := nullif(p_changes->>'roomId','');
    v_status := coalesce(nullif(p_changes->>'status',''),'NORMAL');
    if v_teacher_id is null then raise exception 'teacherId is required for ASSIGN'; end if;
    if v_room_id is null then raise exception 'roomId is required for ASSIGN'; end if;
  elsif v_operation='MOVE' then
    v_day := case when p_changes?'day' then p_changes->>'day' else v_before->>'day' end;
    v_start_time := case when p_changes?'startTime' then (p_changes->>'startTime')::time else (v_before->>'start_time')::time end;
    v_teacher_id := case when p_changes?'teacherId' then p_changes->>'teacherId' else v_before->>'teacher_id' end;
    v_room_id := case when p_changes?'roomId' then p_changes->>'roomId' else v_before->>'room_id' end;
    v_status := case when p_changes?'status' then p_changes->>'status' else v_before->>'status' end;
  end if;

  if v_operation in ('MOVE','ASSIGN') then
    if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') then raise exception 'Invalid schedule day: %',v_day; end if;
    if extract(second from v_start_time)<>0 or mod(extract(minute from v_start_time)::integer,15)<>0 then
      raise exception 'TIME_GRID: start time must be on a 15-minute boundary';
    end if;
    if not exists(select 1 from public.teachers where id=v_teacher_id and studio_id=v_studio) then raise exception 'Teacher % is not part of this studio',v_teacher_id; end if;
    if not exists(select 1 from public.rooms where id=v_room_id and studio_id=v_studio) then raise exception 'Room % is not part of this studio',v_room_id; end if;
    if v_status not in ('NORMAL','WARNING','AI_PROPOSED') then raise exception 'Invalid assignment status: %',v_status; end if;
    v_end_time := v_start_time + make_interval(mins=>v_duration);
    if v_end_time<=v_start_time then raise exception 'Assignment may not cross midnight'; end if;
  end if;

  v_new_version := v_current.version+1;
  insert into public.schedule_versions(studio_id,version,rulebook_version,enforcement_version,actor_user_id,actor_label,reason,is_current)
  values(v_studio,v_new_version,v_current_rulebook,v_current_enforcement,v_uid,v_actor,p_reason,false)
  returning id into v_new_id;

  insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
  select v_new_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
  from public.assignments where schedule_version_id=v_current.id;

  if v_operation='MOVE' then
    update public.assignments
    set day=v_day,start_time=v_start_time,end_time=v_end_time,teacher_id=v_teacher_id,room_id=v_room_id,status=v_status
    where schedule_version_id=v_new_id and id=v_assignment_id;
  elsif v_operation='ASSIGN' then
    insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
    values(v_new_id,v_assignment_id,v_studio,v_session_id,v_day,v_start_time,v_end_time,v_teacher_id,v_room_id,v_session_locked,v_status);
  else
    delete from public.assignments where schedule_version_id=v_new_id and id=v_assignment_id;
  end if;

  select public.validate_schedule_hard_v22(v_new_id) into v_validation;
  v_after_hard := coalesce((v_validation->>'hardViolations')::integer,0);

  if v_operation='MOVE' then
    if v_after_hard>0 and v_before_hard=0 then raise exception 'HARD_VALIDATION_FAILED: %',v_validation::text; end if;
    if v_before_hard>0 and v_after_hard>=v_before_hard then raise exception 'HARD_VALIDATION_NOT_IMPROVED: schedule currently has % HARD violation(s); proposed move leaves %',v_before_hard,v_after_hard; end if;
  elsif v_after_hard>v_before_hard then
    raise exception 'HARD_VALIDATION_WORSENED: operation would increase detected HARD violations from % to %',v_before_hard,v_after_hard;
  end if;

  select count(*)::integer into v_unscheduled
  from public.class_sessions s
  where s.studio_id=v_studio
    and not exists(select 1 from public.assignments a where a.schedule_version_id=v_new_id and a.session_id=s.id);
  v_validation := coalesce(v_validation,'{}'::jsonb) || jsonb_build_object('unscheduledSessions',v_unscheduled,'scheduleComplete',v_unscheduled=0);

  update public.schedule_versions set is_current=false where id=v_current.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;
  select to_jsonb(a) into v_after from public.assignments a where a.schedule_version_id=v_new_id and a.id=v_assignment_id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,'SCHEDULE_BUILDER_PATCH','ASSIGNMENT',v_assignment_id,p_reason,
    jsonb_build_object('operation',v_operation,'sessionId',v_session_id,'before',v_before,'after',v_after,'scheduleVersion',v_new_version,
      'rulebookVersion',v_current_rulebook,'enforcementVersion',v_current_enforcement,'aiProposed',p_ai_proposed,
      'beforeValidation',v_before_validation,'validation',v_validation,'unscheduledSessions',v_unscheduled));

  return jsonb_build_object('operation',v_operation,'scheduleVersion',v_new_version,'rulebookVersion',v_current_rulebook,
    'enforcementVersion',v_current_enforcement,'assignmentId',v_assignment_id,'sessionId',v_session_id,'before',v_before,'after',v_after,
    'beforeValidation',v_before_validation,'validation',v_validation,'unscheduledSessions',v_unscheduled);
end
$function$;

revoke all on function public.apply_schedule_builder_patch_v23(text,text,text,jsonb,text,integer,integer,integer,boolean) from public,anon;
grant execute on function public.apply_schedule_builder_patch_v23(text,text,text,jsonb,text,integer,integer,integer,boolean) to authenticated,service_role;

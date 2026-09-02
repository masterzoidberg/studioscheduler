-- Milestone 2 / V2.9 planning identity completeness.
-- Constraint IR selectors currently use human-reviewed entity names. Those names are
-- therefore scheduling-significant planning facts and must be pinned for historical
-- reproducibility. Presentation-only teacher notes/colors remain outside the snapshot.

create or replace function private.build_planning_dataset_snapshot_v25(p_studio uuid)
returns jsonb
language sql
stable
set search_path=''
as $function$
  select jsonb_build_object(
    'schemaVersion','1.3',
    'studioId',p_studio::text,
    'sourceManifest',(select jsonb_build_object('version',m.version,'snapshotHash',m.snapshot_hash,'complete',m.complete,'snapshot',m.snapshot) from public.planning_source_manifest_versions m where m.studio_id=p_studio and m.status='CURRENT' limit 1),
    'teacherIds',coalesce((select jsonb_agg(t.id order by t.id collate "C") from public.teachers t where t.studio_id=p_studio),'[]'::jsonb),
    'teachers',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.id collate "C") from public.teachers t where t.studio_id=p_studio),'[]'::jsonb),
    'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'capacity',r.capacity,'features',private.sorted_text_array_jsonb_v25(r.features)) order by r.id collate "C") from public.rooms r where r.studio_id=p_studio),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'level',s.level,'cohortIds',private.sorted_text_array_jsonb_v25(s.cohort_ids)) order by s.id collate "C") from public.students s where s.studio_id=p_studio),'[]'::jsonb),
    'cohorts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'studentIds',private.sorted_text_array_jsonb_v25(c.student_ids)) order by c.id collate "C") from public.cohorts c where c.studio_id=p_studio),'[]'::jsonb),
    'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'subject',c.subject,'level',c.level,'durationMinutes',c.duration_minutes,'weeklyFrequency',c.weekly_frequency,'rosterStudentIds',private.sorted_text_array_jsonb_v25(c.roster_student_ids),'companyOnly',c.company_only) order by c.id collate "C") from public.class_definitions c where c.studio_id=p_studio),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'classId',s.class_id,'ordinal',s.ordinal,'durationMinutes',s.duration_minutes,'locked',s.locked) order by s.id collate "C") from public.class_sessions s where s.studio_id=p_studio),'[]'::jsonb)
  )
$function$;
revoke all on function private.build_planning_dataset_snapshot_v25(uuid) from public,anon,authenticated;

-- V2.8 remains the public RPC name. V2.9 refines its response so presentation-only
-- teacher edits can truthfully report that the Planning Dataset did not advance.
create or replace function public.mutate_planning_entity_v28(
  p_operation text,
  p_entity_type text,
  p_entity_id text,
  p_changes jsonb,
  p_reason text,
  p_expected_planning_dataset_version integer
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
  v_current_planning integer;
  v_entity_id text:=nullif(btrim(coalesce(p_entity_id,'')),'');
  v_name text:=btrim(coalesce(p_changes->>'name',''));
  v_before jsonb;
  v_after jsonb;
  v_entity_version integer;
  v_planning_version integer;
  v_requires_revalidation boolean;
  v_unknown text;
  v_frequency integer;
  v_old_frequency integer;
  v_duration integer;
  v_ordinal integer;
  v_session_id text;
  v_color text;
  v_missing_roster text[];
begin
  if p_operation not in ('CREATE','UPDATE') then raise exception 'Unsupported planning entity operation'; end if;
  if p_entity_type not in ('TEACHER','STUDENT','ROOM','CLASS') then raise exception 'Unsupported planning entity type'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  if jsonb_typeof(coalesce(p_changes,'{}'::jsonb))<>'object' then raise exception 'Changes must be a JSON object'; end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-entity:'||v_studio::text,0));
  select version into v_current_planning from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if v_current_planning is null then raise exception 'No current PlanningDatasetVersion exists'; end if;
  if v_current_planning<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_current_planning; end if;

  if p_operation='CREATE' then
    if v_name='' then raise exception 'Name is required'; end if;
    if v_entity_id is null then v_entity_id:=private.next_planning_entity_id_v28(v_studio,p_entity_type,v_name); end if;
  elsif v_entity_id is null then raise exception 'Entity ID is required for UPDATE';
  end if;

  if p_entity_type='TEACHER' then
    select string_agg(k,',') into v_unknown from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) k where k not in ('name','notes','displayColor');
    if v_unknown is not null then raise exception 'Teacher qualifications are Rulebook truth. Unsupported teacher fields: %',v_unknown; end if;
    if p_changes?'displayColor' then
      v_color:=nullif(btrim(coalesce(p_changes->>'displayColor','')),'');
      if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Teacher color must be a six-digit hex color'; end if;
    end if;
    select to_jsonb(t) into v_before from public.teachers t where t.studio_id=v_studio and t.id=v_entity_id;
    if p_operation='CREATE' then
      if v_before is not null then raise exception 'Teacher % already exists',v_entity_id; end if;
      insert into public.teachers(id,studio_id,name,subjects,notes,display_color) values(v_entity_id,v_studio,v_name,'{}'::text[],nullif(p_changes->>'notes',''),v_color);
    else
      if v_before is null then raise exception 'Teacher not found'; end if;
      update public.teachers set
        name=case when p_changes?'name' then nullif(btrim(p_changes->>'name'),'') else name end,
        notes=case when p_changes?'notes' then nullif(p_changes->>'notes','') else notes end,
        display_color=case when p_changes?'displayColor' then v_color else display_color end,
        updated_at=now()
      where studio_id=v_studio and id=v_entity_id;
      if exists(select 1 from public.teachers where studio_id=v_studio and id=v_entity_id and btrim(name)='') then raise exception 'Teacher name is required'; end if;
    end if;
    select to_jsonb(t) into v_after from public.teachers t where t.studio_id=v_studio and t.id=v_entity_id;

  elsif p_entity_type='STUDENT' then
    select string_agg(k,',') into v_unknown from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) k where k not in ('name','level','cohortIds');
    if v_unknown is not null then raise exception 'Unsupported student fields: %',v_unknown; end if;
    select to_jsonb(s) into v_before from public.students s where s.studio_id=v_studio and s.id=v_entity_id;
    if p_operation='CREATE' then
      if v_before is not null then raise exception 'Student % already exists',v_entity_id; end if;
      if btrim(coalesce(p_changes->>'level',''))='' then raise exception 'Student level is required'; end if;
      insert into public.students(id,studio_id,name,level,cohort_ids) values(v_entity_id,v_studio,v_name,btrim(p_changes->>'level'),case when p_changes?'cohortIds' then array(select jsonb_array_elements_text(p_changes->'cohortIds')) else '{}'::text[] end);
    else
      if v_before is null then raise exception 'Student not found'; end if;
      update public.students set
        name=case when p_changes?'name' then nullif(btrim(p_changes->>'name'),'') else name end,
        level=case when p_changes?'level' then nullif(btrim(p_changes->>'level'),'') else level end,
        cohort_ids=case when p_changes?'cohortIds' then array(select jsonb_array_elements_text(p_changes->'cohortIds')) else cohort_ids end,
        updated_at=now()
      where studio_id=v_studio and id=v_entity_id;
      if exists(select 1 from public.students where studio_id=v_studio and id=v_entity_id and (btrim(name)='' or btrim(level)='')) then raise exception 'Student name and level are required'; end if;
    end if;
    select to_jsonb(s) into v_after from public.students s where s.studio_id=v_studio and s.id=v_entity_id;

  elsif p_entity_type='ROOM' then
    select string_agg(k,',') into v_unknown from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) k where k not in ('name','capacity','features');
    if v_unknown is not null then raise exception 'Unsupported room fields: %',v_unknown; end if;
    select to_jsonb(r) into v_before from public.rooms r where r.studio_id=v_studio and r.id=v_entity_id;
    if p_operation='CREATE' then
      if v_before is not null then raise exception 'Room % already exists',v_entity_id; end if;
      insert into public.rooms(id,studio_id,name,capacity,features) values(v_entity_id,v_studio,v_name,case when p_changes?'capacity' then nullif(p_changes->>'capacity','')::integer else null end,case when p_changes?'features' then array(select jsonb_array_elements_text(p_changes->'features')) else '{}'::text[] end);
    else
      if v_before is null then raise exception 'Room not found'; end if;
      update public.rooms set
        name=case when p_changes?'name' then nullif(btrim(p_changes->>'name'),'') else name end,
        capacity=case when p_changes?'capacity' then nullif(p_changes->>'capacity','')::integer else capacity end,
        features=case when p_changes?'features' then array(select jsonb_array_elements_text(p_changes->'features')) else features end,
        updated_at=now()
      where studio_id=v_studio and id=v_entity_id;
      if exists(select 1 from public.rooms where studio_id=v_studio and id=v_entity_id and btrim(name)='') then raise exception 'Room name is required'; end if;
    end if;
    if exists(select 1 from public.rooms where studio_id=v_studio and id=v_entity_id and capacity is not null and capacity<=0) then raise exception 'Room capacity must be greater than zero'; end if;
    select to_jsonb(r) into v_after from public.rooms r where r.studio_id=v_studio and r.id=v_entity_id;

  else
    select string_agg(k,',') into v_unknown from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) k where k not in ('name','subject','level','durationMinutes','weeklyFrequency','rosterStudentIds','companyOnly');
    if v_unknown is not null then raise exception 'Teacher eligibility is Rulebook truth. Unsupported class fields: %',v_unknown; end if;
    if p_changes?'rosterStudentIds' then
      select array_agg(distinct roster_id order by roster_id) into v_missing_roster from jsonb_array_elements_text(p_changes->'rosterStudentIds') roster_id where not exists(select 1 from public.students s where s.studio_id=v_studio and s.id=roster_id);
      if coalesce(array_length(v_missing_roster,1),0)>0 then raise exception 'Roster contains unknown student IDs: %',array_to_string(v_missing_roster,', '); end if;
    end if;
    select to_jsonb(c),c.weekly_frequency into v_before,v_old_frequency from public.class_definitions c where c.studio_id=v_studio and c.id=v_entity_id;
    if p_operation='CREATE' then
      if v_before is not null then raise exception 'Class % already exists',v_entity_id; end if;
      if btrim(coalesce(p_changes->>'subject',''))='' or btrim(coalesce(p_changes->>'level',''))='' then raise exception 'Class subject and level are required'; end if;
      v_duration:=coalesce((p_changes->>'durationMinutes')::integer,0); v_frequency:=coalesce((p_changes->>'weeklyFrequency')::integer,0);
      if v_duration<=0 then raise exception 'Class duration must be greater than zero'; end if;
      if v_frequency<=0 then raise exception 'Class weekly frequency must be greater than zero'; end if;
      insert into public.class_definitions(id,studio_id,name,subject,level,duration_minutes,weekly_frequency,roster_student_ids,eligible_teacher_ids,company_only)
      values(v_entity_id,v_studio,v_name,btrim(p_changes->>'subject'),btrim(p_changes->>'level'),v_duration,v_frequency,case when p_changes?'rosterStudentIds' then array(select distinct value from jsonb_array_elements_text(p_changes->'rosterStudentIds') value order by value) else '{}'::text[] end,'{}'::text[],coalesce((p_changes->>'companyOnly')::boolean,false));
    else
      if v_before is null then raise exception 'Class not found'; end if;
      v_frequency:=case when p_changes?'weeklyFrequency' then (p_changes->>'weeklyFrequency')::integer else v_old_frequency end;
      if v_frequency<=0 then raise exception 'Class weekly frequency must be greater than zero'; end if;
      if p_changes?'durationMinutes' and (p_changes->>'durationMinutes')::integer<=0 then raise exception 'Class duration must be greater than zero'; end if;
      update public.class_definitions set
        name=case when p_changes?'name' then nullif(btrim(p_changes->>'name'),'') else name end,
        subject=case when p_changes?'subject' then nullif(btrim(p_changes->>'subject'),'') else subject end,
        level=case when p_changes?'level' then nullif(btrim(p_changes->>'level'),'') else level end,
        duration_minutes=case when p_changes?'durationMinutes' then (p_changes->>'durationMinutes')::integer else duration_minutes end,
        weekly_frequency=v_frequency,
        roster_student_ids=case when p_changes?'rosterStudentIds' then array(select distinct value from jsonb_array_elements_text(p_changes->'rosterStudentIds') value order by value) else roster_student_ids end,
        company_only=case when p_changes?'companyOnly' then (p_changes->>'companyOnly')::boolean else company_only end,
        updated_at=now()
      where studio_id=v_studio and id=v_entity_id;
      if exists(select 1 from public.class_definitions where studio_id=v_studio and id=v_entity_id and (btrim(name)='' or btrim(subject)='' or btrim(level)='')) then raise exception 'Class name, subject and level are required'; end if;
    end if;
    select weekly_frequency into v_frequency from public.class_definitions where studio_id=v_studio and id=v_entity_id;
    if p_operation='UPDATE' and v_frequency<v_old_frequency then
      if exists(select 1 from public.class_sessions s join public.assignments a on a.session_id=s.id where s.studio_id=v_studio and s.class_id=v_entity_id and s.ordinal>v_frequency) then raise exception 'CLASS_FREQUENCY_REDUCTION_BLOCKED: a removed session is referenced by schedule history. Create a replacement class definition instead of deleting historical session identity.'; end if;
      delete from public.class_sessions where studio_id=v_studio and class_id=v_entity_id and ordinal>v_frequency;
    end if;
    for v_ordinal in 1..v_frequency loop
      if not exists(select 1 from public.class_sessions where studio_id=v_studio and class_id=v_entity_id and ordinal=v_ordinal) then
        v_session_id:='session-'||regexp_replace(v_entity_id,'^class-','')||'-'||v_ordinal::text;
        if exists(select 1 from public.class_sessions where id=v_session_id) then v_session_id:=v_session_id||'-'||substr(gen_random_uuid()::text,1,8); end if;
        insert into public.class_sessions(id,studio_id,class_id,ordinal,locked,duration_minutes) values(v_session_id,v_studio,v_entity_id,v_ordinal,false,null);
      end if;
    end loop;
    select to_jsonb(c) into v_after from public.class_definitions c where c.studio_id=v_studio and c.id=v_entity_id;
  end if;

  select coalesce(max(version),0)+1 into v_entity_version from public.entity_versions where studio_id=v_studio and entity_type=p_entity_type and entity_id=v_entity_id;
  insert into public.entity_versions(studio_id,entity_type,entity_id,version,actor_user_id,actor_label,reason,before_entity,after_entity)
  values(v_studio,p_entity_type,v_entity_id,v_entity_version,v_uid,v_actor,p_reason,v_before,v_after);

  v_planning_version:=private.ensure_planning_dataset_version_v25(v_studio,v_uid,v_actor,p_reason);
  v_requires_revalidation:=v_planning_version<>v_current_planning;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,p_entity_type||'_'||p_operation,p_entity_type,v_entity_id,p_reason,jsonb_build_object('before',v_before,'after',v_after,'entityVersion',v_entity_version,'planningDatasetVersion',v_planning_version,'scheduleRequiresRevalidation',v_requires_revalidation));

  return jsonb_build_object('operation',p_operation,'entityType',p_entity_type,'entityId',v_entity_id,'entityVersion',v_entity_version,'planningDatasetVersion',v_planning_version,'before',v_before,'after',v_after,'scheduleRequiresRevalidation',v_requires_revalidation);
end
$function$;
revoke all on function public.mutate_planning_entity_v28(text,text,text,jsonb,text,integer) from public,anon;
grant execute on function public.mutate_planning_entity_v28(text,text,text,jsonb,text,integer) to authenticated,service_role;

do $block$
declare v_studio uuid;
begin
  for v_studio in select id from public.studios loop
    perform private.ensure_planning_dataset_version_v25(v_studio,null,'V2.9 named-entity planning identity','Planning Dataset schema 1.3 pins selector-relevant entity names');
  end loop;
end
$block$;

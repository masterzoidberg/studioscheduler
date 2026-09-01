alter table public.teachers
  add column if not exists display_color text;

alter table public.teachers
  drop constraint if exists teachers_display_color_hex;

alter table public.teachers
  add constraint teachers_display_color_hex
  check (display_color is null or display_color ~ '^#[0-9A-Fa-f]{6}$');

update public.teachers
set display_color = case id
  when 'teacher-aimee' then '#2563EB'
  when 'teacher-cami' then '#DB2777'
  when 'teacher-denise' then '#7C3AED'
  when 'teacher-jae' then '#EA580C'
  when 'teacher-jalyn' then '#059669'
  when 'teacher-karly' then '#0891B2'
  when 'teacher-khyre' then '#D97706'
  when 'teacher-melina' then '#4F46E5'
  when 'teacher-sydni' then '#DC2626'
  else display_color
end
where studio_id = '11111111-1111-4111-8111-111111111111'
  and display_color is null;

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
set search_path to ''
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
    select string_agg(k,',') into v_unknown
      from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) as k
      where k not in ('name','notes','displayColor');
    if v_unknown is not null then raise exception 'Teacher qualifications are Rulebook truth. Unsupported teacher fields: %',v_unknown; end if;
    select to_jsonb(t) into v_before from public.teachers t where studio_id=v_studio and id=p_entity_id;
    if v_before is null then raise exception 'Teacher not found'; end if;
    if p_changes?'displayColor' and coalesce(p_changes->>'displayColor','') <> '' and (p_changes->>'displayColor') !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'Teacher display color must be a six-digit hex color.';
    end if;
    update public.teachers set
      name=case when p_changes?'name' then p_changes->>'name' else name end,
      notes=case when p_changes?'notes' then nullif(p_changes->>'notes','') else notes end,
      display_color=case when p_changes?'displayColor' then nullif(p_changes->>'displayColor','') else display_color end,
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

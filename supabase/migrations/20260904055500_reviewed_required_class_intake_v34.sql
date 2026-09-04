-- V3.4 reviewed required-class intake boundary.
--
-- Creating a Rulebook-required class establishes new planning truth. Generic
-- class creation must not silently turn an empty roster, default curriculum
-- scope, or naming-derived hints into accepted facts. Required classes are
-- therefore created through an explicit reviewed-intake RPC only.

create or replace function private.required_class_name_v34(p_name text)
returns boolean
language sql
immutable
set search_path=''
as $function$
  select regexp_replace(lower(btrim(coalesce(p_name,''))), '[^a-z0-9]+', '', 'g') = any(array[
    'elementaryballet1','elementaryballet2','ballet1','ballet2','ballet3','ballet4a',
    'ballet4a4b','ballet4b5','ballet5','prepointe','pointe1','pointe23',
    'jazz2','lyrical2','tap2','hiphop2','precompanytechnique1'
  ]::text[])
$function$;
revoke all on function private.required_class_name_v34(text) from public,anon,authenticated;

create or replace function private.guard_required_class_insert_v34()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if private.required_class_name_v34(new.name)
     and coalesce(current_setting('dwde.reviewed_required_class_intake',true),'') <> 'on' then
    raise exception 'REVIEWED_REQUIRED_CLASS_INTAKE_REQUIRED: % must be created through the reviewed required-class intake',new.name;
  end if;
  return new;
end
$function$;
revoke all on function private.guard_required_class_insert_v34() from public,anon,authenticated;

drop trigger if exists class_definitions_required_intake_v34 on public.class_definitions;
create trigger class_definitions_required_intake_v34
before insert on public.class_definitions
for each row execute function private.guard_required_class_insert_v34();

create or replace function public.create_reviewed_required_class_v34(
  p_changes jsonb,
  p_reason text,
  p_expected_planning_dataset_version integer,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  ctx jsonb:=private.assert_editor_context();
  v_name text:=btrim(coalesce(p_changes->>'name',''));
  v_key text:=regexp_replace(lower(v_name),'[^a-z0-9]+','','g');
  v_frequency integer:=coalesce((p_changes->>'weeklyFrequency')::integer,0);
  v_duration integer:=coalesce((p_changes->>'durationMinutes')::integer,0);
begin
  if not private.required_class_name_v34(v_name) then
    raise exception 'REVIEWED_REQUIRED_CLASS_INTAKE_ONLY: % is not a recognized Rulebook-required class',v_name;
  end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object' then
    raise exception 'Reviewed-intake evidence must be a JSON object';
  end if;
  if coalesce((p_evidence->>'rosterReviewed')::boolean,false) is not true then
    raise exception 'REVIEWED_REQUIRED_CLASS_ROSTER_REQUIRED: the complete current roster must be reviewed';
  end if;
  if coalesce((p_evidence->>'companyScopeReviewed')::boolean,false) is not true
     or not (p_changes ? 'companyOnly') then
    raise exception 'REVIEWED_REQUIRED_CLASS_SCOPE_REQUIRED: curriculum scope must be explicitly reviewed';
  end if;
  if coalesce((p_evidence->>'curriculumFieldsReviewed')::boolean,false) is not true then
    raise exception 'REVIEWED_REQUIRED_CLASS_CURRICULUM_REQUIRED: descriptive curriculum fields must be explicitly reviewed';
  end if;

  -- Enforce the structure that the reviewed Rulebook actually establishes.
  -- Ballet 4A intentionally has no Rulebook-established duration, so the
  -- manager supplies that verified planning fact while frequency remains fixed.
  if v_key='elementaryballet1' and (v_frequency<>1 or v_duration<>60) then
    raise exception 'RULEBOOK_STRUCTURE_MISMATCH: Elementary Ballet 1 requires 1/week at 60 minutes';
  elsif v_key='elementaryballet2' and (v_frequency<>2 or v_duration<>75) then
    raise exception 'RULEBOOK_STRUCTURE_MISMATCH: Elementary Ballet 2 requires 2/week at 75 minutes';
  elsif v_key in ('ballet1','ballet2','ballet3') and (v_frequency<>2 or v_duration<>90) then
    raise exception 'RULEBOOK_STRUCTURE_MISMATCH: % requires 2/week at 90 minutes',v_name;
  elsif v_key='ballet4a' and (v_frequency<>1 or v_duration<=0) then
    raise exception 'RULEBOOK_STRUCTURE_MISMATCH: Ballet 4A requires 1/week and a verified positive duration';
  elsif v_key='ballet4a4b' and (v_frequency<>1 or v_duration<>90) then
    raise exception 'RULEBOOK_STRUCTURE_MISMATCH: Ballet 4A/4B requires 1/week at 90 minutes';
  elsif v_key='ballet4b5' then
    raise exception 'DISTINCT_SESSION_DURATION_INTAKE_REQUIRED: Ballet 4B/5 requires 90/105 minute weekly sessions and cannot be created by the single-duration intake';
  elsif v_key='ballet5' and (v_frequency<>1 or v_duration<>90) then
    raise exception 'RULEBOOK_STRUCTURE_MISMATCH: Ballet 5 requires 1/week at 90 minutes';
  elsif v_key='prepointe' and (v_frequency<>1 or v_duration<>30) then
    raise exception 'RULEBOOK_STRUCTURE_MISMATCH: Pre-Pointe requires 1/week at 30 minutes';
  elsif v_key='pointe1' and (v_frequency<>1 or v_duration<>30) then
    raise exception 'RULEBOOK_STRUCTURE_MISMATCH: Pointe 1 requires 1/week at 30 minutes';
  elsif v_key='pointe23' and (v_frequency<>1 or v_duration<>60) then
    raise exception 'RULEBOOK_STRUCTURE_MISMATCH: Pointe 2/3 requires 1/week at 60 minutes';
  end if;

  perform set_config('dwde.reviewed_required_class_intake','on',true);
  return public.mutate_planning_entity_v28(
    'CREATE','CLASS',null,p_changes,p_reason,p_expected_planning_dataset_version
  );
end
$function$;

revoke all on function public.create_reviewed_required_class_v34(jsonb,text,integer,jsonb) from public,anon;
grant execute on function public.create_reviewed_required_class_v34(jsonb,text,integer,jsonb) to authenticated;

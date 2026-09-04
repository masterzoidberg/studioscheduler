-- V3.8 shared Rulebook roster compiler.
--
-- Required-class intake and existing-class roster repair must enforce the same
-- minimum Rulebook-derived roster. The browser remains responsible for review of
-- the complete current roster, but it cannot omit a relationship the reviewed
-- Rulebook establishes. One private compiler now owns those semantics.

create or replace function private.rulebook_required_roster_v38(
  p_studio uuid,
  p_class_name text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_key text:=regexp_replace(lower(btrim(coalesce(p_class_name,''))),'[^a-z0-9]+','','g');
  v_required_ids text[]:='{}'::text[];
  v_level_ids text[]:='{}'::text[];
  v_rule_ids text[]:='{}'::text[];
  v_relationships text[]:='{}'::text[];
  v_daughter_count integer:=0;
  v_daughter_id text;
  v_supported boolean:=false;
begin
  perform private.assert_reviewed_rulebook_v3_v36(p_studio);

  -- BAL-006 + STU-002: all current Level 4A dancers participate in the
  -- Level 4A Ballet structures that exist.
  if v_key in ('ballet4a','ballet4a4b') then
    v_supported:=true;
    select coalesce(array_agg(s.id order by s.id),'{}'::text[]) into v_level_ids
    from public.students s
    where s.studio_id=p_studio and s.level='Level 4A';
    if cardinality(v_level_ids)>0 then
      select array_agg(distinct x order by x) into v_required_ids
      from unnest(array_cat(v_required_ids,v_level_ids)) x;
      select array_agg(distinct x order by x) into v_rule_ids
      from unnest(array_cat(v_rule_ids,array['BAL-006','STU-002']::text[])) x;
      select array_agg(distinct x order by x) into v_relationships
      from unnest(array_cat(v_relationships,array['Level 4A Ballet participation']::text[])) x;
    end if;
  end if;

  -- BAL-007 + STU-002.
  if v_key in ('ballet4a4b','ballet4b5') then
    v_supported:=true;
    select coalesce(array_agg(s.id order by s.id),'{}'::text[]) into v_level_ids
    from public.students s
    where s.studio_id=p_studio and s.level='Level 4B';
    if cardinality(v_level_ids)>0 then
      select array_agg(distinct x order by x) into v_required_ids
      from unnest(array_cat(v_required_ids,v_level_ids)) x;
      select array_agg(distinct x order by x) into v_rule_ids
      from unnest(array_cat(v_rule_ids,array['BAL-007','STU-002']::text[])) x;
      select array_agg(distinct x order by x) into v_relationships
      from unnest(array_cat(v_relationships,array['Level 4B Ballet participation']::text[])) x;
    end if;
  end if;

  -- BAL-008 + STU-002.
  if v_key in ('ballet4b5','ballet5') then
    v_supported:=true;
    select coalesce(array_agg(s.id order by s.id),'{}'::text[]) into v_level_ids
    from public.students s
    where s.studio_id=p_studio and s.level='Level 5';
    if cardinality(v_level_ids)>0 then
      select array_agg(distinct x order by x) into v_required_ids
      from unnest(array_cat(v_required_ids,v_level_ids)) x;
      select array_agg(distinct x order by x) into v_rule_ids
      from unnest(array_cat(v_rule_ids,array['BAL-008','STU-002']::text[])) x;
      select array_agg(distinct x order by x) into v_relationships
      from unnest(array_cat(v_relationships,array['Level 5 Ballet participation']::text[])) x;
    end if;
  end if;

  -- KAR-008 + STU-002: exactly one current Karly daughter record is required
  -- for the listed enrollments. Missing or ambiguous identity fails closed.
  if v_key in ('ballet2','jazz2','lyrical2','tap2','hiphop2','precompanytechnique1') then
    v_supported:=true;
    select count(*),min(s.id) into v_daughter_count,v_daughter_id
    from public.students s
    where s.studio_id=p_studio
      and regexp_replace(lower(btrim(s.name)),'[^a-z0-9]+','','g')='karlysdaughter';
    if v_daughter_count=0 then
      raise exception 'RULEBOOK_ROSTER_REPAIR_STUDENT_MISSING: KAR-008 requires one Karly daughter student record';
    elsif v_daughter_count<>1 then
      raise exception 'RULEBOOK_ROSTER_REPAIR_STUDENT_AMBIGUOUS: KAR-008 requires one Karly daughter student record, found %',v_daughter_count;
    end if;
    v_required_ids:=array[v_daughter_id];
    v_rule_ids:=array['KAR-008','STU-002'];
    v_relationships:=array['Karly''s daughter required enrollment'];
  end if;

  return jsonb_build_object(
    'supported',v_supported,
    'requiredStudentIds',to_jsonb(coalesce(v_required_ids,'{}'::text[])),
    'ruleIds',to_jsonb(coalesce(v_rule_ids,'{}'::text[])),
    'relationshipLabels',to_jsonb(coalesce(v_relationships,'{}'::text[])),
    'rulebookVersion',3,
    'rulebookSourceHash','7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b'
  );
end
$function$;
revoke all on function private.rulebook_required_roster_v38(uuid,text) from public,anon,authenticated;

-- Strengthen required-class intake. The manager still reviews the complete
-- roster, but any minimum membership established by the Rulebook is mandatory
-- at the database boundary as well as in the UI.
create or replace function private.guard_required_class_insert_v34()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_requirements jsonb;
  v_required_ids text[]:='{}'::text[];
begin
  if private.required_class_name_v34(new.name) then
    v_requirements:=private.rulebook_required_roster_v38(new.studio_id,new.name);
    select coalesce(array_agg(value order by value),'{}'::text[]) into v_required_ids
    from jsonb_array_elements_text(coalesce(v_requirements->'requiredStudentIds','[]'::jsonb)) value;

    if coalesce(current_setting('dwde.reviewed_required_class_intake',true),'') <> 'on' then
      raise exception 'REVIEWED_REQUIRED_CLASS_INTAKE_REQUIRED: % must be created through the reviewed required-class intake',new.name;
    end if;

    if not coalesce(new.roster_student_ids,'{}'::text[]) @> v_required_ids then
      raise exception 'REVIEWED_REQUIRED_CLASS_REQUIRED_ROSTER_MISSING: % must include every Rulebook-required roster member (%)',
        new.name,array_to_string(v_required_ids,', ');
    end if;
  end if;
  return new;
end
$function$;
revoke all on function private.guard_required_class_insert_v34() from public,anon,authenticated;

-- Replace the v36 roster repair implementation with a thin consumer of the same
-- private compiler. Existing authorization, concurrency, additive-only mutation,
-- entity history, Planning Dataset versioning and audit semantics are preserved.
create or replace function public.apply_rulebook_roster_repair_v36(
  p_class_id text,
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
  v_name text;
  v_key text;
  v_current_roster text[];
  v_requirements jsonb;
  v_required_ids text[]:='{}'::text[];
  v_missing_ids text[]:='{}'::text[];
  v_after_roster text[]:='{}'::text[];
  v_rule_ids text[]:='{}'::text[];
  v_relationships text[]:='{}'::text[];
  v_added_names text[]:='{}'::text[];
  v_result jsonb;
begin
  if coalesce(btrim(p_class_id),'')='' then raise exception 'Class ID is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-entity:'||v_studio::text,0));

  select version into v_current_planning
  from public.planning_dataset_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;
  if v_current_planning is null then raise exception 'No current PlanningDatasetVersion exists'; end if;
  if v_current_planning<>p_expected_planning_dataset_version then
    raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_current_planning;
  end if;

  select c.name,coalesce(c.roster_student_ids,'{}'::text[])
  into v_name,v_current_roster
  from public.class_definitions c
  where c.studio_id=v_studio and c.id=p_class_id;
  if v_name is null then raise exception 'Class % is not part of this studio',p_class_id; end if;

  v_key:=regexp_replace(lower(btrim(v_name)),'[^a-z0-9]+','','g');
  if (
    select count(*)
    from public.class_definitions c
    where c.studio_id=v_studio
      and regexp_replace(lower(btrim(c.name)),'[^a-z0-9]+','','g')=v_key
  )<>1 then
    raise exception 'RULEBOOK_ROSTER_REPAIR_AMBIGUOUS: % does not resolve to exactly one current class',v_name;
  end if;

  v_requirements:=private.rulebook_required_roster_v38(v_studio,v_name);
  if coalesce((v_requirements->>'supported')::boolean,false) is not true then
    raise exception 'RULEBOOK_ROSTER_REPAIR_UNSUPPORTED: % is not a reviewed Rulebook roster-repair target',v_name;
  end if;

  select coalesce(array_agg(value order by value),'{}'::text[]) into v_required_ids
  from jsonb_array_elements_text(coalesce(v_requirements->'requiredStudentIds','[]'::jsonb)) value;
  select coalesce(array_agg(value order by value),'{}'::text[]) into v_rule_ids
  from jsonb_array_elements_text(coalesce(v_requirements->'ruleIds','[]'::jsonb)) value;
  select coalesce(array_agg(value order by value),'{}'::text[]) into v_relationships
  from jsonb_array_elements_text(coalesce(v_requirements->'relationshipLabels','[]'::jsonb)) value;

  select coalesce(array_agg(x order by x),'{}'::text[]) into v_missing_ids
  from unnest(v_required_ids) x
  where not (x=any(v_current_roster));

  if cardinality(v_missing_ids)=0 then
    return jsonb_build_object(
      'classId',p_class_id,
      'className',v_name,
      'changed',false,
      'planningDatasetVersion',v_current_planning,
      'scheduleRequiresRevalidation',false,
      'requiredStudentIds',to_jsonb(v_required_ids),
      'ruleIds',to_jsonb(v_rule_ids),
      'relationshipLabels',to_jsonb(v_relationships),
      'rulebookVersion',3,
      'rulebookSourceHash',v_requirements->>'rulebookSourceHash'
    );
  end if;

  select array_agg(distinct x order by x) into v_after_roster
  from unnest(array_cat(v_current_roster,v_required_ids)) x;

  v_result:=public.mutate_planning_entity_v28(
    'UPDATE','CLASS',p_class_id,
    jsonb_build_object('rosterStudentIds',to_jsonb(v_after_roster)),
    p_reason,p_expected_planning_dataset_version
  );

  select coalesce(array_agg(s.name order by s.name),'{}'::text[]) into v_added_names
  from public.students s
  where s.studio_id=v_studio and s.id=any(v_missing_ids);

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    v_studio,v_uid,v_actor,'RULEBOOK_ROSTER_REPAIR','CLASS',p_class_id,p_reason,
    jsonb_build_object(
      'className',v_name,
      'addedStudentIds',to_jsonb(v_missing_ids),
      'addedStudentNames',to_jsonb(v_added_names),
      'ruleIds',to_jsonb(v_rule_ids),
      'relationshipLabels',to_jsonb(v_relationships),
      'rulebookVersion',3,
      'rulebookSourceHash',v_requirements->>'rulebookSourceHash',
      'previousPlanningDatasetVersion',v_current_planning,
      'planningDatasetVersion',(v_result->>'planningDatasetVersion')::integer,
      'scheduleRequiresRevalidation',true
    )
  );

  return v_result || jsonb_build_object(
    'classId',p_class_id,
    'className',v_name,
    'changed',true,
    'addedStudentIds',to_jsonb(v_missing_ids),
    'addedStudentNames',to_jsonb(v_added_names),
    'ruleIds',to_jsonb(v_rule_ids),
    'relationshipLabels',to_jsonb(v_relationships),
    'rulebookVersion',3,
    'rulebookSourceHash',v_requirements->>'rulebookSourceHash'
  );
end
$function$;

revoke all on function public.apply_rulebook_roster_repair_v36(text,text,integer) from public,anon;
grant execute on function public.apply_rulebook_roster_repair_v36(text,text,integer) to authenticated,service_role;

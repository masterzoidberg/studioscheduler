-- SET-05 / class assignment policy controls and targeted class review slices.
-- Planning facts remain in PlanningDatasetVersion. Required/preferred teacher
-- and room choices remain typed Rulebook policy. Review rows are supplemental.

create or replace function public.apply_class_assignment_policies_v57(
  p_studio_id uuid,
  p_class_id text,
  p_required_teacher_id text,
  p_preferred_teacher_id text,
  p_required_room_id text,
  p_preferred_room_id text,
  p_reason text,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,
  p_expected_planning_dataset_version integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid(); v_role text; v_actor text; v_rulebook public.rulebook_versions%rowtype; v_enforcement public.rule_enforcement_versions%rowtype;
  v_planning_version integer; v_rule_id text; v_kind text; v_target_id text; v_target_key text; v_strength text; v_before jsonb; v_after jsonb;
  v_changed_ids text[]:='{}'::text[]; v_owner_ids text[]:='{}'::text[]; v_old_owner_ids text[]:='{}'::text[]; v_introduced_ids text[]:='{}'::text[];
  v_bundle jsonb; v_bundles jsonb:='[]'::jsonb; v_snapshot jsonb; v_new_version integer; v_new_enforcement integer; v_source_hash text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_studio_id is null or coalesce(btrim(p_class_id),'')='' then raise exception 'Studio and class are required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  select m.role into v_role from public.studio_members m where m.studio_id=p_studio_id and m.user_id=v_uid for update;
  if not found or v_role not in ('OWNER','EDITOR') then raise exception using errcode='42501',message='Editor membership required for selected workspace'; end if;
  select coalesce(p.display_name,u.email,'Studio user') into v_actor from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;

  perform pg_advisory_xact_lock(hashtextextended('typed-setup:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  select * into v_rulebook from public.rulebook_versions rb where rb.studio_id=p_studio_id and rb.status='CURRENT' for update;
  select * into v_enforcement from public.rule_enforcement_versions ev where ev.studio_id=p_studio_id and ev.status='CURRENT' limit 1 for update;
  select pd.version into v_planning_version from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1;
  if v_rulebook.id is null or v_planning_version is null then raise exception 'Current RulebookVersion and PlanningDatasetVersion are required'; end if;
  if v_rulebook.version<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook.version; end if;
  if coalesce(v_enforcement.version,0)<>coalesce(p_expected_enforcement_version,0) then raise exception 'STALE_ENFORCEMENT: expected %, current %',coalesce(p_expected_enforcement_version,0),coalesce(v_enforcement.version,0); end if;
  if v_planning_version<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_planning_version; end if;
  if not exists(select 1 from jsonb_array_elements(coalesce((select snapshot from public.planning_dataset_versions where studio_id=p_studio_id and status='CURRENT'),'{}'::jsonb)->'classes') c(value) where value->>'id'=p_class_id) then raise exception 'CLASS_SETUP_CLASS_NOT_ACTIVE: class is outside the current Planning Dataset'; end if;
  if nullif(btrim(coalesce(p_required_teacher_id,'')),'') is not null and not exists(select 1 from public.teachers where studio_id=p_studio_id and id=p_required_teacher_id and archived_at is null) then raise exception 'CLASS_SETUP_TEACHER_NOT_ACTIVE: required teacher is outside the current studio'; end if;
  if nullif(btrim(coalesce(p_preferred_teacher_id,'')),'') is not null and not exists(select 1 from public.teachers where studio_id=p_studio_id and id=p_preferred_teacher_id and archived_at is null) then raise exception 'CLASS_SETUP_TEACHER_NOT_ACTIVE: preferred teacher is outside the current studio'; end if;
  if nullif(btrim(coalesce(p_required_teacher_id,'')),'') is not null and not exists(select 1 from public.rules r where r.studio_id=p_studio_id and r.parameters#>>'{policy,kind}'='TEACHER_QUALIFICATION' and r.parameters#>>'{policy,teacherId}'=p_required_teacher_id and r.parameters->'policy'->'classIds' ? p_class_id) then raise exception 'CLASS_SETUP_TEACHER_NOT_QUALIFIED: required teacher must come from reviewed qualification policy'; end if;
  if nullif(btrim(coalesce(p_preferred_teacher_id,'')),'') is not null and not exists(select 1 from public.rules r where r.studio_id=p_studio_id and r.parameters#>>'{policy,kind}'='TEACHER_QUALIFICATION' and r.parameters#>>'{policy,teacherId}'=p_preferred_teacher_id and r.parameters->'policy'->'classIds' ? p_class_id) then raise exception 'CLASS_SETUP_TEACHER_NOT_QUALIFIED: preferred teacher must come from reviewed qualification policy'; end if;
  if nullif(btrim(coalesce(p_required_room_id,'')),'') is not null and not exists(select 1 from public.rooms where studio_id=p_studio_id and id=p_required_room_id and archived_at is null) then raise exception 'CLASS_SETUP_ROOM_NOT_ACTIVE: required room is outside the current studio'; end if;
  if nullif(btrim(coalesce(p_preferred_room_id,'')),'') is not null and not exists(select 1 from public.rooms where studio_id=p_studio_id and id=p_preferred_room_id and archived_at is null) then raise exception 'CLASS_SETUP_ROOM_NOT_ACTIVE: preferred room is outside the current studio'; end if;

  for v_kind,v_target_id,v_target_key,v_strength in
    select * from (values
      ('REQUIRED_TEACHER',nullif(btrim(coalesce(p_required_teacher_id,'')),''),'teacherId','HARD'),
      ('PREFERRED_TEACHER',nullif(btrim(coalesce(p_preferred_teacher_id,'')),''),'teacherId','VERY_STRONG'),
      ('REQUIRED_ROOM',nullif(btrim(coalesce(p_required_room_id,'')),''),'roomId','HARD'),
      ('PREFERRED_ROOM',nullif(btrim(coalesce(p_preferred_room_id,'')),''),'roomId','VERY_STRONG')
    ) policy(kind,target_id,target_key,strength)
  loop
    v_rule_id:='SET05-CLASS-'||replace(v_kind,'_','-')||'-'||p_class_id;
    select to_jsonb(r) into v_before from public.rules r where r.studio_id=p_studio_id and r.id=v_rule_id for update;
    if v_before is null and v_target_id is not null then
      insert into public.rules(id,studio_id,category,type,title,description,strength,status,verification_status,review_status,affected_entity_ids,parameters,exceptions,source,version_introduced,classification_raw,review,source_raw,enforcement_status)
      values(v_rule_id,p_studio_id,'CLASS_POLICY','SETUP_TYPED_POLICY',replace(initcap(lower(v_kind)),'_',' ')||' for class '||p_class_id,'SET-05 manager-owned class assignment policy for stable class '||p_class_id,v_strength,'ACTIVE','VERIFIED','VERIFIED','{}'::text[],'{}'::jsonb,'[]'::jsonb,jsonb_build_object('type','SETUP','task','SET-05'),v_rulebook.version,v_strength,'{}'::jsonb,'{}'::jsonb,case when v_strength='HARD' then 'IMPLEMENTED' else 'NOT_IMPLEMENTED' end);
      select to_jsonb(r) into v_before from public.rules r where r.studio_id=p_studio_id and r.id=v_rule_id;
    end if;
    if v_before is null then continue; end if;
    update public.rules set
      parameters=case when v_target_id is null then '{}'::jsonb else jsonb_build_object('policy',jsonb_build_object('schemaVersion','1.0','kind',v_kind,v_target_key,v_target_id,'classIds',jsonb_build_array(p_class_id))) end,
      affected_entity_ids=case when v_target_id is null then '{}'::text[] else array[p_class_id,v_target_id]::text[] end,
      updated_at=now()
    where studio_id=p_studio_id and id=v_rule_id;
    select to_jsonb(r) into v_after from public.rules r where r.studio_id=p_studio_id and r.id=v_rule_id;
    if v_before is distinct from v_after then
      insert into public.rule_history(studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed) values(p_studio_id,v_rule_id,v_rulebook.version+1,v_uid,coalesce(v_actor,'Studio user'),p_reason,v_before,v_after,false);
      v_changed_ids:=array_append(v_changed_ids,v_rule_id);
    end if;
  end loop;

  if cardinality(v_changed_ids)=0 then return jsonb_build_object('status','UNCHANGED','rulebookVersion',v_rulebook.version,'enforcementVersion',coalesce(v_enforcement.version,0),'changedRuleIds','[]'::jsonb); end if;
  select coalesce(array_agg(r.id order by r.id),'{}'::text[]) into v_owner_ids from public.rules r where r.studio_id=p_studio_id and r.parameters ? 'policy';
  v_old_owner_ids:=coalesce((select array_agg(value #>> '{}' order by value #>> '{}') from jsonb_array_elements(coalesce(v_rulebook.source_metadata->'typedPolicyRuleIds','[]'::jsonb)) item(value)),'{}'::text[]);
  for v_rule_id in select unnest(v_owner_ids) loop
    if not (v_rule_id=any(v_old_owner_ids)) then v_introduced_ids:=array_append(v_introduced_ids,v_rule_id); end if;
    select value into v_bundle from jsonb_array_elements(coalesce(v_rulebook.source_metadata->'typedPolicyBundles','[]'::jsonb)) item(value) where value->>'ownerRuleId'=v_rule_id limit 1;
    if v_bundle is null then v_bundle:=jsonb_build_object('ownerRuleId',v_rule_id,'consumedRuleIds',jsonb_build_array(v_rule_id)); end if;
    v_bundles:=v_bundles||jsonb_build_array(v_bundle);
  end loop;
  v_new_version:=v_rulebook.version+1;
  v_snapshot:=coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.rules r where r.studio_id=p_studio_id),'[]'::jsonb);
  v_source_hash:=encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  update public.rulebook_versions set status='HISTORICAL' where id=v_rulebook.id;
  insert into public.rulebook_versions(studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,rulebook_id,status,imported_at,source_hash,source_file_hash,rule_count,parent_version,format_version,document_type,source_metadata)
  values(p_studio_id,v_new_version,'DWDE Rulebook v'||v_new_version,v_uid,coalesce(v_actor,'Studio user'),p_reason,v_changed_ids,v_snapshot,v_rulebook.rulebook_id,'CURRENT',now(),v_source_hash,v_rulebook.source_file_hash,v_rulebook.rule_count,v_rulebook.version,'2.4','DWDE_SITE_RULEBOOK',jsonb_build_object('provenance','TYPED_POLICY_BUNDLE_EDIT','parentVersion',v_rulebook.version,'residualBaselineSourceHash',coalesce(v_rulebook.source_metadata->>'residualBaselineSourceHash',v_rulebook.source_hash),'previousTypedPolicyVersion',v_rulebook.version,'typedPolicyRuleIds',to_jsonb(v_owner_ids),'introducedTypedPolicyRuleIds',to_jsonb(v_introduced_ids),'typedPolicyBundles',v_bundles,'hashSemantics','DATABASE_RULE_SNAPSHOT_JSONB_SHA256','transition','SET-05 class assignment policy edit'));
  if v_enforcement.id is not null then
    v_new_enforcement:=v_enforcement.version+1; update public.rule_enforcement_versions set status='HISTORICAL' where id=v_enforcement.id;
    insert into public.rule_enforcement_versions(studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status) values(p_studio_id,v_new_enforcement,v_new_version,v_uid,coalesce(v_actor,'Studio user'),'Carry forward compatibility mappings; SET-05 typed policy is Rulebook-owned',v_changed_ids,v_enforcement.snapshot,'CURRENT');
  end if;
  update public.constraint_model_versions set status='HISTORICAL' where studio_id=p_studio_id and status='CURRENT';
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values(p_studio_id,v_uid,coalesce(v_actor,'Studio user'),'RULEBOOK_VERSION','CLASS',p_class_id,p_reason,jsonb_build_object('version',v_new_version,'parentVersion',v_rulebook.version,'changedRuleIds',v_changed_ids,'typedPolicyRuleIds',v_owner_ids,'sourceHash',v_source_hash));
  return jsonb_build_object('status','APPLIED','rulebookVersion',v_new_version,'enforcementVersion',case when v_enforcement.id is null then null else v_new_enforcement end,'changedRuleIds',v_changed_ids);
end
$function$;
revoke all on function public.apply_class_assignment_policies_v57(uuid,text,text,text,text,text,text,integer,integer,integer) from public,anon;
grant execute on function public.apply_class_assignment_policies_v57(uuid,text,text,text,text,text,text,integer,integer,integer) to authenticated,service_role;

-- The historical function name is retained because the governed structure and
-- roster callers already depend on it. Accept typed-policy successors only
-- after proving live/snapshot integrity and exact residual V3 semantics.
create or replace function private.assert_reviewed_rulebook_v3_v36(p_studio uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare
  v_current public.rulebook_versions%rowtype; v_baseline public.rulebook_versions%rowtype;
  v_live jsonb; v_live_hash text; v_owner_ids jsonb; v_current_residual jsonb; v_baseline_residual jsonb;
  v_owner text; v_current_owner jsonb; v_baseline_owner jsonb;
begin
  select * into v_current from public.rulebook_versions where studio_id=p_studio and status='CURRENT' for share;
  if v_current.id is null then raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: no current RulebookVersion exists'; end if;
  v_live:=private.rule_snapshot_v52(p_studio);
  v_live_hash:=encode(extensions.digest(pg_catalog.convert_to(v_live::text,'UTF8'),'sha256'),'hex');
  if v_live is distinct from v_current.snapshot or v_live_hash is distinct from v_current.source_hash then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: live rules differ from the immutable current Rulebook snapshot';
  end if;
  if v_current.version in (3,4) then
    -- V52 owns the exact V3/V4 compatibility contract. Typed setup starts at V5.
    if v_current.version=3 and (v_current.rulebook_id is distinct from 'dwde-2026-2027-master-rulebook' or v_current.rule_count is distinct from 178 or v_current.source_hash is distinct from '7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b') then
      raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: current Rulebook is not the exact reviewed V3 artifact';
    end if;
    if v_current.version=4 and (v_current.rulebook_id is distinct from 'dwde-2026-2027-master-rulebook' or v_current.rule_count is distinct from 178 or v_current.parent_version is distinct from 3 or v_current.format_version is distinct from '2.2' or v_current.source_metadata->>'provenance' is distinct from 'TYPED_POLICY_MIGRATION' or v_current.source_metadata->>'residualBaselineSourceHash' is distinct from '7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b' or v_current.source_metadata->'typedPolicyRuleIds' is distinct from jsonb_build_array('AIM-003') or v_current.changed_rule_ids is distinct from array['AIM-003']::text[]) then
      raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: current Rulebook is not the bounded V4 typed transition';
    end if;
    return;
  end if;
  if v_current.version<5 or v_current.rulebook_id is distinct from 'dwde-2026-2027-master-rulebook' or v_current.rule_count is distinct from 178 or v_current.document_type is distinct from 'DWDE_SITE_RULEBOOK' then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: current Rulebook is not a reviewed DWDE typed-policy successor';
  end if;
  if v_current.source_metadata->>'residualBaselineSourceHash' is distinct from '7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b'
     or jsonb_typeof(v_current.source_metadata->'typedPolicyRuleIds') is distinct from 'array'
     or jsonb_typeof(v_current.source_metadata->'typedPolicyBundles') is distinct from 'array' then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: typed-policy ownership metadata is missing or malformed';
  end if;
  if (v_current.version=5 and (v_current.parent_version is distinct from 4 or v_current.source_metadata->>'provenance' is distinct from 'TYPED_POLICY_BUNDLE_MIGRATION'))
     or (v_current.version>=6 and (v_current.parent_version is distinct from v_current.version-1 or v_current.source_metadata->>'provenance' is distinct from 'TYPED_POLICY_BUNDLE_EDIT' or (v_current.source_metadata->>'previousTypedPolicyVersion')::integer is distinct from v_current.parent_version)) then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: typed-policy successor lineage is invalid';
  end if;
  select * into v_baseline from public.rulebook_versions where studio_id=p_studio and version=3 and rulebook_id='dwde-2026-2027-master-rulebook' and source_hash='7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b' limit 1;
  if v_baseline.id is null then raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: reviewed historical Rulebook V3 snapshot is unavailable'; end if;
  v_owner_ids:=v_current.source_metadata->'typedPolicyRuleIds';
  if exists(select 1 from jsonb_array_elements(v_live) r where r->'parameters' ? 'policy' and not (v_owner_ids ? (r->>'id')))
     or exists(select 1 from jsonb_array_elements_text(v_owner_ids) owner where not exists(select 1 from jsonb_array_elements(v_live) r where r->>'id'=owner and r->'parameters' ? 'policy')) then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: typed-policy owner manifest does not match live policy envelopes';
  end if;
  select coalesce(jsonb_agg(r-'updated_at' order by r->>'id'),'[]'::jsonb) into v_current_residual from jsonb_array_elements(v_current.snapshot) r where not (v_owner_ids ? (r->>'id'));
  select coalesce(jsonb_agg(r-'updated_at' order by r->>'id'),'[]'::jsonb) into v_baseline_residual from jsonb_array_elements(v_baseline.snapshot) r where not (v_owner_ids ? (r->>'id'));
  if v_current_residual is distinct from v_baseline_residual then raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: residual reviewed V3 policy changed outside typed owners'; end if;
  for v_owner in select value from jsonb_array_elements_text(v_owner_ids) item(value) loop
    if v_owner like 'SET04-TEACHER-AVAILABILITY-%' or v_owner like 'SET04-TEACHER-QUALIFICATION-%' or v_owner like 'SET05-CLASS-REQUIRED-TEACHER-%' or v_owner like 'SET05-CLASS-PREFERRED-TEACHER-%' or v_owner like 'SET05-CLASS-REQUIRED-ROOM-%' or v_owner like 'SET05-CLASS-PREFERRED-ROOM-%' then continue; end if;
    select r into v_current_owner from jsonb_array_elements(v_current.snapshot) r where r->>'id'=v_owner;
    select r into v_baseline_owner from jsonb_array_elements(v_baseline.snapshot) r where r->>'id'=v_owner;
    if v_current_owner is null or v_baseline_owner is null or private.rule_without_machine_v52(v_current_owner) is distinct from private.rule_without_machine_v52(v_baseline_owner) then
      raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: typed owner % changed reviewed human policy fields',v_owner;
    end if;
  end loop;
end $function$;
revoke all on function private.assert_reviewed_rulebook_v3_v36(uuid) from public,anon,authenticated;

create or replace function private.class_setup_review_value_v57(p_studio uuid,p_snapshot jsonb,p_class_id text,p_aspect text,p_schema integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_class jsonb; v_class_key text; v_requirements jsonb; v_required_ids jsonb:='[]'::jsonb; v_missing jsonb:='[]'::jsonb; v_sessions jsonb;
begin
  select value into v_class from jsonb_array_elements(coalesce(p_snapshot->'classes','[]'::jsonb)) item(value) where value->>'id'=p_class_id limit 1;
  if v_class is null then return null; end if;
  if p_aspect='structure' then
    select coalesce(jsonb_agg(jsonb_build_object('ordinal',(value->>'ordinal')::integer,'durationMinutes',coalesce(nullif(value->>'durationMinutes','')::integer,(v_class->>'durationMinutes')::integer)) order by (value->>'ordinal')::integer),'[]'::jsonb) into v_sessions from jsonb_array_elements(coalesce(p_snapshot->'sessions','[]'::jsonb)) item(value) where value->>'classId'=p_class_id;
    return jsonb_build_object('scopeKind','CLASS','entityId',p_class_id,'aspect','structure','reviewSchemaVersion',p_schema,'weeklyFrequency',(v_class->>'weeklyFrequency')::integer,'sessions',v_sessions);
  elsif p_aspect='roster' then
    v_class_key:=regexp_replace(lower(btrim(coalesce(v_class->>'name',''))),'[^a-z0-9]+','','g');
    if v_class_key in ('ballet4a','ballet4a4b','ballet4b5','ballet5','ballet2','jazz2','lyrical2','tap2','hiphop2','precompanytechnique1') then
      begin v_requirements:=private.rulebook_required_roster_v38(p_studio,v_class->>'name'); exception when others then v_requirements:=jsonb_build_object('supported',true,'blocked',true,'policyError',sqlerrm,'requiredStudentIds','[]'::jsonb,'ruleIds','[]'::jsonb); end;
    else
      v_requirements:=jsonb_build_object('supported',false,'blocked',false,'requiredStudentIds','[]'::jsonb,'ruleIds','[]'::jsonb);
    end if;
    v_required_ids:=coalesce(v_requirements->'requiredStudentIds','[]'::jsonb);
    select coalesce(jsonb_agg(value order by value),'[]'::jsonb) into v_missing from jsonb_array_elements_text(v_required_ids) req(value) where not coalesce(v_class->'rosterStudentIds','[]'::jsonb) ? value;
    return jsonb_build_object('scopeKind','CLASS','entityId',p_class_id,'aspect','roster','reviewSchemaVersion',p_schema,'companyOnly',coalesce((v_class->>'companyOnly')::boolean,false),'rosterStudentIds',coalesce(v_class->'rosterStudentIds','[]'::jsonb),'requiredStudentIds',v_required_ids,'requiredRuleIds',coalesce(v_requirements->'ruleIds','[]'::jsonb),'missingRequiredStudentIds',v_missing,'blocked',coalesce((v_requirements->>'blocked')::boolean,false),'policyError',v_requirements->>'policyError');
  end if;
  raise exception 'Class setup review aspect is invalid';
end $function$;
revoke all on function private.class_setup_review_value_v57(uuid,jsonb,text,text,integer) from public,anon,authenticated;

create or replace function private.class_setup_review_fingerprint_v57(p_studio uuid,p_snapshot jsonb,p_class_id text,p_aspect text,p_schema integer default 1)
returns text language sql volatile security definer set search_path='' as $function$
  select encode(extensions.digest(pg_catalog.convert_to(private.class_setup_review_value_v57(p_studio,p_snapshot,p_class_id,p_aspect,p_schema)::text,'UTF8'),'sha256'),'hex')
$function$;
revoke all on function private.class_setup_review_fingerprint_v57(uuid,jsonb,text,text,integer) from public,anon,authenticated;

create or replace function public.list_class_setup_review_status_v57(p_studio_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_uid uuid:=auth.uid(); v_version integer; v_snapshot jsonb; v_class jsonb; v_aspect text; v_value jsonb; v_fp text; v_latest public.setup_review_attestations%rowtype; v_has_latest boolean; v_changed_since boolean; v_state text; v_history jsonb; v_aspects jsonb; v_items jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;
  select version,snapshot into v_version,v_snapshot from public.planning_dataset_versions where studio_id=p_studio_id and status='CURRENT' order by version desc limit 1;
  if v_version is null then raise exception 'No current PlanningDatasetVersion exists'; end if;
  for v_class in select value from jsonb_array_elements(coalesce(v_snapshot->'classes','[]'::jsonb)) item(value) order by value->>'name',value->>'id' loop
    v_aspects:='{}'::jsonb;
    foreach v_aspect in array array['structure','roster']::text[] loop
      v_value:=private.class_setup_review_value_v57(p_studio_id,v_snapshot,v_class->>'id',v_aspect,1); v_fp:=private.class_setup_review_fingerprint_v57(p_studio_id,v_snapshot,v_class->>'id',v_aspect,1);
      select a.* into v_latest from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind='CLASS' and a.entity_id=v_class->>'id' and a.aspect=v_aspect and a.review_schema_version=1 order by a.created_at desc,a.id desc limit 1;
      v_has_latest:=found; v_changed_since:=false;
      if v_has_latest then
        select exists(select 1 from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.version>coalesce(v_latest.source_planning_dataset_version,0) and pd.version<=v_version and private.class_setup_review_fingerprint_v57(p_studio_id,pd.snapshot,v_class->>'id',v_aspect,1) is distinct from v_latest.dependency_fingerprint) into v_changed_since;
      end if;
      if v_aspect='structure' and (jsonb_array_length(v_value->'sessions')<>(v_value->>'weeklyFrequency')::integer or exists(select 1 from jsonb_array_elements(v_value->'sessions') s(value) where coalesce((value->>'durationMinutes')::integer,0)<=0)) then v_state:='BLOCKED';
      elsif v_aspect='roster' and (coalesce((v_value->>'blocked')::boolean,false) or jsonb_array_length(v_value->'missingRequiredStudentIds')>0) then v_state:='BLOCKED';
      elsif not v_has_latest then v_state:='NEEDS_REVIEW';
      elsif v_latest.outcome<>'REVIEWED_VALUE' then v_state:='BLOCKED';
      elsif v_latest.dependency_fingerprint is distinct from v_fp or v_changed_since then v_state:='CHANGED_SINCE_REVIEW'; else v_state:='REVIEWED'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'outcome',a.outcome,'reviewerLabel',a.reviewer_label,'sourcePlanningDatasetVersion',a.source_planning_dataset_version,'note',a.note,'createdAt',a.created_at) order by a.created_at desc,a.id desc),'[]'::jsonb) into v_history from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind='CLASS' and a.entity_id=v_class->>'id' and a.aspect=v_aspect and a.review_schema_version=1;
      v_aspects:=v_aspects||jsonb_build_object(v_aspect,jsonb_build_object('state',v_state,'currentFingerprint',v_fp,'value',v_value,'history',v_history));
    end loop;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('classId',v_class->>'id','className',v_class->>'name','planningDatasetVersion',v_version,'structure',v_aspects->'structure','roster',v_aspects->'roster'));
  end loop;
  return v_items;
end $function$;
revoke all on function public.list_class_setup_review_status_v57(uuid) from public,anon;
grant execute on function public.list_class_setup_review_status_v57(uuid) to authenticated,service_role;

create or replace function public.attest_class_setup_review_v57(p_studio_id uuid,p_class_id text,p_aspect text,p_expected_planning_dataset_version integer,p_expected_fingerprint text,p_empty_roster_confirmed boolean default false,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_uid uuid:=auth.uid(); v_role text; v_actor text; v_version integer; v_snapshot jsonb; v_value jsonb; v_fp text; v_review_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_aspect not in ('structure','roster') then raise exception 'Class setup review aspect is invalid'; end if;
  if coalesce(btrim(p_expected_fingerprint),'')='' then raise exception 'Expected class setup fingerprint is required'; end if;
  select m.role into v_role from public.studio_members m where m.studio_id=p_studio_id and m.user_id=v_uid for update;
  if not found or v_role not in ('OWNER','EDITOR') then raise exception using errcode='42501',message='Editor membership required for selected workspace'; end if;
  select coalesce(p.display_name,u.email,'Studio user') into v_actor from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  perform pg_advisory_xact_lock(hashtextextended('planning-entity:'||p_studio_id::text,0));
  select version,snapshot into v_version,v_snapshot from public.planning_dataset_versions where studio_id=p_studio_id and status='CURRENT' order by version desc limit 1;
  if v_version<>p_expected_planning_dataset_version then raise exception 'STALE_CLASS_SETUP_REVIEW_VERSION: expected %, current %',p_expected_planning_dataset_version,v_version; end if;
  v_value:=private.class_setup_review_value_v57(p_studio_id,v_snapshot,p_class_id,p_aspect,1); if v_value is null then raise exception 'CLASS_SETUP_REVIEW_CLASS_NOT_ACTIVE: class is missing or archived'; end if;
  if p_aspect='structure' and (jsonb_array_length(v_value->'sessions')<>(v_value->>'weeklyFrequency')::integer or exists(select 1 from jsonb_array_elements(v_value->'sessions') s(value) where coalesce((value->>'durationMinutes')::integer,0)<=0)) then raise exception 'CLASS_STRUCTURE_REVIEW_BLOCKED: frequency and ordinal durations must be complete'; end if;
  if p_aspect='roster' and (coalesce((v_value->>'blocked')::boolean,false) or jsonb_array_length(v_value->'missingRequiredStudentIds')>0) then raise exception 'CLASS_ROSTER_REVIEW_BLOCKED: required participants are missing'; end if;
  if p_aspect='roster' and jsonb_array_length(v_value->'rosterStudentIds')=0 and not coalesce(p_empty_roster_confirmed,false) then raise exception 'CLASS_EMPTY_ROSTER_CONFIRMATION_REQUIRED: explicitly confirm the empty roster for this class scope'; end if;
  v_fp:=private.class_setup_review_fingerprint_v57(p_studio_id,v_snapshot,p_class_id,p_aspect,1); if lower(p_expected_fingerprint) is distinct from v_fp then raise exception 'STALE_CLASS_SETUP_REVIEW_FINGERPRINT: class setup changed before review commit'; end if;
  insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note) values(p_studio_id,'CLASS',p_class_id,p_aspect,1,v_fp,'REVIEWED_VALUE',v_uid,coalesce(v_actor,'Studio user'),v_version,nullif(btrim(coalesce(p_note,'')),'')) returning id into v_review_id;
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values(p_studio_id,v_uid,coalesce(v_actor,'Studio user'),'SETUP_REVIEW_ATTESTED','CLASS',p_class_id,'Reviewed class '||p_aspect||' setup',jsonb_build_object('reviewId',v_review_id,'scopeKind','CLASS','aspect',p_aspect,'reviewSchemaVersion',1,'outcome','REVIEWED_VALUE','planningDatasetVersion',v_version));
  return jsonb_build_object('status','REVIEWED','reviewId',v_review_id,'classId',p_class_id,'aspect',p_aspect,'currentFingerprint',v_fp,'planningDatasetVersion',v_version);
end $function$;
revoke all on function public.attest_class_setup_review_v57(uuid,text,text,integer,text,boolean,text) from public,anon;
grant execute on function public.attest_class_setup_review_v57(uuid,text,text,integer,text,boolean,text) to authenticated,service_role;

-- POL-01 / V5.2 bounded typed-policy transition.
--
-- AIM-003 is the first Rulebook requirement to move from static name-bound
-- compiler semantics to a schema-versioned policy envelope that references the
-- current teacher by stable planning ID. The transition is deliberately narrow:
-- all 177 residual reviewed rules remain byte-semantically pinned to the exact
-- Rulebook V3 snapshot, and a V4 ConstraintModel must contain exactly one
-- ID-bound AIM-003 semantic source before PostgreSQL will publish it.

create or replace function private.rule_snapshot_v52(p_studio uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id collate "C"),'[]'::jsonb)
  from public.rules r
  where r.studio_id=p_studio
$function$;
revoke all on function private.rule_snapshot_v52(uuid) from public,anon,authenticated;

create or replace function private.rulebook_snapshot_without_v52(p_snapshot jsonb,p_rule_id text)
returns jsonb
language sql
immutable
set search_path=''
as $function$
  select coalesce(jsonb_agg(elem order by elem->>'id' collate "C"),'[]'::jsonb)
  from jsonb_array_elements(coalesce(p_snapshot,'[]'::jsonb)) elem
  where elem->>'id'<>p_rule_id
$function$;
revoke all on function private.rulebook_snapshot_without_v52(jsonb,text) from public,anon,authenticated;

create or replace function private.rule_without_machine_v52(p_rule jsonb)
returns jsonb
language sql
immutable
set search_path=''
as $function$
  select coalesce(p_rule,'{}'::jsonb)-'parameters'-'affected_entity_ids'-'updated_at'
$function$;
revoke all on function private.rule_without_machine_v52(jsonb) from public,anon,authenticated;

-- Preserve the public/private call graph from V3.6 while broadening its content
-- pin from exact V3 to either exact V3 or the one accepted POL-01 V4 transition.
-- The intentionally historical function name remains so all existing governed
-- repair callers pick up the stronger assertion without signature churn.
create or replace function private.assert_reviewed_rulebook_v3_v36(p_studio uuid)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_current public.rulebook_versions%rowtype;
  v_live jsonb;
  v_live_hash text;
  v_v3_snapshot jsonb;
  v_current_aim jsonb;
  v_v3_aim jsonb;
  v_teacher_id text;
begin
  select * into v_current
  from public.rulebook_versions rb
  where rb.studio_id=p_studio and rb.status='CURRENT'
  for share;

  if v_current.id is null then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: no current RulebookVersion exists';
  end if;
  if v_current.rulebook_id is distinct from 'dwde-2026-2027-master-rulebook'
     or v_current.rule_count is distinct from 178
     or v_current.document_type is distinct from 'DWDE_SITE_RULEBOOK' then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: current Rulebook is not the reviewed 178-rule DWDE artifact';
  end if;

  v_live:=private.rule_snapshot_v52(p_studio);
  if jsonb_array_length(v_live)<>178 or v_live is distinct from v_current.snapshot then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: live rules differ from the immutable current Rulebook snapshot';
  end if;
  v_live_hash:=encode(extensions.digest(pg_catalog.convert_to(v_live::text,'UTF8'),'sha256'),'hex');
  if v_current.source_hash is distinct from v_live_hash then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: current Rulebook source hash does not match its live immutable snapshot';
  end if;

  if v_current.version=3 then
    if v_current.source_hash is distinct from '7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b'
       or v_current.format_version is distinct from '2.1'
       or v_current.source_metadata->>'provenance' is distinct from 'POST_REVIEW_CAMI_CONFIRMATION' then
      raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: deterministic repair operations require the exact reviewed Rulebook V3 baseline';
    end if;
    return;
  end if;

  if v_current.version<>4
     or v_current.parent_version is distinct from 3
     or v_current.format_version is distinct from '2.2'
     or v_current.source_metadata->>'provenance' is distinct from 'TYPED_POLICY_MIGRATION'
     or v_current.source_metadata->>'residualBaselineSourceHash' is distinct from '7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b'
     or v_current.source_metadata->'typedPolicyRuleIds' is distinct from jsonb_build_array('AIM-003')
     or v_current.changed_rule_ids is distinct from array['AIM-003']::text[] then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: Rulebook V4 is not the bounded POL-01 typed-policy transition';
  end if;

  select rb.snapshot into v_v3_snapshot
  from public.rulebook_versions rb
  where rb.studio_id=p_studio
    and rb.version=3
    and rb.rulebook_id='dwde-2026-2027-master-rulebook'
    and rb.source_hash='7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b'
  limit 1;
  if v_v3_snapshot is null then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: historical reviewed Rulebook V3 snapshot is unavailable';
  end if;

  if private.rulebook_snapshot_without_v52(v_current.snapshot,'AIM-003')
     is distinct from private.rulebook_snapshot_without_v52(v_v3_snapshot,'AIM-003') then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: residual V3 policy changed outside AIM-003';
  end if;

  select elem into v_current_aim
  from jsonb_array_elements(v_current.snapshot) elem
  where elem->>'id'='AIM-003';
  select elem into v_v3_aim
  from jsonb_array_elements(v_v3_snapshot) elem
  where elem->>'id'='AIM-003';
  if v_current_aim is null or v_v3_aim is null then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: AIM-003 is missing from the V3/V4 transition snapshots';
  end if;
  if private.rule_without_machine_v52(v_current_aim)
     is distinct from private.rule_without_machine_v52(v_v3_aim) then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: AIM-003 human-reviewed policy fields changed during typed migration';
  end if;

  v_teacher_id:=nullif(btrim(v_current_aim#>>'{parameters,policy,teacherId}'),'');
  if v_teacher_id is null then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: AIM-003 typed policy has no stable teacherId';
  end if;
  if v_current_aim#>'{parameters,policy}' is distinct from jsonb_build_object(
    'schemaVersion','1.0',
    'kind','TEACHER_DAY_WINDOW',
    'teacherId',v_teacher_id,
    'allowedDays',jsonb_build_array('Monday','Tuesday','Wednesday','Thursday')
  ) then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: AIM-003 typed policy envelope is malformed or changes reviewed availability semantics';
  end if;
  if v_current_aim->'affected_entity_ids' is distinct from jsonb_build_array(v_teacher_id) then
    raise exception 'RULEBOOK_POLICY_CONTENT_MISMATCH: AIM-003 affected entity IDs must contain exactly its typed teacherId';
  end if;
  if not exists(
    select 1 from public.teachers t
    where t.studio_id=p_studio and t.id=v_teacher_id and t.archived_at is null
  ) then
    raise exception 'RULEBOOK_POLICY_REFERENCE_MISSING: AIM-003 references missing or archived teacher %',v_teacher_id;
  end if;
end
$function$;
revoke all on function private.assert_reviewed_rulebook_v3_v36(uuid) from public,anon,authenticated;

-- Transition the exact reviewed V3 artifact to V4 by changing AIM-003 machine
-- fields only. This is an artifact-scoped data migration, not a global seed:
-- databases that contain another or deidentified Rulebook install the V5.2
-- functions but are not rewritten. Teacher display name is used exactly once
-- here to bind the reviewed rule to its current stable planning identity.
do $migration$
declare
  v_studio uuid;
  v_current public.rulebook_versions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_snapshot jsonb;
  v_source_hash text;
  v_teacher_count integer;
  v_teacher_id text;
  v_current_enforcement public.rule_enforcement_versions%rowtype;
  v_new_enforcement integer;
  v_previous_constraint_model integer;
  v_reason text:='POL-01 bounded typed policy migration for AIM-003 stable teacher identity';
begin
  select studio_id into v_studio
  from public.rulebook_versions
  where rulebook_id='dwde-2026-2027-master-rulebook'
    and status='CURRENT'
    and (
      (version=3 and source_hash='7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b')
      or (version=4 and source_metadata->>'provenance'='TYPED_POLICY_MIGRATION')
    )
  order by version desc
  limit 1;
  if v_studio is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rulebook:'||v_studio::text,0));
  select * into v_current
  from public.rulebook_versions
  where studio_id=v_studio and status='CURRENT'
  for update;

  if v_current.version=4 then
    perform private.assert_reviewed_rulebook_v3_v36(v_studio);
    return;
  end if;
  if v_current.version<>3
     or v_current.rulebook_id<>'dwde-2026-2027-master-rulebook'
     or v_current.rule_count<>178
     or v_current.source_hash<>'7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b' then
    raise exception 'POL01_BASELINE_MISMATCH: expected exact reviewed Rulebook V3';
  end if;
  perform private.assert_reviewed_rulebook_v3_v36(v_studio);

  select count(*)::integer,min(t.id)
  into v_teacher_count,v_teacher_id
  from public.teachers t
  where t.studio_id=v_studio
    and t.archived_at is null
    and regexp_replace(lower(btrim(t.name)),'[^a-z0-9]+','','g')='aimee';
  if v_teacher_count=0 then
    raise exception 'POL01_AIMEE_MISSING: AIM-003 requires one active Aimee teacher record';
  elsif v_teacher_count<>1 then
    raise exception 'POL01_AIMEE_AMBIGUOUS: AIM-003 requires one active Aimee teacher record; found %',v_teacher_count;
  end if;

  select to_jsonb(r) into v_before
  from public.rules r
  where r.studio_id=v_studio and r.id='AIM-003'
  for update;
  if v_before is null then raise exception 'POL01_AIM003_MISSING: reviewed AIM-003 rule is absent'; end if;
  if coalesce(v_before->'parameters','{}'::jsonb)<>'{}'::jsonb
     or coalesce(v_before->'affected_entity_ids','[]'::jsonb)<>'[]'::jsonb then
    raise exception 'POL01_AIM003_MACHINE_DRIFT: legacy AIM-003 already contains machine fields';
  end if;

  update public.rules
  set
    parameters=jsonb_build_object(
      'policy',jsonb_build_object(
        'schemaVersion','1.0',
        'kind','TEACHER_DAY_WINDOW',
        'teacherId',v_teacher_id,
        'allowedDays',jsonb_build_array('Monday','Tuesday','Wednesday','Thursday')
      )
    ),
    affected_entity_ids=array[v_teacher_id]::text[],
    updated_at=now()
  where studio_id=v_studio and id='AIM-003';

  select to_jsonb(r) into v_after
  from public.rules r
  where r.studio_id=v_studio and r.id='AIM-003';
  if private.rule_without_machine_v52(v_after) is distinct from private.rule_without_machine_v52(v_before) then
    raise exception 'POL01_AIM003_HUMAN_POLICY_CHANGED: typed migration may change machine fields only';
  end if;

  v_snapshot:=private.rule_snapshot_v52(v_studio);
  if jsonb_array_length(v_snapshot)<>178 then
    raise exception 'POL01_RULE_COUNT_MISMATCH: V4 snapshot must contain exactly 178 rules';
  end if;
  if private.rulebook_snapshot_without_v52(v_snapshot,'AIM-003')
     is distinct from private.rulebook_snapshot_without_v52(v_current.snapshot,'AIM-003') then
    raise exception 'POL01_RESIDUAL_POLICY_CHANGED: rules outside AIM-003 changed during migration';
  end if;
  v_source_hash:=encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');

  insert into public.rule_history(
    studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed
  ) values(
    v_studio,'AIM-003',4,null,'Engineering typed-policy migration',v_reason,v_before,v_after,false
  );

  update public.rulebook_versions set status='HISTORICAL' where id=v_current.id;
  insert into public.rulebook_versions(
    studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,
    rulebook_id,status,imported_at,source_hash,source_file_hash,rule_count,parent_version,
    format_version,document_type,source_metadata
  ) values(
    v_studio,4,'DWDE 2026-2027 Master Rulebook v4',null,'Engineering typed-policy migration',v_reason,
    array['AIM-003']::text[],v_snapshot,
    'dwde-2026-2027-master-rulebook','CURRENT',now(),v_source_hash,null,178,3,'2.2','DWDE_SITE_RULEBOOK',
    jsonb_build_object(
      'provenance','TYPED_POLICY_MIGRATION',
      'parentVersion',3,
      'parentSourceHash',v_current.source_hash,
      'residualBaselineSourceHash',v_current.source_hash,
      'typedPolicyRuleIds',jsonb_build_array('AIM-003'),
      'hashSemantics','DATABASE_RULE_SNAPSHOT_JSONB_SHA256',
      'transition','AIM-003 legacy name-bound availability to stable teacher ID'
    )
  );

  -- Legacy enforcement snapshots remain compatibility history only. Carry their
  -- unrelated mappings forward if and only if they do not claim AIM-003.
  select * into v_current_enforcement
  from public.rule_enforcement_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1
  for update;
  if v_current_enforcement.id is not null then
    if exists(
      select 1 from jsonb_array_elements(v_current_enforcement.snapshot) elem
      where elem->>'ruleId'='AIM-003'
    ) then
      raise exception 'POL01_DUAL_AUTHORITY: legacy enforcement snapshot already claims AIM-003';
    end if;
    select coalesce(max(version),0)+1 into v_new_enforcement
    from public.rule_enforcement_versions where studio_id=v_studio;
    update public.rule_enforcement_versions set status='HISTORICAL' where id=v_current_enforcement.id;
    insert into public.rule_enforcement_versions(
      studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status
    ) values(
      v_studio,v_new_enforcement,4,null,'Engineering typed-policy migration',
      'Carry unrelated legacy mappings forward; AIM-003 authority is Rulebook typed policy + ConstraintModel',
      '{}'::text[],v_current_enforcement.snapshot,'CURRENT'
    );
    insert into public.audit_events(
      studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
    ) values(
      v_studio,null,'Engineering typed-policy migration','ENFORCEMENT_REBASE','RULE_ENFORCEMENT','rulebook-v4',v_reason,
      jsonb_build_object('fromVersion',v_current_enforcement.version,'toVersion',v_new_enforcement,'rulebookVersion',4,'typedPolicyRuleId','AIM-003')
    );
  end if;

  select version into v_previous_constraint_model
  from public.constraint_model_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1
  for update;
  update public.constraint_model_versions
  set status='HISTORICAL'
  where studio_id=v_studio and status='CURRENT';

  update public.rule_enforcement_proposals
  set status='SUPERSEDED',updated_at=now(),review_reason=coalesce(review_reason,'Superseded by Rulebook V4 typed-policy transition')
  where studio_id=v_studio and status='PROPOSED' and base_rulebook_version<>4;

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values
    (v_studio,null,'Engineering typed-policy migration','RULE_UPDATE','RULE','AIM-003',v_reason,
      jsonb_build_object('before',v_before,'after',v_after,'rulebookVersion',4,'typedTeacherId',v_teacher_id,'aiProposed',false)),
    (v_studio,null,'Engineering typed-policy migration','RULEBOOK_VERSION','RULEBOOK','4',v_reason,
      jsonb_build_object('version',4,'parentVersion',3,'ruleCount',178,'sourceHash',v_source_hash,'changedRuleIds',jsonb_build_array('AIM-003'))),
    (v_studio,null,'Engineering typed-policy migration','CONSTRAINT_MODEL_INVALIDATED','CONSTRAINT_MODEL',coalesce(v_previous_constraint_model::text,'none'),v_reason,
      jsonb_build_object('previousConstraintModelVersion',v_previous_constraint_model,'newRulebookVersion',4,'reason','Rulebook semantics now require compiler dwde-ir-0.4 publication'));

  perform private.assert_reviewed_rulebook_v3_v36(v_studio);
end
$migration$;

-- V4 publication is still compiler-owned. PostgreSQL does not recreate semantics;
-- it checks that the compiler artifact proves the one bounded replacement:
-- exactly one AIM-003 node, stable teacher ID, no name selector, and unchanged
-- Monday-through-Thursday meaning. Pre-V4 publication retains the existing
-- generic JSONB/version mechanics; V4 alone adds the new policy-certification gate.
create or replace function public.publish_constraint_model_v30(
  p_snapshot jsonb,
  p_reason text,
  p_expected_rulebook_version integer
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
  v_current_rulebook integer;
  v_current public.constraint_model_versions%rowtype;
  v_hash text;
  v_version integer;
  v_compiler text:=coalesce(p_snapshot->>'compilerVersion','');
  v_complete boolean:=coalesce((p_snapshot->>'completeHardConstraintCompilation')::boolean,false);
  v_teacher_id text;
  v_aim_count integer;
  v_aim_node jsonb;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

  select version into v_current_rulebook
  from public.rulebook_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;
  if v_current_rulebook is null then raise exception 'No current RulebookVersion exists'; end if;
  if v_current_rulebook<>p_expected_rulebook_version then
    raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_current_rulebook;
  end if;

  if v_current_rulebook=4 then
    perform private.assert_reviewed_rulebook_v3_v36(v_studio);
    if v_compiler<>'dwde-ir-0.4' then
      raise exception 'CONSTRAINT_MODEL_COMPILER_MISMATCH: typed Rulebook V4 requires dwde-ir-0.4';
    end if;
  end if;

  perform private.validate_constraint_model_snapshot_v27(p_snapshot,v_current_rulebook,v_compiler);
  if v_complete is not true then raise exception 'Only complete HARD Constraint IR models may be published'; end if;

  if v_current_rulebook=4 then
    select r.parameters#>>'{policy,teacherId}' into v_teacher_id
    from public.rules r
    where r.studio_id=v_studio and r.id='AIM-003';

    select count(*)::integer into v_aim_count
    from jsonb_array_elements(p_snapshot->'hardConstraints') node
    where (node->'ruleIds') ? 'AIM-003';
    if v_aim_count<>1 then
      raise exception 'POL01_CONSTRAINT_SOURCE_COUNT: Rulebook V4 requires exactly one AIM-003 Constraint IR node; found %',v_aim_count;
    end if;
    select node into v_aim_node
    from jsonb_array_elements(p_snapshot->'hardConstraints') node
    where (node->'ruleIds') ? 'AIM-003'
    limit 1;

    if v_aim_node->>'kind'<>'TEACHER_DAY_WINDOW'
       or v_aim_node->'ruleIds' is distinct from jsonb_build_array('AIM-003')
       or v_aim_node->'selector' is distinct from jsonb_build_object('teacherIds',jsonb_build_array(v_teacher_id))
       or v_aim_node->'parameters' is distinct from jsonb_build_object('allowedDays',jsonb_build_array('Monday','Tuesday','Wednesday','Thursday')) then
      raise exception 'POL01_CONSTRAINT_BINDING_MISMATCH: AIM-003 must publish exactly one stable-ID teacher-day-window semantic source';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||v_studio::text,0));
  v_hash:=private.constraint_model_hash_v27(p_snapshot);

  select * into v_current
  from public.constraint_model_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;

  if v_current.id is not null
     and v_current.snapshot_hash=v_hash
     and v_current.rulebook_version=v_current_rulebook
     and v_current.compiler_version=v_compiler then
    return jsonb_build_object(
      'constraintModelVersion',v_current.version,
      'snapshotHash',v_hash,
      'rulebookVersion',v_current_rulebook,
      'compilerVersion',v_compiler,
      'alreadyCurrent',true
    );
  end if;

  select coalesce(max(version),0)+1 into v_version
  from public.constraint_model_versions
  where studio_id=v_studio;
  update public.constraint_model_versions
  set status='HISTORICAL'
  where studio_id=v_studio and status='CURRENT';

  insert into public.constraint_model_versions(
    studio_id,version,rulebook_version,compiler_version,actor_user_id,actor_label,reason,
    snapshot,snapshot_hash,complete_hard_constraint_compilation,status
  ) values(
    v_studio,v_version,v_current_rulebook,v_compiler,v_uid,v_actor,p_reason,
    p_snapshot,v_hash,true,'CURRENT'
  );

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values(
    v_studio,v_uid,v_actor,'CONSTRAINT_MODEL_PUBLISHED','CONSTRAINT_MODEL',v_version::text,p_reason,
    jsonb_build_object(
      'constraintModelVersion',v_version,
      'snapshotHash',v_hash,
      'rulebookVersion',v_current_rulebook,
      'compilerVersion',v_compiler,
      'previousConstraintModelVersion',case when v_current.id is null then null else v_current.version end
    )
  );

  return jsonb_build_object(
    'constraintModelVersion',v_version,
    'snapshotHash',v_hash,
    'rulebookVersion',v_current_rulebook,
    'compilerVersion',v_compiler,
    'alreadyCurrent',false
  );
end
$function$;
revoke all on function public.publish_constraint_model_v30(jsonb,text,integer)
  from public,anon,authenticated,service_role;

-- The shared roster compiler contains residual reviewed V3 semantics that are
-- unchanged in V4. Keep its implementation, but wrap its metadata so governed
-- callers report the actual current validated Rulebook rather than hardcoded V3.
do $wrap$
begin
  if to_regprocedure('private.rulebook_required_roster_legacy_v52(uuid,text)') is null then
    alter function private.rulebook_required_roster_v38(uuid,text)
      rename to rulebook_required_roster_legacy_v52;
  end if;
end
$wrap$;

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
  v_result jsonb;
  v_version integer;
  v_hash text;
begin
  perform private.assert_reviewed_rulebook_v3_v36(p_studio);
  v_result:=private.rulebook_required_roster_legacy_v52(p_studio,p_class_name);
  select rb.version,rb.source_hash into v_version,v_hash
  from public.rulebook_versions rb
  where rb.studio_id=p_studio and rb.status='CURRENT'
  limit 1;
  return v_result || jsonb_build_object('rulebookVersion',v_version,'rulebookSourceHash',v_hash);
end
$function$;
revoke all on function private.rulebook_required_roster_v38(uuid,text) from public,anon,authenticated;

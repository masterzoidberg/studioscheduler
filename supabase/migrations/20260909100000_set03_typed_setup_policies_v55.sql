-- SET-03 / typed setup policy and room-restriction review boundary.
--
-- Planning facts remain in PlanningDatasetVersion. This migration only adds a
-- governed Rulebook successor for the supported setup policy envelopes and
-- append-only review evidence for room restrictions. The existing V2.2 rule
-- mutation deliberately rejects machine fields, so SET-03 uses this narrow
-- typed boundary instead of bypassing that contract.

create or replace function private.validate_setup_typed_policy_v55(
  p_studio_id uuid,
  p_rule_id text,
  p_policy jsonb
)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_planning jsonb;
  v_item jsonb;
  v_day text;
  v_start text;
  v_end text;
  v_closed text;
  v_room_id text;
  v_class_id text;
  v_feature text;
  v_expected_kind text;
  v_keys text[];
  v_expected_keys text[];
begin
  if p_rule_id not in ('OPS-001','ROOM-002','ROOM-007','ROOM-009') then
    raise exception 'SETUP_TYPED_POLICY_RULE_UNSUPPORTED: rule % is not an approved SET-03 policy owner',p_rule_id;
  end if;
  v_expected_kind:=case p_rule_id
    when 'OPS-001' then 'STUDIO_OPERATING_WINDOWS'
    when 'ROOM-002' then 'ROOM_UNAVAILABLE_WINDOWS'
    when 'ROOM-007' then 'ROOM_CAPACITY_POLICY'
    when 'ROOM-009' then 'ROOM_REQUIRED_FEATURES'
  end;
  if p_policy is null or jsonb_typeof(p_policy)<>'object' then raise exception 'SETUP_TYPED_POLICY_INVALID: policy must be an object'; end if;
  v_keys:=coalesce((select array_agg(key order by key) from jsonb_object_keys(p_policy) key),array[]::text[]);
  v_expected_keys:=case p_rule_id
    when 'OPS-001' then array['kind','schemaVersion','windows']
    when 'ROOM-002' then array['kind','roomId','schemaVersion','windows']
    when 'ROOM-007' then array['kind','roomId','schemaVersion']
    when 'ROOM-009' then array['classIds','kind','requiredFeatures','schemaVersion']
  end;
  if (p_rule_id='OPS-001' and v_keys<>array['kind','schemaVersion','windows'] and v_keys<>array['closedDays','kind','schemaVersion','windows'])
     or (p_rule_id='ROOM-007' and v_keys<>array['kind','roomId','schemaVersion'] and v_keys<>array['exemptClassIds','kind','roomId','schemaVersion'])
     or (p_rule_id not in ('OPS-001','ROOM-007') and v_keys<>v_expected_keys) then
    raise exception 'SETUP_TYPED_POLICY_UNKNOWN_FIELD: % policy fields must be exactly %',p_rule_id,array_to_string(v_expected_keys,',');
  end if;
  if p_policy->>'schemaVersion'<>'1.0' or p_policy->>'kind'<>v_expected_kind then
    raise exception 'SETUP_TYPED_POLICY_KIND_MISMATCH: % requires typed kind %',p_rule_id,v_expected_kind;
  end if;

  select pd.snapshot into v_planning
  from public.planning_dataset_versions pd
  where pd.studio_id=p_studio_id and pd.status='CURRENT'
  order by pd.version desc limit 1;
  if v_planning is null then raise exception 'SETUP_TYPED_POLICY_NO_PLANNING_DATASET: current PlanningDatasetVersion is required'; end if;

  if p_rule_id in ('OPS-001','ROOM-002') then
    if jsonb_typeof(p_policy->'windows')<>'array' or jsonb_array_length(p_policy->'windows')=0 then
      raise exception 'SETUP_TYPED_POLICY_WINDOWS_INVALID: % windows must be a non-empty array',p_rule_id;
    end if;
    for v_item in select value from jsonb_array_elements(p_policy->'windows') loop
      if jsonb_typeof(v_item)<>'object'
         or coalesce((select array_agg(key order by key) from jsonb_object_keys(v_item) key),array[]::text[])<>array['day','end','start'] then
        raise exception 'SETUP_TYPED_POLICY_WINDOWS_INVALID: % window must contain only day,start,end',p_rule_id;
      end if;
      v_day:=v_item->>'day'; v_start:=v_item->>'start'; v_end:=v_item->>'end';
      if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
         or v_start !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
         or v_end !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
         or v_start>=v_end
         or substring(v_start from 4 for 2)::integer%15<>0
         or substring(v_end from 4 for 2)::integer%15<>0 then
        raise exception 'SETUP_TYPED_POLICY_WINDOWS_INVALID: % windows must be same-day HH:MM intervals on the 15-minute grid',p_rule_id;
      end if;
    end loop;
    if jsonb_typeof(coalesce(p_policy->'closedDays','[]'::jsonb))<>'array' then
      raise exception 'SETUP_TYPED_POLICY_CLOSED_DAYS_INVALID: closedDays must be an array';
    end if;
    if exists(
      select 1 from jsonb_array_elements(coalesce(p_policy->'closedDays','[]'::jsonb)) closed(value)
      where value #>> '{}' not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
    ) then raise exception 'SETUP_TYPED_POLICY_CLOSED_DAYS_INVALID: closedDays contains an unsupported day'; end if;
    if jsonb_array_length(coalesce(p_policy->'closedDays','[]'::jsonb))<>jsonb_array_length(
      (select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) from jsonb_array_elements(coalesce(p_policy->'closedDays','[]'::jsonb)) closed(value))
    ) then raise exception 'SETUP_TYPED_POLICY_CLOSED_DAYS_INVALID: closedDays must not contain duplicates'; end if;
    if exists(
      select 1 from jsonb_array_elements(p_policy->'windows') win(value)
      join jsonb_array_elements_text(coalesce(p_policy->'closedDays','[]'::jsonb)) closed(day) on closed.day=win.value->>'day'
    ) then raise exception 'SETUP_TYPED_POLICY_WINDOW_CLOSED_DAY_CONFLICT: a window cannot be configured on a closed day'; end if;
  end if;

  if p_rule_id in ('ROOM-002','ROOM-007') then
    v_room_id:=p_policy->>'roomId';
    if coalesce(btrim(v_room_id),'')='' or not exists(
      select 1 from jsonb_array_elements(coalesce(v_planning->'rooms','[]'::jsonb)) room(value) where value->>'id'=v_room_id
    ) then raise exception 'SETUP_TYPED_POLICY_ROOM_NOT_ACTIVE: roomId must identify an active PlanningDataset room'; end if;
  end if;

  if p_rule_id='ROOM-007' then
    if p_policy ? 'exemptClassIds' and jsonb_typeof(p_policy->'exemptClassIds')<>'array' then raise exception 'SETUP_TYPED_POLICY_CLASS_IDS_INVALID: exemptClassIds must be an array'; end if;
    for v_class_id in select value from jsonb_array_elements_text(p_policy->'exemptClassIds') loop
      if not exists(select 1 from jsonb_array_elements(coalesce(v_planning->'classes','[]'::jsonb)) klass(value) where value->>'id'=v_class_id) then
        raise exception 'SETUP_TYPED_POLICY_CLASS_NOT_ACTIVE: exemptClassIds contains a class outside the current PlanningDataset';
      end if;
    end loop;
  end if;

  if p_rule_id='ROOM-009' then
    if jsonb_typeof(p_policy->'classIds')<>'array' or jsonb_array_length(p_policy->'classIds')=0
       or jsonb_typeof(p_policy->'requiredFeatures')<>'array' or jsonb_array_length(p_policy->'requiredFeatures')=0 then
      raise exception 'SETUP_TYPED_POLICY_FEATURES_INVALID: classIds and requiredFeatures must be non-empty arrays';
    end if;
    for v_class_id in select value from jsonb_array_elements_text(p_policy->'classIds') loop
      if not exists(select 1 from jsonb_array_elements(coalesce(v_planning->'classes','[]'::jsonb)) klass(value) where value->>'id'=v_class_id) then
        raise exception 'SETUP_TYPED_POLICY_CLASS_NOT_ACTIVE: classIds contains a class outside the current PlanningDataset';
      end if;
    end loop;
    for v_feature in select value from jsonb_array_elements_text(p_policy->'requiredFeatures') loop
      if coalesce(btrim(v_feature),'')='' then raise exception 'SETUP_TYPED_POLICY_FEATURES_INVALID: requiredFeatures cannot contain blanks'; end if;
    end loop;
    if jsonb_array_length(p_policy->'classIds')<>jsonb_array_length(
      (select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) from jsonb_array_elements(p_policy->'classIds') ids(value))
    ) or jsonb_array_length(p_policy->'requiredFeatures')<>jsonb_array_length(
      (select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) from jsonb_array_elements(p_policy->'requiredFeatures') features(value))
    ) then raise exception 'SETUP_TYPED_POLICY_DUPLICATE: stable IDs and features must be duplicate-free'; end if;
  end if;
end
$function$;
revoke all on function private.validate_setup_typed_policy_v55(uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.apply_setup_typed_policies_v55(
  p_policies jsonb,
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
  ctx jsonb:=private.assert_editor_context();
  v_uid uuid:=(ctx->>'user_id')::uuid;
  v_studio uuid:=(ctx->>'studio_id')::uuid;
  v_actor text:=ctx->>'actor';
  v_role text;
  v_rulebook public.rulebook_versions%rowtype;
  v_enforcement public.rule_enforcement_versions%rowtype;
  v_policy_item jsonb;
  v_policy jsonb;
  v_rule_id text;
  v_input_ids text[]:='{}'::text[];
  v_changed_ids text[]:='{}'::text[];
  v_owner_ids text[]:='{}'::text[];
  v_old_owner_ids text[]:='{}'::text[];
  v_introduced_ids text[]:='{}'::text[];
  v_bundle jsonb;
  v_bundles jsonb:='[]'::jsonb;
  v_before jsonb;
  v_after jsonb;
  v_history_id uuid;
  v_snapshot jsonb;
  v_new_version integer;
  v_new_enforcement integer;
  v_source_hash text;
  v_expected_kind text;
  v_planning_version integer;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  select m.role into v_role
  from public.studio_members m
  where m.studio_id=v_studio and m.user_id=v_uid
  for update;
  if not found or v_role not in ('OWNER','EDITOR') then raise exception using errcode='42501',message='Editor membership required for selected workspace'; end if;

  perform pg_advisory_xact_lock(hashtextextended('typed-setup:'||v_studio::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||v_studio::text,0));
  select * into v_rulebook from public.rulebook_versions rb where rb.studio_id=v_studio and rb.status='CURRENT' for update;
  if v_rulebook.id is null then raise exception 'SETUP_TYPED_POLICY_NO_RULEBOOK: no current RulebookVersion exists'; end if;
  if v_rulebook.version<4 or v_rulebook.version>100 then raise exception 'SETUP_TYPED_POLICY_RULEBOOK_UNSUPPORTED: setup policies require the accepted typed Rulebook'; end if;
  select * into v_enforcement from public.rule_enforcement_versions ev where ev.studio_id=v_studio and ev.status='CURRENT' limit 1 for update;
  if coalesce(v_enforcement.version,0)<>coalesce(p_expected_enforcement_version,0) then
    raise exception 'STALE_ENFORCEMENT: expected %, current %',coalesce(p_expected_enforcement_version,0),coalesce(v_enforcement.version,0);
  end if;
  if v_rulebook.version<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook.version; end if;
  select pd.version into v_planning_version
  from public.planning_dataset_versions pd
  where pd.studio_id=v_studio and pd.status='CURRENT'
  order by pd.version desc limit 1;
  if v_planning_version is null then raise exception 'SETUP_TYPED_POLICY_NO_PLANNING_DATASET: current PlanningDatasetVersion is required'; end if;
  if v_planning_version<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_planning_version; end if;
  if jsonb_typeof(coalesce(p_policies,'[]'::jsonb))<>'array' then raise exception 'SETUP_TYPED_POLICY_INVALID: policies must be an array'; end if;

  for v_policy_item in select value from jsonb_array_elements(coalesce(p_policies,'[]'::jsonb)) loop
    if jsonb_typeof(v_policy_item)<>'object' or coalesce((select array_agg(key order by key) from jsonb_object_keys(v_policy_item) key),array[]::text[])<>array['policy','ruleId'] then
      raise exception 'SETUP_TYPED_POLICY_INVALID: each policy entry must contain exactly ruleId and policy';
    end if;
    v_rule_id:=nullif(btrim(v_policy_item->>'ruleId'),''); v_policy:=v_policy_item->'policy';
    if v_rule_id is null or v_rule_id=any(v_input_ids) then raise exception 'SETUP_TYPED_POLICY_DUPLICATE: each SET-03 policy owner may be supplied once'; end if;
    if not exists(select 1 from public.rules r where r.studio_id=v_studio and r.id=v_rule_id) then raise exception 'SETUP_TYPED_POLICY_RULE_MISSING: rule % is not present in the current Rulebook',v_rule_id; end if;
    perform private.validate_setup_typed_policy_v55(v_studio,v_rule_id,v_policy);
    v_input_ids:=array_append(v_input_ids,v_rule_id);
  end loop;

  -- The SET-03 form submits the complete supported setup slice. An omitted
  -- existing SET-03 envelope is cleared; unrelated typed owners are carried
  -- forward unchanged and remain governed by their own policy owners.
  foreach v_rule_id in array array['OPS-001','ROOM-002','ROOM-009']::text[] loop
    if not (v_rule_id=any(v_input_ids)) then
      select to_jsonb(r) into v_before from public.rules r where r.studio_id=v_studio and r.id=v_rule_id for update;
      v_expected_kind:=case v_rule_id when 'OPS-001' then 'STUDIO_OPERATING_WINDOWS' when 'ROOM-002' then 'ROOM_UNAVAILABLE_WINDOWS' when 'ROOM-009' then 'ROOM_REQUIRED_FEATURES' end;
      if v_before is not null and v_before->'parameters' ? 'policy' then
        if v_before->'parameters'->'policy'->>'kind'<>v_expected_kind then raise exception 'SETUP_TYPED_POLICY_OWNER_CONFLICT: % already owns another typed policy kind',v_rule_id; end if;
        insert into public.rule_history(studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed)
        values(v_studio,v_rule_id,v_rulebook.version+1,v_uid,v_actor,p_reason,v_before,null,false)
        returning id into v_history_id;
        update public.rules set parameters='{}'::jsonb,affected_entity_ids='{}'::text[],updated_at=now() where studio_id=v_studio and id=v_rule_id;
        select to_jsonb(r) into v_after from public.rules r where r.studio_id=v_studio and r.id=v_rule_id;
        update public.rule_history set after_rule=v_after where id=v_history_id;
        v_changed_ids:=array_append(v_changed_ids,v_rule_id);
      end if;
    end if;
  end loop;

  for v_policy_item in select value from jsonb_array_elements(coalesce(p_policies,'[]'::jsonb)) loop
    v_rule_id:=v_policy_item->>'ruleId'; v_policy:=v_policy_item->'policy';
    select to_jsonb(r) into v_before from public.rules r where r.studio_id=v_studio and r.id=v_rule_id for update;
    v_expected_kind:=case v_rule_id when 'OPS-001' then 'STUDIO_OPERATING_WINDOWS' when 'ROOM-002' then 'ROOM_UNAVAILABLE_WINDOWS' when 'ROOM-007' then 'ROOM_CAPACITY_POLICY' when 'ROOM-009' then 'ROOM_REQUIRED_FEATURES' end;
    if v_before->'parameters' ? 'policy' and v_before->'parameters'->'policy'->>'kind'<>v_expected_kind then raise exception 'SETUP_TYPED_POLICY_OWNER_CONFLICT: % already owns another typed policy kind',v_rule_id; end if;
    update public.rules set
      parameters=jsonb_build_object('policy',v_policy),
      affected_entity_ids=case
        when v_rule_id in ('ROOM-002','ROOM-007') then array[v_policy->>'roomId']::text[] || coalesce((select array_agg(value order by value) from jsonb_array_elements_text(coalesce(v_policy->'exemptClassIds','[]'::jsonb)) ids(value)),'{}'::text[])
        when v_rule_id='ROOM-009' then coalesce((select array_agg(value order by value) from jsonb_array_elements_text(v_policy->'classIds') ids(value)),'{}'::text[])
        else '{}'::text[] end,
      updated_at=now()
    where studio_id=v_studio and id=v_rule_id;
    select to_jsonb(r) into v_after from public.rules r where r.studio_id=v_studio and r.id=v_rule_id;
    insert into public.rule_history(studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed)
    values(v_studio,v_rule_id,v_rulebook.version+1,v_uid,v_actor,p_reason,v_before,v_after,false);
    v_changed_ids:=array_append(v_changed_ids,v_rule_id);
  end loop;

  select coalesce(array_agg(r.id order by r.id),'{}'::text[]) into v_owner_ids
  from public.rules r where r.studio_id=v_studio and r.parameters ? 'policy';
  v_old_owner_ids:=coalesce((select array_agg(value #>> '{}' order by value #>> '{}') from jsonb_array_elements(coalesce(v_rulebook.source_metadata->'typedPolicyRuleIds','[]'::jsonb)) item(value)),'{}'::text[]);
  for v_rule_id in select unnest(v_owner_ids) loop
    if not (v_rule_id=any(v_old_owner_ids)) then v_introduced_ids:=array_append(v_introduced_ids,v_rule_id); end if;
    select value into v_bundle
    from jsonb_array_elements(coalesce(v_rulebook.source_metadata->'typedPolicyBundles','[]'::jsonb)) item(value)
    where value->>'ownerRuleId'=v_rule_id limit 1;
    if v_bundle is null then
      v_bundle:=jsonb_build_object('ownerRuleId',v_rule_id,'consumedRuleIds',case when v_rule_id='ROOM-007' then jsonb_build_array('ROOM-007','ROOM-008') else jsonb_build_array(v_rule_id) end);
    end if;
    v_bundles:=v_bundles||jsonb_build_array(v_bundle);
  end loop;

  v_new_version:=v_rulebook.version+1;
  v_snapshot:=coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.rules r where r.studio_id=v_studio),'[]'::jsonb);
  v_source_hash:=encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  update public.rulebook_versions set status='HISTORICAL' where id=v_rulebook.id;
  insert into public.rulebook_versions(
    studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,
    rulebook_id,status,imported_at,source_hash,source_file_hash,rule_count,parent_version,
    format_version,document_type,source_metadata
  ) values(
    v_studio,v_new_version,'DWDE Rulebook v'||v_new_version,v_uid,v_actor,p_reason,
    coalesce((select array_agg(distinct value order by value) from unnest(v_changed_ids) ids(value)),'{}'::text[]),v_snapshot,
    v_rulebook.rulebook_id,'CURRENT',now(),v_source_hash,v_rulebook.source_file_hash, v_rulebook.rule_count,v_rulebook.version,
    case when v_rulebook.version=4 then '2.3' else '2.4' end,'DWDE_SITE_RULEBOOK',
    jsonb_build_object(
      'provenance',case when v_rulebook.version=4 then 'TYPED_POLICY_BUNDLE_MIGRATION' else 'TYPED_POLICY_BUNDLE_EDIT' end,
      'parentVersion',v_rulebook.version,
      'residualBaselineSourceHash',coalesce(v_rulebook.source_metadata->>'residualBaselineSourceHash',v_rulebook.source_hash),
      'previousTypedPolicyVersion',v_rulebook.version,
      'typedPolicyRuleIds',to_jsonb(v_owner_ids),
      'introducedTypedPolicyRuleIds',to_jsonb(case when v_rulebook.version=4 then v_introduced_ids else v_changed_ids end),
      'typedPolicyBundles',v_bundles,
      'hashSemantics','DATABASE_RULE_SNAPSHOT_JSONB_SHA256',
      'transition','SET-03 manager setup typed policy edit'
    )
  );

  if v_enforcement.id is not null then
    v_new_enforcement:=v_enforcement.version+1;
    update public.rule_enforcement_versions set status='HISTORICAL' where id=v_enforcement.id;
    insert into public.rule_enforcement_versions(
      studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status
    ) values(v_studio,v_new_enforcement,v_new_version,v_uid,v_actor,'Carry forward compatibility mappings; SET-03 typed policy is Rulebook-owned',v_changed_ids,v_enforcement.snapshot,'CURRENT');
  end if;
  update public.constraint_model_versions set status='HISTORICAL' where studio_id=v_studio and status='CURRENT';
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,'RULEBOOK_VERSION','RULEBOOK',v_new_version::text,p_reason,jsonb_build_object('version',v_new_version,'parentVersion',v_rulebook.version,'changedRuleIds',v_changed_ids,'typedPolicyRuleIds',v_owner_ids,'sourceHash',v_source_hash));
  if v_enforcement.id is not null then
    insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
    values(v_studio,v_uid,v_actor,'ENFORCEMENT_REBASE','RULE_ENFORCEMENT',v_new_enforcement::text,'SET-03 typed setup policy changed; compatibility mappings carried forward',jsonb_build_object('rulebookVersion',v_new_version,'enforcementVersion',v_new_enforcement,'changedRuleIds',v_changed_ids));
  end if;
  return jsonb_build_object('status','APPLIED','rulebookVersion',v_new_version,'enforcementVersion',case when v_enforcement.id is null then null else v_new_enforcement end,'changedRuleIds',v_changed_ids,'typedPolicyRuleIds',v_owner_ids);
end
$function$;
revoke all on function public.apply_setup_typed_policies_v55(jsonb,text,integer,integer,integer) from public,anon;
grant execute on function public.apply_setup_typed_policies_v55(jsonb,text,integer,integer,integer) to authenticated,service_role;

-- Room restriction review is supplemental evidence. Its fingerprint includes
-- only the current room fact and the typed room-policy slice, so unrelated
-- PlanningDataset changes do not invalidate a room's review.
create or replace function private.room_restriction_review_fingerprint_v55(
  p_rulebook_snapshot jsonb,
  p_planning_snapshot jsonb,
  p_room_id text,
  p_review_schema_version integer default 1
)
returns text
language sql
immutable
security definer
set search_path=''
as $function$
  with room as (
    select value->'features' as features
    from jsonb_array_elements(coalesce(p_planning_snapshot->'rooms','[]'::jsonb)) item(value)
    where value->>'id'=p_room_id limit 1
  ), unavailable as (
    select coalesce(jsonb_agg(value->'parameters'->'policy' order by value->>'id'),'[]'::jsonb) as policies
    from jsonb_array_elements(coalesce(p_rulebook_snapshot,'[]'::jsonb)) item(value)
    where value->'parameters'->'policy'->>'kind'='ROOM_UNAVAILABLE_WINDOWS'
      and value->'parameters'->'policy'->>'roomId'=p_room_id
  ), features as (
    select coalesce(jsonb_agg(value->'parameters'->'policy' order by value->>'id'),'[]'::jsonb) as policies
    from jsonb_array_elements(coalesce(p_rulebook_snapshot,'[]'::jsonb)) item(value)
    where value->'parameters'->'policy'->>'kind'='ROOM_REQUIRED_FEATURES'
  )
  select encode(extensions.digest(pg_catalog.convert_to(jsonb_build_object(
    'scopeKind','ROOM','entityId',p_room_id,'aspect','restrictions','reviewSchemaVersion',p_review_schema_version,
    'features',room.features,'unavailablePolicies',unavailable.policies,'requiredFeaturePolicies',features.policies
  )::text,'UTF8'),'sha256'),'hex')
  from room cross join unavailable cross join features
$function$;
revoke all on function private.room_restriction_review_fingerprint_v55(jsonb,jsonb,text,integer) from public,anon,authenticated;

create or replace function public.list_room_restriction_review_status_v55(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_current_rulebook public.rulebook_versions%rowtype;
  v_planning_version integer;
  v_planning_snapshot jsonb;
  v_room jsonb;
  v_room_id text;
  v_fingerprint text;
  v_latest public.setup_review_attestations%rowtype;
  v_has_latest boolean;
  v_has_restriction boolean;
  v_state text;
  v_history jsonb;
  v_items jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;
  select * into v_current_rulebook from public.rulebook_versions where studio_id=p_studio_id and status='CURRENT' limit 1;
  select pd.version,pd.snapshot into v_planning_version,v_planning_snapshot from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1;
  if v_current_rulebook.id is null or v_planning_version is null then raise exception 'Current Rulebook and PlanningDatasetVersion are required'; end if;

  for v_room in select value from jsonb_array_elements(coalesce(v_planning_snapshot->'rooms','[]'::jsonb)) item(value) order by value->>'name',value->>'id' loop
    v_room_id:=v_room->>'id';
    v_fingerprint:=private.room_restriction_review_fingerprint_v55(v_current_rulebook.snapshot,v_planning_snapshot,v_room_id,1);
    select exists(
      select 1 from jsonb_array_elements(coalesce(v_current_rulebook.snapshot,'[]'::jsonb)) item(value)
      where (value->'parameters'->'policy'->>'kind'='ROOM_UNAVAILABLE_WINDOWS' and value->'parameters'->'policy'->>'roomId'=v_room_id)
         or value->'parameters'->'policy'->>'kind'='ROOM_REQUIRED_FEATURES'
    ) into v_has_restriction;
    select a.* into v_latest from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind='ROOM' and a.entity_id=v_room_id and a.aspect='restrictions' and a.review_schema_version=1 order by a.created_at desc,a.id desc limit 1;
    v_has_latest:=found;
    if not v_has_latest then v_state:='NEEDS_REVIEW';
    elsif v_latest.dependency_fingerprint is distinct from v_fingerprint then v_state:='CHANGED_SINCE_REVIEW';
    elsif v_latest.outcome='REVIEWED_NO_ADDITIONAL_RESTRICTION' and v_has_restriction then v_state:='CHANGED_SINCE_REVIEW';
    elsif v_latest.outcome='REVIEWED_VALUE' and not v_has_restriction then v_state:='CHANGED_SINCE_REVIEW';
    else v_state:='REVIEWED'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'outcome',a.outcome,'reviewerUserId',a.reviewer_user_id,'reviewerLabel',a.reviewer_label,'sourcePlanningDatasetVersion',a.source_planning_dataset_version,'note',a.note,'createdAt',a.created_at) order by a.created_at desc,a.id desc),'[]'::jsonb) into v_history
    from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind='ROOM' and a.entity_id=v_room_id and a.aspect='restrictions' and a.review_schema_version=1;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('roomId',v_room_id,'roomName',coalesce(v_room->>'name',v_room_id),'state',v_state,'hasRestriction',v_has_restriction,'currentFingerprint',v_fingerprint,'rulebookVersion',v_current_rulebook.version,'planningDatasetVersion',v_planning_version,'history',v_history));
  end loop;
  return v_items;
end
$function$;
revoke all on function public.list_room_restriction_review_status_v55(uuid) from public,anon;
grant execute on function public.list_room_restriction_review_status_v55(uuid) to authenticated,service_role;

create or replace function public.attest_room_restriction_review_v55(
  p_studio_id uuid,p_room_id text,p_expected_rulebook_version integer,p_expected_planning_dataset_version integer,
  p_expected_fingerprint text,p_outcome text,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid(); v_role text; v_actor text; v_rulebook public.rulebook_versions%rowtype;
  v_planning_version integer; v_planning_snapshot jsonb; v_fingerprint text; v_review_id uuid; v_has_restriction boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select m.role into v_role from public.studio_members m where m.studio_id=p_studio_id and m.user_id=v_uid for update;
  if not found or v_role not in ('OWNER','EDITOR') then raise exception using errcode='42501',message='Editor membership required for selected workspace'; end if;
  if p_room_id is null or coalesce(btrim(p_room_id),'')='' then raise exception 'Room is required'; end if;
  if coalesce(btrim(p_expected_fingerprint),'')='' then raise exception 'Expected room-restriction fingerprint is required'; end if;
  if p_note is not null and char_length(p_note)>500 then raise exception 'Review note is limited to 500 characters'; end if;
  perform pg_advisory_xact_lock(hashtextextended('typed-setup-review:'||p_studio_id::text,0));
  select * into v_rulebook from public.rulebook_versions where studio_id=p_studio_id and status='CURRENT' for share;
  select pd.version,pd.snapshot into v_planning_version,v_planning_snapshot from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1;
  if v_rulebook.id is null or v_planning_version is null then raise exception 'Current Rulebook and PlanningDatasetVersion are required'; end if;
  if v_rulebook.version<>p_expected_rulebook_version then raise exception 'STALE_ROOM_RESTRICTION_REVIEW_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook.version; end if;
  if v_planning_version<>p_expected_planning_dataset_version then raise exception 'STALE_ROOM_RESTRICTION_REVIEW_VERSION: expected %, current %',p_expected_planning_dataset_version,v_planning_version; end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(v_planning_snapshot->'rooms','[]'::jsonb)) item(value) where value->>'id'=p_room_id) then raise exception 'ROOM_RESTRICTION_REVIEW_ROOM_NOT_ACTIVE: room is missing or archived in the current Planning Dataset'; end if;
  select exists(select 1 from jsonb_array_elements(coalesce(v_rulebook.snapshot,'[]'::jsonb)) item(value) where (value->'parameters'->'policy'->>'kind'='ROOM_UNAVAILABLE_WINDOWS' and value->'parameters'->'policy'->>'roomId'=p_room_id) or value->'parameters'->'policy'->>'kind'='ROOM_REQUIRED_FEATURES') into v_has_restriction;
  if (not v_has_restriction and p_outcome<>'REVIEWED_NO_ADDITIONAL_RESTRICTION') or (v_has_restriction and p_outcome<>'REVIEWED_VALUE') then raise exception 'ROOM_RESTRICTION_REVIEW_OUTCOME_INVALID: choose the outcome matching the current typed room policy'; end if;
  v_fingerprint:=private.room_restriction_review_fingerprint_v55(v_rulebook.snapshot,v_planning_snapshot,p_room_id,1);
  if lower(p_expected_fingerprint) is distinct from v_fingerprint then raise exception 'STALE_ROOM_RESTRICTION_REVIEW_FINGERPRINT: room restrictions changed before review commit'; end if;
  select coalesce(p.display_name,u.email,'Studio user') into v_actor from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note)
  values(p_studio_id,'ROOM',p_room_id,'restrictions',1,v_fingerprint,p_outcome,v_uid,coalesce(v_actor,'Studio user'),v_planning_version,nullif(btrim(coalesce(p_note,'')),'')) returning id into v_review_id;
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(p_studio_id,v_uid,coalesce(v_actor,'Studio user'),'SETUP_REVIEW_ATTESTED','ROOM',p_room_id,'Reviewed room restrictions for setup',jsonb_build_object('reviewId',v_review_id,'scopeKind','ROOM','aspect','restrictions','reviewSchemaVersion',1,'outcome',p_outcome,'rulebookVersion',v_rulebook.version,'planningDatasetVersion',v_planning_version));
  return jsonb_build_object('status','REVIEWED','reviewId',v_review_id,'roomId',p_room_id,'outcome',p_outcome,'currentFingerprint',v_fingerprint,'rulebookVersion',v_rulebook.version,'planningDatasetVersion',v_planning_version);
end
$function$;
revoke all on function public.attest_room_restriction_review_v55(uuid,text,integer,integer,text,text,text) from public,anon;
grant execute on function public.attest_room_restriction_review_v55(uuid,text,integer,integer,text,text,text) to authenticated,service_role;

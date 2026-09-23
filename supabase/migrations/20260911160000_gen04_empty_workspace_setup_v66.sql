-- GEN-04: give an EMPTY_WORKSPACE tenant a neutral setup-policy write path.
-- The established DWDE v55/v63 path remains unchanged and is deliberately not
-- used here: an empty tenant has no reviewed DWDE rule owners to update.

create or replace function public.apply_empty_workspace_setup_policies_v66(
  p_studio_id uuid,
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
  v_uid uuid:=auth.uid();
  v_actor text;
  v_role text;
  v_rulebook public.rulebook_versions%rowtype;
  v_enforcement public.rule_enforcement_versions%rowtype;
  v_policy_item jsonb;
  v_policy jsonb;
  v_rule_id text;
  v_expected_kind text;
  v_input_ids text[]:='{}'::text[];
  v_changed_ids text[]:='{}'::text[];
  v_owner_ids text[]:='{}'::text[];
  v_before jsonb;
  v_after jsonb;
  v_history_id uuid;
  v_snapshot jsonb;
  v_new_version integer;
  v_new_enforcement integer;
  v_source_hash text;
  v_planning_version integer;
  v_availability_prefix constant text:='SET04-TEACHER-AVAILABILITY-';
  v_qualification_prefix constant text:='SET04-TEACHER-QUALIFICATION-';
begin
  if v_uid is null then
    raise exception using errcode='42501',message='EMPTY_WORKSPACE_SETUP_AUTH_REQUIRED';
  end if;
  if p_studio_id is null then
    raise exception using errcode='22023',message='EMPTY_WORKSPACE_SETUP_STUDIO_REQUIRED';
  end if;
  if coalesce(btrim(p_reason),'')='' then
    raise exception 'Reason is required';
  end if;

  -- Lock the selected tenant membership before reading any authority. This is
  -- intentionally tenant-explicit; no current-studio inference is permitted.
  select m.role into v_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=v_uid
  for update;
  if not found or v_role not in ('OWNER','EDITOR') then
    raise exception using errcode='42501',message='Editor membership required for selected workspace';
  end if;

  select coalesce(p.display_name,u.email,'Studio user') into v_actor
  from auth.users u
  left join public.profiles p on p.id=u.id
  where u.id=v_uid;
  v_actor:=coalesce(nullif(btrim(v_actor),''),'Studio user');

  perform pg_advisory_xact_lock(hashtextextended('typed-setup:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));

  select * into v_rulebook
  from public.rulebook_versions rb
  where rb.studio_id=p_studio_id and rb.status='CURRENT'
  for update;
  if v_rulebook.id is null then
    raise exception 'SETUP_TYPED_POLICY_NO_RULEBOOK: no current RulebookVersion exists';
  end if;
  if v_rulebook.source_metadata->>'provisioning' <> 'EMPTY_WORKSPACE' then
    raise exception 'EMPTY_WORKSPACE_SETUP_NOT_APPLICABLE: selected workspace is not an empty workspace';
  end if;
  if v_rulebook.version<>p_expected_rulebook_version then
    raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook.version;
  end if;

  select * into v_enforcement
  from public.rule_enforcement_versions ev
  where ev.studio_id=p_studio_id and ev.status='CURRENT'
  limit 1
  for update;
  if coalesce(v_enforcement.version,0)<>coalesce(p_expected_enforcement_version,0) then
    raise exception 'STALE_ENFORCEMENT: expected %, current %',coalesce(p_expected_enforcement_version,0),coalesce(v_enforcement.version,0);
  end if;
  select pd.version into v_planning_version
  from public.planning_dataset_versions pd
  where pd.studio_id=p_studio_id and pd.status='CURRENT'
  order by pd.version desc limit 1;
  if v_planning_version is null then
    raise exception 'SETUP_TYPED_POLICY_NO_PLANNING_DATASET: current PlanningDatasetVersion is required';
  end if;
  if v_planning_version<>p_expected_planning_dataset_version then
    raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_planning_version;
  end if;
  if jsonb_typeof(coalesce(p_policies,'[]'::jsonb))<>'array' then
    raise exception 'SETUP_TYPED_POLICY_INVALID: policies must be an array';
  end if;

  for v_policy_item in select value from jsonb_array_elements(coalesce(p_policies,'[]'::jsonb)) item(value) loop
    if jsonb_typeof(v_policy_item)<>'object'
       or coalesce((select array_agg(key order by key) from jsonb_object_keys(v_policy_item) key),array[]::text[])<>array['policy','ruleId'] then
      raise exception 'SETUP_TYPED_POLICY_INVALID: each policy entry must contain exactly ruleId and policy';
    end if;
    v_rule_id:=nullif(btrim(v_policy_item->>'ruleId'),'');
    v_policy:=nullif(v_policy_item->'policy','null'::jsonb);
    if v_rule_id is null or v_rule_id=any(v_input_ids) then
      raise exception 'SETUP_TYPED_POLICY_DUPLICATE: each setup policy owner may be supplied once';
    end if;
    if v_rule_id not in ('OPS-001','ROOM-002','ROOM-007','ROOM-009')
       and v_rule_id not like v_availability_prefix||'%'
       and v_rule_id not like v_qualification_prefix||'%' then
      raise exception 'EMPTY_WORKSPACE_SETUP_OWNER_UNSUPPORTED: % is not a supported neutral setup policy owner',v_rule_id;
    end if;
    -- Reuse the effective typed validator. V65 updates its day domain to
    -- Sunday, while the validator retains the established stable-ID checks.
    perform private.validate_setup_typed_policy_v55(p_studio_id,v_rule_id,v_policy);
    v_input_ids:=array_append(v_input_ids,v_rule_id);
  end loop;

  -- The studio setup form submits the complete fixed setup slice. Omitted
  -- existing policies are cleared, but no DWDE owner rows are ever invented.
  foreach v_rule_id in array array['OPS-001','ROOM-002','ROOM-009']::text[] loop
    if not (v_rule_id=any(v_input_ids)) then
      select to_jsonb(r) into v_before
      from public.rules r
      where r.studio_id=p_studio_id and r.id=v_rule_id
      for update;
      if v_before is not null and v_before->'parameters' ? 'policy' then
        v_expected_kind:=case v_rule_id
          when 'OPS-001' then 'STUDIO_OPERATING_WINDOWS'
          when 'ROOM-002' then 'ROOM_UNAVAILABLE_WINDOWS'
          when 'ROOM-009' then 'ROOM_REQUIRED_FEATURES'
        end;
        if v_before->'parameters'->'policy'->>'kind'<>v_expected_kind then
          raise exception 'SETUP_TYPED_POLICY_OWNER_CONFLICT: % already owns another typed policy kind',v_rule_id;
        end if;
        insert into public.rule_history(studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed)
        values(p_studio_id,v_rule_id,v_rulebook.version+1,v_uid,v_actor,p_reason,v_before,null,false)
        returning id into v_history_id;
        update public.rules
        set parameters='{}'::jsonb,affected_entity_ids='{}'::text[],updated_at=now()
        where studio_id=p_studio_id and id=v_rule_id;
        select to_jsonb(r) into v_after from public.rules r where r.studio_id=p_studio_id and r.id=v_rule_id;
        update public.rule_history set after_rule=v_after where id=v_history_id;
        v_changed_ids:=array_append(v_changed_ids,v_rule_id);
      end if;
    end if;
  end loop;

  for v_policy_item in select value from jsonb_array_elements(coalesce(p_policies,'[]'::jsonb)) item(value) loop
    v_rule_id:=v_policy_item->>'ruleId';
    v_policy:=nullif(v_policy_item->'policy','null'::jsonb);
    select to_jsonb(r) into v_before
    from public.rules r
    where r.studio_id=p_studio_id and r.id=v_rule_id
    for update;

    if v_before is null and v_policy is null then
      -- An unrestricted generated teacher owner has no canonical row to clear.
      continue;
    end if;
    if v_before is null then
      insert into public.rules(
        studio_id,id,category,type,title,description,strength,status,verification_status,
        review_status,affected_entity_ids,parameters,exceptions,source,version_introduced,
        classification_raw,review,source_raw,enforcement_status
      ) values(
        p_studio_id,v_rule_id,'SETUP','TYPED_POLICY','Studio setup policy '||v_rule_id,
        'Manager-owned neutral setup policy for the selected workspace','HARD','ACTIVE','VERIFIED',
        'VERIFIED','{}'::text[],'{}'::jsonb,'[]'::jsonb,
        jsonb_build_object('type','MANAGER_SETUP','authority','GENERIC_SETUP_POLICY_V66'),
        v_rulebook.version,'HARD','{}'::jsonb,'{}'::jsonb,'NOT_IMPLEMENTED'
      );
      select to_jsonb(r) into v_before from public.rules r where r.studio_id=p_studio_id and r.id=v_rule_id;
    end if;

    v_expected_kind:=case
      when v_rule_id like v_availability_prefix||'%' then 'TEACHER_DAY_WINDOW'
      when v_rule_id like v_qualification_prefix||'%' then 'TEACHER_QUALIFICATION'
      when v_rule_id='OPS-001' then 'STUDIO_OPERATING_WINDOWS'
      when v_rule_id='ROOM-002' then 'ROOM_UNAVAILABLE_WINDOWS'
      when v_rule_id='ROOM-007' then 'ROOM_CAPACITY_POLICY'
      when v_rule_id='ROOM-009' then 'ROOM_REQUIRED_FEATURES'
    end;
    if v_before->'parameters' ? 'policy'
       and v_before->'parameters'->'policy'->>'kind'<>v_expected_kind then
      raise exception 'SETUP_TYPED_POLICY_OWNER_CONFLICT: % already owns another typed policy kind',v_rule_id;
    end if;
    update public.rules set
      parameters=case when v_policy is null then '{}'::jsonb else jsonb_build_object('policy',v_policy) end,
      affected_entity_ids=case
        when v_policy is null then '{}'::text[]
        when v_rule_id='ROOM-009' then coalesce((select array_agg(value order by value) from jsonb_array_elements_text(v_policy->'classIds') ids(value)),'{}'::text[])
        when v_rule_id in ('ROOM-002','ROOM-007') then array[v_policy->>'roomId']::text[] || coalesce((select array_agg(value order by value) from jsonb_array_elements_text(coalesce(v_policy->'exemptClassIds','[]'::jsonb)) ids(value)),'{}'::text[])
        when v_expected_kind='TEACHER_QUALIFICATION' then array[v_policy->>'teacherId']::text[] || coalesce((select array_agg(value order by value) from jsonb_array_elements_text(v_policy->'classIds') ids(value)),'{}'::text[])
        when v_expected_kind='TEACHER_DAY_WINDOW' then array[v_policy->>'teacherId']::text[]
        else '{}'::text[]
      end,
      updated_at=now()
    where studio_id=p_studio_id and id=v_rule_id;
    select to_jsonb(r) into v_after from public.rules r where r.studio_id=p_studio_id and r.id=v_rule_id;
    insert into public.rule_history(studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed)
    values(p_studio_id,v_rule_id,v_rulebook.version+1,v_uid,v_actor,p_reason,v_before,v_after,false);
    v_changed_ids:=array_append(v_changed_ids,v_rule_id);
  end loop;

  select coalesce(array_agg(r.id order by r.id),'{}'::text[]) into v_owner_ids
  from public.rules r
  where r.studio_id=p_studio_id and r.parameters ? 'policy';
  v_new_version:=v_rulebook.version+1;
  v_snapshot:=coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.rules r where r.studio_id=p_studio_id),'[]'::jsonb);
  v_source_hash:=encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');

  update public.rulebook_versions set status='HISTORICAL' where id=v_rulebook.id;
  insert into public.rulebook_versions(
    studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,
    rulebook_id,status,imported_at,source_hash,source_file_hash,rule_count,parent_version,
    format_version,document_type,source_metadata
  ) values(
    p_studio_id,v_new_version,'Studio Rulebook v'||v_new_version,v_uid,v_actor,p_reason,
    coalesce((select array_agg(distinct value order by value) from unnest(v_changed_ids) ids(value)),'{}'::text[]),
    v_snapshot,v_rulebook.rulebook_id,'CURRENT',now(),v_source_hash,v_rulebook.source_file_hash,
    jsonb_array_length(v_snapshot),v_rulebook.version,'1.0','STUDIO_RULEBOOK',
    jsonb_build_object(
      'provisioning','EMPTY_WORKSPACE',
      'authority','GENERIC_SETUP_POLICY_V66',
      'parentVersion',v_rulebook.version,
      'typedPolicyRuleIds',to_jsonb(v_owner_ids),
      'introducedTypedPolicyRuleIds',to_jsonb(v_changed_ids),
      'typedPolicyBundles',coalesce((select jsonb_agg(jsonb_build_object('ownerRuleId',ids.value,'consumedRuleIds',jsonb_build_array(ids.value)) order by ids.value) from unnest(v_owner_ids) ids(value)),'[]'::jsonb),
      'hashSemantics','DATABASE_RULE_SNAPSHOT_JSONB_SHA256'
    )
  );

  if v_enforcement.id is not null then
    v_new_enforcement:=v_enforcement.version+1;
    update public.rule_enforcement_versions set status='HISTORICAL' where id=v_enforcement.id;
    insert into public.rule_enforcement_versions(
      studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status
    ) values(
      p_studio_id,v_new_enforcement,v_new_version,v_uid,v_actor,
      'Carry forward neutral setup enforcement mappings',v_changed_ids,v_enforcement.snapshot,'CURRENT'
    );
  end if;
  update public.constraint_model_versions set status='HISTORICAL' where studio_id=p_studio_id and status='CURRENT';
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(p_studio_id,v_uid,v_actor,'RULEBOOK_VERSION','RULEBOOK',v_new_version::text,p_reason,
    jsonb_build_object('version',v_new_version,'parentVersion',v_rulebook.version,'changedRuleIds',v_changed_ids,'typedPolicyRuleIds',v_owner_ids,'sourceHash',v_source_hash,'authority','GENERIC_SETUP_POLICY_V66'));
  if v_enforcement.id is not null then
    insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
    values(p_studio_id,v_uid,v_actor,'ENFORCEMENT_REBASE','RULE_ENFORCEMENT',v_new_enforcement::text,
      'Neutral setup policy changed; enforcement mappings carried forward',jsonb_build_object('rulebookVersion',v_new_version,'enforcementVersion',v_new_enforcement,'changedRuleIds',v_changed_ids));
  end if;
  return jsonb_build_object('status','APPLIED','rulebookVersion',v_new_version,'enforcementVersion',case when v_enforcement.id is null then null else v_new_enforcement end,'changedRuleIds',v_changed_ids,'typedPolicyRuleIds',v_owner_ids,'authority','GENERIC_SETUP_POLICY_V66');
end
$function$;

revoke all on function public.apply_empty_workspace_setup_policies_v66(uuid,jsonb,text,integer,integer,integer) from public,anon;
grant execute on function public.apply_empty_workspace_setup_policies_v66(uuid,jsonb,text,integer,integer,integer) to authenticated,service_role;

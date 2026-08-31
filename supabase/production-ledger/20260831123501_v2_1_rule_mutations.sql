-- Exact production migration 20260831123501: v2_1_rule_mutations
create or replace function public.apply_rule_patch_v21(
  p_operation text,
  p_rule_id text,
  p_changes jsonb,
  p_reason text,
  p_expected_rulebook_version integer,
  p_ai_proposed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  ctx jsonb := private.assert_editor_context();
  v_uid uuid := (ctx->>'user_id')::uuid;
  v_studio uuid := (ctx->>'studio_id')::uuid;
  v_actor text := ctx->>'actor';
  v_current public.rulebook_versions%rowtype;
  v_new_version integer;
  v_id text := coalesce(nullif(p_rule_id,''),p_changes->>'id');
  v_before jsonb;
  v_after jsonb;
  v_raw text;
  v_normalized text;
  v_enforcement text;
  v_unknown text;
begin
  if p_operation not in ('CREATE','UPDATE','RETIRE','DISABLE','ENABLE') then raise exception 'Unsupported rule operation'; end if;
  if v_id is null or btrim(v_id)='' then raise exception 'Stable rule ID is required'; end if;
  if v_id !~ '^[A-Z0-9]+-[0-9]{3}$' then raise exception 'Stable rule ID has invalid format'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;

  select string_agg(k,',') into v_unknown
  from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) as k
  where k not in ('id','category','type','title','description','classificationRaw','strength','status','verificationStatus','reviewStatus','review','affectedEntityIds','parameters','exceptions','enforcementStatus','sourceRaw');
  if v_unknown is not null then raise exception 'Unsupported rule fields: %',v_unknown; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
  select * into v_current from public.rulebook_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if v_current.id is null then raise exception 'No current Rulebook exists'; end if;
  if v_current.version<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_current.version; end if;
  v_new_version:=v_current.version+1;
  select to_jsonb(r) into v_before from public.rules r where r.studio_id=v_studio and r.id=v_id;

  if p_operation='CREATE' then
    if v_before is not null then raise exception 'Rule % already exists',v_id; end if;
    v_raw:=coalesce(nullif(p_changes->>'classificationRaw',''),replace(p_changes->>'strength','_',' '),'MODERATE');
    v_normalized:=private.normalized_strength_for_classification(v_raw);
    v_enforcement:=coalesce(p_changes->>'enforcementStatus',case when upper(v_raw)='HARD' then 'NOT_IMPLEMENTED' else 'NOT_APPLICABLE' end);
    insert into public.rules(
      id,studio_id,category,type,title,description,strength,status,verification_status,affected_entity_ids,parameters,exceptions,
      source,version_introduced,updated_at,classification_raw,review_status,review,source_raw,enforcement_status
    ) values (
      v_id,v_studio,coalesce(p_changes->>'category','General'),nullif(p_changes->>'type',''),coalesce(p_changes->>'title','Untitled rule'),coalesce(p_changes->>'description',''),v_normalized,
      coalesce(p_changes->>'status','ACTIVE'),coalesce(p_changes->>'verificationStatus',p_changes->>'reviewStatus','UNVERIFIED'),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_changes->'affectedEntityIds','[]'::jsonb))),'{}'::text[]),
      coalesce(p_changes->'parameters','{}'::jsonb),coalesce(p_changes->'exceptions','[]'::jsonb),
      jsonb_build_object('type',case when p_ai_proposed then 'AI_PROPOSAL_APPROVED' else 'USER_EDIT' end,'note',p_reason,'parentRulebookVersion',v_current.version),
      v_new_version,now(),v_raw,coalesce(p_changes->>'reviewStatus',p_changes->>'verificationStatus','UNVERIFIED'),
      coalesce(p_changes->'review','{}'::jsonb),coalesce(p_changes->'sourceRaw','{}'::jsonb),v_enforcement
    );
  else
    if v_before is null then raise exception 'Rule % does not exist',v_id; end if;
    v_raw:=case
      when p_changes?'classificationRaw' then p_changes->>'classificationRaw'
      when p_changes?'strength' then replace(p_changes->>'strength','_',' ')
      else v_before->>'classification_raw' end;
    v_normalized:=private.normalized_strength_for_classification(v_raw);
    v_enforcement:=case
      when p_changes?'enforcementStatus' then p_changes->>'enforcementStatus'
      when (p_changes ?| array['description','classificationRaw','strength','type','parameters','affectedEntityIds','exceptions'])
        and v_before->>'enforcement_status'='IMPLEMENTED' then 'PARTIAL'
      else v_before->>'enforcement_status' end;

    update public.rules set
      category=case when p_changes?'category' then p_changes->>'category' else category end,
      type=case when p_changes?'type' then nullif(p_changes->>'type','') else type end,
      title=case when p_changes?'title' then p_changes->>'title' else title end,
      description=case when p_changes?'description' then p_changes->>'description' else description end,
      strength=v_normalized,
      classification_raw=v_raw,
      status=case
        when p_operation='RETIRE' then 'RETIRED'
        when p_operation='DISABLE' then 'DISABLED'
        when p_operation='ENABLE' then 'ACTIVE'
        when p_changes?'status' then p_changes->>'status'
        else status end,
      verification_status=case
        when p_changes?'verificationStatus' then p_changes->>'verificationStatus'
        when p_changes?'reviewStatus' then p_changes->>'reviewStatus'
        else verification_status end,
      review_status=case
        when p_changes?'reviewStatus' then p_changes->>'reviewStatus'
        when p_changes?'verificationStatus' then p_changes->>'verificationStatus'
        else review_status end,
      review=case when p_changes?'review' then p_changes->'review' else review end,
      affected_entity_ids=case
        when p_changes?'affectedEntityIds' then array(select jsonb_array_elements_text(p_changes->'affectedEntityIds'))
        else affected_entity_ids end,
      parameters=case when p_changes?'parameters' then p_changes->'parameters' else parameters end,
      exceptions=case when p_changes?'exceptions' then p_changes->'exceptions' else exceptions end,
      enforcement_status=v_enforcement,
      source_raw=case when p_changes?'sourceRaw' then p_changes->'sourceRaw' else source_raw end,
      source=jsonb_build_object('type',case when p_ai_proposed then 'AI_PROPOSAL_APPROVED' else 'USER_EDIT' end,'note',p_reason,'parentRulebookVersion',v_current.version),
      updated_at=now()
    where studio_id=v_studio and id=v_id;
  end if;

  select to_jsonb(r) into v_after from public.rules r where r.studio_id=v_studio and r.id=v_id;
  insert into public.rule_history(studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed)
    values(v_studio,v_id,v_new_version,v_uid,v_actor,p_reason,v_before,v_after,p_ai_proposed);

  update public.rulebook_versions set status='HISTORICAL' where id=v_current.id;
  insert into public.rulebook_versions(
    studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,
    rulebook_id,status,rule_count,parent_version,format_version,document_type,source_metadata
  )
  select v_studio,v_new_version,'DWDE Rulebook v'||v_new_version,v_uid,v_actor,p_reason,array[v_id],
    coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb),
    coalesce(v_current.rulebook_id,'dwde-2026-2027-master-rulebook'),'CURRENT',count(*)::integer,v_current.version,
    '2.0','DWDE_SITE_RULEBOOK',jsonb_build_object(
      'provenance',case when p_ai_proposed then 'AI_PROPOSAL_APPROVED' else 'USER_EDIT' end,
      'parentVersion',v_current.version,'parentSourceHash',v_current.source_hash)
  from public.rules r where r.studio_id=v_studio;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
    values(v_studio,v_uid,v_actor,'RULE_'||p_operation,'RULE',v_id,p_reason,
      jsonb_build_object('before',v_before,'after',v_after,'rulebookVersion',v_new_version,'aiProposed',p_ai_proposed));

  return jsonb_build_object('ruleId',v_id,'version',v_new_version,'before',v_before,'after',v_after);
end
$function$;

revoke all on function public.apply_rule_patch_v21(text,text,jsonb,text,integer,boolean) from public, anon;
grant execute on function public.apply_rule_patch_v21(text,text,jsonb,text,integer,boolean) to authenticated, service_role;

-- V2.2 human Rulebook mutation wrapper.
-- Human edits create RulebookVersion history. Machine mappings live in EnforcementVersion history.
-- Semantic changes invalidate the changed rule's machine mapping rather than silently reusing it.

create or replace function public.apply_rule_patch_v22(
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
set search_path=''
as $function$
declare
  ctx jsonb:=private.assert_editor_context();
  v_uid uuid:=(ctx->>'user_id')::uuid;
  v_studio uuid:=(ctx->>'studio_id')::uuid;
  v_actor text:=ctx->>'actor';
  v_current_enforcement public.rule_enforcement_versions%rowtype;
  v_result jsonb;
  v_rule_id text;
  v_new_rulebook integer;
  v_new_enforcement integer;
  v_snapshot jsonb;
  v_unknown text;
  v_invalidate boolean;
begin
  select string_agg(k,',') into v_unknown
  from jsonb_object_keys(coalesce(p_changes,'{}'::jsonb)) as k
  where k not in (
    'id','category','title','description','classificationRaw','strength','status',
    'verificationStatus','reviewStatus','review','sourceRaw'
  );
  if v_unknown is not null then
    raise exception 'Machine-enforcement fields are not Rulebook fields in V2.2. Unsupported Rulebook fields: %',v_unknown;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));
  select * into v_current_enforcement
  from public.rule_enforcement_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;

  v_result:=public.apply_rule_patch_v21(
    p_operation,p_rule_id,coalesce(p_changes,'{}'::jsonb),p_reason,p_expected_rulebook_version,p_ai_proposed
  );
  v_rule_id:=v_result->>'ruleId';
  v_new_rulebook:=(v_result->>'version')::integer;

  if v_current_enforcement.id is null then
    return v_result||jsonb_build_object('enforcementVersion',null,'mappingInvalidated',false);
  end if;

  v_invalidate:=
    p_operation in ('RETIRE','DISABLE','ENABLE')
    or (
      p_operation='UPDATE'
      and coalesce(p_changes,'{}'::jsonb) ?| array[
        'description','classificationRaw','strength','status','verificationStatus','reviewStatus','review'
      ]
    );

  if v_invalidate then
    select coalesce(jsonb_agg(elem order by elem->>'ruleId'),'[]'::jsonb)
    into v_snapshot
    from jsonb_array_elements(v_current_enforcement.snapshot) elem
    where elem->>'ruleId'<>v_rule_id;
  else
    v_snapshot:=v_current_enforcement.snapshot;
  end if;

  v_new_enforcement:=v_current_enforcement.version+1;
  update public.rule_enforcement_versions set status='HISTORICAL' where id=v_current_enforcement.id;
  insert into public.rule_enforcement_versions(
    studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status
  ) values(
    v_studio,v_new_enforcement,v_new_rulebook,v_uid,v_actor,
    case when v_invalidate
      then 'Rulebook v'||v_new_rulebook||' changed '||v_rule_id||'; machine mapping requires fresh review'
      else 'Carry approved enforcement mappings forward to Rulebook v'||v_new_rulebook
    end,
    case when v_invalidate then array[v_rule_id] else '{}'::text[] end,
    v_snapshot,'CURRENT'
  );

  update public.rule_enforcement_proposals
  set status='SUPERSEDED',updated_at=now(),review_reason=coalesce(review_reason,'Superseded by Rulebook v'||v_new_rulebook)
  where studio_id=v_studio and status='PROPOSED' and base_rulebook_version<>v_new_rulebook;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(
    v_studio,v_uid,v_actor,
    case when v_invalidate then 'ENFORCEMENT_INVALIDATE' else 'ENFORCEMENT_REBASE' end,
    'RULE_ENFORCEMENT',v_rule_id,
    case when v_invalidate then 'Human Rulebook change invalidated the prior machine mapping.' else 'Approved machine mappings carried forward unchanged.' end,
    jsonb_build_object(
      'rulebookVersion',v_new_rulebook,
      'fromEnforcementVersion',v_current_enforcement.version,
      'toEnforcementVersion',v_new_enforcement,
      'mappingInvalidated',v_invalidate,
      'ruleId',v_rule_id
    )
  );

  return v_result||jsonb_build_object(
    'enforcementVersion',v_new_enforcement,
    'mappingInvalidated',v_invalidate
  );
end
$function$;

revoke all on function public.apply_rule_patch_v22(text,text,jsonb,text,integer,boolean) from public,anon;
grant execute on function public.apply_rule_patch_v22(text,text,jsonb,text,integer,boolean) to authenticated,service_role;
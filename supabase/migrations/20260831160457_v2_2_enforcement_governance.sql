-- V2.2 enforcement mapping governance.
-- Proposed mappings cannot affect validation until an authenticated editor explicitly approves them.

create or replace function private.normalize_enforcement_mapping_v22(p_rule_id text,p_mapping jsonb)
returns jsonb
language plpgsql
immutable
set search_path=''
as $function$
declare
  v_type text;
  v_parameters jsonb;
  v_entities jsonb;
  v_exceptions jsonb;
  v_text text;
begin
  if p_mapping is null or jsonb_typeof(p_mapping)<>'object' then
    raise exception 'Enforcement mapping must be a JSON object';
  end if;
  if coalesce(btrim(p_rule_id),'')='' then raise exception 'Rule ID is required'; end if;

  v_type:=upper(coalesce(p_mapping->>'type',''));
  if v_type not in (
    'CLASS_DURATION','TIME_GRID','ROOM_NO_OVERLAP','TEACHER_NO_OVERLAP','STUDENT_NO_OVERLAP',
    'CLASS_FREQUENCY','EARLIEST_START','LATEST_FINISH','NO_DAY','MAX_TEACHER_GAP','MAX_STUDENT_GAP',
    'MAX_TEACHER_WORKDAYS','REQUIRED_ROOM','REQUIRED_TEACHER'
  ) then raise exception 'Unsupported enforcement mapping type: %',v_type; end if;

  v_parameters:=coalesce(p_mapping->'parameters','{}'::jsonb);
  v_entities:=coalesce(p_mapping->'affectedEntityIds','[]'::jsonb);
  v_exceptions:=coalesce(p_mapping->'exceptions','[]'::jsonb);
  if jsonb_typeof(v_parameters)<>'object' then raise exception 'parameters must be an object'; end if;
  if jsonb_typeof(v_entities)<>'array' then raise exception 'affectedEntityIds must be an array'; end if;
  if jsonb_typeof(v_exceptions)<>'array' then raise exception 'exceptions must be an array'; end if;

  if v_type in ('EARLIEST_START','LATEST_FINISH') then
    v_text:=v_parameters->>'time';
    if v_text is null or v_text !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception '% requires parameters.time in HH:MM format',v_type;
    end if;
    if v_parameters?'days' and jsonb_typeof(v_parameters->'days')<>'array' then
      raise exception 'parameters.days must be an array';
    end if;
  end if;

  if v_type='NO_DAY' then
    if jsonb_typeof(v_parameters->'days')<>'array' or jsonb_array_length(v_parameters->'days')=0 then
      raise exception 'NO_DAY requires a non-empty parameters.days array';
    end if;
  end if;

  if v_type in ('MAX_TEACHER_GAP','MAX_STUDENT_GAP') then
    v_text:=v_parameters->>'minutes';
    if v_text is null or v_text !~ '^[0-9]+$' then raise exception '% requires non-negative integer minutes',v_type; end if;
  end if;

  if v_type='MAX_TEACHER_WORKDAYS' then
    if coalesce(btrim(v_parameters->>'teacher_id'),'')='' then raise exception 'MAX_TEACHER_WORKDAYS requires teacher_id'; end if;
    v_text:=v_parameters->>'max_days';
    if v_text is null or v_text !~ '^[1-9][0-9]*$' then raise exception 'MAX_TEACHER_WORKDAYS requires max_days >= 1'; end if;
  end if;

  if v_type='REQUIRED_ROOM' then
    if coalesce(btrim(v_parameters->>'required_room_id'),'')='' then raise exception 'REQUIRED_ROOM requires required_room_id'; end if;
    if jsonb_array_length(v_entities)=0 then raise exception 'REQUIRED_ROOM requires affected class IDs'; end if;
  end if;

  if v_type='REQUIRED_TEACHER' then
    if coalesce(btrim(v_parameters->>'teacher_id'),'')='' then raise exception 'REQUIRED_TEACHER requires teacher_id'; end if;
    if jsonb_array_length(v_entities)=0 then raise exception 'REQUIRED_TEACHER requires affected class IDs'; end if;
  end if;

  return jsonb_build_object(
    'ruleId',p_rule_id,
    'type',v_type,
    'parameters',v_parameters,
    'affectedEntityIds',v_entities,
    'exceptions',v_exceptions
  );
end
$function$;

create or replace function private.assert_enforcement_mapping_entities_v22(p_studio uuid,p_mapping jsonb)
returns void
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_type text:=p_mapping->>'type';
  v_id text;
begin
  if nullif(p_mapping->'parameters'->>'teacher_id','') is not null
     and not exists(select 1 from public.teachers t where t.studio_id=p_studio and t.id=p_mapping->'parameters'->>'teacher_id') then
    raise exception 'Mapped teacher % does not exist',p_mapping->'parameters'->>'teacher_id';
  end if;
  if nullif(p_mapping->'parameters'->>'required_room_id','') is not null
     and not exists(select 1 from public.rooms r where r.studio_id=p_studio and r.id=p_mapping->'parameters'->>'required_room_id') then
    raise exception 'Mapped room % does not exist',p_mapping->'parameters'->>'required_room_id';
  end if;
  if v_type in ('REQUIRED_ROOM','REQUIRED_TEACHER') then
    for v_id in select jsonb_array_elements_text(p_mapping->'affectedEntityIds') loop
      if not exists(select 1 from public.class_definitions c where c.studio_id=p_studio and c.id=v_id) then
        raise exception 'Mapped class % does not exist',v_id;
      end if;
    end loop;
  end if;
end
$function$;

create or replace function public.propose_rule_enforcement_mapping_v22(
  p_rule_id text,
  p_mapping jsonb,
  p_rationale text,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer,
  p_source text default 'USER'
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
  v_rb integer;
  v_ev integer;
  v_mapping jsonb;
  v_id uuid;
begin
  if coalesce(btrim(p_rationale),'')='' then raise exception 'Mapping rationale is required'; end if;
  if p_source not in ('USER','AI') then raise exception 'User-created proposal source must be USER or AI'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));

  select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select version into v_ev from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT';
  if v_rb<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rb; end if;
  if v_ev<>p_expected_enforcement_version then raise exception 'STALE_ENFORCEMENT: expected %, current %',p_expected_enforcement_version,v_ev; end if;

  if not exists(
    select 1 from public.rules r
    where r.studio_id=v_studio and r.id=p_rule_id and r.status='ACTIVE'
      and coalesce(r.review_status,r.verification_status)='VERIFIED'
  ) then raise exception 'Rule % is not an active verified Rulebook rule',p_rule_id; end if;

  if exists(
    select 1 from public.rule_enforcement_proposals p
    where p.studio_id=v_studio and p.rule_id=p_rule_id and p.status='PROPOSED'
  ) then raise exception 'A pending enforcement proposal already exists for %',p_rule_id; end if;

  v_mapping:=private.normalize_enforcement_mapping_v22(p_rule_id,p_mapping);
  perform private.assert_enforcement_mapping_entities_v22(v_studio,v_mapping);

  insert into public.rule_enforcement_proposals(
    studio_id,rule_id,base_rulebook_version,base_enforcement_version,proposed_mapping,rationale,
    proposal_source,proposed_by_user_id
  ) values(v_studio,p_rule_id,v_rb,v_ev,v_mapping,p_rationale,p_source,v_uid)
  returning id into v_id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,'ENFORCEMENT_PROPOSE','RULE_ENFORCEMENT',p_rule_id,p_rationale,
    jsonb_build_object('proposalId',v_id,'baseRulebookVersion',v_rb,'baseEnforcementVersion',v_ev,'mapping',v_mapping,'source',p_source));

  return jsonb_build_object('proposalId',v_id,'ruleId',p_rule_id,'baseRulebookVersion',v_rb,'baseEnforcementVersion',v_ev,'mapping',v_mapping);
end
$function$;

create or replace function public.review_rule_enforcement_mapping_v22(
  p_proposal_id uuid,
  p_decision text,
  p_reason text,
  p_expected_rulebook_version integer,
  p_expected_enforcement_version integer
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
  v_rb integer;
  v_current public.rule_enforcement_versions%rowtype;
  v_proposal public.rule_enforcement_proposals%rowtype;
  v_mapping jsonb;
  v_snapshot jsonb;
  v_new_version integer;
begin
  if p_decision not in ('APPROVE','REJECT') then raise exception 'Decision must be APPROVE or REJECT'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Review reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));

  select version into v_rb from public.rulebook_versions where studio_id=v_studio and status='CURRENT';
  select * into v_current from public.rule_enforcement_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if v_rb<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rb; end if;
  if v_current.version<>p_expected_enforcement_version then raise exception 'STALE_ENFORCEMENT: expected %, current %',p_expected_enforcement_version,v_current.version; end if;

  select * into v_proposal
  from public.rule_enforcement_proposals
  where id=p_proposal_id and studio_id=v_studio
  for update;
  if v_proposal.id is null then raise exception 'Enforcement proposal not found'; end if;
  if v_proposal.status<>'PROPOSED' then raise exception 'Enforcement proposal is already %',v_proposal.status; end if;
  if v_proposal.base_rulebook_version<>v_rb or v_proposal.base_enforcement_version<>v_current.version then
    raise exception 'STALE_PROPOSAL: proposal is based on Rulebook v% / Enforcement v%, current is Rulebook v% / Enforcement v%',
      v_proposal.base_rulebook_version,v_proposal.base_enforcement_version,v_rb,v_current.version;
  end if;

  if p_decision='REJECT' then
    update public.rule_enforcement_proposals
    set status='REJECTED',reviewed_by_user_id=v_uid,reviewed_at=now(),review_reason=p_reason,updated_at=now()
    where id=v_proposal.id;
    insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
    values(v_studio,v_uid,v_actor,'ENFORCEMENT_REJECT','RULE_ENFORCEMENT',v_proposal.rule_id,p_reason,
      jsonb_build_object('proposalId',v_proposal.id,'enforcementVersion',v_current.version));
    return jsonb_build_object('decision','REJECTED','proposalId',v_proposal.id,'ruleId',v_proposal.rule_id,'enforcementVersion',v_current.version,'scheduleStale',false);
  end if;

  v_mapping:=private.normalize_enforcement_mapping_v22(v_proposal.rule_id,v_proposal.proposed_mapping);
  perform private.assert_enforcement_mapping_entities_v22(v_studio,v_mapping);

  select coalesce(jsonb_agg(elem order by elem->>'ruleId'),'[]'::jsonb)
  into v_snapshot
  from jsonb_array_elements(v_current.snapshot) elem
  where elem->>'ruleId'<>v_proposal.rule_id;
  v_snapshot:=v_snapshot||jsonb_build_array(v_mapping);
  v_new_version:=v_current.version+1;

  update public.rule_enforcement_versions set status='HISTORICAL' where id=v_current.id;
  insert into public.rule_enforcement_versions(
    studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status
  ) values(v_studio,v_new_version,v_rb,v_uid,v_actor,p_reason,array[v_proposal.rule_id],v_snapshot,'CURRENT');

  update public.rule_enforcement_proposals
  set status='APPROVED',reviewed_by_user_id=v_uid,reviewed_at=now(),review_reason=p_reason,updated_at=now()
  where id=v_proposal.id;
  update public.rule_enforcement_proposals
  set status='SUPERSEDED',updated_at=now()
  where studio_id=v_studio and rule_id=v_proposal.rule_id and status='PROPOSED' and id<>v_proposal.id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,'ENFORCEMENT_APPROVE','RULE_ENFORCEMENT',v_proposal.rule_id,p_reason,
    jsonb_build_object('proposalId',v_proposal.id,'fromEnforcementVersion',v_current.version,'toEnforcementVersion',v_new_version,'rulebookVersion',v_rb,'mapping',v_mapping));

  return jsonb_build_object('decision','APPROVED','proposalId',v_proposal.id,'ruleId',v_proposal.rule_id,'enforcementVersion',v_new_version,'rulebookVersion',v_rb,'scheduleStale',true,'mapping',v_mapping);
end
$function$;

revoke all on function private.normalize_enforcement_mapping_v22(text,jsonb) from public,anon,authenticated;
revoke all on function private.assert_enforcement_mapping_entities_v22(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.propose_rule_enforcement_mapping_v22(text,jsonb,text,integer,integer,text) from public,anon;
revoke all on function public.review_rule_enforcement_mapping_v22(uuid,text,text,integer,integer) from public,anon;
grant execute on function public.propose_rule_enforcement_mapping_v22(text,jsonb,text,integer,integer,text) to authenticated,service_role;
grant execute on function public.review_rule_enforcement_mapping_v22(uuid,text,text,integer,integer) to authenticated,service_role;
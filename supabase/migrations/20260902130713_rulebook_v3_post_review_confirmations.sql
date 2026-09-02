-- DWDE Rulebook V3
-- Capture two post-review policy confirmations without rewriting the canonical
-- 178-rule inventory:
--   * OPS-002: Level 5 is explicitly included in the 4:30 PM weekday exception.
--   * ADV-004: Kiran Landis keeps HARD extra/lower-level Tap; Jazz and
--     Contemporary lower-level requirements are removed; Ballet remains a priority.
--
-- V2 remains immutable history. This migration creates one atomic RulebookVersion
-- for both confirmations and carries the existing, unrelated V2.2 enforcement
-- mappings forward to the new Rulebook version. Existing schedules are intentionally
-- not rebased because their legality must be reconsidered under Rulebook V3.

do $migration$
declare
  v_studio uuid;
  v_current public.rulebook_versions%rowtype;
  v_current_enforcement public.rule_enforcement_versions%rowtype;
  v_before_ops jsonb;
  v_after_ops jsonb;
  v_before_adv jsonb;
  v_after_adv jsonb;
  v_snapshot jsonb;
  v_source_hash text;
  v_rule_count integer;
  v_new_enforcement integer;
  v_reason text := 'Post-review Cami confirmations: Level 5 weekday start exception and Kiran Landis lower-level scope';
begin
  select studio_id into v_studio
  from public.rulebook_versions
  where rulebook_id='dwde-2026-2027-master-rulebook' and status='CURRENT'
  order by version desc
  limit 1;

  if v_studio is null then
    raise exception 'DWDE current Rulebook was not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_studio::text,0));

  select * into v_current
  from public.rulebook_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;

  -- Idempotent recovery path if production already contains this exact V3.
  if v_current.version=3
     and v_current.changed_rule_ids=array['ADV-004','OPS-002']::text[]
     and v_current.source_metadata->>'provenance'='POST_REVIEW_CAMI_CONFIRMATION' then
    return;
  end if;

  if v_current.version<>2 then
    raise exception 'Expected Rulebook V2 before V3 migration; current is V%',v_current.version;
  end if;

  select count(*)::integer into v_rule_count
  from public.rules
  where studio_id=v_studio;
  if v_rule_count<>178 then
    raise exception 'Rulebook V3 migration requires exactly 178 rules; found %',v_rule_count;
  end if;

  select to_jsonb(r) into v_before_ops
  from public.rules r where r.studio_id=v_studio and r.id='OPS-002';
  select to_jsonb(r) into v_before_adv
  from public.rules r where r.studio_id=v_studio and r.id='ADV-004';

  if v_before_ops is null or v_before_adv is null then
    raise exception 'OPS-002 and ADV-004 must both exist before V3 migration';
  end if;

  if v_before_ops->>'description' <> 'Only Elementary 1, Elementary 2, Level 4B, and 4B/5 levels may start at 4:30 PM. 4:45 PM remains the preferred normal weekday start time.' then
    raise exception 'OPS-002 drifted from the reviewed V2 baseline';
  end if;
  if v_before_adv->>'description' <> 'Kiran Landis has more flexibility than the normal lower-level rule; pursue lower-level placement, but do not treat it with the same hard rigidity as the general requirement.' then
    raise exception 'ADV-004 drifted from the reviewed V2 baseline';
  end if;

  update public.rules
  set
    title='Weekday 4:30 start exceptions',
    description='Only Elementary 1, Elementary 2, Level 4B, Level 4B/5, and Level 5 may start at 4:30 PM when needed. All other regular weekday classes have a HARD 4:45 PM earliest start. 4:45 PM remains the preferred normal weekday start time for all classes, including the exception levels.',
    review=review || jsonb_build_object(
      'post_review_confirmation',jsonb_build_object(
        'confirmed',true,
        'confirmed_at','2026-09-02T04:14:37Z',
        'decision','Level 5 explicitly included in the 4:30 PM weekday exception; 4:45 PM remains preferred.'
      )
    ),
    source_raw=source_raw || jsonb_build_object(
      'post_review_confirmation',jsonb_build_object(
        'type','Cami confirmation',
        'confirmed_at','2026-09-02T04:14:37Z'
      )
    ),
    source=jsonb_build_object(
      'type','USER_EDIT',
      'note',v_reason,
      'parentRulebookVersion',2
    ),
    updated_at=now()
  where studio_id=v_studio and id='OPS-002';

  update public.rules
  set
    classification_raw='EXCEPTION',
    title='Kiran Landis lower-level exception',
    description='For Kiran Landis, the normal lower-level requirement does not apply to Jazz or Contemporary. Kiran''s extra/lower-level Tap class remains a HARD requirement. Kiran''s Ballet placement and training remain a priority, but Ballet is not treated as a HARD lower-level requirement under this exception.',
    review=review || jsonb_build_object(
      'post_review_confirmation',jsonb_build_object(
        'confirmed',true,
        'confirmed_at','2026-09-02T04:16:19Z',
        'decision','Remove lower-level Jazz and Contemporary requirements; keep extra/lower-level Tap HARD; retain Ballet as a priority.'
      )
    ),
    source_raw=source_raw || jsonb_build_object(
      'post_review_confirmation',jsonb_build_object(
        'type','Cami confirmation',
        'confirmed_at','2026-09-02T04:16:19Z'
      )
    ),
    source=jsonb_build_object(
      'type','USER_EDIT',
      'note',v_reason,
      'parentRulebookVersion',2
    ),
    updated_at=now()
  where studio_id=v_studio and id='ADV-004';

  select to_jsonb(r) into v_after_ops
  from public.rules r where r.studio_id=v_studio and r.id='OPS-002';
  select to_jsonb(r) into v_after_adv
  from public.rules r where r.studio_id=v_studio and r.id='ADV-004';

  insert into public.rule_history(
    studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed
  ) values
    (v_studio,'ADV-004',3,null,'Cami post-review confirmation',v_reason,v_before_adv,v_after_adv,false),
    (v_studio,'OPS-002',3,null,'Cami post-review confirmation',v_reason,v_before_ops,v_after_ops,false);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.id collate "C"),'[]'::jsonb),count(*)::integer
  into v_snapshot,v_rule_count
  from public.rules r
  where r.studio_id=v_studio;

  if v_rule_count<>178 or jsonb_array_length(v_snapshot)<>178 then
    raise exception 'V3 snapshot must contain exactly 178 rules';
  end if;

  v_source_hash:=encode(
    extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),
    'hex'
  );

  update public.rulebook_versions
  set status='HISTORICAL'
  where id=v_current.id;

  insert into public.rulebook_versions(
    studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,
    rulebook_id,status,imported_at,source_hash,source_file_hash,rule_count,parent_version,
    format_version,document_type,source_metadata
  ) values (
    v_studio,3,'DWDE 2026-2027 Master Rulebook v3',null,'Cami post-review confirmation',v_reason,
    array['ADV-004','OPS-002']::text[],v_snapshot,
    coalesce(v_current.rulebook_id,'dwde-2026-2027-master-rulebook'),'CURRENT',now(),v_source_hash,null,
    178,2,'2.1','DWDE_SITE_RULEBOOK',
    jsonb_build_object(
      'provenance','POST_REVIEW_CAMI_CONFIRMATION',
      'parentVersion',2,
      'parentSourceHash',v_current.source_hash,
      'hashSemantics','DATABASE_RULE_SNAPSHOT_JSONB_SHA256',
      'changedRuleIds',jsonb_build_array('ADV-004','OPS-002'),
      'confirmations',jsonb_build_array(
        jsonb_build_object(
          'ruleId','OPS-002',
          'confirmedAt','2026-09-02T04:14:37Z',
          'decision','Level 5 explicitly included in 4:30 PM weekday exception; 4:45 PM remains preferred.'
        ),
        jsonb_build_object(
          'ruleId','ADV-004',
          'confirmedAt','2026-09-02T04:16:19Z',
          'decision','Kiran: Jazz/Contemporary lower-level requirements removed; Tap remains HARD; Ballet remains priority.'
        )
      )
    )
  );

  -- The two changed rules were not among the five existing machine mappings, so
  -- carry that historical mapping snapshot forward intact solely for compatibility
  -- while the canonical ConstraintModelVersion architecture replaces it.
  select * into v_current_enforcement
  from public.rule_enforcement_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;

  if v_current_enforcement.id is not null then
    if exists (
      select 1 from jsonb_array_elements(v_current_enforcement.snapshot) elem
      where elem->>'ruleId' in ('ADV-004','OPS-002')
    ) then
      raise exception 'V3 changed a rule with an existing enforcement mapping; fresh engineering mapping is required';
    end if;

    select coalesce(max(version),0)+1 into v_new_enforcement
    from public.rule_enforcement_versions
    where studio_id=v_studio;

    update public.rule_enforcement_versions
    set status='HISTORICAL'
    where id=v_current_enforcement.id;

    insert into public.rule_enforcement_versions(
      studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status
    ) values (
      v_studio,v_new_enforcement,3,null,'Engineering policy migration',
      'Carry existing unrelated enforcement mappings forward to Rulebook v3 while Constraint IR becomes authoritative',
      '{}'::text[],v_current_enforcement.snapshot,'CURRENT'
    );

    insert into public.audit_events(
      studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
    ) values (
      v_studio,null,'Engineering policy migration','ENFORCEMENT_REBASE','RULE_ENFORCEMENT','rulebook-v3',
      'Existing unrelated enforcement mappings carried forward to Rulebook v3.',
      jsonb_build_object(
        'rulebookVersion',3,
        'fromEnforcementVersion',v_current_enforcement.version,
        'toEnforcementVersion',v_new_enforcement,
        'mappingInvalidated',false,
        'changedRuleIds',jsonb_build_array('ADV-004','OPS-002')
      )
    );
  end if;

  update public.rule_enforcement_proposals
  set
    status='SUPERSEDED',
    updated_at=now(),
    review_reason=coalesce(review_reason,'Superseded by Rulebook v3 post-review confirmations')
  where studio_id=v_studio
    and status='PROPOSED'
    and base_rulebook_version<>3;

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values
    (v_studio,null,'Cami post-review confirmation','RULE_UPDATE','RULE','ADV-004',v_reason,
      jsonb_build_object('before',v_before_adv,'after',v_after_adv,'rulebookVersion',3,'aiProposed',false)),
    (v_studio,null,'Cami post-review confirmation','RULE_UPDATE','RULE','OPS-002',v_reason,
      jsonb_build_object('before',v_before_ops,'after',v_after_ops,'rulebookVersion',3,'aiProposed',false)),
    (v_studio,null,'Engineering policy migration','RULEBOOK_VERSION','RULEBOOK','3',v_reason,
      jsonb_build_object('version',3,'parentVersion',2,'ruleCount',178,'sourceHash',v_source_hash,'changedRuleIds',jsonb_build_array('ADV-004','OPS-002')));
end
$migration$;

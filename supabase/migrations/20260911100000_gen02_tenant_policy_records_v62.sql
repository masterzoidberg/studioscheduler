-- GEN-02 / V6.2 converts the reviewed Rulebook into tenant-owned policy
-- records. The manifest is embedded in the immutable Rulebook successor's
-- source_metadata; it is not a second policy authority or a mutable overlay.

create or replace function private.tenant_rule_snapshot_v62(p_studio uuid)
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
revoke all on function private.tenant_rule_snapshot_v62(uuid) from public,anon,authenticated;

create or replace function private.tenant_policy_manifest_hash_v62(p_manifest jsonb)
returns text
language sql
immutable
security definer
set search_path=''
as $function$
  select encode(extensions.digest(pg_catalog.convert_to(p_manifest::text,'UTF8'),'sha256'),'hex')
$function$;
revoke all on function private.tenant_policy_manifest_hash_v62(jsonb) from public,anon,authenticated;

-- Typed policy parsing in the application normalizes set-like arrays and omits
-- optional empty arrays. Compare that canonical projection with the immutable
-- Rulebook policy so valid historical rows do not fail conversion merely due
-- to JSON array order, while unknown fields still fail closed. Day arrays and
-- windows use the application's Monday-to-Saturday order rather than database
-- lexical order.
create or replace function private.canonical_tenant_typed_policy_value_v62(p_value jsonb,p_field text)
returns jsonb
language plpgsql
immutable
set search_path=''
as $function$
declare
  v_result jsonb;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(item order by
      case
        when p_field in ('allowedDays','unavailableDays','closedDays') and jsonb_typeof(item)='string' then
          case item#>>'{}'
            when 'Monday' then 1 when 'Tuesday' then 2 when 'Wednesday' then 3
            when 'Thursday' then 4 when 'Friday' then 5 when 'Saturday' then 6 else 99
          end
        when p_field='windows' and jsonb_typeof(item)='object' then
          case item->>'day'
            when 'Monday' then 1 when 'Tuesday' then 2 when 'Wednesday' then 3
            when 'Thursday' then 4 when 'Friday' then 5 when 'Saturday' then 6 else 99
          end
        else 99
      end,
      case when p_field='windows' and jsonb_typeof(item)='object' then coalesce(item->>'start','') else item::text end,
      case when p_field='windows' and jsonb_typeof(item)='object' then coalesce(item->>'end','') else item::text end,
      item::text
    ),'[]'::jsonb)
    into v_result
    from (
      select distinct private.canonical_tenant_typed_policy_value_v62(value,p_field) item
      from jsonb_array_elements(p_value) element(value)
    ) values_list;
    return v_result;
  end if;
  if jsonb_typeof(p_value)='object' then
    select coalesce(jsonb_object_agg(key,item order by key),'{}'::jsonb)
    into v_result
    from (
      select key,private.canonical_tenant_typed_policy_value_v62(value,key) item
      from jsonb_each(p_value) fields(key,value)
    ) fields
    where not (key in ('unavailableDays','closedDays','exemptClassIds') and item='[]'::jsonb);
    return v_result;
  end if;
  return p_value;
end
$function$;
revoke all on function private.canonical_tenant_typed_policy_value_v62(jsonb,text) from public,anon,authenticated;

create or replace function private.canonical_tenant_typed_policy_v62(p_value jsonb)
returns jsonb
language sql
immutable
set search_path=''
as $function$
  select private.canonical_tenant_typed_policy_value_v62(p_value,null)
$function$;
revoke all on function private.canonical_tenant_typed_policy_v62(jsonb) from public,anon,authenticated;

-- The submitted manifest is authored from the source Rulebook. Its immutable
-- successor keeps the same rule snapshot/hash, so only the version fields that
-- identify the target Rulebook need to be rebased before storage.
create or replace function private.rebase_tenant_policy_manifest_v62(p_manifest jsonb,p_target_version integer)
returns jsonb
language plpgsql
immutable
set search_path=''
as $function$
declare
  v_records jsonb;
  v_result jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_set(
      elem.value,
      '{provenance,sourceRulebookVersion}',
      to_jsonb(p_target_version),
      true
    ) order by elem.value->>'ruleId' collate "C"
  ),'[]'::jsonb)
  into v_records
  from jsonb_array_elements(p_manifest->'records') elem(value);

  v_result:=jsonb_set(p_manifest,'{sourceRulebookVersion}',to_jsonb(p_target_version),true);
  v_result:=jsonb_set(v_result,'{conversion,sourceVersion}',to_jsonb(p_target_version),true);
  v_result:=jsonb_set(v_result,'{records}',v_records,true);
  return v_result;
end
$function$;
revoke all on function private.rebase_tenant_policy_manifest_v62(jsonb,integer) from public,anon,authenticated;

create or replace function private.validate_tenant_policy_manifest_v62(
  p_studio uuid,
  p_manifest jsonb,
  p_rulebook_version integer
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_rulebook public.rulebook_versions%rowtype;
  v_active_ids jsonb;
  v_record_ids jsonb;
  v_active_count integer;
  v_record jsonb;
  v_rule jsonb;
  v_provenance jsonb;
  v_rule_id text;
  v_disposition text;
  v_runtime_layer text;
  v_expected_layer text;
  v_family text;
  v_constraint jsonb;
  v_constraint_id text;
  v_precondition jsonb;
  v_precondition_id text;
  v_precondition_kind text;
  v_objective jsonb;
  v_governance jsonb;
  v_source_hash text;
begin
  select * into v_rulebook
  from public.rulebook_versions rb
  where rb.studio_id=p_studio and rb.version=p_rulebook_version
  limit 1;
  if not found then raise exception 'TENANT_POLICY_SOURCE_RULEBOOK_MISSING: source Rulebook version is unavailable'; end if;

  if p_manifest is null or jsonb_typeof(p_manifest)<>'object' then
    raise exception 'TENANT_POLICY_MANIFEST_INVALID: conversion manifest must be a JSON object';
  end if;
  if p_manifest->>'schemaVersion' is distinct from '1.0' then
    raise exception 'TENANT_POLICY_MANIFEST_SCHEMA_UNSUPPORTED: conversion manifest schemaVersion must be 1.0';
  end if;
  if coalesce((p_manifest->>'sourceRulebookVersion')::integer,0)<>p_rulebook_version
     or p_manifest->>'sourceRulebookId' is distinct from v_rulebook.rulebook_id
     or p_manifest->>'sourceHash' is distinct from v_rulebook.source_hash then
    raise exception 'TENANT_POLICY_SOURCE_MISMATCH: conversion manifest is not bound to the submitted immutable Rulebook source';
  end if;
  if p_manifest#>>'{conversion,kind}' is distinct from 'REVIEWED_RULEBOOK_TO_TENANT_RECORDS'
     or coalesce((p_manifest#>>'{conversion,sourceVersion}')::integer,0)<>p_rulebook_version then
    raise exception 'TENANT_POLICY_CONVERSION_KIND_INVALID: reviewed Rulebook conversion metadata is missing or mismatched';
  end if;

  select count(*)::integer,
         coalesce(jsonb_agg(to_jsonb(r.id) order by r.id collate "C"),'[]'::jsonb)
  into v_active_count,v_active_ids
  from public.rules r
  where r.studio_id=p_studio and r.status='ACTIVE';
  if coalesce((p_manifest#>>'{conversion,sourceRuleCount}')::integer,-1)<>v_active_count
     or p_manifest->'activeRuleIds' is distinct from v_active_ids then
    raise exception 'TENANT_POLICY_ACTIVE_RULE_SET_MISMATCH: manifest must account for exactly the current active Rulebook rule set';
  end if;
  if jsonb_typeof(p_manifest->'records')<>'array' then
    raise exception 'TENANT_POLICY_RECORD_ACCOUNTING_INCOMPLETE: manifest records must be an array';
  end if;
  select coalesce(jsonb_agg(elem.value->'ruleId' order by elem.value->>'ruleId' collate "C"),'[]'::jsonb)
  into v_record_ids
  from jsonb_array_elements(p_manifest->'records') elem(value);
  if jsonb_array_length(p_manifest->'records')<>v_active_count or v_record_ids is distinct from v_active_ids then
    raise exception 'TENANT_POLICY_RECORD_ACCOUNTING_INCOMPLETE: each active Rulebook rule must have exactly one tenant record';
  end if;

  for v_record in select value from jsonb_array_elements(p_manifest->'records') item(value) loop
    v_rule_id:=v_record->>'ruleId';
    select to_jsonb(r) into v_rule from public.rules r where r.studio_id=p_studio and r.id=v_rule_id and r.status='ACTIVE';
    v_provenance:=v_record->'provenance';
    v_disposition:=v_record->>'disposition';
    v_runtime_layer:=v_record->>'runtimeLayer';
    v_family:=v_record->>'family';
    v_expected_layer:=case
      when v_disposition='HARD_DATA_PRECONDITION' then 'READY_GATE'
      when v_disposition in ('HARD_CONSTRAINT','FIXED_ANCHOR','EXCEPTION') then 'CONSTRAINT_IR'
      when v_disposition='SOFT_OBJECTIVE' then 'OBJECTIVE_IR'
      when v_disposition='DATA_FACT' then 'DATASET'
      when v_disposition='INFORMATIONAL' then 'HUMAN_REVIEW'
      when v_disposition='NO_RUNTIME_EFFECT' then 'GOVERNANCE'
      else null end;
    if v_rule is null
       or v_rule_id is null
       or v_record->>'schemaVersion' is distinct from '1.0'
       or jsonb_typeof(v_provenance)<>'object'
       or v_provenance->>'sourceRuleId' is distinct from v_rule_id
       or coalesce((v_provenance->>'sourceRulebookVersion')::integer,0)<>p_rulebook_version
       or v_provenance->>'sourceRulebookId' is distinct from v_rulebook.rulebook_id
       or v_provenance->>'sourceHash' is distinct from v_rulebook.source_hash
       or v_provenance->>'conversion'<>'REVIEWED_RULEBOOK_TO_TENANT_RECORDS'
       or v_disposition is null
       or v_disposition not in ('HARD_CONSTRAINT','HARD_DATA_PRECONDITION','FIXED_ANCHOR','SOFT_OBJECTIVE','DATA_FACT','EXCEPTION','INFORMATIONAL','NO_RUNTIME_EFFECT')
       or v_family is null
       or v_family not in ('ADVANCED_PROGRESSION','TEACHER_POLICY','CLASS_STRUCTURE','CURRICULUM_INTEGRITY','DATA_GOVERNANCE','FIXED_ASSIGNMENT','FRIDAY_POLICY','STUDIO_OPERATIONS','OPTIMIZATION_PRIORITY','ROOM_POLICY','SEQUENCING','DANCER_POLICY','REVIEW_RESOLUTION')
       or v_runtime_layer is null
       or v_runtime_layer<>v_expected_layer
       or coalesce(btrim(v_record->>'rationale'),'')=''
       or jsonb_typeof(v_record->'constraintIds')<>'array'
       or jsonb_typeof(v_record->'preconditionIds')<>'array' then
      raise exception 'TENANT_POLICY_RECORD_INVALID: tenant record % is malformed or has invalid provenance/disposition',coalesce(v_rule_id,'(missing)');
    end if;

    if exists(select 1 from jsonb_array_elements(v_record->'constraintIds') item(value) where jsonb_typeof(item.value)<>'string' or btrim(item.value#>>'{}')='')
       or (select count(*) from jsonb_array_elements(v_record->'constraintIds') item(value))<>
          (select count(distinct item.value#>>'{}') from jsonb_array_elements(v_record->'constraintIds') item(value)) then
      raise exception 'TENANT_POLICY_RECORD_INVALID: tenant record % has malformed or duplicate Constraint IR references',v_rule_id;
    end if;
    if exists(select 1 from jsonb_array_elements(v_record->'preconditionIds') item(value) where jsonb_typeof(item.value)<>'string' or btrim(item.value#>>'{}')='')
       or (select count(*) from jsonb_array_elements(v_record->'preconditionIds') item(value))<>
          (select count(distinct item.value#>>'{}') from jsonb_array_elements(v_record->'preconditionIds') item(value)) then
      raise exception 'TENANT_POLICY_RECORD_INVALID: tenant record % has malformed or duplicate precondition references',v_rule_id;
    end if;

    -- A typed policy is a projection of the canonical Rulebook rule, never a
    -- caller-controlled alternative. Known typed kinds are checked here so an
    -- unsupported typed HARD rule cannot be smuggled through as prose.
    if (v_rule->'parameters') ? 'policy' then
      if jsonb_typeof(v_record->'typedPolicy')<>'object'
         or private.canonical_tenant_typed_policy_v62(v_record->'typedPolicy') is distinct from private.canonical_tenant_typed_policy_v62(v_rule->'parameters'->'policy')
         or v_record->'typedPolicy'->>'schemaVersion'<>'1.0'
         or v_record->'typedPolicy'->>'kind' not in ('TEACHER_DAY_WINDOW','STUDIO_OPERATING_WINDOWS','ROOM_UNAVAILABLE_WINDOWS','TEACHER_QUALIFICATION','REQUIRED_TEACHER','REQUIRED_ROOM','ROOM_CAPACITY_POLICY','ROOM_REQUIRED_FEATURES','PREFERRED_TEACHER','PREFERRED_ROOM','PREFERRED_DAY','AVOID_DAY','PARTICIPANT_NO_OVERLAP','MAX_ATTENDANCE_DAYS','DIRECT_AFTER','LINKED_ARRIVAL','PARTICIPANT_LATEST_FINISH')
         or (v_rule->'parameters'->'policy'->>'kind'='TEACHER_DAY_WINDOW' and jsonb_typeof(v_rule->'parameters'->'policy'->'allowedDays')='array' and (select count(*) from jsonb_array_elements(v_rule->'parameters'->'policy'->'allowedDays'))<>(select count(distinct value) from jsonb_array_elements(v_rule->'parameters'->'policy'->'allowedDays') item(value))) then
        raise exception 'TENANT_POLICY_TYPED_RECORD_MISMATCH: typed policy record % does not match its canonical Rulebook policy',v_rule_id;
      end if;
    elsif v_record->'typedPolicy' is distinct from 'null'::jsonb then
      raise exception 'TENANT_POLICY_TYPED_RECORD_MISMATCH: record % claims typed policy where its Rulebook has none',v_rule_id;
    end if;

    if (upper(coalesce(v_rule->>'strength',''))='HARD' or upper(coalesce(v_rule->>'classification_raw',''))='HARD')
       and v_disposition not in ('HARD_CONSTRAINT','HARD_DATA_PRECONDITION','FIXED_ANCHOR','EXCEPTION') then
      raise exception 'TENANT_POLICY_HARD_RULE_UNACCOUNTED: HARD Rulebook rule % has a non-legality tenant disposition',v_rule_id;
    end if;
    if v_disposition in ('HARD_CONSTRAINT','FIXED_ANCHOR','EXCEPTION') and jsonb_array_length(v_record->'constraintIds')=0 then
      raise exception 'TENANT_POLICY_HARD_RULE_UNACCOUNTED: HARD Rulebook rule % has no owned Constraint IR record',v_rule_id;
    end if;
    if v_disposition='HARD_DATA_PRECONDITION' and jsonb_array_length(v_record->'preconditionIds')=0 then
      raise exception 'TENANT_POLICY_PRECONDITION_UNACCOUNTED: HARD data precondition % has no typed precondition record',v_rule_id;
    end if;

    for v_constraint_id in select value#>>'{}' from jsonb_array_elements(v_record->'constraintIds') item(value) loop
      if not exists(select 1 from jsonb_array_elements(p_manifest->'constraints') item(value) where item.value->>'id'=v_constraint_id) then
        raise exception 'TENANT_POLICY_RECORD_REFERENCE_MISSING: tenant record % references missing Constraint IR %',v_rule_id,v_constraint_id;
      end if;
      if not exists(select 1 from jsonb_array_elements(p_manifest->'constraints') item(value) where item.value->>'id'=v_constraint_id and (item.value->'ruleIds') ? v_rule_id) then
        raise exception 'TENANT_POLICY_CONSTRAINT_OWNERSHIP_MISMATCH: Constraint IR % is not owned by rule %',v_constraint_id,v_rule_id;
      end if;
    end loop;
    for v_precondition_id in select value#>>'{}' from jsonb_array_elements(v_record->'preconditionIds') item(value) loop
      if not exists(select 1 from jsonb_array_elements(p_manifest->'preconditions') item(value) where item.value->>'id'=v_precondition_id) then
        raise exception 'TENANT_POLICY_RECORD_REFERENCE_MISSING: tenant record % references missing precondition %',v_rule_id,v_precondition_id;
      end if;
      if not exists(select 1 from jsonb_array_elements(p_manifest->'preconditions') item(value) where item.value->>'id'=v_precondition_id and (item.value->'ruleIds') ? v_rule_id) then
        raise exception 'TENANT_POLICY_PRECONDITION_OWNERSHIP_MISMATCH: precondition % is not owned by rule %',v_precondition_id,v_rule_id;
      end if;
    end loop;
  end loop;

  if jsonb_typeof(p_manifest->'constraints')<>'array' then raise exception 'TENANT_POLICY_CONSTRAINT_INVALID: constraints must be an array'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_manifest->'constraints') item(value)
    group by item.value->>'id' having count(*)>1
  ) then raise exception 'TENANT_POLICY_CONSTRAINT_DUPLICATE: conversion manifest contains duplicate Constraint IR IDs'; end if;
  for v_constraint in select value from jsonb_array_elements(p_manifest->'constraints') item(value) loop
    v_constraint_id:=v_constraint->>'id';
    if jsonb_typeof(v_constraint)<>'object'
       or coalesce(btrim(v_constraint_id),'')=''
       or v_constraint->>'kind' is null
       or v_constraint->>'kind' not in ('RESOURCE_NO_OVERLAP','TIME_GRID','DAY_TIME_WINDOW','NO_DAY','MAX_GAP','MAX_WORKDAYS','LATEST_FINISH_BY_LEVEL','MAX_ATTENDANCE_DAYS','REQUIRED_ROOM','REQUIRED_TEACHER','REQUIRED_LOWER_LEVEL','TEACHER_SUBJECT_DOMAIN','TEACHER_DAY_WINDOW','STUDIO_OPERATING_WINDOWS','ROOM_UNAVAILABLE_WINDOWS','TEACHER_CLASS_DOMAIN','ROOM_REQUIRED_FEATURES','DIRECTLY_AFTER','FIXED_ASSIGNMENT','ROOM_CAPACITY','RELATIONSHIP_START_WINDOW','PARTICIPANT_NO_OVERLAP','LINKED_ARRIVAL','LATEST_FINISH_BY_PARTICIPANT')
       or jsonb_typeof(v_constraint->'ruleIds')<>'array'
       or jsonb_array_length(v_constraint->'ruleIds')=0
       or exists(select 1 from jsonb_array_elements(v_constraint->'ruleIds') item(value) where jsonb_typeof(item.value)<>'string' or btrim(item.value#>>'{}')='')
       or (select count(*) from jsonb_array_elements(v_constraint->'ruleIds') item(value))<>
          (select count(distinct item.value#>>'{}') from jsonb_array_elements(v_constraint->'ruleIds') item(value))
       or jsonb_typeof(v_constraint->'selector')<>'object'
       or jsonb_typeof(v_constraint->'parameters')<>'object'
       or coalesce(btrim(v_constraint->>'explanation'),'')='' then
      raise exception 'TENANT_POLICY_CONSTRAINT_INVALID: Constraint IR % is malformed',coalesce(v_constraint_id,'(missing)');
    end if;
    if v_constraint->'selector' ?| array['classNames','teacherNames','roomNames','studentNames','studentRelation']
       or v_constraint->'parameters' ?| array['teacherName','roomName','predecessor','successor','daughterClassNames','exceptionClasses']
       or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v_constraint->'parameters'->'exceptions')='array' then v_constraint->'parameters'->'exceptions' else '[]'::jsonb end) item(value) where jsonb_typeof(item.value)='object' and item.value ? 'studentName') then
      raise exception 'TENANT_POLICY_CONSTRAINT_IDENTITY_UNRESOLVED: Constraint IR % still contains name-bound entity resolution',v_constraint_id;
    end if;
    if exists(
      select 1 from jsonb_array_elements(v_constraint->'ruleIds') item(value)
      where not exists(select 1 from public.rules r where r.studio_id=p_studio and r.status='ACTIVE' and r.id=item.value#>>'{}')
    ) then raise exception 'TENANT_POLICY_CONSTRAINT_RULE_UNKNOWN: Constraint IR % references a non-active Rulebook rule',v_constraint_id; end if;
    for v_rule_id in select value#>>'{}' from jsonb_array_elements(v_constraint->'ruleIds') item(value) loop
      if not exists(select 1 from jsonb_array_elements(p_manifest->'records') item(value) where item.value->>'ruleId'=v_rule_id and (item.value->'constraintIds') ? v_constraint_id) then
        raise exception 'TENANT_POLICY_CONSTRAINT_OWNERSHIP_MISMATCH: Constraint IR % is not declared by rule %',v_constraint_id,v_rule_id;
      end if;
      if not exists(select 1 from jsonb_array_elements(p_manifest->'records') item(value) where item.value->>'ruleId'=v_rule_id and item.value->>'disposition' in ('HARD_CONSTRAINT','FIXED_ANCHOR','EXCEPTION')) then
        raise exception 'TENANT_POLICY_CONSTRAINT_DISPOSITION_MISMATCH: Constraint IR % is owned by rule % with a non-constraint tenant disposition',v_constraint_id,v_rule_id;
      end if;
    end loop;
  end loop;

  if jsonb_typeof(p_manifest->'preconditions')<>'array' then raise exception 'TENANT_POLICY_PRECONDITION_INVALID: preconditions must be an array'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_manifest->'preconditions') item(value)
    group by item.value->>'id' having count(*)>1
  ) then raise exception 'TENANT_POLICY_PRECONDITION_DUPLICATE: conversion manifest contains duplicate precondition IDs'; end if;
  for v_precondition in select value from jsonb_array_elements(p_manifest->'preconditions') item(value) loop
    v_precondition_id:=v_precondition->>'id';
    v_precondition_kind:=v_precondition->>'kind';
    if jsonb_typeof(v_precondition)<>'object'
       or coalesce(btrim(v_precondition_id),'')=''
       or v_precondition->>'schemaVersion' is distinct from '1.0'
       or v_precondition->>'kind' is null
       or v_precondition->>'kind' not in ('CLASS_STRUCTURE','ROSTER_MEMBERSHIP','ENTITY_EXISTS','RELATIONSHIP')
       or jsonb_typeof(v_precondition->'ruleIds')<>'array'
       or jsonb_array_length(v_precondition->'ruleIds')=0
       or exists(select 1 from jsonb_array_elements(v_precondition->'ruleIds') item(value) where jsonb_typeof(item.value)<>'string' or btrim(item.value#>>'{}')='') then
      raise exception 'TENANT_POLICY_PRECONDITION_INVALID: typed precondition % is malformed',coalesce(v_precondition_id,'(missing)');
    end if;
    if (select count(*) from jsonb_array_elements(v_precondition->'ruleIds') item(value))<>
       (select count(distinct item.value#>>'{}') from jsonb_array_elements(v_precondition->'ruleIds') item(value)) then
      raise exception 'TENANT_POLICY_PRECONDITION_INVALID: typed precondition % has duplicate rule IDs',v_precondition_id;
    end if;
    if v_precondition_kind='CLASS_STRUCTURE' then
      if exists(select 1 from jsonb_object_keys(v_precondition) key where key not in ('schemaVersion','id','kind','ruleIds','classId','expectedFrequency','expectedDurations')) then
        raise exception 'TENANT_POLICY_PRECONDITION_INVALID: class structure precondition % contains unsupported fields',v_precondition_id;
      end if;
      if coalesce(btrim(v_precondition->>'classId'),'')=''
         or v_precondition->>'expectedFrequency' is null
         or v_precondition->>'expectedFrequency' !~ '^[0-9]+$'
         or (v_precondition->>'expectedFrequency')::integer<=0
         or (v_precondition ? 'expectedDurations' and (
           jsonb_typeof(v_precondition->'expectedDurations')<>'array'
           or jsonb_array_length(v_precondition->'expectedDurations')<>(v_precondition->>'expectedFrequency')::integer
           or jsonb_array_length(v_precondition->'expectedDurations')=0
           or exists(select 1 from jsonb_array_elements(v_precondition->'expectedDurations') item(value) where jsonb_typeof(item.value)<>'number' or item.value#>>'{}' !~ '^[0-9]+$' or (item.value#>>'{}')::integer<=0)
          )) then raise exception 'TENANT_POLICY_PRECONDITION_INVALID: class structure precondition % is malformed',v_precondition_id; end if;
    elsif v_precondition_kind='ROSTER_MEMBERSHIP' then
      if exists(select 1 from jsonb_object_keys(v_precondition) key where key not in ('schemaVersion','id','kind','ruleIds','classId','requiredStudentIds','relationshipKind')) then
        raise exception 'TENANT_POLICY_PRECONDITION_INVALID: roster precondition % contains unsupported fields',v_precondition_id;
      end if;
      if coalesce(btrim(v_precondition->>'classId'),'')=''
         or jsonb_typeof(v_precondition->'requiredStudentIds')<>'array'
         or jsonb_array_length(v_precondition->'requiredStudentIds')=0
         or exists(select 1 from jsonb_array_elements(v_precondition->'requiredStudentIds') item(value) where jsonb_typeof(item.value)<>'string' or btrim(item.value#>>'{}')='') then
        raise exception 'TENANT_POLICY_PRECONDITION_INVALID: roster precondition % is malformed',v_precondition_id;
      end if;
      if (select count(*) from jsonb_array_elements(v_precondition->'requiredStudentIds') item(value))<>
         (select count(distinct item.value#>>'{}') from jsonb_array_elements(v_precondition->'requiredStudentIds') item(value)) then
        raise exception 'TENANT_POLICY_PRECONDITION_INVALID: roster precondition % has duplicate student IDs',v_precondition_id;
      end if;
      if v_precondition ? 'relationshipKind' and coalesce(btrim(v_precondition->>'relationshipKind'),'')='' then
        raise exception 'TENANT_POLICY_PRECONDITION_INVALID: roster precondition % has an empty relationship label',v_precondition_id;
      end if;
    elsif v_precondition_kind='ENTITY_EXISTS' then
      if exists(select 1 from jsonb_object_keys(v_precondition) key where key not in ('schemaVersion','id','kind','ruleIds','entityType','entityIds')) then
        raise exception 'TENANT_POLICY_PRECONDITION_INVALID: entity precondition % contains unsupported fields',v_precondition_id;
      end if;
      if v_precondition->>'entityType' is null
         or v_precondition->>'entityType' not in ('CLASS','TEACHER','ROOM','STUDENT','SESSION')
         or jsonb_typeof(v_precondition->'entityIds')<>'array'
         or jsonb_array_length(v_precondition->'entityIds')=0
         or exists(select 1 from jsonb_array_elements(v_precondition->'entityIds') item(value) where jsonb_typeof(item.value)<>'string' or btrim(item.value#>>'{}')='') then
        raise exception 'TENANT_POLICY_PRECONDITION_INVALID: entity precondition % is malformed',v_precondition_id;
      end if;
      if (select count(*) from jsonb_array_elements(v_precondition->'entityIds') item(value))<>
         (select count(distinct item.value#>>'{}') from jsonb_array_elements(v_precondition->'entityIds') item(value)) then
        raise exception 'TENANT_POLICY_PRECONDITION_INVALID: entity precondition % has duplicate entity IDs',v_precondition_id;
      end if;
    elsif exists(select 1 from jsonb_object_keys(v_precondition) key where key not in ('schemaVersion','id','kind','ruleIds','relationshipKind','entityIds'))
       or coalesce(btrim(v_precondition->>'relationshipKind'),'')=''
       or jsonb_typeof(v_precondition->'entityIds')<>'array'
       or jsonb_array_length(v_precondition->'entityIds')=0
       or exists(select 1 from jsonb_array_elements(v_precondition->'entityIds') item(value) where jsonb_typeof(item.value)<>'string' or btrim(item.value#>>'{}')='') then
      raise exception 'TENANT_POLICY_PRECONDITION_INVALID: relationship precondition % is malformed',v_precondition_id;
    elsif (select count(*) from jsonb_array_elements(v_precondition->'entityIds') item(value))<>
          (select count(distinct item.value#>>'{}') from jsonb_array_elements(v_precondition->'entityIds') item(value)) then
      raise exception 'TENANT_POLICY_PRECONDITION_INVALID: relationship precondition % has duplicate entity IDs',v_precondition_id;
    end if;
    if exists(select 1 from jsonb_array_elements(v_precondition->'ruleIds') item(value) where not exists(select 1 from public.rules r where r.studio_id=p_studio and r.status='ACTIVE' and r.id=item.value#>>'{}')) then
      raise exception 'TENANT_POLICY_PRECONDITION_RULE_UNKNOWN: precondition % references a non-active Rulebook rule',v_precondition_id;
    end if;
    for v_rule_id in select value#>>'{}' from jsonb_array_elements(v_precondition->'ruleIds') item(value) loop
      if not exists(select 1 from jsonb_array_elements(p_manifest->'records') item(value) where item.value->>'ruleId'=v_rule_id and (item.value->'preconditionIds') ? v_precondition_id) then
        raise exception 'TENANT_POLICY_PRECONDITION_OWNERSHIP_MISMATCH: precondition % is not declared by rule %',v_precondition_id,v_rule_id;
      end if;
    end loop;
  end loop;

  if jsonb_typeof(p_manifest->'objectivePrioritySpine')<>'array'
     or exists(select 1 from jsonb_array_elements(p_manifest->'objectivePrioritySpine') item(value) where jsonb_typeof(item.value)<>'object' or coalesce(btrim(item.value->>'ruleId'),'')='' or not exists(select 1 from public.rules r where r.studio_id=p_studio and r.status='ACTIVE' and r.id=item.value->>'ruleId')) then
    raise exception 'TENANT_POLICY_OBJECTIVE_INVALID: objective priority records must reference active Rulebook rules';
  end if;
  if jsonb_typeof(p_manifest->'readinessRuleIds')<>'array'
     or exists(select 1 from jsonb_array_elements(p_manifest->'readinessRuleIds') item(value) where jsonb_typeof(item.value)<>'string' or not exists(select 1 from public.rules r where r.studio_id=p_studio and r.status='ACTIVE' and r.id=item.value#>>'{}')) then
    raise exception 'TENANT_POLICY_DERIVED_REFERENCE_UNKNOWN: readiness records must reference active Rulebook rules';
  end if;
  if jsonb_typeof(p_manifest->'governanceAssertions')<>'array'
     or exists(select 1 from jsonb_array_elements(p_manifest->'governanceAssertions') item(value) where jsonb_typeof(item.value)<>'object' or coalesce(btrim(item.value->>'ruleId'),'')='' or coalesce(btrim(item.value->>'family'),'')='' or coalesce(btrim(item.value->>'assertion'),'')='' or not exists(select 1 from public.rules r where r.studio_id=p_studio and r.status='ACTIVE' and r.id=item.value->>'ruleId')) then
    raise exception 'TENANT_POLICY_DERIVED_REFERENCE_UNKNOWN: governance assertions must reference active Rulebook rules';
  end if;
end
$function$;
revoke all on function private.validate_tenant_policy_manifest_v62(uuid,jsonb,integer) from public,anon,authenticated;

create or replace function private.validate_constraint_model_snapshot_v62(
  p_studio uuid,
  p_snapshot jsonb,
  p_rulebook_version integer,
  p_compiler_version text
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_rulebook public.rulebook_versions%rowtype;
  v_manifest jsonb;
  v_active_count integer;
begin
  select * into v_rulebook from public.rulebook_versions where studio_id=p_studio and version=p_rulebook_version and status='CURRENT' limit 1;
  if v_rulebook.id is null then raise exception 'TENANT_POLICY_RULEBOOK_CURRENT_MISSING: current RulebookVersion is unavailable'; end if;
  v_manifest:=v_rulebook.source_metadata->'tenantPolicyManifest';
  if v_manifest is null then
    perform private.validate_constraint_model_snapshot_v27(p_snapshot,p_rulebook_version,p_compiler_version);
    return;
  end if;
  perform private.validate_tenant_policy_manifest_v62(p_studio,v_manifest,p_rulebook_version);
  if p_compiler_version<>'dwde-ir-0.9' then raise exception 'CONSTRAINT_MODEL_COMPILER_MISMATCH: tenant Rulebook records require dwde-ir-0.9'; end if;
  if jsonb_typeof(p_snapshot)<>'object'
     or p_snapshot->>'schemaVersion'<>'1.0'
     or coalesce((p_snapshot->>'rulebookVersion')::integer,0)<>p_rulebook_version
     or p_snapshot->>'compilerVersion'<>p_compiler_version
     or jsonb_typeof(p_snapshot->'hardConstraints')<>'array'
     or jsonb_typeof(p_snapshot->'objectivePrioritySpine')<>'array'
     or jsonb_typeof(p_snapshot->'readinessRuleIds')<>'array'
     or jsonb_typeof(p_snapshot->'governanceAssertions')<>'array'
     or jsonb_typeof(p_snapshot->'uncompiledConstraintRuleIds')<>'array'
     or jsonb_array_length(p_snapshot->'uncompiledConstraintRuleIds')<>0
      or coalesce((p_snapshot->>'completeHardConstraintCompilation')::boolean,false) is not true
      or p_snapshot ? 'planningDatasetVersion' then
    raise exception 'TENANT_POLICY_CONSTRAINT_MODEL_INVALID: published model has an invalid tenant Constraint IR envelope';
  end if;
  select count(*)::integer into v_active_count from public.rules where studio_id=p_studio and status='ACTIVE';
  if coalesce((p_snapshot->>'activeRuleCount')::integer,-1)<>v_active_count then
    raise exception 'TENANT_POLICY_ACTIVE_RULE_COUNT_MISMATCH: model must account for the current tenant active-rule count';
  end if;
  if p_snapshot->'hardConstraints' is distinct from v_manifest->'constraints'
     or p_snapshot->'objectivePrioritySpine' is distinct from v_manifest->'objectivePrioritySpine'
     or p_snapshot->'readinessRuleIds' is distinct from v_manifest->'readinessRuleIds'
     or p_snapshot->'governanceAssertions' is distinct from v_manifest->'governanceAssertions' then
    raise exception 'TENANT_POLICY_CONSTRAINT_MODEL_SOURCE_MISMATCH: published Constraint IR does not equal the current tenant manifest';
  end if;
end
$function$;
revoke all on function private.validate_constraint_model_snapshot_v62(uuid,jsonb,integer,text) from public,anon,authenticated;

create or replace function public.convert_reviewed_rulebook_to_tenant_records_v62(
  p_studio_id uuid,
  p_expected_rulebook_version integer,
  p_expected_rulebook_source_hash text,
  p_manifest jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_role text;
  v_actor text;
  v_current public.rulebook_versions%rowtype;
  v_source public.rulebook_versions%rowtype;
  v_current_enforcement public.rule_enforcement_versions%rowtype;
  v_live jsonb;
  v_live_hash text;
  v_target_manifest jsonb;
  v_existing_manifest jsonb;
  v_manifest_hash text;
  v_new_version integer;
  v_new_enforcement integer;
  v_previous_model integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  select m.role into v_role from public.studio_members m where m.studio_id=p_studio_id and m.user_id=v_uid for update;
  if not found or v_role not in ('OWNER','EDITOR') then
    raise exception using errcode='42501',message='Editor membership required for selected workspace';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rulebook:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));
  select * into v_current from public.rulebook_versions where studio_id=p_studio_id and status='CURRENT' order by version desc limit 1 for update;
  if v_current.id is null then raise exception 'TENANT_POLICY_CURRENT_RULEBOOK_MISSING: no current RulebookVersion exists'; end if;
  if v_current.version<>p_expected_rulebook_version and v_current.source_metadata->'tenantPolicyManifest' is null then
    raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_current.version;
  end if;

  -- An uncertain client retry may see the immutable successor already current.
  -- It is idempotent only when the exact source version/hash and manifest match;
  -- every other stale token remains a no-write rejection.
  select * into v_source from public.rulebook_versions where studio_id=p_studio_id and version=p_expected_rulebook_version limit 1;
  if v_source.id is null then raise exception 'STALE_RULEBOOK: expected source Rulebook version is unavailable'; end if;
  if v_source.source_hash is distinct from p_expected_rulebook_source_hash then raise exception 'STALE_RULEBOOK_SOURCE: expected Rulebook source hash does not match'; end if;
  perform private.validate_tenant_policy_manifest_v62(p_studio_id,p_manifest,p_expected_rulebook_version);

  v_live:=private.tenant_rule_snapshot_v62(p_studio_id);
  if v_live is distinct from v_current.snapshot then raise exception 'TENANT_POLICY_SOURCE_DRIFT: live rules differ from the immutable current Rulebook snapshot'; end if;
  v_live_hash:=encode(extensions.digest(pg_catalog.convert_to(v_live::text,'UTF8'),'sha256'),'hex');
  if v_current.source_hash is distinct from v_live_hash then raise exception 'TENANT_POLICY_SOURCE_HASH_MISMATCH: current Rulebook source hash does not match live rules'; end if;
  if v_current.rule_count is not null and v_current.rule_count<>jsonb_array_length(v_live) then raise exception 'TENANT_POLICY_RULE_COUNT_MISMATCH: current Rulebook rule count differs from live rules'; end if;

  v_existing_manifest:=v_current.source_metadata->'tenantPolicyManifest';
  if v_existing_manifest is not null then
    v_target_manifest:=private.rebase_tenant_policy_manifest_v62(p_manifest,v_current.version);
    if v_current.source_metadata->>'provenance'='TENANT_POLICY_CONVERSION'
       and coalesce((v_current.source_metadata->>'convertedFromRulebookVersion')::integer,0)=p_expected_rulebook_version
       and v_current.source_metadata->>'convertedFromSourceHash' is not distinct from v_source.source_hash
       and v_existing_manifest is not distinct from v_target_manifest then
      return jsonb_build_object('status','ALREADY_CURRENT','alreadyCurrent',true,'rulebookVersion',v_current.version,'sourceRulebookVersion',p_expected_rulebook_version,'sourceHash',v_current.source_hash,'manifestHash',private.tenant_policy_manifest_hash_v62(v_existing_manifest),'enforcementVersion',(select version from public.rule_enforcement_versions where studio_id=p_studio_id and status='CURRENT' order by version desc limit 1),'authority','TENANT_POLICY_CONVERSION_V62');
    end if;
    raise exception 'TENANT_POLICY_ALREADY_CONVERTED: current Rulebook contains a different tenant policy manifest';
  end if;

  v_target_manifest:=private.rebase_tenant_policy_manifest_v62(p_manifest,v_current.version+1);
  v_new_version:=v_current.version+1;
  -- Validate the rebased target before changing authority. The helper reads the
  -- source version's rules; the structural rebasing is limited to immutable IDs
  -- already checked above, so no target-specific semantic can be introduced.
  if v_target_manifest->>'sourceRulebookVersion'<>v_new_version::text then raise exception 'TENANT_POLICY_TARGET_REBASE_FAILED'; end if;
  v_actor:=coalesce((select p.display_name from public.profiles p where p.id=v_uid),'Studio user');

  select * into v_current_enforcement from public.rule_enforcement_versions where studio_id=p_studio_id and status='CURRENT' order by version desc limit 1 for update;
  if v_current_enforcement.id is not null then select coalesce(max(version),0)+1 into v_new_enforcement from public.rule_enforcement_versions where studio_id=p_studio_id; end if;
  select version into v_previous_model from public.constraint_model_versions where studio_id=p_studio_id and status='CURRENT' order by version desc limit 1 for update;

  update public.rulebook_versions set status='HISTORICAL' where id=v_current.id;
  insert into public.rulebook_versions(
    studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,
    rulebook_id,status,imported_at,source_hash,source_file_hash,rule_count,parent_version,
    format_version,document_type,source_metadata
  ) values(
    p_studio_id,v_new_version,v_current.name||' tenant policy records',v_uid,v_actor,btrim(p_reason),'{}'::text[],v_current.snapshot,
    v_current.rulebook_id,'CURRENT',now(),v_current.source_hash,v_current.source_file_hash,v_current.rule_count,v_current.version,
    coalesce(v_current.format_version,'2.5'),v_current.document_type,
    coalesce(v_current.source_metadata,'{}'::jsonb)||jsonb_build_object(
      'provenance','TENANT_POLICY_CONVERSION',
      'parentVersion',v_current.version,
      'convertedFromRulebookVersion',v_current.version,
      'convertedFromSourceHash',v_current.source_hash,
      'conversionSchemaVersion',62,
      'hashSemantics','DATABASE_RULE_SNAPSHOT_JSONB_SHA256',
      'transition','Reviewed Rulebook policy converted to tenant records',
      'tenantPolicyManifest',v_target_manifest
    )
  );

  if v_current_enforcement.id is not null then
    update public.rule_enforcement_versions set status='HISTORICAL' where id=v_current_enforcement.id;
    insert into public.rule_enforcement_versions(
      studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status
    ) values(
      p_studio_id,v_new_enforcement,v_new_version,v_uid,v_actor,'Carry forward compatibility mappings; tenant Rulebook manifest is canonical','{}'::text[],v_current_enforcement.snapshot,'CURRENT'
    );
  end if;
  update public.constraint_model_versions set status='HISTORICAL' where studio_id=p_studio_id and status='CURRENT';

  v_manifest_hash:=private.tenant_policy_manifest_hash_v62(v_target_manifest);
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values
    (p_studio_id,v_uid,v_actor,'RULEBOOK_VERSION','RULEBOOK',v_new_version::text,btrim(p_reason),jsonb_build_object('version',v_new_version,'parentVersion',v_current.version,'ruleCount',v_current.rule_count,'sourceHash',v_current.source_hash,'manifestHash',v_manifest_hash,'activeRuleCount',jsonb_array_length(v_target_manifest->'activeRuleIds'),'conversion','REVIEWED_RULEBOOK_TO_TENANT_RECORDS')),
    (p_studio_id,v_uid,v_actor,'TENANT_POLICY_CONVERTED','TENANT_POLICY',v_new_version::text,btrim(p_reason),jsonb_build_object('sourceRulebookVersion',v_current.version,'targetRulebookVersion',v_new_version,'sourceHash',v_current.source_hash,'manifestHash',v_manifest_hash,'activeRuleCount',jsonb_array_length(v_target_manifest->'activeRuleIds'),'recordCount',jsonb_array_length(v_target_manifest->'records'),'authority','RULEBOOK_SOURCE_METADATA_TENANT_POLICY_MANIFEST_V62')),
    (p_studio_id,v_uid,v_actor,'CONSTRAINT_MODEL_INVALIDATED','CONSTRAINT_MODEL',coalesce(v_previous_model::text,'none'),btrim(p_reason),jsonb_build_object('previousConstraintModelVersion',v_previous_model,'newRulebookVersion',v_new_version,'reason','Tenant policy records changed the canonical Rulebook meaning'));
  if v_current_enforcement.id is not null then
    insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values(p_studio_id,v_uid,v_actor,'ENFORCEMENT_REBASE','RULE_ENFORCEMENT',v_new_enforcement::text,btrim(p_reason),jsonb_build_object('fromVersion',v_current_enforcement.version,'toVersion',v_new_enforcement,'rulebookVersion',v_new_version,'authority','RULEBOOK_SOURCE_METADATA_TENANT_POLICY_MANIFEST_V62'));
  end if;
  return jsonb_build_object('status','APPLIED','alreadyCurrent',false,'rulebookVersion',v_new_version,'sourceRulebookVersion',v_current.version,'sourceHash',v_current.source_hash,'manifestHash',v_manifest_hash,'enforcementVersion',v_new_enforcement,'invalidatedConstraintModelVersion',v_previous_model,'authority','TENANT_POLICY_CONVERSION_V62');
end
$function$;
revoke all on function public.convert_reviewed_rulebook_to_tenant_records_v62(uuid,integer,text,jsonb,text) from public,anon;
grant execute on function public.convert_reviewed_rulebook_to_tenant_records_v62(uuid,integer,text,jsonb,text) to authenticated;

-- Replace the effective publication body so current tenant Rulebooks are
-- validated against manifest-derived accounting. Missing-manifest historical
-- fixtures retain the V27/V52 178-rule compatibility contract.
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
  v_rulebook public.rulebook_versions%rowtype;
  v_current public.constraint_model_versions%rowtype;
  v_hash text;
  v_version integer;
  v_compiler text:=coalesce(p_snapshot->>'compilerVersion','');
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rulebook:'||v_studio::text,0));
  select * into v_rulebook from public.rulebook_versions where studio_id=v_studio and status='CURRENT' order by version desc limit 1 for share;
  if v_rulebook.id is null then raise exception 'No current RulebookVersion exists'; end if;
  if v_rulebook.version<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook.version; end if;
  if v_rulebook.source_metadata->'tenantPolicyManifest' is not null then
    perform private.validate_constraint_model_snapshot_v62(v_studio,p_snapshot,v_rulebook.version,v_compiler);
  else
    perform private.validate_constraint_model_snapshot_v27(p_snapshot,v_rulebook.version,v_compiler);
    if v_rulebook.version=4 then
      perform private.assert_reviewed_rulebook_v3_v36(v_studio);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||v_studio::text,0));
  v_hash:=private.constraint_model_hash_v27(p_snapshot);
  select * into v_current from public.constraint_model_versions where studio_id=v_studio and status='CURRENT' limit 1;
  if v_current.id is not null and v_current.snapshot_hash=v_hash and v_current.rulebook_version=v_rulebook.version and v_current.compiler_version=v_compiler then
    return jsonb_build_object('constraintModelVersion',v_current.version,'snapshotHash',v_hash,'rulebookVersion',v_rulebook.version,'compilerVersion',v_compiler,'alreadyCurrent',true);
  end if;
  select coalesce(max(version),0)+1 into v_version from public.constraint_model_versions where studio_id=v_studio;
  update public.constraint_model_versions set status='HISTORICAL' where studio_id=v_studio and status='CURRENT';
  insert into public.constraint_model_versions(studio_id,version,rulebook_version,compiler_version,actor_user_id,actor_label,reason,snapshot,snapshot_hash,complete_hard_constraint_compilation,status)
  values(v_studio,v_version,v_rulebook.version,v_compiler,v_uid,v_actor,p_reason,p_snapshot,v_hash,true,'CURRENT');
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values(v_studio,v_uid,v_actor,'CONSTRAINT_MODEL_PUBLISHED','CONSTRAINT_MODEL',v_version::text,p_reason,jsonb_build_object('constraintModelVersion',v_version,'snapshotHash',v_hash,'rulebookVersion',v_rulebook.version,'compilerVersion',v_compiler,'previousConstraintModelVersion',case when v_current.id is null then null else v_current.version end));
  return jsonb_build_object('constraintModelVersion',v_version,'snapshotHash',v_hash,'rulebookVersion',v_rulebook.version,'compilerVersion',v_compiler,'alreadyCurrent',false);
end
$function$;
revoke all on function public.publish_constraint_model_v30(jsonb,text,integer) from public,anon,authenticated,service_role;

-- SET-06 / governed student restrictions and scheduling relationships.
-- Student/cohort facts remain PlanningDatasetVersion truth. Only explicit
-- manager choices create typed Rulebook policy; review rows are supplemental.

create or replace function private.validate_set06_policy_v59(p_studio uuid,p_rule_id text,p_policy jsonb,p_planning jsonb)
returns void language plpgsql security definer set search_path='' as $function$
declare v_kind text; v_id text; v_suffix text; v_count integer; v_min integer; v_max integer;
begin
  if p_rule_id is null or not (
    p_rule_id like 'SET06-STUDENT-LATEST-FINISH-%'
    or p_rule_id like 'SET06-STUDENT-MAX-DAYS-%'
    or p_rule_id in ('SET06-PARTICIPANT-NO-OVERLAP','SET06-DIRECT-AFTER','SET06-LINKED-ARRIVAL')
  ) then
    raise exception 'SET06_POLICY_RULE_UNSUPPORTED: % is not a SET-06 policy owner',p_rule_id;
  end if;
  if p_policy is null then return; end if;
  if jsonb_typeof(p_policy)<>'object' or p_policy->>'schemaVersion'<>'1.0' then raise exception 'SET06_POLICY_INVALID: policy must use schemaVersion 1.0'; end if;
  v_kind:=p_policy->>'kind';
  if p_rule_id like 'SET06-STUDENT-LATEST-FINISH-%' then
    if v_kind<>'PARTICIPANT_LATEST_FINISH' or exists(select 1 from jsonb_object_keys(p_policy) k where k not in ('schemaVersion','kind','participantIds','latestFinish')) then raise exception 'SET06_POLICY_KIND_MISMATCH: latest-finish owner requires PARTICIPANT_LATEST_FINISH'; end if;
    v_suffix:=substring(p_rule_id from char_length('SET06-STUDENT-LATEST-FINISH-')+1);
    if jsonb_typeof(p_policy->'participantIds')<>'array' or jsonb_array_length(p_policy->'participantIds')<>1 or p_policy->'participantIds'->>0<>v_suffix then raise exception 'SET06_POLICY_OWNER_CONFLICT: latest-finish owner must match its participant'; end if;
    if p_policy->>'latestFinish' !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or substring(p_policy->>'latestFinish' from 4 for 2)::integer%15<>0 then raise exception 'SET06_LATEST_FINISH_INVALID: use HH:MM on the 15-minute grid'; end if;
  elsif p_rule_id like 'SET06-STUDENT-MAX-DAYS-%' then
    if v_kind<>'MAX_ATTENDANCE_DAYS' or exists(select 1 from jsonb_object_keys(p_policy) k where k not in ('schemaVersion','kind','participantIds','maxDays')) then raise exception 'SET06_POLICY_KIND_MISMATCH: maximum-days owner requires MAX_ATTENDANCE_DAYS'; end if;
    v_suffix:=substring(p_rule_id from char_length('SET06-STUDENT-MAX-DAYS-')+1);
    if jsonb_typeof(p_policy->'participantIds')<>'array' or jsonb_array_length(p_policy->'participantIds')<>1 or p_policy->'participantIds'->>0<>v_suffix then raise exception 'SET06_POLICY_OWNER_CONFLICT: maximum-days owner must match its participant'; end if;
    if jsonb_typeof(p_policy->'maxDays')<>'number' or (p_policy->>'maxDays')::integer not between 1 and 6 then raise exception 'SET06_MAX_DAYS_INVALID: maxDays must be an integer from 1 to 6'; end if;
  elsif p_rule_id='SET06-PARTICIPANT-NO-OVERLAP' then
    if v_kind<>'PARTICIPANT_NO_OVERLAP' or exists(select 1 from jsonb_object_keys(p_policy) k where k not in ('schemaVersion','kind','participantIds')) then raise exception 'SET06_POLICY_KIND_MISMATCH: no-overlap owner requires PARTICIPANT_NO_OVERLAP'; end if;
    if jsonb_typeof(p_policy->'participantIds')<>'array' or jsonb_array_length(p_policy->'participantIds')<2 then raise exception 'SET06_PARTICIPANT_GROUP_INVALID: choose at least two participants explicitly'; end if;
  elsif p_rule_id='SET06-DIRECT-AFTER' then
    if v_kind<>'DIRECT_AFTER' or exists(select 1 from jsonb_object_keys(p_policy) k where k not in ('schemaVersion','kind','predecessorSessionId','successorSessionId')) then raise exception 'SET06_POLICY_KIND_MISMATCH: direct-after owner requires DIRECT_AFTER'; end if;
    if coalesce(p_policy->>'predecessorSessionId','')='' or coalesce(p_policy->>'successorSessionId','')='' or p_policy->>'predecessorSessionId'=p_policy->>'successorSessionId' then raise exception 'SET06_DIRECT_AFTER_INVALID: choose two different ordered sessions'; end if;
    foreach v_id in array array[p_policy->>'predecessorSessionId',p_policy->>'successorSessionId'] loop
      if not exists(select 1 from jsonb_array_elements(coalesce(p_planning->'sessions','[]'::jsonb)) s(value) where s.value->>'id'=v_id) then raise exception 'SET06_SESSION_NOT_ACTIVE: direct-after endpoint % is outside the current Planning Dataset',v_id; end if;
    end loop;
  elsif p_rule_id='SET06-LINKED-ARRIVAL' then
    if v_kind<>'LINKED_ARRIVAL' or exists(select 1 from jsonb_object_keys(p_policy) k where k not in ('schemaVersion','kind','teacherId','participantId','minOffsetMinutes','maxOffsetMinutes')) then raise exception 'SET06_POLICY_KIND_MISMATCH: linked-arrival owner requires LINKED_ARRIVAL'; end if;
    if not exists(select 1 from jsonb_array_elements(coalesce(p_planning->'teachers','[]'::jsonb)) t(value) where t.value->>'id'=p_policy->>'teacherId') and not (coalesce(p_planning->'teacherIds','[]'::jsonb) ? (p_policy->>'teacherId')) then raise exception 'SET06_TEACHER_NOT_ACTIVE: linked teacher is outside the current Planning Dataset'; end if;
    if jsonb_typeof(p_policy->'minOffsetMinutes')<>'number' or jsonb_typeof(p_policy->'maxOffsetMinutes')<>'number' then raise exception 'SET06_OFFSET_INVALID: linked-arrival bounds must be integer minutes'; end if;
    v_min:=(p_policy->>'minOffsetMinutes')::integer; v_max:=(p_policy->>'maxOffsetMinutes')::integer;
    if v_min>v_max or v_min%15<>0 or v_max%15<>0 then raise exception 'SET06_OFFSET_INVALID: use an inclusive ordered interval on the 15-minute grid'; end if;
  else raise exception 'SET06_POLICY_RULE_UNSUPPORTED: % is not a SET-06 policy owner',p_rule_id;
  end if;

  if v_kind in ('PARTICIPANT_LATEST_FINISH','MAX_ATTENDANCE_DAYS','PARTICIPANT_NO_OVERLAP') then
    if jsonb_typeof(p_policy->'participantIds')<>'array' then raise exception 'SET06_PARTICIPANT_IDS_INVALID: participantIds must be an array'; end if;
    select count(*) into v_count from jsonb_array_elements_text(p_policy->'participantIds');
    if v_count<>(select count(distinct value) from jsonb_array_elements_text(p_policy->'participantIds') x(value)) then raise exception 'SET06_PARTICIPANT_IDS_INVALID: participantIds must be duplicate-free'; end if;
    for v_id in select value from jsonb_array_elements_text(p_policy->'participantIds') x(value) loop
      if not exists(select 1 from jsonb_array_elements(coalesce(p_planning->'students','[]'::jsonb)) s(value) where s.value->>'id'=v_id) then raise exception 'SET06_PARTICIPANT_NOT_ACTIVE: participant % is outside the current Planning Dataset',v_id; end if;
    end loop;
  elsif v_kind='LINKED_ARRIVAL' then
    v_id:=nullif(btrim(p_policy->>'participantId'),'');
    if v_id is null or not exists(select 1 from jsonb_array_elements(coalesce(p_planning->'students','[]'::jsonb)) s(value) where s.value->>'id'=v_id) then raise exception 'SET06_PARTICIPANT_NOT_ACTIVE: linked participant is outside the current Planning Dataset'; end if;
  end if;
end $function$;
revoke all on function private.validate_set06_policy_v59(uuid,text,jsonb,jsonb) from public,anon,authenticated;

create or replace function public.apply_set06_policies_v59(p_studio_id uuid,p_policies jsonb,p_reason text,p_expected_rulebook_version integer,p_expected_enforcement_version integer,p_expected_planning_dataset_version integer)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_uid uuid:=auth.uid(); v_role text; v_actor text; v_rulebook public.rulebook_versions%rowtype; v_enforcement public.rule_enforcement_versions%rowtype; v_planning public.planning_dataset_versions%rowtype;
  v_item jsonb; v_policy jsonb; v_rule_id text; v_before jsonb; v_after jsonb; v_changed text[]:='{}'; v_seen text[]:='{}'; v_owners text[]:='{}'; v_old_owners text[]:='{}'; v_introduced text[]:='{}';
  v_bundle jsonb; v_bundles jsonb:='[]'; v_snapshot jsonb; v_new_version integer; v_new_enforcement integer; v_hash text; v_ids text[]; v_title text; v_category text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_studio_id is null or coalesce(btrim(p_reason),'')='' then raise exception 'Studio and reason are required'; end if;
  select m.role into v_role from public.studio_members m where m.studio_id=p_studio_id and m.user_id=v_uid for update;
  if not found or v_role not in ('OWNER','EDITOR') then raise exception using errcode='42501',message='Editor membership required for selected workspace'; end if;
  select coalesce(p.display_name,u.email,'Studio user') into v_actor from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  perform pg_advisory_xact_lock(hashtextextended('typed-setup:'||p_studio_id::text,0)); perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  select * into v_rulebook from public.rulebook_versions where studio_id=p_studio_id and status='CURRENT' for update;
  select * into v_enforcement from public.rule_enforcement_versions where studio_id=p_studio_id and status='CURRENT' limit 1 for update;
  select * into v_planning from public.planning_dataset_versions where studio_id=p_studio_id and status='CURRENT' order by version desc limit 1 for update;
  if v_rulebook.id is null or v_planning.id is null then raise exception 'Current RulebookVersion and PlanningDatasetVersion are required'; end if;
  if v_rulebook.version<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook.version; end if;
  if coalesce(v_enforcement.version,0)<>coalesce(p_expected_enforcement_version,0) then raise exception 'STALE_ENFORCEMENT: expected %, current %',coalesce(p_expected_enforcement_version,0),coalesce(v_enforcement.version,0); end if;
  if v_planning.version<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_planning.version; end if;
  if jsonb_typeof(coalesce(p_policies,'[]'::jsonb))<>'array' then raise exception 'SET06_POLICY_INVALID: policies must be an array'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_policies,'[]'::jsonb)) x(value) loop
    if jsonb_typeof(v_item)<>'object' or coalesce((select array_agg(key order by key) from jsonb_object_keys(v_item) key),'{}')<>array['policy','ruleId']::text[] then raise exception 'SET06_POLICY_INVALID: each entry must contain exactly ruleId and policy'; end if;
    v_rule_id:=nullif(btrim(v_item->>'ruleId'),''); v_policy:=nullif(v_item->'policy','null'::jsonb);
    if v_rule_id is null or v_rule_id=any(v_seen) then raise exception 'SET06_POLICY_DUPLICATE: each owner may be supplied once'; end if;
    perform private.validate_set06_policy_v59(p_studio_id,v_rule_id,v_policy,v_planning.snapshot); v_seen:=array_append(v_seen,v_rule_id);
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_policies,'[]'::jsonb)) x(value) loop
    v_rule_id:=v_item->>'ruleId'; v_policy:=nullif(v_item->'policy','null'::jsonb);
    select to_jsonb(r) into v_before from public.rules r where r.studio_id=p_studio_id and r.id=v_rule_id for update;
    if v_before is null and v_policy is null then continue; end if;
    if v_before is null then
      v_category:=case when v_rule_id like 'SET06-STUDENT-%' then 'STUDENT_POLICY' else 'RELATIONSHIP_POLICY' end;
      v_title:=case v_policy->>'kind' when 'PARTICIPANT_LATEST_FINISH' then 'Student latest finish' when 'MAX_ATTENDANCE_DAYS' then 'Student maximum attendance days' when 'PARTICIPANT_NO_OVERLAP' then 'Participant group cannot overlap' when 'DIRECT_AFTER' then 'Session must happen directly after' else 'Linked arrival and attendance' end;
      insert into public.rules(id,studio_id,category,type,title,description,strength,status,verification_status,review_status,affected_entity_ids,parameters,exceptions,source,version_introduced,classification_raw,review,source_raw,enforcement_status)
      values(v_rule_id,p_studio_id,v_category,'SETUP_TYPED_POLICY',v_title,'SET-06 manager-owned policy with explicit stable IDs','HARD','ACTIVE','VERIFIED','VERIFIED','{}','{}','[]',jsonb_build_object('type','SETUP','task','SET-06'),v_rulebook.version,'HARD','{}','{}','IMPLEMENTED');
      select to_jsonb(r) into v_before from public.rules r where r.studio_id=p_studio_id and r.id=v_rule_id;
    elsif v_before->'parameters' ? 'policy' and v_policy is not null and v_before#>>'{parameters,policy,kind}' is distinct from v_policy->>'kind' then raise exception 'SET06_POLICY_OWNER_CONFLICT: owner already contains another policy kind'; end if;
    v_ids:=case when v_policy is null then '{}'::text[] when v_policy ? 'participantIds' then array(select value from jsonb_array_elements_text(v_policy->'participantIds') x(value)) when v_policy->>'kind'='DIRECT_AFTER' then array[v_policy->>'predecessorSessionId',v_policy->>'successorSessionId'] when v_policy->>'kind'='LINKED_ARRIVAL' then array[v_policy->>'teacherId',v_policy->>'participantId'] else '{}'::text[] end;
    update public.rules set parameters=case when v_policy is null then '{}' else jsonb_build_object('policy',v_policy) end,affected_entity_ids=v_ids,status=case when v_policy is null then 'DISABLED' else 'ACTIVE' end,updated_at=now() where studio_id=p_studio_id and id=v_rule_id;
    select to_jsonb(r) into v_after from public.rules r where r.studio_id=p_studio_id and r.id=v_rule_id;
    if v_before is distinct from v_after then insert into public.rule_history(studio_id,rule_id,rulebook_version,actor_user_id,actor_label,reason,before_rule,after_rule,ai_proposed) values(p_studio_id,v_rule_id,v_rulebook.version+1,v_uid,coalesce(v_actor,'Studio user'),p_reason,v_before,v_after,false); v_changed:=array_append(v_changed,v_rule_id); end if;
  end loop;
  if exists(with recursive edges as (select r.parameters#>>'{policy,predecessorSessionId}' source_id,r.parameters#>>'{policy,successorSessionId}' target_id from public.rules r where r.studio_id=p_studio_id and r.status='ACTIVE' and r.strength='HARD' and r.parameters#>>'{policy,kind}'='DIRECT_AFTER'),walk(origin,current_id) as (select source_id,target_id from edges union select w.origin,e.target_id from walk w join edges e on e.source_id=w.current_id) select 1 from walk where origin=current_id) then raise exception 'SET06_DIRECT_AFTER_CYCLE: direct-after relationships cannot contain a cycle or reversed edge'; end if;
  if cardinality(v_changed)=0 then return jsonb_build_object('status','UNCHANGED','rulebookVersion',v_rulebook.version,'enforcementVersion',coalesce(v_enforcement.version,0),'changedRuleIds','[]'::jsonb); end if;
  select coalesce(array_agg(id order by id),'{}') into v_owners from public.rules where studio_id=p_studio_id and parameters ? 'policy';
  v_old_owners:=coalesce((select array_agg(value #>> '{}' order by value #>> '{}') from jsonb_array_elements(coalesce(v_rulebook.source_metadata->'typedPolicyRuleIds','[]')) x(value)),'{}');
  for v_rule_id in select unnest(v_owners) loop if not v_rule_id=any(v_old_owners) then v_introduced:=array_append(v_introduced,v_rule_id); end if; select value into v_bundle from jsonb_array_elements(coalesce(v_rulebook.source_metadata->'typedPolicyBundles','[]')) x(value) where value->>'ownerRuleId'=v_rule_id limit 1; if v_bundle is null then v_bundle:=jsonb_build_object('ownerRuleId',v_rule_id,'consumedRuleIds',jsonb_build_array(v_rule_id)); end if; v_bundles:=v_bundles||jsonb_build_array(v_bundle); end loop;
  v_new_version:=v_rulebook.version+1; v_snapshot:=coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.rules r where r.studio_id=p_studio_id),'[]'); v_hash:=encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  update public.rulebook_versions set status='HISTORICAL' where id=v_rulebook.id;
  insert into public.rulebook_versions(studio_id,version,name,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,rulebook_id,status,imported_at,source_hash,source_file_hash,rule_count,parent_version,format_version,document_type,source_metadata) values(p_studio_id,v_new_version,'DWDE Rulebook v'||v_new_version,v_uid,coalesce(v_actor,'Studio user'),p_reason,v_changed,v_snapshot,v_rulebook.rulebook_id,'CURRENT',now(),v_hash,v_rulebook.source_file_hash,v_rulebook.rule_count,v_rulebook.version,'2.4','DWDE_SITE_RULEBOOK',jsonb_build_object('provenance','TYPED_POLICY_BUNDLE_EDIT','parentVersion',v_rulebook.version,'residualBaselineSourceHash',coalesce(v_rulebook.source_metadata->>'residualBaselineSourceHash',v_rulebook.source_hash),'previousTypedPolicyVersion',v_rulebook.version,'typedPolicyRuleIds',to_jsonb(v_owners),'introducedTypedPolicyRuleIds',to_jsonb(v_introduced),'typedPolicyBundles',v_bundles,'hashSemantics','DATABASE_RULE_SNAPSHOT_JSONB_SHA256','transition','SET-06 student relationship policy edit'));
  if v_enforcement.id is not null then v_new_enforcement:=v_enforcement.version+1; update public.rule_enforcement_versions set status='HISTORICAL' where id=v_enforcement.id; insert into public.rule_enforcement_versions(studio_id,version,rulebook_version,actor_user_id,actor_label,reason,changed_rule_ids,snapshot,status) values(p_studio_id,v_new_enforcement,v_new_version,v_uid,coalesce(v_actor,'Studio user'),'Carry forward compatibility mappings; SET-06 typed policy is Rulebook-owned',v_changed,v_enforcement.snapshot,'CURRENT'); end if;
  update public.constraint_model_versions set status='HISTORICAL' where studio_id=p_studio_id and status='CURRENT';
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload) values(p_studio_id,v_uid,coalesce(v_actor,'Studio user'),'RULEBOOK_VERSION','RULEBOOK',v_new_version::text,p_reason,jsonb_build_object('version',v_new_version,'parentVersion',v_rulebook.version,'changedRuleIds',v_changed,'typedPolicyRuleIds',v_owners,'sourceHash',v_hash));
  return jsonb_build_object('status','APPLIED','rulebookVersion',v_new_version,'enforcementVersion',case when v_enforcement.id is null then null else v_new_enforcement end,'changedRuleIds',v_changed);
end $function$;
revoke all on function public.apply_set06_policies_v59(uuid,jsonb,text,integer,integer,integer) from public,anon;
grant execute on function public.apply_set06_policies_v59(uuid,jsonb,text,integer,integer,integer) to authenticated,service_role;

-- Keep the existing reviewed-rulebook assertion authoritative while admitting
-- only the bounded SET-06 generated owners. Fail migration if the expected
-- effective predecessor definition is not present.
do $block$
declare v_definition text; v_updated text; v_marker text:='if v_owner like ''SET04-TEACHER-AVAILABILITY-%'' or v_owner like ''SET04-TEACHER-QUALIFICATION-%'' or v_owner like ''SET05-CLASS-REQUIRED-TEACHER-%'' or v_owner like ''SET05-CLASS-PREFERRED-TEACHER-%'' or v_owner like ''SET05-CLASS-REQUIRED-ROOM-%'' or v_owner like ''SET05-CLASS-PREFERRED-ROOM-%'' then continue; end if;';
begin
  select pg_get_functiondef('private.assert_reviewed_rulebook_v3_v36(uuid)'::regprocedure) into v_definition;
  if position(v_marker in v_definition)=0 then raise exception 'SET06_ASSERTION_PREDECESSOR_MISMATCH: reviewed Rulebook assertion changed unexpectedly'; end if;
  v_updated:=replace(v_definition,v_marker,replace(v_marker,' then continue; end if;',' or v_owner like ''SET06-%'' then continue; end if;'));
  execute v_updated;
end $block$;

create or replace function private.set06_review_value_v59(p_studio uuid,p_scope text,p_entity text,p_aspect text,p_planning jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_value jsonb;
begin
  if p_scope='STUDENT' and not exists(select 1 from jsonb_array_elements(coalesce(p_planning->'students','[]'::jsonb)) s(value) where s.value->>'id'=p_entity) then return null; end if;
  if p_scope='STUDENT' and p_aspect='restrictions' then
    select jsonb_build_object('participantId',p_entity,'rosteredClassIds',coalesce((select jsonb_agg(c.value->>'id' order by c.value->>'id') from jsonb_array_elements(coalesce(p_planning->'classes','[]')) c(value) where coalesce(c.value->'rosterStudentIds','[]') ? p_entity),'[]'),'policies',coalesce((select jsonb_agg(jsonb_build_object('ruleId',r.id,'policy',r.parameters->'policy') order by r.id) from public.rules r where r.studio_id=p_studio and r.status='ACTIVE' and r.parameters#>>'{policy,kind}' in ('PARTICIPANT_LATEST_FINISH','MAX_ATTENDANCE_DAYS') and r.parameters->'policy'->'participantIds' ? p_entity),'[]')) into v_value;
  elsif p_scope='RULE' and p_aspect='interpretation' then
    select jsonb_build_object('ruleId',r.id,'policy',r.parameters->'policy','affectedEntityIds',to_jsonb(r.affected_entity_ids)) into v_value from public.rules r where r.studio_id=p_studio and r.id=p_entity and r.status='ACTIVE' and r.parameters#>>'{policy,kind}' in ('PARTICIPANT_NO_OVERLAP','DIRECT_AFTER','LINKED_ARRIVAL');
  else raise exception 'SET06_REVIEW_SCOPE_INVALID: unsupported review slice'; end if;
  return v_value;
end $function$;
revoke all on function private.set06_review_value_v59(uuid,text,text,text,jsonb) from public,anon,authenticated;

create or replace function private.set06_review_fingerprint_v59(p_studio uuid,p_scope text,p_entity text,p_aspect text,p_planning jsonb)
returns text language sql stable security definer set search_path='' as $function$ select encode(extensions.digest(pg_catalog.convert_to(jsonb_build_object('schema',1,'scope',p_scope,'entityId',p_entity,'aspect',p_aspect,'value',private.set06_review_value_v59(p_studio,p_scope,p_entity,p_aspect,p_planning))::text,'UTF8'),'sha256'),'hex') $function$;
revoke all on function private.set06_review_fingerprint_v59(uuid,text,text,text,jsonb) from public,anon,authenticated;

create or replace function public.list_set06_review_status_v59(p_studio_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_uid uuid:=auth.uid(); v_role text; v_planning public.planning_dataset_versions%rowtype; v_rulebook integer; v_item jsonb; v_entity text; v_scope text; v_aspect text; v_label text; v_value jsonb; v_fp text; v_latest public.setup_review_attestations%rowtype; v_rows jsonb:='[]'; v_state text; v_history jsonb;
begin
  if v_uid is null then raise exception 'Authentication required'; end if; select role into v_role from public.studio_members where studio_id=p_studio_id and user_id=v_uid; if not found then raise exception using errcode='42501',message='Membership required for selected workspace'; end if;
  select * into v_planning from public.planning_dataset_versions where studio_id=p_studio_id and status='CURRENT' order by version desc limit 1; select version into v_rulebook from public.rulebook_versions where studio_id=p_studio_id and status='CURRENT'; if v_planning.id is null or v_rulebook is null then raise exception 'Current planning and Rulebook versions are required'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(v_planning.snapshot->'students','[]')) x(value) loop
    v_scope:='STUDENT'; v_entity:=v_item->>'id'; v_aspect:='restrictions'; v_label:=coalesce(v_item->>'name',v_entity); v_value:=private.set06_review_value_v59(p_studio_id,v_scope,v_entity,v_aspect,v_planning.snapshot); v_fp:=private.set06_review_fingerprint_v59(p_studio_id,v_scope,v_entity,v_aspect,v_planning.snapshot);
    select * into v_latest from public.setup_review_attestations where studio_id=p_studio_id and scope_kind=v_scope and entity_id=v_entity and aspect=v_aspect and review_schema_version=1 order by created_at desc,id desc limit 1; v_state:=case when v_latest.id is null then 'NEEDS_REVIEW' when v_latest.outcome='NEEDS_REVIEW' then 'NEEDS_REVIEW' when v_latest.dependency_fingerprint<>v_fp then 'CHANGED_SINCE_REVIEW' else v_latest.outcome end;
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'outcome',a.outcome,'reviewerLabel',a.reviewer_label,'note',a.note,'createdAt',a.created_at) order by a.created_at desc,a.id desc),'[]') into v_history from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind=v_scope and a.entity_id=v_entity and a.aspect=v_aspect and a.review_schema_version=1;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('scopeKind',v_scope,'entityId',v_entity,'label',v_label,'aspect',v_aspect,'state',v_state,'currentFingerprint',v_fp,'value',v_value,'rulebookVersion',v_rulebook,'planningDatasetVersion',v_planning.version,'history',v_history));
  end loop;
  for v_entity,v_label in select r.id,r.title from public.rules r where r.studio_id=p_studio_id and r.status='ACTIVE' and r.parameters#>>'{policy,kind}' in ('PARTICIPANT_NO_OVERLAP','DIRECT_AFTER','LINKED_ARRIVAL') order by r.id loop
    v_scope:='RULE'; v_aspect:='interpretation'; v_value:=private.set06_review_value_v59(p_studio_id,v_scope,v_entity,v_aspect,v_planning.snapshot); v_fp:=private.set06_review_fingerprint_v59(p_studio_id,v_scope,v_entity,v_aspect,v_planning.snapshot);
    select * into v_latest from public.setup_review_attestations where studio_id=p_studio_id and scope_kind=v_scope and entity_id=v_entity and aspect=v_aspect and review_schema_version=1 order by created_at desc,id desc limit 1; v_state:=case when v_latest.id is null then 'NEEDS_REVIEW' when v_latest.outcome='NEEDS_REVIEW' then 'NEEDS_REVIEW' when v_latest.dependency_fingerprint<>v_fp then 'CHANGED_SINCE_REVIEW' else v_latest.outcome end;
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'outcome',a.outcome,'reviewerLabel',a.reviewer_label,'note',a.note,'createdAt',a.created_at) order by a.created_at desc,a.id desc),'[]') into v_history from public.setup_review_attestations a where a.studio_id=p_studio_id and a.scope_kind=v_scope and a.entity_id=v_entity and a.aspect=v_aspect and a.review_schema_version=1;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('scopeKind',v_scope,'entityId',v_entity,'label',v_label,'aspect',v_aspect,'state',v_state,'currentFingerprint',v_fp,'value',v_value,'rulebookVersion',v_rulebook,'planningDatasetVersion',v_planning.version,'history',v_history));
  end loop; return v_rows;
end $function$;
revoke all on function public.list_set06_review_status_v59(uuid) from public,anon;
grant execute on function public.list_set06_review_status_v59(uuid) to authenticated,service_role;

create or replace function public.attest_set06_review_v59(p_studio_id uuid,p_scope_kind text,p_entity_id text,p_aspect text,p_expected_rulebook_version integer,p_expected_planning_dataset_version integer,p_expected_fingerprint text,p_outcome text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_uid uuid:=auth.uid(); v_role text; v_actor text; v_planning public.planning_dataset_versions%rowtype; v_rulebook integer; v_value jsonb; v_fp text; v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if; select role into v_role from public.studio_members where studio_id=p_studio_id and user_id=v_uid for update; if not found or v_role not in ('OWNER','EDITOR') then raise exception using errcode='42501',message='Editor membership required for selected workspace'; end if;
  perform pg_advisory_xact_lock(hashtextextended('typed-setup:'||p_studio_id::text,0)); perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  select * into v_planning from public.planning_dataset_versions where studio_id=p_studio_id and status='CURRENT' order by version desc limit 1 for share; select version into v_rulebook from public.rulebook_versions where studio_id=p_studio_id and status='CURRENT' for share;
  if v_rulebook<>p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook; end if; if v_planning.version<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_planning.version; end if;
  if p_outcome not in ('REVIEWED_VALUE','REVIEWED_NO_ADDITIONAL_RESTRICTION') then raise exception 'SET06_REVIEW_OUTCOME_INVALID'; end if;
  v_value:=private.set06_review_value_v59(p_studio_id,p_scope_kind,p_entity_id,p_aspect,v_planning.snapshot); if v_value is null then raise exception 'SET06_REVIEW_REFERENCE_MISSING: review target is not active'; end if;
  if p_scope_kind='RULE' and p_outcome<>'REVIEWED_VALUE' then raise exception 'SET06_REVIEW_OUTCOME_INVALID: relationship policy requires reviewed value'; end if;
  if p_scope_kind='STUDENT' and ((jsonb_array_length(v_value->'policies')=0)<>(p_outcome='REVIEWED_NO_ADDITIONAL_RESTRICTION')) then raise exception 'SET06_REVIEW_OUTCOME_INVALID: explicit-none is allowed only when no student restriction exists'; end if;
  v_fp:=private.set06_review_fingerprint_v59(p_studio_id,p_scope_kind,p_entity_id,p_aspect,v_planning.snapshot); if v_fp is distinct from lower(p_expected_fingerprint) then raise exception 'STALE_REVIEW_FINGERPRINT: current SET-06 review slice changed'; end if;
  select coalesce(p.display_name,u.email,'Studio user') into v_actor from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  insert into public.setup_review_attestations(studio_id,scope_kind,entity_id,aspect,review_schema_version,dependency_fingerprint,outcome,reviewer_user_id,reviewer_label,source_planning_dataset_version,note) values(p_studio_id,p_scope_kind,p_entity_id,p_aspect,1,v_fp,p_outcome,v_uid,coalesce(v_actor,'Studio user'),v_planning.version,nullif(btrim(coalesce(p_note,'')),'')) returning id into v_id;
  return jsonb_build_object('status','REVIEWED','reviewId',v_id,'fingerprint',v_fp,'rulebookVersion',v_rulebook,'planningDatasetVersion',v_planning.version);
end $function$;
revoke all on function public.attest_set06_review_v59(uuid,text,text,text,integer,integer,text,text,text) from public,anon;
grant execute on function public.attest_set06_review_v59(uuid,text,text,text,integer,integer,text,text,text) to authenticated,service_role;

do $block$ begin if to_regprocedure('private.validate_typed_schedule_v54(uuid)') is not null and to_regprocedure('private.validate_typed_schedule_v54_set06_base(uuid)') is null then alter function private.validate_typed_schedule_v54(uuid) rename to validate_typed_schedule_v54_set06_base; end if; end $block$;
create or replace function private.validate_typed_schedule_v54(p_schedule_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_base jsonb; v_schedule public.schedule_versions%rowtype; v_model public.constraint_model_versions%rowtype; v_planning public.planning_dataset_versions%rowtype; v_node jsonb; v_id text; v_latest time; v_errors jsonb:='[]'; v_violations jsonb:='[]'; v_rule_ids jsonb:='[]'; v_assignment record; v_participants jsonb;
begin
  v_base:=private.validate_typed_schedule_v54_set06_base(p_schedule_version_id); select * into v_schedule from public.schedule_versions where id=p_schedule_version_id; if v_schedule.id is null then return v_base; end if; select * into v_model from public.constraint_model_versions where studio_id=v_schedule.studio_id and version=v_schedule.constraint_model_version; select * into v_planning from public.planning_dataset_versions where studio_id=v_schedule.studio_id and version=v_schedule.planning_dataset_version;
  for v_node in select value from jsonb_array_elements(coalesce(v_model.snapshot->'hardConstraints','[]')) x(value) where value->>'kind'='LATEST_FINISH_BY_PARTICIPANT' loop
    v_rule_ids:=v_rule_ids||coalesce(v_node->'ruleIds','[]'); v_participants:=v_node->'selector'->'participantIds';
    if jsonb_typeof(v_participants)<>'array' or jsonb_array_length(v_participants)=0 or jsonb_array_length(v_participants)<>(select count(distinct value) from jsonb_array_elements_text(v_participants) x(value)) or jsonb_typeof(v_node->'parameters'->'latestFinish')<>'string' or v_node#>>'{parameters,latestFinish}' !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or substring(v_node#>>'{parameters,latestFinish}' from 4 for 2)::integer%15<>0 then v_errors:=v_errors||jsonb_build_array('LATEST_FINISH_BY_PARTICIPANT has malformed stable IDs or time'); continue; end if;
    for v_id in select value from jsonb_array_elements_text(v_participants) x(value) loop
      if not exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'students','[]')) s(value) where s.value->>'id'=v_id) then v_errors:=v_errors||jsonb_build_array('LATEST_FINISH_BY_PARTICIPANT references a missing PlanningDataset participant'); end if;
      if not exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'classes','[]')) c(value) where coalesce(c.value->'rosterStudentIds','[]') ? v_id) then v_errors:=v_errors||jsonb_build_array('LATEST_FINISH_BY_PARTICIPANT participant is absent from every class roster'); end if;
    end loop;
  end loop;
  if jsonb_array_length(v_errors)>0 then return v_base||jsonb_build_object('typedRuleIds',coalesce(v_base->'typedRuleIds','[]')||v_rule_ids,'violations','[]','modelErrors',coalesce(v_base->'modelErrors','[]')||v_errors); end if;
  for v_node in select value from jsonb_array_elements(coalesce(v_model.snapshot->'hardConstraints','[]')) x(value) where value->>'kind'='LATEST_FINISH_BY_PARTICIPANT' loop
    v_latest:=(v_node#>>'{parameters,latestFinish}')::time; v_participants:=v_node->'selector'->'participantIds';
    for v_assignment in select a.id,a.session_id,a.end_time from public.assignments a where a.schedule_version_id=p_schedule_version_id and a.end_time>v_latest and exists(select 1 from jsonb_array_elements(coalesce(v_planning.snapshot->'sessions','[]')) s(value) join jsonb_array_elements(coalesce(v_planning.snapshot->'classes','[]')) c(value) on c.value->>'id'=s.value->>'classId' where s.value->>'id'=a.session_id and exists(select 1 from jsonb_array_elements_text(v_participants) p(value) where coalesce(c.value->'rosterStudentIds','[]') ? p.value)) loop v_violations:=v_violations||jsonb_build_array(jsonb_build_object('constraintId',v_node->>'id','ruleIds',v_node->'ruleIds','severity','HARD','message','A selected participant is scheduled after the latest allowed finish.','assignmentIds',jsonb_build_array(v_assignment.id),'affectedEntityIds',v_participants)); end loop;
  end loop;
  return v_base||jsonb_build_object('typedRuleIds',coalesce(v_base->'typedRuleIds','[]')||v_rule_ids,'violations',coalesce(v_base->'violations','[]')||v_violations,'modelErrors',coalesce(v_base->'modelErrors','[]')||v_errors);
end $function$;
revoke all on function private.validate_typed_schedule_v54(uuid) from public,anon,authenticated;

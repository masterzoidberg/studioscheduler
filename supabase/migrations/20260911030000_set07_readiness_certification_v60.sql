-- SET-07 / V6.0 readiness and manager certification boundary.
--
-- PlanningDatasetVersion remains the one aggregate certification record. The
-- review set is derived from the existing append-only setup attestations; this
-- migration does not create a second review or scheduling authority.

alter table public.planning_dataset_versions
  add column if not exists certification_rulebook_version integer null,
  add column if not exists certification_constraint_model_version integer null,
  add column if not exists certification_constraint_model_snapshot_hash text null,
  add column if not exists certification_review_set_fingerprint text null,
  add column if not exists certification_review_schema_version integer null;

alter table public.planning_dataset_versions
  drop constraint if exists planning_dataset_versions_certification_model_hash_v60;
alter table public.planning_dataset_versions
  add constraint planning_dataset_versions_certification_model_hash_v60
  check (
    certification_constraint_model_snapshot_hash is null
    or certification_constraint_model_snapshot_hash ~ '^[0-9a-f]{64}$'
  );

alter table public.planning_dataset_versions
  drop constraint if exists planning_dataset_versions_certification_review_hash_v60;
alter table public.planning_dataset_versions
  add constraint planning_dataset_versions_certification_review_hash_v60
  check (
    certification_review_set_fingerprint is null
    or certification_review_set_fingerprint ~ '^[0-9a-f]{64}$'
  );

create or replace function private.build_readiness_review_set_v60(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_rulebook public.rulebook_versions%rowtype;
  v_planning public.planning_dataset_versions%rowtype;
  v_items jsonb:='[]'::jsonb;
  v_value jsonb;
  v_fp text;
  v_id text;
  v_aspect text;
  v_state text;
  v_has_latest boolean;
  v_has_policy boolean;
  v_latest public.setup_review_attestations%rowtype;
begin
  select * into v_rulebook
  from public.rulebook_versions
  where studio_id=p_studio and status='CURRENT'
  order by version desc limit 1;
  select * into v_planning
  from public.planning_dataset_versions
  where studio_id=p_studio and status='CURRENT'
  order by version desc limit 1;

  if v_rulebook.id is null or v_planning.id is null then
    return jsonb_build_object('schemaVersion',1,'fingerprint',null,'items','[]'::jsonb);
  end if;

  -- Every current setup slice is represented, including explicit-none slices.
  for v_id in
    select value->>'id'
    from jsonb_array_elements(coalesce(v_planning.snapshot->'rooms','[]'::jsonb)) item(value)
    order by value->>'id'
  loop
    foreach v_aspect in array array['capacity','restrictions']::text[] loop
      if v_aspect='capacity' then
        v_fp:=private.room_capacity_review_fingerprint_v51(v_planning.snapshot,v_id,1);
      else
        v_fp:=private.room_restriction_review_fingerprint_v55(v_rulebook.snapshot,v_planning.snapshot,v_id,1);
      end if;
      select * into v_latest from public.setup_review_attestations
      where studio_id=p_studio and scope_kind='ROOM' and entity_id=v_id and aspect=v_aspect and review_schema_version=1
      order by created_at desc,id desc limit 1;
      v_has_latest:=found;
      if not v_has_latest then
        v_state:='NEEDS_REVIEW';
      elsif v_latest.dependency_fingerprint is distinct from v_fp then
        v_state:='CHANGED_SINCE_REVIEW';
      elsif v_aspect='capacity' and v_latest.outcome<>'REVIEWED_VALUE' then
        v_state:='BLOCKED';
      elsif v_aspect='restrictions' then
        select exists(
          select 1 from jsonb_array_elements(coalesce(v_rulebook.snapshot,'[]'::jsonb)) item(value)
          where (value->'parameters'->'policy'->>'kind'='ROOM_UNAVAILABLE_WINDOWS' and value->'parameters'->'policy'->>'roomId'=v_id)
             or value->'parameters'->'policy'->>'kind'='ROOM_REQUIRED_FEATURES'
        ) into v_has_policy;
        if (v_has_policy and v_latest.outcome<>'REVIEWED_VALUE')
           or (not v_has_policy and v_latest.outcome<>'REVIEWED_NO_ADDITIONAL_RESTRICTION') then
          v_state:='CHANGED_SINCE_REVIEW';
        else
          v_state:='REVIEWED';
        end if;
      else
        v_state:='REVIEWED';
      end if;
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'code','ROOM_'||upper(v_aspect)||'_REVIEW','scopeKind','ROOM','entityId',v_id,'aspect',v_aspect,
        'state',v_state,'classification','MUST',
        'message',format('Room %s %s must be reviewed for the current setup.',v_id,v_aspect),
        'ruleIds',case when v_aspect='capacity' then jsonb_build_array('ROOM-001') else jsonb_build_array('ROOM-002') end,
        'entityIds',jsonb_build_array(v_id),'currentFingerprint',v_fp,
        'latestId',case when v_has_latest then v_latest.id::text else null end,
        'latestOutcome',case when v_has_latest then v_latest.outcome else null end
      ));
    end loop;
  end loop;

  -- Teacher availability and qualification remain distinct review aspects.
  for v_id in
    select value from jsonb_array_elements_text(coalesce(v_planning.snapshot->'teacherIds','[]'::jsonb)) item(value)
    order by value
  loop
    foreach v_aspect in array array['availability','qualification']::text[] loop
      v_fp:=private.teacher_setup_review_fingerprint_v56(v_rulebook.snapshot,v_planning.snapshot,v_id,v_aspect,1);
      select exists(
        select 1 from jsonb_array_elements(coalesce(v_rulebook.snapshot,'[]'::jsonb)) item(value)
        where value->'parameters'->'policy'->>'teacherId'=v_id
          and value->'parameters'->'policy'->>'kind'=(case when v_aspect='availability' then 'TEACHER_DAY_WINDOW' else 'TEACHER_QUALIFICATION' end)
      ) into v_has_policy;
      select * into v_latest from public.setup_review_attestations
      where studio_id=p_studio and scope_kind='TEACHER' and entity_id=v_id and aspect=v_aspect and review_schema_version=1
      order by created_at desc,id desc limit 1;
      v_has_latest:=found;
      if not v_has_latest then v_state:='NEEDS_REVIEW';
      elsif v_aspect='qualification' and not v_has_policy then v_state:='BLOCKED';
      elsif v_latest.dependency_fingerprint is distinct from v_fp then v_state:='CHANGED_SINCE_REVIEW';
      elsif (v_has_policy and v_latest.outcome<>'REVIEWED_VALUE') or (not v_has_policy and v_latest.outcome<>'REVIEWED_NO_ADDITIONAL_RESTRICTION') then v_state:='CHANGED_SINCE_REVIEW';
      else v_state:='REVIEWED'; end if;
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'code','TEACHER_'||upper(v_aspect)||'_REVIEW','scopeKind','TEACHER','entityId',v_id,'aspect',v_aspect,
        'state',v_state,'classification','MUST',
        'message',format('Teacher %s %s must be reviewed for the current setup.',v_id,v_aspect),
        'ruleIds',case when v_aspect='qualification' then jsonb_build_array('AIM-003') else jsonb_build_array('AIM-001') end,
        'entityIds',jsonb_build_array(v_id),'currentFingerprint',v_fp,
        'latestId',case when v_has_latest then v_latest.id::text else null end,
        'latestOutcome',case when v_has_latest then v_latest.outcome else null end
      ));
    end loop;
  end loop;

  -- Class structure and roster reviews are current Planning Dataset facts.
  for v_id in
    select value->>'id'
    from jsonb_array_elements(coalesce(v_planning.snapshot->'classes','[]'::jsonb)) item(value)
    order by value->>'id'
  loop
    foreach v_aspect in array array['structure','roster']::text[] loop
      v_value:=private.class_setup_review_value_v57(p_studio,v_planning.snapshot,v_id,v_aspect,1);
      v_fp:=private.class_setup_review_fingerprint_v57(p_studio,v_planning.snapshot,v_id,v_aspect,1);
      select * into v_latest from public.setup_review_attestations
      where studio_id=p_studio and scope_kind='CLASS' and entity_id=v_id and aspect=v_aspect and review_schema_version=1
      order by created_at desc,id desc limit 1;
      v_has_latest:=found;
      if v_aspect='structure' and (
        jsonb_array_length(v_value->'sessions')<>(v_value->>'weeklyFrequency')::integer
        or exists(select 1 from jsonb_array_elements(v_value->'sessions') item(value) where coalesce((value->>'durationMinutes')::integer,0)<=0)
      ) then
        v_state:='BLOCKED';
      elsif v_aspect='roster' and (
        coalesce((v_value->>'blocked')::boolean,false)
        or jsonb_array_length(v_value->'missingRequiredStudentIds')>0
      ) then
        v_state:='BLOCKED';
      elsif not v_has_latest then v_state:='NEEDS_REVIEW';
      elsif v_latest.outcome<>'REVIEWED_VALUE' then v_state:='BLOCKED';
      elsif v_latest.dependency_fingerprint is distinct from v_fp then v_state:='CHANGED_SINCE_REVIEW';
      else v_state:='REVIEWED'; end if;
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'code','CLASS_'||upper(v_aspect)||'_REVIEW','scopeKind','CLASS','entityId',v_id,'aspect',v_aspect,
        'state',v_state,'classification','MUST',
        'message',format('Class %s %s must be reviewed for the current setup.',v_id,v_aspect),
        'ruleIds',case when v_aspect='structure' then jsonb_build_array('CUR-006') else jsonb_build_array('STU-002') end,
        'entityIds',jsonb_build_array(v_id),'currentFingerprint',v_fp,
        'latestId',case when v_has_latest then v_latest.id::text else null end,
        'latestOutcome',case when v_has_latest then v_latest.outcome else null end
      ));
    end loop;
  end loop;

  -- SET-06 student and relationship semantics use their existing private
  -- value/fingerprint functions as the sole semantic source.
  for v_id in
    select value->>'id'
    from jsonb_array_elements(coalesce(v_planning.snapshot->'students','[]'::jsonb)) item(value)
    order by value->>'id'
  loop
    v_fp:=private.set06_review_fingerprint_v59(p_studio,'STUDENT',v_id,'restrictions',v_planning.snapshot);
    select * into v_latest from public.setup_review_attestations
    where studio_id=p_studio and scope_kind='STUDENT' and entity_id=v_id and aspect='restrictions' and review_schema_version=1
    order by created_at desc,id desc limit 1;
    v_has_latest:=found;
    if not v_has_latest then v_state:='NEEDS_REVIEW';
    elsif v_latest.outcome='NEEDS_REVIEW' then v_state:='NEEDS_REVIEW';
    elsif v_latest.dependency_fingerprint is distinct from v_fp then v_state:='CHANGED_SINCE_REVIEW';
    else v_state:=v_latest.outcome; end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'code','STUDENT_RESTRICTIONS_REVIEW','scopeKind','STUDENT','entityId',v_id,'aspect','restrictions',
      'state',v_state,'classification','MUST',
      'message',format('Student %s restrictions must be explicitly reviewed.',v_id),
      'ruleIds',jsonb_build_array('STU-002'),'entityIds',jsonb_build_array(v_id),'currentFingerprint',v_fp,
      'latestId',case when v_has_latest then v_latest.id::text else null end,
      'latestOutcome',case when v_has_latest then v_latest.outcome else null end
    ));
  end loop;

  for v_id in
    select id from public.rules
    where studio_id=p_studio and status='ACTIVE'
      and parameters#>>'{policy,kind}' in ('PARTICIPANT_NO_OVERLAP','DIRECT_AFTER','LINKED_ARRIVAL')
    order by id
  loop
    v_fp:=private.set06_review_fingerprint_v59(p_studio,'RULE',v_id,'interpretation',v_planning.snapshot);
    select * into v_latest from public.setup_review_attestations
    where studio_id=p_studio and scope_kind='RULE' and entity_id=v_id and aspect='interpretation' and review_schema_version=1
    order by created_at desc,id desc limit 1;
    v_has_latest:=found;
    if not v_has_latest then v_state:='NEEDS_REVIEW';
    elsif v_latest.outcome<>'REVIEWED_VALUE' then v_state:='BLOCKED';
    elsif v_latest.dependency_fingerprint is distinct from v_fp then v_state:='CHANGED_SINCE_REVIEW';
    else v_state:='REVIEWED_VALUE'; end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'code','RELATIONSHIP_RULE_REVIEW','scopeKind','RULE','entityId',v_id,'aspect','interpretation',
      'state',v_state,'classification','MUST',
      'message',format('Relationship rule %s must be reviewed before scheduling.',v_id),
      'ruleIds',jsonb_build_array(v_id),'entityIds',jsonb_build_array(v_id),'currentFingerprint',v_fp,
      'latestId',case when v_has_latest then v_latest.id::text else null end,
      'latestOutcome',case when v_has_latest then v_latest.outcome else null end
    ));
  end loop;

  -- Unknown active HARD meaning is never downgraded to a preference. Optional
  -- preferences are intentionally absent here and remain warnings.
  for v_id in
    select id from public.rules
    where studio_id=p_studio and status='ACTIVE' and strength='HARD'
      and coalesce(review_status,verification_status,'UNVERIFIED')<>'VERIFIED'
      and parameters#>>'{policy,kind}' not in ('PARTICIPANT_NO_OVERLAP','DIRECT_AFTER','LINKED_ARRIVAL')
    order by id
  loop
    v_fp:=encode(extensions.digest(pg_catalog.convert_to(v_id,'UTF8'),'sha256'),'hex');
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'code','UNREVIEWED_HARD_RULE','scopeKind','RULE','entityId',v_id,'aspect','interpretation',
      'state','NEEDS_REVIEW','classification','MUST',
      'message',format('HARD rule %s has not been reviewed for current scheduling meaning.',v_id),
      'ruleIds',jsonb_build_array(v_id),'entityIds',jsonb_build_array(v_id),
      'currentFingerprint',v_fp,'latestId',null,'latestOutcome',null
    ));
  end loop;

  return jsonb_build_object(
    'schemaVersion',1,
    'fingerprint',encode(extensions.digest(pg_catalog.convert_to(v_items::text,'UTF8'),'sha256'),'hex'),
    'items',v_items
  );
end
$function$;

revoke all on function private.build_readiness_review_set_v60(uuid) from public,anon,authenticated;

create or replace function private.build_readiness_certification_v60(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_rulebook public.rulebook_versions%rowtype;
  v_planning public.planning_dataset_versions%rowtype;
  v_model public.constraint_model_versions%rowtype;
  v_review jsonb;
begin
  select * into v_rulebook from public.rulebook_versions where studio_id=p_studio and status='CURRENT' order by version desc limit 1;
  select * into v_planning from public.planning_dataset_versions where studio_id=p_studio and status='CURRENT' order by version desc limit 1;
  select * into v_model from public.constraint_model_versions where studio_id=p_studio and status='CURRENT' order by version desc limit 1;
  v_review:=private.build_readiness_review_set_v60(p_studio);
  return jsonb_build_object(
    'schemaVersion',1,'reviewSetSchemaVersion',1,'reviewSetFingerprint',v_review->>'fingerprint',
    'currentRulebookVersion',v_rulebook.version,'currentPlanningDatasetVersion',v_planning.version,
    'currentPlanningSnapshotHash',v_planning.snapshot_hash,'currentConstraintModelVersion',v_model.version,
    'currentConstraintModelSnapshotHash',v_model.snapshot_hash,'currentConstraintModelCompilerVersion',v_model.compiler_version,
    'reviewFindings',coalesce(v_review->'items','[]'::jsonb),
    'certification',case when v_planning.confirmed_for_scheduling_at is not null
      and v_planning.certification_rulebook_version is not null
      and v_planning.certification_constraint_model_version is not null
      and v_planning.certification_constraint_model_snapshot_hash is not null
      and v_planning.certification_review_set_fingerprint is not null then jsonb_build_object(
        'planningDatasetVersion',v_planning.version,'planningSnapshotHash',v_planning.snapshot_hash,
        'rulebookVersion',v_planning.certification_rulebook_version,'constraintModelVersion',v_planning.certification_constraint_model_version,
        'constraintModelSnapshotHash',v_planning.certification_constraint_model_snapshot_hash,
        'reviewSetSchemaVersion',v_planning.certification_review_schema_version,
        'reviewSetFingerprint',v_planning.certification_review_set_fingerprint,
        'confirmedAt',v_planning.confirmed_for_scheduling_at,'confirmedByLabel',v_planning.confirmed_for_scheduling_by_label
      ) else null end
  );
end
$function$;
revoke all on function private.build_readiness_certification_v60(uuid) from public,anon,authenticated;

create or replace function public.get_readiness_certification_v60(p_studio_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;
  return private.build_readiness_certification_v60(p_studio_id);
end
$function$;
revoke all on function public.get_readiness_certification_v60(uuid) from public,anon;
grant execute on function public.get_readiness_certification_v60(uuid) to authenticated,service_role;

create or replace function private.assert_current_readiness_certification_v60(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_cert jsonb:=private.build_readiness_certification_v60(p_studio);
begin
  if v_cert->>'certification' is null then
    raise exception 'PLANNING_DATASET_NOT_CERTIFIED: current Planning Dataset has no complete manager certification';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(coalesce(v_cert->'reviewFindings','[]'::jsonb)) item(value)
    where value->>'classification'='MUST'
      and value->>'state' not in ('REVIEWED','REVIEWED_VALUE','REVIEWED_NO_ADDITIONAL_RESTRICTION')
  ) then
    raise exception 'READINESS_REVIEW_REQUIRED: one or more required setup/HARD-policy slices are missing, stale, or blocked';
  end if;
  if v_cert->'certification'->>'planningDatasetVersion' is distinct from v_cert->>'currentPlanningDatasetVersion'
     or v_cert->'certification'->>'planningSnapshotHash' is distinct from v_cert->>'currentPlanningSnapshotHash'
     or v_cert->'certification'->>'rulebookVersion' is distinct from v_cert->>'currentRulebookVersion'
     or v_cert->'certification'->>'constraintModelVersion' is distinct from v_cert->>'currentConstraintModelVersion'
     or v_cert->'certification'->>'constraintModelSnapshotHash' is distinct from v_cert->>'currentConstraintModelSnapshotHash'
     or v_cert->'certification'->>'reviewSetSchemaVersion' is distinct from v_cert->>'reviewSetSchemaVersion'
     or v_cert->'certification'->>'reviewSetFingerprint' is distinct from v_cert->>'reviewSetFingerprint' then
    raise exception 'PLANNING_CERTIFICATION_STALE: current Rulebook, model, planning, or review-set context changed after certification';
  end if;
  return v_cert;
end
$function$;
revoke all on function private.assert_current_readiness_certification_v60(uuid) from public,anon,authenticated;

create or replace function public.adopt_solver_candidate_v49(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_actor_label text,
  p_reason text,
  p_expected_context jsonb,
  p_candidate jsonb,
  p_application_validation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_selected_role text;
  v_result jsonb;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id
  for update;
  if not found or v_selected_role not in ('OWNER','EDITOR') then
    raise exception using errcode='42501',message='Editor membership required for selected workspace';
  end if;

  -- Candidate adoption is a transaction boundary, not only an application
  -- readiness check. A direct service-role transport call cannot bypass the
  -- current aggregate certification or its review-set revision.
  perform private.assert_current_readiness_certification_v60(p_studio_id);
  v_result:=public.adopt_solver_candidate_v44(
    p_studio_id,p_actor_user_id,p_actor_label,p_reason,
    p_expected_context,p_candidate,p_application_validation
  );
  return v_result || jsonb_build_object(
    'authority','SERVER_CONSTRAINT_IR_V49',
    'actorRoleRechecked',true,
    'membershipSerialized',true,
    'readinessCertificationRequired',true
  );
end
$function$;

revoke all on function public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)
  to service_role;

create or replace function public.confirm_current_planning_dataset_v60(
  p_expected_planning_dataset_version integer,
  p_expected_snapshot_hash text,
  p_expected_rulebook_version integer,
  p_expected_constraint_model_version integer,
  p_expected_constraint_model_snapshot_hash text,
  p_expected_review_set_fingerprint text,
  p_expected_review_schema_version integer,
  p_note text,
  p_evidence jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  ctx jsonb:=private.assert_editor_context();
  v_uid uuid:=(ctx->>'user_id')::uuid;
  v_studio uuid:=(ctx->>'studio_id')::uuid;
  v_actor text:=ctx->>'actor';
  v_current public.planning_dataset_versions%rowtype;
  v_rulebook public.rulebook_versions%rowtype;
  v_model public.constraint_model_versions%rowtype;
  v_review jsonb;
  v_note text:=coalesce(nullif(btrim(p_note),''),'Manager reviewed the exact current Planning Dataset, policy, model, and setup review context for scheduling');
  v_evidence jsonb:=coalesce(p_evidence,'{}'::jsonb);
begin
  if jsonb_typeof(v_evidence)<>'object'
     or v_evidence->'peopleInventoryReviewed' is distinct from 'true'::jsonb
     or v_evidence->'classSessionCatalogReviewed' is distinct from 'true'::jsonb
     or v_evidence->'classRostersReviewed' is distinct from 'true'::jsonb
     or v_evidence->'sourceAndCompletenessReviewed' is distinct from 'true'::jsonb then
    raise exception 'PLANNING_CONFIRMATION_EVIDENCE_REQUIRED: all four current-snapshot attestations are required';
  end if;
  if p_expected_review_schema_version is null or p_expected_review_schema_version<>1 then raise exception 'READINESS_REVIEW_SCHEMA_UNSUPPORTED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||v_studio::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||v_studio::text,0));
  perform pg_advisory_xact_lock(hashtextextended('typed-setup:'||v_studio::text,0));
  select * into v_current from public.planning_dataset_versions where studio_id=v_studio and status='CURRENT' order by version desc limit 1 for update;
  select * into v_rulebook from public.rulebook_versions where studio_id=v_studio and status='CURRENT' order by version desc limit 1 for share;
  select * into v_model from public.constraint_model_versions where studio_id=v_studio and status='CURRENT' order by version desc limit 1 for share;
  if v_current.id is null then raise exception 'No current PlanningDatasetVersion exists'; end if;
  if v_rulebook.id is null then raise exception 'No current RulebookVersion exists'; end if;
  if v_model.id is null or not v_model.complete_hard_constraint_compilation then raise exception 'CONSTRAINT_MODEL_NOT_PUBLISHED: a complete current ConstraintModelVersion is required'; end if;
  if v_current.version<>p_expected_planning_dataset_version then raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_current.version; end if;
  if coalesce(btrim(p_expected_snapshot_hash),'')='' or v_current.snapshot_hash<>btrim(p_expected_snapshot_hash) then raise exception 'STALE_PLANNING_DATASET_SNAPSHOT: expected hash %, current %',p_expected_snapshot_hash,v_current.snapshot_hash; end if;
  if v_rulebook.version is distinct from p_expected_rulebook_version then raise exception 'STALE_RULEBOOK: expected %, current %',p_expected_rulebook_version,v_rulebook.version; end if;
  if v_model.version is distinct from p_expected_constraint_model_version or v_model.rulebook_version is distinct from v_rulebook.version then raise exception 'STALE_CONSTRAINT_MODEL: expected %, current %',p_expected_constraint_model_version,v_model.version; end if;
  if v_model.snapshot_hash is distinct from lower(btrim(p_expected_constraint_model_snapshot_hash)) then raise exception 'STALE_CONSTRAINT_MODEL_SNAPSHOT: expected %, current %',p_expected_constraint_model_snapshot_hash,v_model.snapshot_hash; end if;
  if private.constraint_model_hash_v27(v_model.snapshot) is distinct from v_model.snapshot_hash then raise exception 'CONSTRAINT_MODEL_HASH_MISMATCH: current model snapshot is not internally consistent'; end if;
  v_review:=private.build_readiness_review_set_v60(v_studio);
  if v_review->>'fingerprint' is distinct from lower(btrim(p_expected_review_set_fingerprint)) then raise exception 'STALE_READINESS_REVIEW_SET: review set changed before certification'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(v_review->'items','[]'::jsonb)) item(value) where value->>'classification'='MUST' and value->>'state' not in ('REVIEWED','REVIEWED_VALUE','REVIEWED_NO_ADDITIONAL_RESTRICTION')) then
    raise exception 'READINESS_REVIEW_REQUIRED: one or more required setup/HARD-policy slices are missing, stale, or blocked';
  end if;
  update public.planning_dataset_versions
  set confirmed_for_scheduling_at=now(),confirmed_for_scheduling_by=v_uid,confirmed_for_scheduling_by_label=v_actor,
      scheduling_confirmation_note=v_note,certification_rulebook_version=v_rulebook.version,
      certification_constraint_model_version=v_model.version,certification_constraint_model_snapshot_hash=v_model.snapshot_hash,
      certification_review_set_fingerprint=v_review->>'fingerprint',certification_review_schema_version=1
  where id=v_current.id;
  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(v_studio,v_uid,v_actor,'PLANNING_DATASET_CERTIFIED','PLANNING_DATASET_VERSION',v_current.id::text,v_note,jsonb_build_object(
    'planningDatasetVersion',v_current.version,'snapshotHash',v_current.snapshot_hash,'rulebookVersion',v_rulebook.version,
    'constraintModelVersion',v_model.version,'constraintModelSnapshotHash',v_model.snapshot_hash,
    'reviewSetSchemaVersion',1,'reviewSetFingerprint',v_review->>'fingerprint','confirmationContractVersion',60,
    'evidence',jsonb_build_object('peopleInventoryReviewed',true,'classSessionCatalogReviewed',true,'classRostersReviewed',true,'sourceAndCompletenessReviewed',true)
  ));
  return jsonb_build_object('status','CERTIFIED','planningDatasetVersion',v_current.version,'snapshotHash',v_current.snapshot_hash,
    'rulebookVersion',v_rulebook.version,'constraintModelVersion',v_model.version,'constraintModelSnapshotHash',v_model.snapshot_hash,
    'reviewSetSchemaVersion',1,'reviewSetFingerprint',v_review->>'fingerprint','confirmedForSchedulingAt',now(),
    'confirmedBy',v_actor,'confirmationContractVersion',60);
end
$function$;
revoke all on function public.confirm_current_planning_dataset_v60(integer,text,integer,integer,text,text,integer,text,jsonb) from public,anon;
grant execute on function public.confirm_current_planning_dataset_v60(integer,text,integer,integer,text,text,integer,text,jsonb) to authenticated,service_role;

revoke all on function public.confirm_current_planning_dataset_v39(integer,text,text,jsonb) from public,anon,authenticated,service_role;

create or replace function private.build_solver_context_token_v43(p_studio_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $function$
  with current_rulebook as (
    select rb.* from public.rulebook_versions rb where rb.studio_id=p_studio_id and rb.status='CURRENT' order by rb.version desc limit 1
  ), current_planning as (
    select pd.* from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1
  ), current_enforcement as (
    select ev.* from public.rule_enforcement_versions ev where ev.studio_id=p_studio_id and ev.status='CURRENT' order by ev.version desc limit 1
  ), current_model as (
    select cm.* from public.constraint_model_versions cm where cm.studio_id=p_studio_id and cm.status='CURRENT' order by cm.version desc limit 1
  ), current_schedule as (
    select sv.* from public.schedule_versions sv where sv.studio_id=p_studio_id and sv.is_current order by sv.version desc limit 1
  ), rules_state as (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) as snapshot from public.rules r where r.studio_id=p_studio_id
  ), assignment_state as (
    select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'sessionId',a.session_id,'day',a.day,'startTime',a.start_time,'endTime',a.end_time,'teacherId',a.teacher_id,'roomId',a.room_id,'locked',a.locked,'status',a.status) order by a.id),'[]'::jsonb) as snapshot
    from public.assignments a where a.studio_id=p_studio_id and a.schedule_version_id=(select id from current_schedule)
  ), certification as (
    select private.build_readiness_certification_v60(p_studio_id) as value
  )
  select jsonb_build_object(
    'schemaVersion','1.0','studioId',p_studio_id::text,
    'rulebookVersion',(select version from current_rulebook),'rulebookId',(select id::text from current_rulebook),
    'rulebookSourceHash',(select source_hash from current_rulebook),
    'rulebookSnapshotHash',(select private.planning_dataset_hash_v25(snapshot) from current_rulebook),
    'rulesHash',private.planning_dataset_hash_v25((select snapshot from rules_state)),
    'planningDatasetVersion',(select version from current_planning),'planningDatasetId',(select id::text from current_planning),
    'planningSnapshotHash',(select snapshot_hash from current_planning),
    'planningConfirmedForSchedulingAt',(select confirmed_for_scheduling_at from current_planning),
    'planningCertificationRulebookVersion',(select certification_rulebook_version from current_planning),
    'planningCertificationConstraintModelVersion',(select certification_constraint_model_version from current_planning),
    'planningCertificationConstraintModelSnapshotHash',(select certification_constraint_model_snapshot_hash from current_planning),
    'planningCertificationReviewSchemaVersion',(select certification_review_schema_version from current_planning),
    'planningCertificationReviewSetFingerprint',(select value->>'reviewSetFingerprint' from certification),
    'enforcementVersion',(select version from current_enforcement),'enforcementId',(select id::text from current_enforcement),
    'constraintModelVersion',(select version from current_model),'constraintModelId',(select id::text from current_model),
    'constraintModelSnapshotHash',(select snapshot_hash from current_model),
    'scheduleVersion',(select version from current_schedule),'scheduleId',(select id::text from current_schedule),
    'scheduleRulebookVersion',(select rulebook_version from current_schedule),
    'scheduleEnforcementVersion',(select enforcement_version from current_schedule),
    'schedulePlanningDatasetVersion',(select planning_dataset_version from current_schedule),
    'scheduleConstraintModelVersion',(select constraint_model_version from current_schedule),
    'scheduleAssignmentsHash',private.planning_dataset_hash_v25((select snapshot from assignment_state))
  )
$function$;
revoke all on function private.build_solver_context_token_v43(uuid) from public,anon,authenticated;

create or replace function public.get_solver_snapshot_v43(p_studio_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;
  select jsonb_build_object(
    'contextToken',private.build_solver_context_token_v43(p_studio_id),
    'readinessCertification',private.build_readiness_certification_v60(p_studio_id),
    'integrity',jsonb_build_object(
      'planningSnapshotHashValid',coalesce((select private.planning_dataset_hash_v25(pd.snapshot)=pd.snapshot_hash from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1),false),
      'constraintModelSnapshotHashValid',coalesce((select private.constraint_model_hash_v27(cm.snapshot)=cm.snapshot_hash from public.constraint_model_versions cm where cm.studio_id=p_studio_id and cm.status='CURRENT' order by cm.version desc limit 1),true)
    ),
    'studio',(select jsonb_build_object('id',s.id,'name',s.name) from public.studios s where s.id=p_studio_id),
    'rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.rules r where r.studio_id=p_studio_id),'[]'::jsonb),
    'rulebookVersion',(select to_jsonb(rb) from public.rulebook_versions rb where rb.studio_id=p_studio_id and rb.status='CURRENT' order by rb.version desc limit 1),
    'enforcementVersion',(select to_jsonb(ev) from public.rule_enforcement_versions ev where ev.studio_id=p_studio_id and ev.status='CURRENT' order by ev.version desc limit 1),
    'planningDatasetVersion',(select to_jsonb(pd) from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1),
    'constraintModelVersion',(select to_jsonb(cm) from public.constraint_model_versions cm where cm.studio_id=p_studio_id and cm.status='CURRENT' order by cm.version desc limit 1),
    'currentSchedule',(select to_jsonb(sv) from public.schedule_versions sv where sv.studio_id=p_studio_id and sv.is_current order by sv.version desc limit 1),
    'currentAssignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.assignments a where a.studio_id=p_studio_id and a.schedule_version_id=(select sv.id from public.schedule_versions sv where sv.studio_id=p_studio_id and sv.is_current order by sv.version desc limit 1)),'[]'::jsonb)
  ) into v_result;
  return v_result;
end
$function$;
revoke all on function public.get_solver_snapshot_v43(uuid) from public,anon;
grant execute on function public.get_solver_snapshot_v43(uuid) to authenticated,service_role;

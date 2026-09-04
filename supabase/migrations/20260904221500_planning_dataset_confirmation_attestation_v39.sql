-- V3.9 evidence-bearing Planning Dataset confirmation.
--
-- Deterministic readiness checks can prove internal consistency, but they cannot
-- prove that a fluid studio inventory is complete. Scheduling authority therefore
-- requires an editor to attest, against the exact immutable snapshot hash, that
-- the current people inventory, class/session catalog, rosters, and known
-- completeness have been reviewed.

create or replace function public.confirm_current_planning_dataset_v39(
  p_expected_planning_dataset_version integer,
  p_expected_snapshot_hash text,
  p_note text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  ctx jsonb := private.assert_editor_context();
  v_uid uuid := (ctx->>'user_id')::uuid;
  v_studio uuid := (ctx->>'studio_id')::uuid;
  v_actor text := ctx->>'actor';
  v_current public.planning_dataset_versions%rowtype;
  v_note text := coalesce(nullif(btrim(p_note),''),'Manager reviewed and attested the exact current Planning Dataset snapshot for scheduling');
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
begin
  if jsonb_typeof(v_evidence) <> 'object' then
    raise exception 'PLANNING_CONFIRMATION_EVIDENCE_REQUIRED: evidence must be a JSON object';
  end if;

  if v_evidence->'peopleInventoryReviewed' is distinct from 'true'::jsonb then
    raise exception 'PLANNING_CONFIRMATION_PEOPLE_REVIEW_REQUIRED: review and attest the current teacher and student inventory';
  end if;
  if v_evidence->'classSessionCatalogReviewed' is distinct from 'true'::jsonb then
    raise exception 'PLANNING_CONFIRMATION_CLASS_SESSION_REVIEW_REQUIRED: review and attest the current class and weekly session catalog';
  end if;
  if v_evidence->'classRostersReviewed' is distinct from 'true'::jsonb then
    raise exception 'PLANNING_CONFIRMATION_ROSTER_REVIEW_REQUIRED: review and attest the current class rosters';
  end if;
  if v_evidence->'sourceAndCompletenessReviewed' is distinct from 'true'::jsonb then
    raise exception 'PLANNING_CONFIRMATION_COMPLETENESS_REVIEW_REQUIRED: verify the snapshot against the best available current studio source or manager knowledge and attest that no known planning records are omitted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||v_studio::text,0));

  select * into v_current
  from public.planning_dataset_versions
  where studio_id=v_studio and status='CURRENT'
  limit 1;

  if v_current.id is null then
    raise exception 'No current PlanningDatasetVersion exists';
  end if;
  if v_current.version<>p_expected_planning_dataset_version then
    raise exception 'STALE_PLANNING_DATASET: expected %, current %',p_expected_planning_dataset_version,v_current.version;
  end if;
  if coalesce(btrim(p_expected_snapshot_hash),'')='' or v_current.snapshot_hash<>btrim(p_expected_snapshot_hash) then
    raise exception 'STALE_PLANNING_DATASET_SNAPSHOT: expected hash %, current %',p_expected_snapshot_hash,v_current.snapshot_hash;
  end if;

  update public.planning_dataset_versions
  set confirmed_for_scheduling_at=now(),
      confirmed_for_scheduling_by=v_uid,
      confirmed_for_scheduling_by_label=v_actor,
      scheduling_confirmation_note=v_note
  where id=v_current.id;

  insert into public.audit_events(
    studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload
  ) values (
    v_studio,v_uid,v_actor,'PLANNING_DATASET_CONFIRMED','PLANNING_DATASET_VERSION',v_current.id::text,v_note,
    jsonb_build_object(
      'planningDatasetVersion',v_current.version,
      'snapshotHash',v_current.snapshot_hash,
      'confirmedForScheduling',true,
      'confirmationContractVersion',39,
      'evidence',jsonb_build_object(
        'peopleInventoryReviewed',true,
        'classSessionCatalogReviewed',true,
        'classRostersReviewed',true,
        'sourceAndCompletenessReviewed',true
      )
    )
  );

  return jsonb_build_object(
    'planningDatasetVersion',v_current.version,
    'snapshotHash',v_current.snapshot_hash,
    'confirmedForSchedulingAt',now(),
    'confirmedBy',v_actor,
    'note',v_note,
    'confirmationContractVersion',39
  );
end
$function$;

revoke all on function public.confirm_current_planning_dataset_v39(integer,text,text,jsonb) from public,anon;
grant execute on function public.confirm_current_planning_dataset_v39(integer,text,text,jsonb) to authenticated,service_role;

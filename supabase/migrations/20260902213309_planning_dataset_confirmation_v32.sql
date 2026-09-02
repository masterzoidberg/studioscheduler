-- V3.2 fluid planning-data confirmation gate.
--
-- DWDE inventory and rosters are intentionally fluid. External source manifests
-- remain optional provenance/comparison baselines. Automatic scheduling instead
-- requires the current immutable PlanningDatasetVersion itself to have been
-- explicitly reviewed/confirmed by an editor after the latest planning changes.

alter table public.planning_dataset_versions
  add column if not exists confirmed_for_scheduling_at timestamptz null,
  add column if not exists confirmed_for_scheduling_by uuid null references auth.users(id) on delete set null,
  add column if not exists confirmed_for_scheduling_by_label text null,
  add column if not exists scheduling_confirmation_note text null;

create index if not exists idx_planning_dataset_confirmed_current
  on public.planning_dataset_versions(studio_id,version)
  where status='CURRENT' and confirmed_for_scheduling_at is not null;

create or replace function public.confirm_current_planning_dataset_v32(
  p_expected_planning_dataset_version integer,
  p_note text default 'Reviewed current planning inventory and rosters for scheduling'
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
  v_note text := coalesce(nullif(btrim(p_note),''),'Reviewed current planning inventory and rosters for scheduling');
begin
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
      'confirmedForScheduling',true
    )
  );

  return jsonb_build_object(
    'planningDatasetVersion',v_current.version,
    'snapshotHash',v_current.snapshot_hash,
    'confirmedForSchedulingAt',now(),
    'confirmedBy',v_actor,
    'note',v_note
  );
end
$function$;

revoke all on function public.confirm_current_planning_dataset_v32(integer,text) from public,anon;
grant execute on function public.confirm_current_planning_dataset_v32(integer,text) to authenticated,service_role;

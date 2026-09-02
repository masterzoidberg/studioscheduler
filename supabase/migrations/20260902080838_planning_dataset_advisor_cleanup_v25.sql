-- Follow-up to the PlanningDatasetVersion rollout.
-- Remove the unnecessary SECURITY DEFINER surface from the read-only current
-- dataset helper and cover the actor_user_id foreign key used by audit/history queries.

create index if not exists idx_planning_dataset_versions_actor_user
  on public.planning_dataset_versions(actor_user_id);

create or replace function public.get_current_planning_dataset_v25()
returns jsonb
language sql
stable
security invoker
set search_path=''
as $function$
  select jsonb_build_object(
    'id', pdv.id,
    'version', pdv.version,
    'createdAt', pdv.created_at,
    'actor', pdv.actor_label,
    'reason', pdv.reason,
    'snapshot', pdv.snapshot,
    'snapshotHash', pdv.snapshot_hash,
    'status', pdv.status
  )
  from public.planning_dataset_versions pdv
  where pdv.status='CURRENT'
  order by pdv.version desc
  limit 1
$function$;

revoke all on function public.get_current_planning_dataset_v25() from public, anon;
grant execute on function public.get_current_planning_dataset_v25() to authenticated, service_role;

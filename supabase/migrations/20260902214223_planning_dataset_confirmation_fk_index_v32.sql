create index if not exists idx_planning_dataset_versions_confirmed_by
  on public.planning_dataset_versions(confirmed_for_scheduling_by)
  where confirmed_for_scheduling_by is not null;

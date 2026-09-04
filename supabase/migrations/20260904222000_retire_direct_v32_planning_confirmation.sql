-- Retire the legacy free-text-only Planning Dataset confirmation boundary after
-- the v39 frontend is live. v32 remains postgres-owned for historical/internal
-- compatibility but is no longer directly callable by browser or service-role
-- clients.

revoke execute on function public.confirm_current_planning_dataset_v32(integer,text) from authenticated,service_role;
revoke all on function public.confirm_current_planning_dataset_v32(integer,text) from public,anon;

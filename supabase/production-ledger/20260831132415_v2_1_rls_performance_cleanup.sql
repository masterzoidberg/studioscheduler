create index if not exists idx_entity_versions_actor_user on public.entity_versions(actor_user_id);
create index if not exists idx_studio_invites_invited_by on public.studio_invites(invited_by);

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated using ((select auth.uid())=id);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);

drop policy if exists member_select_owner on public.studio_members;
drop policy if exists member_select_self on public.studio_members;
create policy member_select_studio_members on public.studio_members for select to authenticated using (user_id=(select auth.uid()) or private.is_studio_owner(studio_id));
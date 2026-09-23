-- M01-T01: serialize membership changes that can affect workspace ownership.
-- The older v21 mutators make the last-owner decision from an unlocked count,
-- which lets simultaneous owner changes orphan a workspace.

create or replace function public.set_studio_member_role_v63(
  p_studio_id uuid,
  p_user_id uuid,
  p_role text
)
returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_uid uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_owner_count integer;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if p_studio_id is null then
    raise exception using errcode='22023', message='Explicit studio selection is required';
  end if;
  if p_user_id is null then
    raise exception using errcode='22023', message='Member is required';
  end if;
  if p_role is null or p_role not in ('OWNER','EDITOR','VIEWER') then
    raise exception using errcode='22023', message='Invalid role';
  end if;

  -- Every role change/removal in this tenant takes the same transaction lock.
  -- Check the actor only after waiting so a queued request cannot use a role
  -- that was revoked while it waited.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('studio-membership-v70:' || p_studio_id::text, 0)
  );

  select m.role into v_actor_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=v_uid
  for update;
  if not found then
    raise exception using errcode='42501', message='Studio membership required for selected workspace';
  end if;
  if v_actor_role<>'OWNER' then
    raise exception using errcode='42501', message='Owner membership required';
  end if;

  select m.role into v_target_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_user_id
  for update;
  if not found then
    return false;
  end if;

  if v_target_role='OWNER' and p_role<>'OWNER' then
    select count(*)::integer into v_owner_count
    from public.studio_members m
    where m.studio_id=p_studio_id and m.role='OWNER';
    if v_owner_count<=1 then
      raise exception using errcode='23514', message='Cannot demote the last studio owner';
    end if;
  end if;

  update public.studio_members m
  set role=p_role
  where m.studio_id=p_studio_id and m.user_id=p_user_id;
  return found;
end
$function$;

create or replace function public.remove_studio_member_v63(
  p_studio_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_uid uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_owner_count integer;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if p_studio_id is null then
    raise exception using errcode='22023', message='Explicit studio selection is required';
  end if;
  if p_user_id is null then
    raise exception using errcode='22023', message='Member is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('studio-membership-v70:' || p_studio_id::text, 0)
  );

  select m.role into v_actor_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=v_uid
  for update;
  if not found then
    raise exception using errcode='42501', message='Studio membership required for selected workspace';
  end if;
  if v_actor_role<>'OWNER' then
    raise exception using errcode='42501', message='Owner membership required';
  end if;

  select m.role into v_target_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_user_id
  for update;
  if not found then
    return false;
  end if;

  if v_target_role='OWNER' then
    select count(*)::integer into v_owner_count
    from public.studio_members m
    where m.studio_id=p_studio_id and m.role='OWNER';
    if v_owner_count<=1 then
      raise exception using errcode='23514', message='Cannot remove the last studio owner';
    end if;
  end if;

  delete from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_user_id;
  return found;
end
$function$;

-- Calls through the current explicit-tenant API remain supported. Direct
-- calls to the unlocked one-tenant compatibility mutators are no longer valid.
revoke execute on function public.invite_studio_member_v21(text,text) from public,anon,authenticated,service_role;
revoke execute on function public.set_studio_member_role_v21(uuid,text) from public,anon,authenticated,service_role;
revoke execute on function public.remove_studio_member_v21(uuid) from public,anon,authenticated,service_role;
revoke execute on function public.cancel_studio_invite_v21(uuid) from public,anon,authenticated,service_role;

revoke all on function public.set_studio_member_role_v63(uuid,uuid,text) from public,anon;
revoke all on function public.remove_studio_member_v63(uuid,uuid) from public,anon;
grant execute on function public.set_studio_member_role_v63(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.remove_studio_member_v63(uuid,uuid) to authenticated,service_role;

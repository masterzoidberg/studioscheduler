-- SAFE-01 / V5.0 commit-time membership authorization hardening.
--
-- Canonical service writes already recheck the human actor in PostgreSQL. The
-- legacy actor-context helper, however, used a non-locking membership read, and
-- V4.9 adoption used `role NOT IN (...)` without an explicit missing-row check.
-- A concurrent role change/removal could therefore race the privileged write,
-- while a missing V4.9 adoption membership produced NULL rather than a denial.
--
-- Keep the existing scheduling implementations and signatures intact. Lock the
-- authoritative membership row while the transaction is in flight so normal
-- UPDATE/DELETE revocation on studio_members serializes with the commit boundary.

create or replace function private.dwde_actor_context()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_studio uuid;
  v_role text;
  v_actor text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  -- FOR UPDATE is deliberate. V4.6/V4.7/V4.8 and V4.9 model publication set
  -- auth.uid() to the submitted human actor and then call assert_editor_context.
  -- Holding this row through transaction end makes authorization and membership
  -- revocation obey database lock order instead of request timing.
  select m.studio_id,m.role into v_studio,v_role
  from public.studio_members m
  where m.user_id=v_uid
  order by case m.role when 'OWNER' then 0 when 'EDITOR' then 1 else 2 end
  limit 1
  for update;

  if not found or v_studio is null then
    raise exception using errcode = '42501', message = 'Studio membership required';
  end if;

  select coalesce(p.display_name,u.email,'Studio user') into v_actor
  from auth.users u
  left join public.profiles p on p.id=u.id
  where u.id=v_uid;

  return jsonb_build_object(
    'user_id',v_uid,
    'studio_id',v_studio,
    'role',v_role,
    'actor',v_actor
  );
end
$function$;

create or replace function private.assert_editor_context()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  ctx jsonb := private.dwde_actor_context();
begin
  if ctx->>'role' not in ('OWNER','EDITOR') then
    raise exception using errcode = '42501', message = 'Editor membership required';
  end if;
  return ctx;
end
$function$;

revoke all on function private.dwde_actor_context() from public,anon,authenticated;
revoke all on function private.assert_editor_context() from public,anon,authenticated;

-- V4.9 adoption does not use the legacy actor-context bridge, so make its exact
-- selected-workspace membership check independently null-safe and locking. The
-- lock is retained while V4.9 delegates to the already-proven V4.4/V3.3 chain.
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

  -- The service key is transport authority, not human authorization. Lock the
  -- exact selected membership before looking at candidate/context content. If a
  -- revocation already owns the row lock we wait and then re-evaluate its new
  -- role/existence; if this command owns it first, revocation waits for commit.
  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id
  for update;
  if not found or v_selected_role not in ('OWNER','EDITOR') then
    raise exception using errcode = '42501', message = 'Editor membership required for selected workspace';
  end if;

  v_result:=public.adopt_solver_candidate_v44(
    p_studio_id,p_actor_user_id,p_actor_label,p_reason,
    p_expected_context,p_candidate,p_application_validation
  );
  return v_result || jsonb_build_object(
    'authority','SERVER_CONSTRAINT_IR_V49',
    'actorRoleRechecked',true,
    'membershipSerialized',true
  );
end
$function$;

revoke all on function public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.adopt_solver_candidate_v49(uuid,uuid,text,text,jsonb,jsonb,jsonb)
  to service_role;

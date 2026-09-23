-- M01-T01: make invitation acceptance explicit, tenant-bound and time-limited.

alter table public.studio_invites
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz;

update public.studio_invites
set expires_at=created_at + interval '7 days'
where expires_at is null;

alter table public.studio_invites
  alter column expires_at set default (clock_timestamp() + interval '7 days'),
  alter column expires_at set not null;

-- Preserve pending history while invalidating older duplicate pending rows.
with ranked_pending as (
  select i.id,
         row_number() over (
           partition by i.studio_id,lower(i.email)
           order by i.created_at desc,i.id desc
         ) as duplicate_rank
  from public.studio_invites i
  where i.accepted_at is null and i.revoked_at is null
)
update public.studio_invites i
set revoked_at=clock_timestamp()
from ranked_pending d
where d.id=i.id and d.duplicate_rank>1;

alter table public.studio_invites
  drop constraint if exists studio_invites_studio_id_email_key;

create unique index if not exists studio_invites_one_pending_per_email_v71
  on public.studio_invites(studio_id,lower(email))
  where accepted_at is null and revoked_at is null;

create index if not exists studio_invites_invitee_lookup_v71
  on public.studio_invites(lower(email),studio_id,created_at desc)
  where accepted_at is null and revoked_at is null;

-- New account creation records a profile only. A matching email can have
-- invitations to multiple tenants, so signup must never choose one implicitly.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)))
  on conflict(id) do nothing;
  return new;
end
$function$;

create or replace function public.invite_studio_member_v63(
  p_studio_id uuid,
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_existing public.studio_invites%rowtype;
  v_email text:=lower(btrim(coalesce(p_email,'')));
  v_id uuid;
  v_expires_at timestamptz;
begin
  if p_studio_id is null then
    raise exception using errcode='22023',message='Explicit studio selection is required';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='A valid invitation email is required';
  end if;
  if p_role is null or p_role not in ('OWNER','EDITOR','VIEWER') then
    raise exception using errcode='22023',message='Invalid role';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('studio-membership-v70:' || p_studio_id::text,0)
  );
  perform private.require_studio_context_v63(p_studio_id,'OWNER');

  select i.* into v_existing
  from public.studio_invites i
  where i.studio_id=p_studio_id
    and lower(i.email)=v_email
    and i.accepted_at is null
    and i.revoked_at is null
  order by i.created_at desc
  limit 1
  for update;

  if found then
    if v_existing.expires_at>clock_timestamp() then
      raise exception using errcode='23505',message='An active invitation already exists for this email';
    end if;
    update public.studio_invites
    set revoked_at=clock_timestamp()
    where id=v_existing.id;
  end if;

  insert into public.studio_invites(studio_id,email,role,invited_by)
  values(p_studio_id,v_email,p_role,auth.uid())
  returning id,expires_at into v_id,v_expires_at;

  return jsonb_build_object(
    'id',v_id,
    'email',v_email,
    'role',p_role,
    'expiresAt',v_expires_at
  );
end
$function$;

create or replace function public.cancel_studio_invite_v63(
  p_studio_id uuid,
  p_invite_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $function$
begin
  if p_studio_id is null or p_invite_id is null then
    raise exception using errcode='22023',message='Studio and invitation are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('studio-membership-v70:' || p_studio_id::text,0)
  );
  perform private.require_studio_context_v63(p_studio_id,'OWNER');

  update public.studio_invites i
  set revoked_at=clock_timestamp()
  where i.id=p_invite_id
    and i.studio_id=p_studio_id
    and i.accepted_at is null
    and i.revoked_at is null;
  return found;
end
$function$;

create or replace function public.list_my_studio_invites_v71()
returns table(
  invite_id uuid,
  studio_id uuid,
  studio_name text,
  role text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception using errcode='42501',message='Authentication required';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id=v_uid;
  if v_email is null then
    return;
  end if;

  return query
  select i.id,i.studio_id,s.name::text,i.role::text,i.created_at,i.expires_at
  from public.studio_invites i
  join public.studios s on s.id=i.studio_id
  where lower(i.email)=v_email
    and i.accepted_at is null
    and i.revoked_at is null
  order by i.created_at desc,i.id;
end
$function$;

create or replace function public.accept_studio_invite_v71(
  p_studio_id uuid,
  p_invite_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_invite public.studio_invites%rowtype;
  v_existing_role text;
begin
  if v_uid is null then
    raise exception using errcode='42501',message='Authentication required';
  end if;
  if p_studio_id is null or p_invite_id is null then
    raise exception using errcode='22023',message='Invitation is unavailable';
  end if;

  select lower(u.email),u.email_confirmed_at
  into v_email,v_email_confirmed_at
  from auth.users u
  where u.id=v_uid;
  if v_email is null then
    raise exception using errcode='42501',message='Authentication required';
  end if;
  if v_email_confirmed_at is null then
    raise exception using errcode='42501',message='Confirm your email address before accepting';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('studio-membership-v70:' || p_studio_id::text,0)
  );

  select i.* into v_invite
  from public.studio_invites i
  where i.id=p_invite_id
    and i.studio_id=p_studio_id
    and lower(i.email)=v_email
    and i.accepted_at is null
    and i.revoked_at is null
  for update;
  if not found or v_invite.expires_at<=clock_timestamp() then
    raise exception using errcode='22023',message='Invitation is unavailable';
  end if;

  select m.role into v_existing_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=v_uid
  for update;
  if found then
    if v_existing_role<>v_invite.role then
      raise exception using errcode='22023',message='This account already has a different studio role';
    end if;
  else
    insert into public.studio_members(studio_id,user_id,role)
    values(p_studio_id,v_uid,v_invite.role);
  end if;

  update public.studio_invites
  set accepted_at=clock_timestamp()
  where id=v_invite.id and accepted_at is null and revoked_at is null;
  if not found then
    raise exception using errcode='22023',message='Invitation is unavailable';
  end if;

  return jsonb_build_object('studioId',p_studio_id,'role',v_invite.role);
end
$function$;

revoke all on function public.invite_studio_member_v63(uuid,text,text) from public,anon;
revoke all on function public.cancel_studio_invite_v63(uuid,uuid) from public,anon;
revoke all on function public.list_my_studio_invites_v71() from public,anon;
revoke all on function public.accept_studio_invite_v71(uuid,uuid) from public,anon;
grant execute on function public.invite_studio_member_v63(uuid,text,text) to authenticated,service_role;
grant execute on function public.cancel_studio_invite_v63(uuid,uuid) to authenticated,service_role;
grant execute on function public.list_my_studio_invites_v71() to authenticated,service_role;
grant execute on function public.accept_studio_invite_v71(uuid,uuid) to authenticated,service_role;

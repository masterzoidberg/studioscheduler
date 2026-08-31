-- DWDE Studio Scheduler V2.1 integrity and authorization stabilization.
-- Canonical data is client-readable by studio members but mutation is restricted to audited RPCs.

create table if not exists public.studio_invites (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  email text not null,
  role text not null check (role in ('OWNER','EDITOR','VIEWER')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique(studio_id,email)
);
alter table public.studio_invites enable row level security;
revoke all on public.studio_invites from anon, authenticated;

create or replace function private.is_studio_member(p_studio uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.studio_members where studio_id=p_studio and user_id=auth.uid()) $$;
create or replace function private.is_studio_editor(p_studio uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.studio_members where studio_id=p_studio and user_id=auth.uid() and role in ('OWNER','EDITOR')) $$;
create or replace function private.is_studio_owner(p_studio uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.studio_members where studio_id=p_studio and user_id=auth.uid() and role='OWNER') $$;

update public.studio_members m set role='OWNER'
where (m.studio_id,m.user_id) = (
  select x.studio_id,x.user_id from public.studio_members x
  where not exists(select 1 from public.studio_members o where o.studio_id=x.studio_id and o.role='OWNER')
  order by x.created_at asc limit 1
);

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
declare inv public.studio_invites%rowtype;
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)))
  on conflict(id) do nothing;
  select * into inv from public.studio_invites
  where lower(email)=lower(new.email) and accepted_at is null order by created_at asc limit 1;
  if inv.id is not null then
    insert into public.studio_members(studio_id,user_id,role) values(inv.studio_id,new.id,inv.role)
    on conflict(studio_id,user_id) do update set role=excluded.role;
    update public.studio_invites set accepted_at=now() where id=inv.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated using(auth.uid()=id);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated using(auth.uid()=id) with check(auth.uid()=id);
grant select,update on public.profiles to authenticated;

create or replace function public.invite_studio_member(p_email text,p_role text default 'EDITOR')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_studio uuid; v_uid uuid:=auth.uid(); v_id uuid; v_existing_user uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select studio_id into v_studio from public.studio_members where user_id=v_uid and role='OWNER' limit 1;
  if v_studio is null then raise exception 'Owner membership required'; end if;
  if p_role not in ('OWNER','EDITOR','VIEWER') then raise exception 'Invalid role'; end if;
  if coalesce(btrim(p_email),'')='' then raise exception 'Email is required'; end if;
  insert into public.studio_invites(studio_id,email,role,invited_by)
  values(v_studio,lower(btrim(p_email)),p_role,v_uid)
  on conflict(studio_id,email) do update set role=excluded.role,invited_by=excluded.invited_by,created_at=now(),accepted_at=null
  returning id into v_id;
  select id into v_existing_user from auth.users where lower(email)=lower(btrim(p_email)) limit 1;
  if v_existing_user is not null then
    insert into public.studio_members(studio_id,user_id,role) values(v_studio,v_existing_user,p_role)
    on conflict(studio_id,user_id) do update set role=excluded.role;
    update public.studio_invites set accepted_at=now() where id=v_id;
  end if;
  return jsonb_build_object('inviteId',v_id,'email',lower(btrim(p_email)),'role',p_role,'accepted',v_existing_user is not null);
end $$;

do $$ declare p record; begin
  for p in select schemaname,tablename,policyname from pg_policies where schemaname='public' and policyname ilike '%alpha%' loop
    execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;

drop function if exists private.alpha_access_allowed();
drop table if exists private.alpha_access;

do $$ declare p record; begin
  for p in select schemaname,tablename,policyname from pg_policies where schemaname='public' and policyname like '%member_all' loop
    execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;

drop policy if exists studio_member_select on public.studios;
create policy studio_member_select on public.studios for select to authenticated using(private.is_studio_member(id));
drop policy if exists member_select on public.studio_members;
create policy member_select_self on public.studio_members for select to authenticated using(user_id=auth.uid());
create policy member_select_owner on public.studio_members for select to authenticated using(private.is_studio_owner(studio_id));

do $$ declare t text; begin
  foreach t in array array['teachers','rooms','students','cohorts','class_definitions','class_sessions','rules','rulebook_versions','rule_history','schedule_versions','assignments','scenarios','ai_proposals','audit_events'] loop
    execute format('drop policy if exists %I on public.%I','member_select_'||t,t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_studio_member(studio_id))','member_select_'||t,t);
    execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
revoke all on public.studios from anon;
grant select on public.studios to authenticated;
revoke insert,update,delete on public.studio_members from anon,authenticated;
grant select on public.studio_members to authenticated;

create or replace function private.resolve_dwde_actor()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_studio uuid; v_actor text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select studio_id into v_studio from public.studio_members where user_id=v_uid and role in ('OWNER','EDITOR') order by case role when 'OWNER' then 0 else 1 end limit 1;
  if v_studio is null then raise exception 'Editor membership required'; end if;
  select coalesce(p.display_name,u.email,'Studio user') into v_actor from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  return jsonb_build_object('studio_id',v_studio,'actor',v_actor,'user_id',v_uid);
end $$;

create or replace function private.validate_schedule_core(p_schedule_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_studio uuid; v_hard int; v_applicable int; v_implemented int; v_partial int; v_not int; v_violations jsonb; v_uncovered text[];
begin
  select studio_id into v_studio from public.schedule_versions where id=p_schedule_version_id;
  if v_studio is null then raise exception 'Schedule version not found'; end if;
  with violations as (
    select 'CUR-005'::text constraint_id,'HARD'::text severity,'Class duration does not match the class definition.'::text message,array[a.id]::text[] assignment_ids
    from public.assignments a join public.class_sessions s on s.id=a.session_id join public.class_definitions c on c.id=s.class_id
    where a.schedule_version_id=p_schedule_version_id and extract(epoch from (a.end_time-a.start_time))/60 <> c.duration_minutes
    union all
    select 'OPS-017','HARD','Assignment is not on the 15-minute scheduling grid.',array[a.id]::text[]
    from public.assignments a where a.schedule_version_id=p_schedule_version_id and ((extract(hour from a.start_time)::int*60+extract(minute from a.start_time)::int)%15<>0 or (extract(hour from a.end_time)::int*60+extract(minute from a.end_time)::int)%15<>0)
    union all
    select 'OPS-008','HARD','Room is double-booked.',array[a.id,b.id]::text[]
    from public.assignments a join public.assignments b on b.schedule_version_id=a.schedule_version_id and b.id>a.id and b.day=a.day and b.room_id=a.room_id and a.start_time<b.end_time and b.start_time<a.end_time where a.schedule_version_id=p_schedule_version_id
    union all
    select 'OPS-009','HARD','Teacher is double-booked.',array[a.id,b.id]::text[]
    from public.assignments a join public.assignments b on b.schedule_version_id=a.schedule_version_id and b.id>a.id and b.day=a.day and b.teacher_id=a.teacher_id and a.start_time<b.end_time and b.start_time<a.end_time where a.schedule_version_id=p_schedule_version_id
    union all
    select 'OPS-010','HARD','One or more dancers are double-booked.',array[a.id,b.id]::text[]
    from public.assignments a join public.assignments b on b.schedule_version_id=a.schedule_version_id and b.id>a.id and b.day=a.day and a.start_time<b.end_time and b.start_time<a.end_time
    join public.class_sessions sa on sa.id=a.session_id join public.class_sessions sb on sb.id=b.session_id
    join public.class_definitions ca on ca.id=sa.class_id join public.class_definitions cb on cb.id=sb.class_id
    where a.schedule_version_id=p_schedule_version_id and ca.roster_student_ids && cb.roster_student_ids
  )
  select count(*),coalesce(jsonb_agg(jsonb_build_object('constraintId',constraint_id,'severity',severity,'message',message,'assignmentIds',assignment_ids,'affectedEntityIds','[]'::jsonb)),'[]'::jsonb)
  into v_hard,v_violations from violations;
  select count(*) filter(where enforcement_status<>'NOT_APPLICABLE'),
         count(*) filter(where enforcement_status='IMPLEMENTED'),
         count(*) filter(where enforcement_status='PARTIAL'),
         count(*) filter(where enforcement_status='NOT_IMPLEMENTED'),
         coalesce(array_agg(id order by id) filter(where enforcement_status in ('PARTIAL','NOT_IMPLEMENTED')),'{}'::text[])
  into v_applicable,v_implemented,v_partial,v_not,v_uncovered
  from public.rules where studio_id=v_studio and status='ACTIVE' and classification_raw='HARD';
  return jsonb_build_object('valid',v_hard=0,'fullyValidated',v_hard=0 and cardinality(v_uncovered)=0,'hardViolations',v_hard,'warnings',0,'violations',v_violations,
    'coverage',jsonb_build_object('applicableHardRules',v_applicable,'implementedHardRules',v_implemented,'partialHardRules',v_partial,'notImplementedHardRules',v_not,'uncoveredHardRuleIds',to_jsonb(v_uncovered)));
end $$;
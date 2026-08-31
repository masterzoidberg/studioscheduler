create table if not exists public.entity_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  entity_type text not null check (entity_type in ('TEACHER','ROOM','CLASS')),
  entity_id text not null,
  version integer not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  reason text not null,
  before_entity jsonb,
  after_entity jsonb not null,
  created_at timestamptz not null default now(),
  unique(studio_id, entity_type, entity_id, version)
);
alter table public.entity_versions enable row level security;
revoke all on public.entity_versions from anon, authenticated;
grant select on public.entity_versions to authenticated;
drop policy if exists member_select_entity_versions on public.entity_versions;
create policy member_select_entity_versions on public.entity_versions for select to authenticated using (private.is_studio_member(studio_id));

alter table public.studio_invites enable row level security;
revoke all on public.studio_invites from anon, authenticated;
grant select on public.studio_invites to authenticated;
drop policy if exists owner_select_studio_invites on public.studio_invites;
create policy owner_select_studio_invites on public.studio_invites for select to authenticated using (private.is_studio_owner(studio_id));

revoke all on table public.studios, public.studio_members, public.teachers, public.rooms, public.students, public.cohorts,
  public.class_definitions, public.class_sessions, public.rules, public.rulebook_versions, public.rule_history,
  public.schedule_versions, public.assignments, public.scenarios, public.ai_proposals, public.audit_events from anon;

grant select on table public.studios, public.studio_members, public.teachers, public.rooms, public.students, public.cohorts,
  public.class_definitions, public.class_sessions, public.rules, public.rulebook_versions, public.rule_history,
  public.schedule_versions, public.assignments, public.scenarios, public.ai_proposals, public.audit_events to authenticated;

create or replace function private.dwde_actor_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_studio uuid;
  v_role text;
  v_actor text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select m.studio_id,m.role into v_studio,v_role
  from public.studio_members m
  where m.user_id=v_uid
  order by case m.role when 'OWNER' then 0 when 'EDITOR' then 1 else 2 end
  limit 1;
  if v_studio is null then raise exception 'Studio membership required'; end if;
  select coalesce(p.display_name,u.email,'Studio user') into v_actor
  from auth.users u left join public.profiles p on p.id=u.id where u.id=v_uid;
  return jsonb_build_object('user_id',v_uid,'studio_id',v_studio,'role',v_role,'actor',v_actor);
end
$function$;

create or replace function private.assert_editor_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare ctx jsonb := private.dwde_actor_context();
begin
  if ctx->>'role' not in ('OWNER','EDITOR') then raise exception 'Editor membership required'; end if;
  return ctx;
end
$function$;

revoke execute on function public.apply_rule_patch(text,text,jsonb,text,boolean) from public, anon, authenticated;
revoke execute on function public.apply_schedule_patch(text,jsonb,text,jsonb,boolean) from public, anon, authenticated;
revoke execute on function public.import_canonical_rulebook(jsonb,text) from public, anon, authenticated;
revoke execute on function public.import_reviewed_rulebook(jsonb,text,text) from public, anon, authenticated;
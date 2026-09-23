-- Setup workflow metadata for manager-assigned, self-service setup work.
-- This table never replaces PlanningDataset, Rulebook, ConstraintModel, or ScheduleVersion.

create table public.setup_assignments(
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  area text not null check (area in ('STUDIO','PEOPLE','CLASSES','STUDENTS','POLICIES','IMPORT')),
  title text not null check (length(btrim(title)) between 1 and 160),
  instructions text check (instructions is null or length(instructions) <= 2000),
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','DONE')),
  assigned_to uuid not null references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index setup_assignments_studio_updated_idx
  on public.setup_assignments(studio_id, status, updated_at desc);

alter table public.setup_assignments enable row level security;
revoke all on table public.setup_assignments from public, anon;
grant select on table public.setup_assignments to authenticated;
grant all on table public.setup_assignments to service_role;

create policy setup_assignments_member_read
  on public.setup_assignments
  for select to authenticated
  using (
    exists (
      select 1
      from public.studio_members m
      where m.studio_id=setup_assignments.studio_id
        and m.user_id=auth.uid()
    )
  );

create or replace function public.list_setup_assignments_v69(p_studio_id uuid)
returns table(
  id uuid,
  studio_id uuid,
  area text,
  title text,
  instructions text,
  status text,
  assigned_to uuid,
  assigned_to_label text,
  created_by uuid,
  created_by_label text,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz
)
language plpgsql volatile security definer set search_path=''
as $function$
begin
  perform private.require_studio_context_v63(p_studio_id,'MEMBER');
  return query
  select a.id,a.studio_id,a.area,a.title,a.instructions,a.status,a.assigned_to,
    coalesce(ap.display_name,au.email,'Studio user'),a.created_by,
    coalesce(cp.display_name,cu.email,'Studio user'),a.created_at,a.updated_at,a.completed_at
  from public.setup_assignments a
  join auth.users au on au.id=a.assigned_to
  left join public.profiles ap on ap.id=a.assigned_to
  join auth.users cu on cu.id=a.created_by
  left join public.profiles cp on cp.id=a.created_by
  where a.studio_id=p_studio_id
  order by case a.status when 'OPEN' then 1 when 'IN_PROGRESS' then 2 else 3 end,
    a.updated_at desc,a.id;
end
$function$;

create or replace function public.create_setup_assignment_v69(
  p_studio_id uuid,
  p_assigned_to uuid,
  p_area text,
  p_title text,
  p_instructions text default null
)
returns jsonb
language plpgsql volatile security definer set search_path=''
as $function$
declare
  v_context jsonb;
  v_assigned_role text;
  v_id uuid;
begin
  v_context:=private.require_studio_context_v63(p_studio_id,'EDITOR');
  if p_assigned_to is null then raise exception 'SETUP_ASSIGNMENT_ASSIGNEE_REQUIRED'; end if;
  if p_area is null or p_area not in ('STUDIO','PEOPLE','CLASSES','STUDENTS','POLICIES','IMPORT') then
    raise exception 'SETUP_ASSIGNMENT_AREA_INVALID';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 160 then
    raise exception 'SETUP_ASSIGNMENT_TITLE_INVALID';
  end if;
  if p_instructions is not null and length(p_instructions)>2000 then
    raise exception 'SETUP_ASSIGNMENT_INSTRUCTIONS_INVALID';
  end if;
  select m.role into v_assigned_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_assigned_to;
  if not found then raise exception 'SETUP_ASSIGNMENT_ASSIGNEE_NOT_MEMBER'; end if;
  if v_assigned_role not in ('OWNER','EDITOR') then
    raise exception 'SETUP_ASSIGNMENT_ASSIGNEE_MUST_EDIT';
  end if;
  insert into public.setup_assignments(studio_id,area,title,instructions,assigned_to,created_by)
  values(p_studio_id,p_area,btrim(p_title),nullif(btrim(coalesce(p_instructions,'')),''),p_assigned_to,(v_context->>'user_id')::uuid)
  returning id into v_id;
  return jsonb_build_object('id',v_id,'status','OPEN');
end
$function$;

create or replace function public.update_setup_assignment_v69(
  p_studio_id uuid,
  p_assignment_id uuid,
  p_assigned_to uuid,
  p_area text,
  p_title text,
  p_instructions text,
  p_status text
)
returns jsonb
language plpgsql volatile security definer set search_path=''
as $function$
declare
  v_context jsonb;
  v_uid uuid;
  v_role text;
  v_assignment public.setup_assignments%rowtype;
  v_assigned_role text;
begin
  v_context:=private.require_studio_context_v63(p_studio_id,'MEMBER');
  v_uid:=(v_context->>'user_id')::uuid;
  v_role:=v_context->>'role';
  if p_status is null or p_status not in ('OPEN','IN_PROGRESS','DONE') then
    raise exception 'SETUP_ASSIGNMENT_STATUS_INVALID';
  end if;
  select * into v_assignment
  from public.setup_assignments a
  where a.id=p_assignment_id and a.studio_id=p_studio_id
  for update;
  if not found then raise exception 'SETUP_ASSIGNMENT_NOT_FOUND'; end if;
  if v_role not in ('OWNER','EDITOR') and v_assignment.assigned_to<>v_uid then
    raise exception 'SETUP_ASSIGNMENT_UPDATE_FORBIDDEN';
  end if;
  if v_role not in ('OWNER','EDITOR') and (
    p_assigned_to is distinct from v_assignment.assigned_to
    or p_area is distinct from v_assignment.area
    or p_title is distinct from v_assignment.title
    or nullif(btrim(coalesce(p_instructions,'')),'') is distinct from v_assignment.instructions
  ) then
    raise exception 'SETUP_ASSIGNMENT_ASSIGNEE_FIELDS_READ_ONLY';
  end if;
  if v_role in ('OWNER','EDITOR') then
    if p_assigned_to is null then raise exception 'SETUP_ASSIGNMENT_ASSIGNEE_REQUIRED'; end if;
    if p_area is null or p_area not in ('STUDIO','PEOPLE','CLASSES','STUDENTS','POLICIES','IMPORT') then
      raise exception 'SETUP_ASSIGNMENT_AREA_INVALID';
    end if;
    if p_title is null or length(btrim(p_title)) not between 1 and 160 then
      raise exception 'SETUP_ASSIGNMENT_TITLE_INVALID';
    end if;
    if p_instructions is not null and length(p_instructions)>2000 then
      raise exception 'SETUP_ASSIGNMENT_INSTRUCTIONS_INVALID';
    end if;
    select m.role into v_assigned_role
    from public.studio_members m
    where m.studio_id=p_studio_id and m.user_id=p_assigned_to;
    if not found then raise exception 'SETUP_ASSIGNMENT_ASSIGNEE_NOT_MEMBER'; end if;
    if v_assigned_role not in ('OWNER','EDITOR') then raise exception 'SETUP_ASSIGNMENT_ASSIGNEE_MUST_EDIT'; end if;
  else
    p_assigned_to:=v_assignment.assigned_to;
    p_area:=v_assignment.area;
    p_title:=v_assignment.title;
    p_instructions:=v_assignment.instructions;
  end if;
  update public.setup_assignments
  set assigned_to=p_assigned_to,
      area=p_area,
      title=btrim(p_title),
      instructions=nullif(btrim(coalesce(p_instructions,'')),''),
      status=p_status,
      updated_at=now(),
      completed_at=case when p_status='DONE' then coalesce(completed_at,now()) else null end
  where id=p_assignment_id and studio_id=p_studio_id;
  return jsonb_build_object('id',p_assignment_id,'status',p_status);
end
$function$;

revoke all on function public.list_setup_assignments_v69(uuid) from public,anon;
revoke all on function public.create_setup_assignment_v69(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.update_setup_assignment_v69(uuid,uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.list_setup_assignments_v69(uuid) to authenticated,service_role;
grant execute on function public.create_setup_assignment_v69(uuid,uuid,text,text,text) to authenticated,service_role;
grant execute on function public.update_setup_assignment_v69(uuid,uuid,uuid,text,text,text,text) to authenticated,service_role;

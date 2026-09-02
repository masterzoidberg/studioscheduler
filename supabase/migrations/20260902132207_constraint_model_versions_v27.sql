-- Milestone 2 / V2.7 ConstraintModelVersion persistence.
--
-- ConstraintModelVersion stores the deterministic meaning of the Rulebook.
-- It is intentionally independent of PlanningDatasetVersion, which stores the
-- mutable planning facts to which the model is applied. Existing schedules and
-- scenarios remain unpinned (NULL) until a tested model is published and they are
-- explicitly revalidated/rebased.

create table if not exists public.constraint_model_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  version integer not null check (version > 0),
  rulebook_version integer not null,
  compiler_version text not null check (btrim(compiler_version) <> ''),
  created_at timestamptz not null default now(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_label text not null,
  reason text not null,
  snapshot jsonb not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  complete_hard_constraint_compilation boolean not null,
  status text not null default 'HISTORICAL' check (status in ('CURRENT','HISTORICAL')),
  unique (studio_id,version),
  constraint constraint_model_rulebook_fk
    foreign key (studio_id,rulebook_version)
    references public.rulebook_versions(studio_id,version)
    on delete restrict
);

create unique index if not exists idx_constraint_model_one_current
  on public.constraint_model_versions(studio_id)
  where status='CURRENT';
create index if not exists idx_constraint_model_rulebook
  on public.constraint_model_versions(studio_id,rulebook_version,version desc);

alter table public.constraint_model_versions enable row level security;
drop policy if exists member_select_constraint_model_versions on public.constraint_model_versions;
create policy member_select_constraint_model_versions
  on public.constraint_model_versions
  for select to authenticated
  using (private.is_studio_member(studio_id));

revoke all on table public.constraint_model_versions from public,anon,authenticated;
grant select on table public.constraint_model_versions to authenticated;
grant all on table public.constraint_model_versions to service_role;

create or replace function private.constraint_model_hash_v27(p_snapshot jsonb)
returns text
language sql
immutable
set search_path=''
as $function$
  select encode(extensions.digest(pg_catalog.convert_to(p_snapshot::text,'UTF8'),'sha256'),'hex')
$function$;
revoke all on function private.constraint_model_hash_v27(jsonb) from public,anon,authenticated;

create or replace function private.validate_constraint_model_snapshot_v27(
  p_snapshot jsonb,
  p_rulebook_version integer,
  p_compiler_version text
)
returns void
language plpgsql
immutable
set search_path=''
as $function$
begin
  if jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Constraint model snapshot must be a JSON object';
  end if;
  if p_snapshot->>'schemaVersion' <> '1.0' then
    raise exception 'Constraint model schemaVersion must be 1.0';
  end if;
  if coalesce((p_snapshot->>'rulebookVersion')::integer,0) <> p_rulebook_version then
    raise exception 'Constraint model Rulebook version does not match row Rulebook version';
  end if;
  if coalesce(p_snapshot->>'compilerVersion','') <> p_compiler_version then
    raise exception 'Constraint model compiler version does not match row compiler version';
  end if;
  if coalesce((p_snapshot->>'activeRuleCount')::integer,0) <> 178 then
    raise exception 'DWDE constraint model must account for 178 active rules';
  end if;
  if coalesce((p_snapshot->>'completeHardConstraintCompilation')::boolean,false) is not true then
    raise exception 'Only complete HARD Constraint IR models may be published';
  end if;
  if jsonb_typeof(p_snapshot->'hardConstraints') <> 'array' then
    raise exception 'Constraint model hardConstraints must be an array';
  end if;
  if jsonb_typeof(p_snapshot->'objectivePrioritySpine') <> 'array' then
    raise exception 'Constraint model objectivePrioritySpine must be an array';
  end if;
  if jsonb_array_length(p_snapshot->'objectivePrioritySpine') <> 9 then
    raise exception 'DWDE objective priority spine must contain OPT-001 through OPT-009';
  end if;
  if jsonb_typeof(p_snapshot->'readinessRuleIds') <> 'array' then
    raise exception 'Constraint model readinessRuleIds must be an array';
  end if;
  if jsonb_typeof(p_snapshot->'governanceAssertions') <> 'array' then
    raise exception 'Constraint model governanceAssertions must be an array';
  end if;
  if jsonb_typeof(p_snapshot->'uncompiledConstraintRuleIds') <> 'array'
     or jsonb_array_length(p_snapshot->'uncompiledConstraintRuleIds') <> 0 then
    raise exception 'Published constraint model may not contain uncompiled Constraint IR rules';
  end if;
  if p_snapshot ? 'planningDatasetVersion' then
    raise exception 'ConstraintModelVersion must not embed PlanningDatasetVersion';
  end if;
end
$function$;
revoke all on function private.validate_constraint_model_snapshot_v27(jsonb,integer,text) from public,anon,authenticated;

alter table public.schedule_versions
  add column if not exists constraint_model_version integer null;
alter table public.scenarios
  add column if not exists base_constraint_model_version integer null;

do $block$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname='schedule_versions_constraint_model_fk'
      and conrelid='public.schedule_versions'::regclass
  ) then
    alter table public.schedule_versions
      add constraint schedule_versions_constraint_model_fk
      foreign key (studio_id,constraint_model_version)
      references public.constraint_model_versions(studio_id,version)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname='scenarios_constraint_model_fk'
      and conrelid='public.scenarios'::regclass
  ) then
    alter table public.scenarios
      add constraint scenarios_constraint_model_fk
      foreign key (studio_id,base_constraint_model_version)
      references public.constraint_model_versions(studio_id,version)
      on delete restrict;
  end if;
end
$block$;

create index if not exists idx_schedule_versions_constraint_model_fk
  on public.schedule_versions(studio_id,constraint_model_version)
  where constraint_model_version is not null;
create index if not exists idx_scenarios_constraint_model_fk
  on public.scenarios(studio_id,base_constraint_model_version)
  where base_constraint_model_version is not null;

-- Deliberately do not seed a CURRENT ConstraintModelVersion here. Publication is
-- an engineering artifact produced by the tested TypeScript compiler, not another
-- handwritten SQL interpretation of Rulebook semantics.

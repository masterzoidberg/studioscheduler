-- V2.2 separates human-reviewed Rulebook truth from machine-enforcement truth.
-- RulebookVersion records what humans said. RuleEnforcementVersion records what the validator
-- is approved to enforce. ScheduleVersion is reproducible only when linked to both.

create table if not exists public.rule_enforcement_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  version integer not null,
  rulebook_version integer not null,
  created_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  reason text not null,
  changed_rule_ids text[] not null default '{}',
  snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'HISTORICAL' check (status in ('CURRENT','HISTORICAL')),
  unique(studio_id,version)
);

create unique index if not exists one_current_enforcement_version_per_studio
  on public.rule_enforcement_versions(studio_id) where status='CURRENT';

create table if not exists public.rule_enforcement_proposals (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  rule_id text not null references public.rules(id) on delete cascade,
  base_rulebook_version integer not null,
  base_enforcement_version integer not null,
  proposed_mapping jsonb not null,
  rationale text not null,
  proposal_source text not null default 'USER' check (proposal_source in ('SYSTEM','USER','AI')),
  status text not null default 'PROPOSED' check (status in ('PROPOSED','APPROVED','REJECTED','SUPERSEDED')),
  proposed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rule_enforcement_proposals_studio_status
  on public.rule_enforcement_proposals(studio_id,status,created_at desc);
create index if not exists idx_rule_enforcement_proposals_rule
  on public.rule_enforcement_proposals(studio_id,rule_id,created_at desc);

alter table public.schedule_versions
  add column if not exists enforcement_version integer;

-- Enforcement v1 is a faithful description of the five deterministic checks that V2.1 already
-- enforced in production. This does not add new policy and does not alter reviewed Rulebook text.
insert into public.rule_enforcement_versions(
  studio_id,version,rulebook_version,actor_label,reason,changed_rule_ids,snapshot,status
)
select
  s.id,
  1,
  coalesce(
    (select rv.version from public.rulebook_versions rv where rv.studio_id=s.id and rv.status='CURRENT' limit 1),
    (select max(sv.rulebook_version) from public.schedule_versions sv where sv.studio_id=s.id),
    0
  ),
  'V2.2 system',
  'Capture previously implemented V2.1 deterministic checks as explicit enforcement mappings',
  coalesce(array_agg(r.id order by r.id) filter (where r.id is not null),'{}'::text[]),
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ruleId',r.id,
        'type',case r.id
          when 'CUR-005' then 'CLASS_DURATION'
          when 'OPS-008' then 'ROOM_NO_OVERLAP'
          when 'OPS-009' then 'TEACHER_NO_OVERLAP'
          when 'OPS-010' then 'STUDENT_NO_OVERLAP'
          when 'OPS-017' then 'TIME_GRID'
        end,
        'parameters','{}'::jsonb,
        'affectedEntityIds','[]'::jsonb,
        'exceptions','[]'::jsonb
      ) order by r.id
    ) filter (where r.id is not null),
    '[]'::jsonb
  ),
  'CURRENT'
from public.studios s
left join public.rules r
  on r.studio_id=s.id
 and r.id in ('CUR-005','OPS-008','OPS-009','OPS-010','OPS-017')
 and r.status='ACTIVE'
 and r.enforcement_status='IMPLEMENTED'
where not exists (
  select 1 from public.rule_enforcement_versions ev where ev.studio_id=s.id
)
group by s.id;

update public.schedule_versions sv
set enforcement_version=coalesce(
  (select ev.version from public.rule_enforcement_versions ev where ev.studio_id=sv.studio_id and ev.status='CURRENT' limit 1),
  1
)
where sv.enforcement_version is null;

alter table public.schedule_versions
  alter column enforcement_version set default 1,
  alter column enforcement_version set not null;

do $block$
begin
  if not exists (
    select 1 from pg_constraint where conname='schedule_versions_enforcement_version_fkey'
  ) then
    alter table public.schedule_versions
      add constraint schedule_versions_enforcement_version_fkey
      foreign key(studio_id,enforcement_version)
      references public.rule_enforcement_versions(studio_id,version);
  end if;
end $block$;

alter table public.rule_enforcement_versions enable row level security;
alter table public.rule_enforcement_proposals enable row level security;

revoke all on public.rule_enforcement_versions from anon,authenticated;
revoke all on public.rule_enforcement_proposals from anon,authenticated;
grant select on public.rule_enforcement_versions to authenticated;
grant select on public.rule_enforcement_proposals to authenticated;

drop policy if exists member_select_rule_enforcement_versions on public.rule_enforcement_versions;
create policy member_select_rule_enforcement_versions
  on public.rule_enforcement_versions for select to authenticated
  using (private.is_studio_member(studio_id));

drop policy if exists member_select_rule_enforcement_proposals on public.rule_enforcement_proposals;
create policy member_select_rule_enforcement_proposals
  on public.rule_enforcement_proposals for select to authenticated
  using (private.is_studio_member(studio_id));
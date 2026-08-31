-- Cover V2.2 foreign keys used for referential checks and future history growth.
-- Index-only migration: no canonical studio data or enforcement policy changes.

create index if not exists idx_rule_enforcement_proposals_rule_id
  on public.rule_enforcement_proposals(rule_id);

create index if not exists idx_rule_enforcement_proposals_proposed_by
  on public.rule_enforcement_proposals(proposed_by_user_id);

create index if not exists idx_rule_enforcement_proposals_reviewed_by
  on public.rule_enforcement_proposals(reviewed_by_user_id);

create index if not exists idx_rule_enforcement_versions_actor_user
  on public.rule_enforcement_versions(actor_user_id);

create index if not exists idx_scenarios_enforcement_version
  on public.scenarios(studio_id, base_enforcement_version);

create index if not exists idx_schedule_versions_enforcement_version
  on public.schedule_versions(studio_id, enforcement_version);

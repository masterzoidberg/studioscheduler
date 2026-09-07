# Active Decision Log

This log records decisions material to this execution plan, not a duplicate of [ADR 0001](../docs/architecture/0001-scheduling-foundation-decisions.md). Dates record decisions, not delivery promises. Initial decisions preserve the completed audit; no implementation is implied.

## DEC-001 — Preserve CP-SAT

Status: Accepted
Date: 2026-09-06
Decision: Keep Python OR-Tools CP-SAT and the stateless service as the search engine.
Reason: Existing feasibility/service code and 24 passing Python tests justify completing it.
Alternatives considered: Timefold bake-off or rewrite.
Consequences: Maintain independent runtime validation and measured resource budgets.
Revisit when: Representative full DWDE workload demonstrates a material modeling or operational failure.

## DEC-002 — Evolve without a rewrite

Status: Accepted
Date: 2026-09-06
Decision: Preserve Next.js, Supabase, domain identities, snapshots, audit and schedule UX.
Reason: Correctness gaps are bounded; a rewrite delays real use.
Alternatives considered: Greenfield architecture or wholesale schema renaming.
Consequences: Stage command cutover and remove superseded paths safely.
Revisit when: Evidence shows an existing component cannot satisfy a required bounded use case.

## DEC-003 — DWDE remains a configured tenant

Status: Accepted
Date: 2026-09-06
Decision: Keep DWDE prepopulated and preserve its history/golden fixture.
Reason: It is the first real user and most demanding validation case.
Alternatives considered: Remove DWDE branding/data wholesale or maintain a separate fork.
Consequences: Tenant extraction migrates policy, not customer identity/history.
Revisit when: A verified data migration needs compatibility handling.

## DEC-004 — Tenant logic leaves reusable code

Status: Accepted
Date: 2026-09-06
Decision: Move named policy, DWDE Rule dispatch and readiness requirements into tenant records.
Reason: Studio #2 must not require custom compilation or SQL repair policy.
Alternatives considered: Plugin/policy marketplace or per-customer source forks.
Consequences: T05 is an explicitly temporary content guard; T21 removes live coupling.
Revisit when: A genuinely new generic constraint family is required by repeated supported-domain demand.

## DEC-005 — Stable IDs carry canonical identity

Status: Accepted
Date: 2026-09-06
Decision: Use typed stable IDs and explicit taxonomy relationships; names are presentation.
Reason: Name normalization and renaming can change scheduling correctness.
Alternatives considered: Fuzzy runtime matching or global display-name uniqueness.
Consequences: Versioned compatibility for old artifacts; reviewed name resolution only during intake.
Revisit when: Import usability or historical binding requires a documented adapter.

## DEC-006 — AI stays non-authoritative

Status: Accepted
Date: 2026-09-06
Decision: AI proposes typed changes or explains deterministic findings; human approves policy.
Reason: Canonical truth must not depend on hallucinated context or model output.
Alternatives considered: Autonomous policy inference/application.
Consequences: T16 contains stale AI behavior; T28 alignment optional for launch.
Revisit when: New assistance capability can be evaluated without changing legality authority.

## DEC-007 — Soft optimization follows HARD correctness

Status: Accepted
Date: 2026-09-06
Decision: Implement a few transparent hierarchical penalties after coherent validated scheduling.
Reason: Attractive but illegal schedules have no value; current objective spine is metadata.
Alternatives considered: Feature-rich weighted optimization first.
Consequences: T17–T19 follow T14; promote to DWDE P0 only on manager usability evidence.
Revisit when: Manager cannot use first-feasible schedules with bounded manual finishing.

## DEC-008 — No broad integrations before pilots

Status: Accepted
Date: 2026-09-06
Decision: Use CSV and standard onboarding until repeated demand proves specific integrations.
Reason: Avoid high-cost speculative platform coupling.
Alternatives considered: Immediate Studio Pro/Jackrabbit/GymDesk connectors.
Consequences: T26 CSV; Milestone G deferred.
Revisit when: Repeated paying pilot requests and measured setup cost support one integration.

## DEC-009 — Historical migrations remain immutable

Status: Accepted
Date: 2026-09-06
Decision: Use forward migrations; retain bootstrap/ledger provenance and canonical hashes.
Reason: Rewriting history undermines reconstruction and recovery.
Alternatives considered: Rename/rewrite applied SQL to make current checks pass.
Consequences: T01 enforces LF integrity; T02 reconstructs disposable state.
Revisit when: A verified discrepancy needs forward repair or an explicitly separate archival annotation.

## DEC-010 — One scheduling authority, two acceptance modes

Status: Accepted
Date: 2026-09-06
Decision: Use common deterministic semantics for all writes; separate draft placement legality from final completeness.
Reason: Manual/solver divergence and partial-edit deadlocks both threaten use.
Alternatives considered: Permanent parallel engines or all-or-nothing complete editing.
Consequences: T10–T13 cutover; preserve SQL structural checks and historical readers.
Revisit when: A specific constraint exposes an unresolved partial-evaluation rule.

## DEC-011 — Snapshot coherence and reviewed candidate context

Status: Accepted
Date: 2026-09-06
Decision: Build from immutable snapshots and pin base schedule/lock context through adoption.
Reason: Version labels alone do not prove coherent reads or reviewed state.
Alternatives considered: Best-effort mutable reads and fresh-token substitution.
Consequences: T07/T08 add concurrency tests; no event sourcing.
Revisit when: Measured snapshot overhead or schema evolution demands a contained change.

## DEC-012 — Canonical ledger with derived queue

Status: Accepted
Date: 2026-09-06
Decision: TASKS.md owns status; README/NEXT/prompts and milestone checklists are coordinated views.
Reason: Persistent execution must not create competing roadmaps.
Alternatives considered: Multiple independent roadmap documents.
Consequences: Update derived views after each task; no task initially DONE.
Revisit when: Plan drift indicates a need for lightweight validation automation.

## DEC-013 — Dependency refinements preserve audit priorities

Status: Accepted
Date: 2026-09-06
Decision: Make implicit correctness prerequisites explicit in the task ledger: T04 after T03, T07 after T05/T06, T26 after T24, T22 after T16 for the authenticated verification harness, and T27 after all generic gates.
Reason: The audit's broad ordering needs executable minimum dependencies and supported UI/import scope.
Alternatives considered: Treat audit phase labels as independent readiness.
Consequences: Only T01 READY initially. These are sequencing clarifications, not changed audit findings.
Revisit when: Current code provides verified equivalent prerequisite acceptance.

## DEC-014 — Launch-safe AI containment is distinct from later alignment

Status: Accepted
Date: 2026-09-06
Decision: T16 hides/corrects misleading legacy guidance if necessary; T28 implements fuller optional canonical-context/template assistance.
Reason: DWDE should not wait for optional AI, but cannot expose claims inconsistent with current scheduling authority.
Alternatives considered: Block launch on full AI strategy or leave stale authority claims visible.
Consequences: T28 is not a dependency for T27/T29 unless AI is shipped as part of that release.
Revisit when: Enabled AI capabilities expand beyond launch-safe factual explanation.

## DEC-015 — Disposable database harness uses an explicit managed-service shim

Status: Accepted for T02
Date: 2026-09-06
Decision: Reconstruct the schema in a pinned disposable PostgreSQL container and provide only the required `auth`/Vault compatibility boundary in harness setup; never connect the harness to Supabase or another external target.
Reason: The local Supabase CLI is unavailable in the inspected runtime, while the current SQL depends on Supabase-managed `auth` and Vault objects. A plain PostgreSQL container keeps migration, privilege, RLS, RPC, and rollback execution real without adding a new CLI dependency or external infrastructure.
Alternatives considered: Install or download a Supabase CLI at test time; use a shared/staging Supabase project; weaken the database checks to SQL text assertions. The first adds unpinned setup and the latter two violate the disposable/no-production constraints.
Consequences: T02's shim is deliberately isolated and documented; it proves the application SQL boundary but does not claim full Supabase Auth or Vault service fidelity. A future task must add a pinned local Supabase stack if managed-service-specific behavior is in scope.
Revisit when: The Supabase CLI/runtime is pinned and available, or an acceptance criterion requires behavior beyond the explicit shim boundary.


## New decision template

```markdown
## DEC-NNN — Title

Status:
Date:
Decision:
Reason:
Alternatives considered:
Consequences:
Revisit when:
```

Link affected tasks, repository evidence, and any blocker under Consequences. Do not overwrite old decisions silently; supersede them with a linked new record.


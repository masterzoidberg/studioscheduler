> HISTORICAL — superseded by the 2026-09-07 rebuild. Not current instructions or status. Start at [current planning entry](README.md).

# Master Development Plan

Canonical strategy; task status and executable detail live in [TASKS](TASKS_OLD.md). Audit baseline: `17b3a60`. The repository has substantial working infrastructure; this is an evolution and cutover plan, not a rewrite.

# Product Objective

## DWDE

Make a fully operational scheduling application prepopulated with DWDE people, rooms, curriculum, Rulebook, rosters, constraints, historical versions, and schedules. Cami must be able to trust generation, inspect a candidate, adopt it, edit it safely, recover, and distribute output.

The audit did not verify current production planning completeness or run the current full DWDE dataset. These remain release evidence requirements.

## Product

Support recurring class/activity scheduling: instructors, participants, groups, rooms, sessions, eligibility, availability, enrollment, sequencing, hard constraints, and preferences. Dance studios are the initial domain; adjacent class businesses are allowed only within supported templates. Do not generalize to hospitals, logistics, airlines, or universal scheduling.

DWDE must be one configured tenant. Studio #2 must onboard with zero bespoke compiler/solver/application logic.

## Target architecture

```text
Selected Organization
        |
Planning Facts + Structured Rulebook
        |
Immutable Versioned Snapshots
        |
Generic Deterministic Compilation
        |
System Invariants + Constraint IR + Locks
        |
+-----------------------------+
|                             |
Runtime Validator        CP-SAT Solver
|                             |
+-------------+---------------+
              |
Candidate / Manual Change
              |
Server Validation
              |
Governed Transaction
              |
New ScheduleVersion
```

AI operates beside this path as a proposal/explanation layer. It uses pinned context and typed proposals, never canonical authority.

# Architectural Invariants

1. No reusable application, compiler, validator, or solver logic may branch on a particular studio, person, room, class, level, subject, or tenant-specific Rule ID. Existing coupling is tracked for removal; T05 may guard an explicitly isolated legacy DWDE adapter, not add new generic-kernel exceptions.
2. Tenant-specific policy belongs in tenant data/configuration.
3. Human-facing names are presentation; canonical scheduling identity uses stable IDs.
4. HARD legality is deterministic.
5. LLM output is never authoritative policy or canonical scheduling state.
6. Solver output is a candidate until validated and adopted through the governed boundary.
7. Manual changes and solver adoption use the same scheduling semantics.
8. Rulebook, Planning Dataset, Constraint Model, Schedule, and lock context remain coherent.
9. Unsupported HARD semantics fail closed, including unsupported parameters, not just unknown kinds.
10. Partial schedules may exist during editing but never masquerade as publishable complete schedules.
11. Historical migrations and ledger provenance are immutable; change behavior with forward migrations.
12. Introduce no infrastructure merely for theoretical extensibility.
13. Tests never connect to production. Release operators may separately collect authorized deployment evidence.
14. Database transactions enforce explicit tenant/actor authorization, structural integrity, concurrency, history, and audit; the browser is only preview.
15. Preserve existing historical IDs/artifacts through versioned compatibility; never silently reinterpret historical policy.

# Verified findings and task coverage

| Finding | Evidence at baseline | Consequence | Tasks |
|---|---|---|---|
| F01 Split authority | [workspace](../components/workspace-provider.tsx), [v25 commands](../supabase/migrations/20260902122425_schedule_commands_v25.sql), [adoption](../app/api/solver/adopt/route.ts) | Manual edits can violate solver-enforced policy | T10–T13 |
| F02 Candidate duration differs from persistence | [gateway](../lib/solver-gateway.ts), [adoption SQL](../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql) | Validated short interval can become a longer persisted interval; probe reproduced gateway acceptance | T04 |
| F03 Wording/execution divergence | [compiler](../lib/constraint-compiler.ts), [v3 compiler](../lib/constraint-compiler-v3.ts) | OPS-003 edit still compiles old close; reproduced | T05, T21, T25 |
| F04 Order-sensitive equality | [model helpers](../lib/constraint-model-version.ts) | Equivalent reordered models compare unequal; reproduced; production incidence unknown | T03 |
| F05 Archive downstream gaps | [loader](../lib/server-studio-state.ts), [v33 adoption](../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql), [v40](../supabase/migrations/20260905034428_planning_inventory_archive_v40.sql) | Active session set differs from SQL count | T06, T11, T12 |
| F06 Incoherent mutable reads | [loader](../lib/server-studio-state.ts), [problem builder](../lib/solver-problem.ts) | Version label does not prove all facts share a snapshot | T07 |
| F07 Missing candidate base schedule | [context](../lib/solver-problem.ts), [adoption](../app/api/solver/adopt/route.ts) | Intervening manual changes can be overwritten | T08 |
| F08 Incomplete locks | [problem](../lib/solver-problem.ts), [service](../solver/dwde_solver/service.py) | Multi-session lock unsupported; name-based lock resolution | T09 |
| F09 DWDE kernel coupling | [compiler](../lib/constraint-compiler.ts), [readiness](../lib/schedule-readiness.ts), [registry](../lib/rule-execution-registry.ts) | Exactly 178 rules and named requirements block unrelated tenants | T20–T21, T24–T25 |
| F10 Implicit tenant command context | [actor helper](../supabase/production-ledger/20260831123403_v2_1_governed_infrastructure.sql), [workspace](../components/workspace-provider.tsx) | First membership may differ from selected workspace | T22–T23 |
| F11 Parity gaps | [TS runtime](../lib/constraint-engine.ts), [Python](../solver/dwde_solver/feasibility.py) | Default-deny depends on CUR-007 only in Python; Unicode normalization differs | T14, T20 |
| F12 Boundary/operations gaps | [publication](../supabase/migrations/20260902163046_constraint_model_publication_v30.sql), [gateway](../app/api/solver/feasibility/route.ts), [Supabase config](../lib/supabase.ts) | Client artifact disruption, role race, second-solve timeout, production fallback | T13, T15, T16, T29 |
| F13 Weak executed DB/real-workload evidence | [CI](../.github/workflows/ci.yml), [golden tests](../tests/golden-schedule-fixtures.test.ts) | Passing source assertions/toy fixtures do not certify production use | T02, T14, T16 |
| F14 Legacy AI/scenario presentation | [Copilot](../app/api/copilot/route.ts), [scenarios](../components/scenarios-view.tsx) | Stale explanations and implied what-if capability | T16 launch containment, T28 fuller alignment |
| F15 No executable optimization | [IR](../lib/constraint-ir.ts), [Python](../solver/dwde_solver/feasibility.py) | First-feasible may be unattractive | T17–T19 |

Preserve version snapshots, audit/RLS foundations, Next.js, Supabase, CP-SAT, mobile/desktop components, and candidate workflow. Schema/domain names are mostly sufficient. “Teacher/student/class” may remain internal names with UI terminology mapping.

# Milestones

All milestone acceptance is initially NOT_STARTED. Existing code does not prove release readiness.

## Milestone A — DWDE Operational

Gate: T01–T16 criteria plus [DWDE release checklist](DWDE_RELEASE_PLAN_OLD.md).

Required: trustworthy complete planning inventory and qualifications; supported HARD policy; coherent snapshot and locks; full active-session solve; independent validation; atomic adoption; same authority for manual edits/rebase/undo; stale-change rejection; archive integrity; readable conflict/non-success results; usable print/export/mobile viewing; verified roles and restore procedure; named manager acceptance.

Preferences T17–T19 are P1 unless manager evidence shows first-feasible schedules require unacceptable reconstruction. Record that promotion rather than silently calling an unusable schedule operational. AI is optional; misleading current AI behavior must be contained before release.

## Milestone B — Generic Kernel

Gate: T20–T22 plus parity evidence from T14.

- ID-based rule targets and typed parameters/exceptions.
- Tenant-neutral compilation, runtime, solver, and generic readiness.
- No DWDE-specific kernel branching or fixed 178-rule assumptions.
- DWDE policy extracted to tenant records while golden behavior remains.
- Renamed-DWDE fixture invariance.
- Explicit tenant authorization throughout commands and same-studio reference validation.

T20/T21/T22 are L-sized parents with bounded child slices in the ledger.

## Milestone C — Studio #2

Gate: T17–T27 relevant dependencies and [formal acceptance](STUDIO_2_ACCEPTANCE.md).

An unrelated organization uses standard provisioning, imports/forms, supported rules, generation, scoring/comparison, adoption/edit/recovery/export with no bespoke source changes. Manual onboarding assistance is acceptable; custom code is not.

## Milestone D — External Pilot

Gate: T27 plus T29 pilot evidence.

3–5 independent organizations use real schedules. Capture onboarding effort, supported rules, rejected/accepted candidates, failure causes, support burden, and paid-pilot feedback. Do not substitute demo accounts for real use.

## Milestone E — Commercial MVP

Gate: T29 operations, repeated Studio #2-style acceptance, T17–T19 preferences, and T28 if AI is shipped.

Repeatable onboarding, reliable generation/editing/adoption/export, useful preference optimization, role isolation, recoverability, bounded usage, basic billing/entitlements, supportability. Standard manual invoicing can serve pilots; MVP billing policy must be explicit.

## Milestone F — 10–25 Customers

Record measured paid retention, recurring scheduling use, actual adoption rate, support cost, setup effort, rule-template coverage, and bespoke engineering. T29 creates the protocol; the milestone remains open until actual evidence exists. Do not invent calendar targets or assert product-market fit from account counts alone.

## Milestone G — Integration / Scale

Status: DEFERRED until repeated customer demand and measured capacity constraints justify work. Evaluate Studio Pro, Jackrabbit, GymDesk or other integrations only from evidence; add bounded tasks under a decision then. No integrations are pre-authorized by this roadmap.

# Ordered phases

0. T01–T02: verification foundation.
1. T03–T10: candidate, policy, snapshot, lock, and manual MOVE correctness.
2. T11–T16: complete shared authority and manager workflow.
3. T17–T19: good schedules and comparison.
4. T20–T24: generic kernel and explicit tenants.
5. T25–T29: repeatable onboarding, unrelated acceptance, pilot operations.

Dependencies allow some safe parallel work after contracts stabilize, but numeric order is the default priority. No automatic subagent delegation is prescribed. One owner coordinates shared contracts and migration ordering.

# Critical Path

## DWDE critical path

```text
T01 → T02 → T03 → T04
                 └→ T05
T04 → T06
T03 + T05 + T06 → T07 → T08 → T09
T03–T09 → T10 → T11 → T12 → T13
T05–T13 → T14 → T15 → T16 → Milestone A
T14 → T17 → T18 → T19 (promote if manager cannot use first-feasible output)
```

T14 requires real completeness evidence; T16 requires manager and authorized release evidence. No amount of synthetic testing substitutes for either.

## Studio #2 critical path

```text
T14 → T20 → T21
T13 + T02 + T16 → T22 → T23
T20 + T21 + T23 → T24 and T25
T23 + T24 + T25 → T26
T17 → T18 → T19
T19 + T21–T26 → T27 → Milestone C → T29 → D/E
T25 + T22 + T27 → T28 (optional AI release dependency)
```

T22 and T20 can run independently once their prerequisites are accepted, with a common identity contract. T19 also needs T16 per ledger. TASKS.md is the precise dependency authority when diagrams omit transitive edges.

# Constraint X-Ray and preferences

T15 starts with move violations, empty teacher/room/time domains, and display of existing fixed-anchor conflict IDs. Those IDs are partial/sufficient evidence relative to background constraints, not a smallest conflict proof. Later bounded diagnostic rebuilds may test a small repair menu without canonical writes. Defer exact minimal explanations/repairs.

T17 defines transparent bounded integer penalties; T18 uses hierarchical optimization (VERY_STRONG, MODERATE, LIGHT, BASELINE) with HARD outside the objective. Preserve achieved stronger-tier results; report time-limited incumbents and optimality honestly. T19 introduces a small diverse candidate set. No arbitrary giant weights or false precision.

# What Not To Build Yet

- General-purpose scheduling DSL or universal scheduling engine.
- Deep management-platform integrations before repeated pilot demand.
- Exact globally minimal conflict explanations or exact minimum-cost repairs.
- Autonomous AI policy changes or judgment learning.
- Plugin/policy marketplace and inheritance infrastructure.
- Event sourcing/bitemporal infrastructure.
- Broad industry expansion.
- Advanced billing.
- Generalized scenario branch/merge.
- Arbitrary resource bundles or multi-instructor scheduling unless demanded.
- Solver replacement without representative measured failure.
- Cosmetic whole-codebase renaming or generic “cleanup.”

# Deletion/cutover strategy

Delete unused [FeaturePreview](../components/feature-preview.tsx) only during adjacent work. Retire stale mapping instructions at T16. Remove legacy write access at T13 after migration; remove duplicate business-rule interpretation only when parity and all callers permit it. T21 removes duplicated DWDE policy tables. Keep historical SQL, version artifacts, DWDE data, and minimal relational safeguards. Do not perform unrelated deletion during planning.

# Risk Register

| Risk | Probability | Impact | Detection | Mitigation / owner task |
|---|---|---|---|---|
| Incomplete planning data | High | Critical | Manager source reconciliation and session counts | T14 snapshot-specific attestations; T16 walkthrough |
| Policy/executable divergence | High | Critical | Wording/strength regression | T05 guard; T21/T25 structured rules |
| Manual edit/solver divergence | High | Critical | IR-only illegal manual write tests | T10–T13 one authority |
| Wrong-tenant mutation | High with multiple memberships | Critical | Two-tenant/two-role executed tests | T22/T23 explicit context |
| Solver performance on real DWDE | Unknown | High | Complete benchmark with resource envelope | T14 measure; T15 bound; tighten domains before new infrastructure |
| First-feasible schedules unattractive | High | High | Manager edits/adoption rate | T17–T19 selected preferences; promote if needed |
| Per-customer bespoke engineering | High today | Critical commercially | Frozen-SHA unrelated onboarding | T27 zero bespoke code gate |
| Migration/recovery failure | Unknown | Critical | Fresh reconstruction/restore drill | T02/T16, immutable history |
| Candidate duration/version mismatch | Verified code risks | Critical | Adversarial interval/stale tests | T04/T07/T08 |
| History/state loading growth | Medium | Medium | Large-history workload and query count | T07 current snapshot loading; T29 measured limits |
| AI confusion/support burden | Medium | Medium | Wrong-context/injection evaluations | T16 contain; T28 align; AI optional |
| Solve/provider cost overload | Medium | High | Concurrent request and usage tests | T15 total deadline; T29 per-tenant limits |

Strongest strategy objection: scheduling can be infrequent and studio-specific, with messy enrollment data, making onboarding a bespoke service customers expect inside existing management platforms. Mitigate through paid pilots and measured engineering/support effort, not premature domain expansion.


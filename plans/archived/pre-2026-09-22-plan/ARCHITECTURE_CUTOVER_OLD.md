> HISTORICAL — superseded by the 2026-09-07 rebuild. Not current instructions or status. Start at [current planning entry](README.md).

# Scheduling Authority Cutover

Owners: T03–T13, followed by T14 parity and full-workload evidence. This is a staged migration of working code, not a second scheduling architecture.

### Current state

| Component | Current behavior/evidence |
|---|---|
| Legacy validator | [lib/validator.ts](../lib/validator.ts) evaluates approved enforcement mappings and partial coverage |
| Constraint IR runtime | [base](../lib/constraint-engine.ts) plus [v2](../lib/constraint-engine-v2.ts); fuller independent oracle |
| Compiler | [base](../lib/constraint-compiler.ts) plus [v3](../lib/constraint-compiler-v3.ts); static DWDE specification by Rule ID |
| Solver | [Python CP-SAT](../solver/dwde_solver/feasibility.py) consumes model/planning, never writes Supabase |
| Service boundary | [service](../solver/dwde_solver/service.py) uses internal token, contract checks, candidate-only output |
| Adoption | [route](../app/api/solver/adopt/route.ts) reloads state, IR validates, service-role calls [v33 RPC](../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql), SQL recomputes duration and checks legacy validation |
| Manual mutations | [provider](../components/workspace-provider.tsx) and schedule views use legacy preview; [v25 RPC](../supabase/migrations/20260902122425_schedule_commands_v25.sql) remains canonical database gate |
| Shadow helper | [gate comparison](../lib/constraint-gate-equivalence.ts) tests old/new behavior; it is not deployed canonical authority |
| Version/authorization | Governed RPCs and RLS exist, but implicit first-membership helpers and independent mutable reads weaken context guarantees |

Legacy semantics must not be expanded as another permanent policy engine. The existing bridge protects known checks but does not establish complete HARD coverage.

### Target state

One semantic scheduling authority covers:
- MOVE;
- ASSIGN;
- UNASSIGN;
- rebase;
- undo;
- solver adoption;
- explicit revalidation.

“Shared authority” means common typed model, binding, candidate construction, evaluation, and acceptance policy. Python translates the same model for search; parity tests enforce agreement. It does not mean Python replaces the runtime or SQL loses relational defenses.

### Command contract

Each command carries authenticated actor, explicit selected tenant, operation, reason, and expected Rulebook/Planning Dataset/Constraint Model/base ScheduleVersion/lock context. The server:
1. Authenticates and authorizes the exact tenant.
2. Loads coherent immutable snapshots and current pointers.
3. Builds a structural candidate from stable IDs and canonical duration.
4. Checks supported compilation, binding, delegated preconditions, and placement/finalization mode.
5. Independently evaluates the candidate.
6. Passes server-derived data to a restricted governed transaction.
7. Transactionally rechecks actor membership, version/context and active identity integrity, persists a new version and audit event atomically.

Never accept browser-provided validation results or substitute freshly loaded versions for reviewed candidate tokens. A service-role key is privileged transport, not human authorization.

### Placement legality

A draft may omit some required sessions. An intermediate placement must have valid active same-tenant IDs, supported day/time/duration, lock compliance, and no disallowed resource/qualification/window/other applicable conflicts.

Evaluate temporal requirements with explicit partial semantics: an absent required predecessor may be an outstanding completeness obligation, but a placed successor with an incompatible placed predecessor is a real placement violation. Fixed sessions not yet placed remain required obligations. Unknown HARD meaning is never waived.

Repair mode must not exchange one serious violation for another just because a count decreases. Define and test the admissible violation transition using stable finding identities and explicit policy. Do not rely only on aggregate counts. Preserve usable incremental editing and record any changed repair behavior.

### Final schedule completeness

At adoption/finalization, require every active required session exactly once, all locks preserved, supported/bound HARD model, zero HARD violations, validated delegated planning requirements, confirmed complete dataset, and current context.

No missing sessions, duplicate sessions, archived obligations, or unresolved required relationships may be hidden behind a “valid” badge. UI status distinguishes valid placement/draft from complete ready-to-publish schedule.

### Safe migration order

| Stage | Tasks | Release/rollback condition |
|---|---|---|
| Executed baseline | T01–T02 | Portable tests and disposable DB; preserve source/ledger |
| Trust input/artifact | T03–T09 | Canonical comparison/intervals, supported policy, archives, coherent snapshots, stale context, session locks |
| First command slice | T10 | MOVE reaches server IR; regression proving IR-only illegal move cannot commit |
| Incremental construction | T11 | ASSIGN/UNASSIGN preserve partial editing without weakening placement |
| Recovery | T12 | Rebase/undo/revalidation share semantics; history immutable |
| Close bypasses | T13 | All active callers migrated; old authenticated write grants revoked or safely delegated |
| Operational proof | T14–T16 | Full DWDE/parity, bounded diagnostics, manager/export/restore evidence |

Before T13, label the cutover incomplete and keep DWDE release blocked. Changing UI calls does not close direct RPC access.

### When legacy authority can be removed

Require:
- all seven command types covered by executed success/rejection/stale/lock tests;
- direct old-RPC calls denied;
- current server path never relies on browser validation;
- canonical intervals and context persisted exactly;
- actor role rechecked transactionally;
- full supported semantics parity and structural invariants retained;
- historical read compatibility identified.

T13 removes write bypasses. Delete remaining duplicate policy evaluation only after T14 confirms parity and no live consumers remain. Keep historical artifacts and minimal database reference/duration/transaction checks. Enforcement mapping readers required solely for history may remain read-only and explicitly labeled.

### Failure and rollback

Before privilege cutover, revert a failed feature slice without declaring release complete. After T13, never restore a weaker write boundary as an emergency workaround: keep scheduling read-only, preserve evidence, and forward-fix the authoritative route. Feature rollback must not reinterpret historical schedules or erase versions. Record failure as BLK-NNN and any architectural change as DEC-NNN.

### Verification matrix

For each command: authorized success, viewer/nonmember denial, wrong tenant, stale Rulebook/planning/model/schedule/lock, archive target, canonical duration override, unsupported semantics, zero-write rejection, audit creation, and immutable prior version.

For whole-schedule adoption: exact active session set and independent full IR/precondition validation.
For incremental edits: legal partial construction and no false finalization.
For recovery: historical inspection versus current-policy adoption.
See [TEST_STRATEGY](TEST_STRATEGY.md).


# Current Execution Queue

Current Milestone: DWDE Operational
Current Task: T11
Next Task: T12

Baseline: `17b3a60`. T10 is DONE. T11 is the next executable task; T12 remains pending T11. Status authority: [TASKS.md](TASKS.md). Recompute this view after each accepted task. Later tasks remain in the ledger.

Exact verification commands below include the T02 `npm run test:db` harness. See [TEST_STRATEGY](TEST_STRATEGY.md) and [database harness documentation](../docs/testing/database-integration.md) for setup. Missing tools/data are recorded blockers, never implicit passes.

## T01 — Line-ending and test portability

**Current status:** DONE

**Dependency check:** Satisfied: no dependencies. Acceptance verified; see the T01 completion record in [TASKS.md](TASKS.md).

**Objective:** Make the existing quality gate reliable on Windows and Linux without weakening ledger integrity.

### Exact acceptance criteria

- [x] Windows and Linux checkouts pass all existing TypeScript tests.
- [x] Canonical ledger byte lengths and hashes remain unchanged; no manifest regeneration to accommodate CRLF.
- [x] Historical migration SQL semantics and application behavior remain unchanged.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [tests/production-ledger.test.ts](../tests/production-ledger.test.ts)
- [tests/atomic-rulebook-structure-repair.test.ts](../tests/atomic-rulebook-structure-repair.test.ts)
- [tests/fluid-planning-inventory.test.ts](../tests/fluid-planning-inventory.test.ts)
- [tests/rulebook-v36-governance.test.ts](../tests/rulebook-v36-governance.test.ts)
- [tests/schedule-commands-v25.test.ts](../tests/schedule-commands-v25.test.ts)
- [supabase/production-ledger/manifest.json](../supabase/production-ledger/manifest.json)
- [.github/workflows/ci.yml](../.github/workflows/ci.yml)

### Implementation notes

- Test clean-checkout line endings and ledger bytes, not only the existing working directory.
- Use repository attributes (new .gitattributes if needed); normalize textual assertions only where byte identity is not the contract.

**Non-goals:** Do not change compiler, scheduling, database behavior, package versions, or ledger history.

[Implementation prompt](prompts/T01-line-ending-integrity.md)

## T02 — Disposable database integration harness

**Current status:** DONE

**Dependency check:** Satisfied: T01 is DONE. All T02 acceptance criteria are verified; the initial Docker blocker is resolved.

**Objective:** Reconstruct and test current database command behavior in a disposable environment.

### Exact acceptance criteria

- [x] A fresh disposable environment reconstructs the current schema through a documented, dependency-correct sequence.
- [x] Executed owner/editor/viewer/nonmember tests verify one governed write and stale-version rejection.
- [x] The harness refuses production targets and exposes npm run test:db, with an actionable setup failure rather than a silent skip.
- [x] Bootstrap/archive schema differences are resolved in test setup or forward migrations, never by rewriting historical SQL.

**Verified run:** `npm run test:db` exited 0 after applying every archived V2.1 and forward migration through V40, executing the role/RLS/stale-version checks, and removing the disposable container.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [supabase/bootstrap/2026-08-31-production-schema-baseline.sql](../supabase/bootstrap/2026-08-31-production-schema-baseline.sql)
- [supabase/production-ledger/README.md](../supabase/production-ledger/README.md)
- [supabase/production-ledger/manifest.json](../supabase/production-ledger/manifest.json)
- [supabase/migrations/README.md](../supabase/migrations/README.md)
- [package.json](../package.json)
- [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- [scripts/test-db.mjs](../scripts/test-db.mjs)
- [tests/database-harness.test.ts](../tests/database-harness.test.ts)
- [docs/testing/database-integration.md](../docs/testing/database-integration.md)

### Implementation notes

- Inspect CLI/runtime availability before choosing tooling; use isolated Supabase when auth/vault dependencies require it.
- Document fixture identities, teardown, prerequisites, and migration ledger handling.
- Add a staging recovery procedure outline; no production restore.

**Non-goals:** Do not reconcile the production ledger live, provision paid services, or build a general migration framework.

[Implementation prompt](prompts/T02-database-integration-harness.md)

## T03 — Canonical Constraint Model comparison

**Current status:** DONE

**Dependency check:** Satisfied: T01 and T02 are DONE. T03 acceptance is verified; see the completion evidence in [TASKS.md](TASKS.md).

**Objective:** Compare equivalent Constraint Model objects independently of JSON object-key order.

### Exact acceptance criteria

- [x] Recursively reordered object keys compare equal; meaningful parameter and ordered-array differences compare unequal.
- [x] A real JSONB publication/read-back compares equal to the submitted semantic model.
- [x] Historical fingerprint compatibility is documented and tested; no silent historical rehash.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [lib/constraint-model-version.ts](../lib/constraint-model-version.ts)
- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [tests/constraint-model-version.test.ts](../tests/constraint-model-version.test.ts)
- [tests/solver-gateway.test.ts](../tests/solver-gateway.test.ts)
- [supabase/migrations/20260902163046_constraint_model_publication_v30.sql](../supabase/migrations/20260902163046_constraint_model_publication_v30.sql)

### Implementation notes

- Define object canonicalization explicitly; preserve array ordering unless the contract already declares a set.
- Test nested selectors/parameters and model-sync drift detection.

**Non-goals:** Do not weaken drift detection or change scheduling semantics.

[Implementation prompt](prompts/T03-constraint-model-canonicalization.md)

## T04 — Canonical candidate intervals

**Current status:** DONE

**Dependency check:** Satisfied: T02 and T03 are DONE. T04 acceptance is recorded in [TASKS.md](TASKS.md).

**Objective:** Validate exactly the assignment intervals that adoption will persist.

### Exact acceptance criteria

- [x] Start/end values and assignment shape are strictly validated; nonfinite, malformed, duplicate, unknown, or cross-midnight assignments are rejected.
- [x] End times derive from pinned session overrides/class durations before IR evaluation; inconsistent supplied end times fail.
- [x] Shortened intervals cannot evade teacher availability, sequencing, or overlap checks.
- [x] Adoption persists the exact validated assignment interpretation and rolls back rejected candidates.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)
- [lib/schedule-command-candidate.ts](../lib/schedule-command-candidate.ts)
- [tests/solver-gateway.test.ts](../tests/solver-gateway.test.ts)
- [supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql](../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql)
- [supabase/migrations/20260906120000_solver_candidate_intervals_v41.sql](../supabase/migrations/20260906120000_solver_candidate_intervals_v41.sql)
- [scripts/test-db.mjs](../scripts/test-db.mjs)

### Implementation notes

- Add a shortened-duration teacher-window regression and a per-session duration override case.
- Keep SQL structural validation as defense in depth; change current function through a forward migration.

**Non-goals:** Do not trust browser validation or add an alternative business-rule engine in SQL.

[Implementation prompt](prompts/T04-canonical-candidate-intervals.md)

## T05 — Unsupported DWDE policy guard

**Current status:** DONE

**Dependency check:** Satisfied: T01 and T03 were verified DONE before execution; T05 acceptance is verified in [TASKS.md](TASKS.md).

**Objective:** Prevent changed human policy from silently retaining obsolete static compiler behavior.

### Exact acceptance criteria

- [x] Supported reviewed DWDE v3 behavior remains reproducible.
- [x] An unsupported change to wording, strength, status, or executable policy content cannot be marked supported/current by the static compiler.
- [x] The OPS-003 19:00 regression fails closed instead of silently returning a supposedly current 21:30 policy.
- [x] Draft/unsupported rules have clear readiness feedback and preserve immutable policy history.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [lib/constraint-compiler.ts](../lib/constraint-compiler.ts)
- [lib/constraint-compiler-v3.ts](../lib/constraint-compiler-v3.ts)
- [lib/reviewed-rulebook.ts](../lib/reviewed-rulebook.ts)
- [lib/schedule-readiness.ts](../lib/schedule-readiness.ts)
- [lib/domain.ts](../lib/domain.ts)
- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [tests/constraint-compiler.test.ts](../tests/constraint-compiler.test.ts)
- [supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql](../supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql)

### Implementation notes

- Reuse reviewed-policy provenance and inspect existing content-pinned repair precedent.
- Treat this as a temporary DWDE adapter guard, to be replaced by structured rules in T21/T25; do not create new generic-kernel exceptions.

**Non-goals:** Do not implement a prose parser or the whole generic rule authoring system.

[Implementation prompt](prompts/T05-unsupported-dwde-policy-guard.md)

## T06 — Archive-aware adoption

**Current status:** DONE

**Dependency check:** Satisfied and accepted: T02 and T04 are DONE; all T06 acceptance criteria are verified.

**Objective:** Make active inventory consistent between solver preparation and database adoption.

### Exact acceptance criteria

- [x] Every active session is required exactly once; archived sessions are excluded from current candidate completeness.
- [x] Archived teachers/rooms/classes cannot be introduced into a new active candidate.
- [x] Archive → confirm → solve → adopt and restore → reconfirm execute successfully in the disposable database.
- [x] Historical versions still resolve archived identities; adjacent current-state count/query defects are fixed or explicitly assigned to T11/T12.

**Verified run:** GitHub Actions run `34083389232` passed Ubuntu and Windows quality gates; Ubuntu also passed `npm run test:db` with the T06 archive/restore candidate lifecycle.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql](../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql)
- [supabase/migrations/20260905034428_planning_inventory_archive_v40.sql](../supabase/migrations/20260905034428_planning_inventory_archive_v40.sql)
- [supabase/migrations/20260905034442_planning_inventory_archive_guards_v40.sql](../supabase/migrations/20260905034442_planning_inventory_archive_guards_v40.sql)
- [tests/planning-inventory-lifecycle.test.ts](../tests/planning-inventory-lifecycle.test.ts)

### Implementation notes

- Define active session inventory including parent-class state.
- Use a forward migration, retain historical records, and inspect lock/archive interactions.

**Non-goals:** Do not delete archived records, rewrite historical schedules, or broaden into generic retention policies.

[Implementation prompt](prompts/T06-archive-aware-adoption.md)

## T07 — Coherent solver snapshots

**Current status:** DONE

**Dependency check:** Satisfied and accepted: T02, T03, T05, and T06 are DONE; all T07 acceptance criteria are verified.

**Objective:** Build solver requests from coherent immutable planning and policy context.

### Exact acceptance criteria

- [x] Scheduling facts come from the pinned immutable planning snapshot, with compatible historical schema handling.
- [x] Rulebook/model/current schedule and lock references belong to a coherent context; pointer changes cause retry or rejection.
- [x] Concurrent planning/policy changes cannot submit a mixed-version request.
- [x] The request excludes unrelated tenant data and unnecessary historical assignments.

**Verified run:** GitHub Actions run `34085179827` passed Ubuntu and Windows quality gates; Ubuntu also passed the disposable PostgreSQL snapshot/drift integration lifecycle.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [lib/solver-problem.ts](../lib/solver-problem.ts)
- [lib/planning-dataset.ts](../lib/planning-dataset.ts)
- [lib/constraint-model-version.ts](../lib/constraint-model-version.ts)
- [tests/solver-problem-contract.test.ts](../tests/solver-problem-contract.test.ts)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)

### Implementation notes

- Prefer snapshot reconstruction plus coherent pointer reads over a new event store.
- Specify snapshot/hash checks and what is allowed to change during a long solve.

**Non-goals:** Do not add caching, queues, or event sourcing merely to solve consistency.

[Implementation prompt](prompts/T07-coherent-solver-snapshots.md)

## T08 — Candidate stale-schedule binding

**Current status:** DONE

**Dependency check:** Satisfied and accepted: T07 is DONE; all T08 acceptance criteria are verified.

**Objective:** Bind reviewed candidates to the base schedule and lock state.

### Exact acceptance criteria

- [x] Candidate context includes base ScheduleVersion and unambiguous lock identity alongside studio, Rulebook, planning, and compiler/model context.
- [x] An intervening schedule edit or lock change rejects stale adoption even when policy/planning versions are unchanged.
- [x] The UI preserves the reviewed context and explains the need to regenerate/re-review.
- [x] Transactional expected-version checks use submitted reviewed context, not substituted fresh values.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [lib/solver-problem.ts](../lib/solver-problem.ts)
- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)
- [components/solver-feasibility-card.tsx](../components/solver-feasibility-card.tsx)
- [tests/solver-gateway.test.ts](../tests/solver-gateway.test.ts)

### Implementation notes

- Test concurrent editors and repeated/double adoption.
- Version the wire contract compatibly and reject missing required context.

**Non-goals:** Do not implement scenario merging or automatic conflict resolution.

[Implementation prompt](prompts/T08-candidate-stale-schedule-binding.md)

## T09 — Session-specific solver locks

**Current status:** READY

**Dependency check:** Satisfied: T07 and T08 are verified DONE. T09 is now the first executable unfinished task.

**Objective:** Lock exact weekly sessions independently of class display names.

### Exact acceptance criteria

- [ ] One selected session of a multi-session activity preserves day/start/teacher/room while other meetings remain movable.
- [ ] Runtime locks bind stable session IDs and preserve canonical duration.
- [ ] Assignment/session lock precedence is explicit; locked placements cannot be lost at preparation, solve, validation, or adoption.
- [ ] Missing, stale, conflicting, and impossible locks fail with deterministic explanations.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
Push-Location solver
python -m pytest -q
Pop-Location
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [lib/solver-problem.ts](../lib/solver-problem.ts)
- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [solver/dwde_solver/service.py](../solver/dwde_solver/service.py)
- [solver/dwde_solver/feasibility.py](../solver/dwde_solver/feasibility.py)
- [solver/tests/test_service.py](../solver/tests/test_service.py)
- [solver/tests/test_feasibility.py](../solver/tests/test_feasibility.py)
- [tests/solver-problem-contract.test.ts](../tests/solver-problem-contract.test.ts)

### Implementation notes

- Apply placements directly to session variables; preserve policy-fixed assignment behavior separately.
- Use shared serialized fixtures for lock semantics on both runtimes.

**Non-goals:** Do not redesign all sequencing or introduce a general locking service.

[Implementation prompt](prompts/T09-session-specific-locks.md)

## T10 — Manual MOVE through authoritative IR

**Current status:** NOT_STARTED

**Dependency check:** Not satisfied; waiting for verified DONE: T03, T04, T05, T06, T07, T08, T09.

**Objective:** Route manual MOVE through server-side canonical candidate construction and IR validation.

### Exact acceptance criteria

- [ ] Server authenticates and authorizes the explicit workspace, reconstructs pinned context, derives duration, and evaluates IR before MOVE commits.
- [ ] An IR-only illegal move is rejected without a new canonical version.
- [ ] Valid desktop/mobile moves persist with version checks and audit evidence.
- [ ] Draft completeness and repair behavior are explicit; moving within a partial schedule remains possible without a false publishable claim.

### Exact verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add/run the task's regression tests and capture criterion-specific evidence; see the prompt for required behavior. Database commands run only against the disposable harness.

### Files likely involved

- [components/workspace-provider.tsx](../components/workspace-provider.tsx)
- [components/schedule/schedule-view.tsx](../components/schedule/schedule-view.tsx)
- [components/schedule/mobile-schedule-view.tsx](../components/schedule/mobile-schedule-view.tsx)
- [lib/schedule-command-candidate.ts](../lib/schedule-command-candidate.ts)
- [lib/constraint-gate-equivalence.ts](../lib/constraint-gate-equivalence.ts)
- [lib/constraint-engine-v2.ts](../lib/constraint-engine-v2.ts)
- [supabase/migrations/20260902122425_schedule_commands_v25.sql](../supabase/migrations/20260902122425_schedule_commands_v25.sql)

### Implementation notes

- Add one contained command route and restricted transaction boundary; reuse adoption infrastructure where correct.
- For this first cutover, reject wrong selected tenants rather than silently choosing first membership; full multi-tenant provisioning remains T22/T23.
- Record remaining bypasses for T13 and keep interim release blocked.

**Non-goals:** Do not migrate unrelated commands or delete legacy authority before T11–T13.

[Implementation prompt](prompts/T10-manual-move-authoritative-ir.md)

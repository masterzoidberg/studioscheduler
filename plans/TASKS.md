# Task Ledger

This is the authoritative task status and acceptance ledger. Baseline: HEAD `17b3a60`, audit recorded 2026-09-06. Related existing functionality does not mean its corrective task is complete.

Read [README](README.md), [MASTER_PLAN](MASTER_PLAN.md), and [execution rules](CODEX_EXECUTION_RULES.md) first. Select the first executable unfinished task in numeric order; dependencies are minimum prerequisites, not permission to skip earlier ready P0 work.

## Status index

| ID | Task | Status | Milestone | Priority | Dependencies | Size |
|---|---|---|---|---|---|---|
| [T01](#t01) | Line-ending and test portability | DONE | A | P0 | None | S |
| [T02](#t02) | Disposable database integration harness | DONE | A | P0 | T01 | M |
| [T03](#t03) | Canonical Constraint Model comparison | DONE | A | P0 | T01, T02 | S |
| [T04](#t04) | Canonical candidate intervals | DONE | A | P0 | T02, T03 | M |
| [T05](#t05) | Unsupported DWDE policy guard | DONE | A | P0 | T01, T03 | M |
| [T06](#t06) | Archive-aware adoption | DONE | A | P0 | T02, T04 | M |
| [T07](#t07) | Coherent solver snapshots | DONE | A | P0 | T02, T03, T05, T06 | M |
| [T08](#t08) | Candidate stale-schedule binding | DONE | A | P0 | T07 | M |
| [T09](#t09) | Session-specific solver locks | DONE | A | P0 | T07, T08 | M |
| [T10](#t10) | Manual MOVE through authoritative IR | DONE | A | P0 | T03, T04, T05, T06, T07, T08, T09 | M |
| [T11](#t11) | ASSIGN/UNASSIGN canonical authority | READY | A | P0 | T10 | M |
| [T12](#t12) | Rebase/undo canonical authority | NOT_STARTED | A | P0 | T10, T11 | M |
| [T13](#t13) | Close legacy write bypasses | NOT_STARTED | A | P0 | T10, T11, T12 | S |
| [T14](#t14) | Representative full DWDE acceptance fixture/solve | NOT_STARTED | A | P0 | T05, T06, T07, T08, T09, T10, T11, T12, T13 | M |
| [T15](#t15) | Bounded and understandable solve failures | NOT_STARTED | A | P0 | T14 | M |
| [T16](#t16) | Manager workflow/export/mobile verification | NOT_STARTED | A | P0 | T14, T15 | M |
| [T17](#t17) | Preference scoring | NOT_STARTED | C | P1 | T14 | M |
| [T18](#t18) | Soft optimization | NOT_STARTED | C | P1 | T17, T15 | M |
| [T19](#t19) | Candidate comparison/persistence | NOT_STARTED | C | P1 | T18, T08, T16 | M |
| [T20](#t20) | Typed ID targets/parameters | NOT_STARTED | B | P1 | T14 | L |
| [T21](#t21) | Convert DWDE policy into tenant records | NOT_STARTED | B | P1 | T20 | L |
| [T22](#t22) | Tenant-explicit database commands | NOT_STARTED | B | P1 | T02, T13, T16 | L |
| [T23](#t23) | Tenant initialization/selection | NOT_STARTED | C | P1 | T22 | M |
| [T24](#t24) | Remove DWDE operational UI assumptions | NOT_STARTED | C | P1 | T20, T21, T23 | M |
| [T25](#t25) | Generic structured rule authoring | NOT_STARTED | C | P1 | T20, T21, T23 | M |
| [T26](#t26) | CSV intake | NOT_STARTED | C | P1 | T23, T24, T25 | M |
| [T27](#t27) | Studio #2 acceptance | NOT_STARTED | C | P1 | T19, T21, T22, T23, T24, T25, T26 | M |
| [T28](#t28) | AI canonical-context alignment | NOT_STARTED | E | P2 | T25, T22, T27 | M |
| [T29](#t29) | Paid-pilot operations | NOT_STARTED | D/E/F | P2 | T16, T19, T27 | M |

## Verification command contract

Existing commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:db`; Python: `python -m pytest -q` from solver with its pinned requirements installed in a disposable virtual environment.

Planned commands, not yet implemented: T14 introduces `npm run test:parity`; T16 introduces `npm run test:e2e`. These become stable harness interfaces for dependent tasks. Keep setup/environment instructions in TEST_STRATEGY.md. Never run a placeholder command and report success. No production test targets.

## Execution phases

- Verification: T01–T02.
- Correctness: T03–T10.
- DWDE completion: T11–T16.
- Optimization: T17–T19.
- Generic product: T20–T24.
- Commercial pilot: T25–T29.

L-sized tasks are parent outcomes. Before implementation, record bounded children T20a–c, T21a–b, T22a–c as described below, with their own evidence; parent dependencies and final acceptance remain binding. Do not mark a parent DONE because one child passed.

<a id="t01"></a>

## T01 — Line-ending and test portability

| Field | Value |
|---|---|
| Task ID | T01 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | None |
| Size | S |
| Risk | Low |
| Reversible? | Yes |

### Objective

Make the existing quality gate reliable on Windows and Linux without weakening ledger integrity.

### Why now

The audit reproduced 15 failures caused by SQL CRLF conversion; normalized isolated SQL passed all 256 tests.

### Expected files/subsystems

- [tests/production-ledger.test.ts](../tests/production-ledger.test.ts)
- [tests/atomic-rulebook-structure-repair.test.ts](../tests/atomic-rulebook-structure-repair.test.ts)
- [tests/fluid-planning-inventory.test.ts](../tests/fluid-planning-inventory.test.ts)
- [tests/rulebook-v36-governance.test.ts](../tests/rulebook-v36-governance.test.ts)
- [tests/schedule-commands-v25.test.ts](../tests/schedule-commands-v25.test.ts)
- [supabase/production-ledger/manifest.json](../supabase/production-ledger/manifest.json)
- [.github/workflows/ci.yml](../.github/workflows/ci.yml)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] Windows and Linux checkouts pass all existing TypeScript tests.
- [x] Canonical ledger byte lengths and hashes remain unchanged; no manifest regeneration to accommodate CRLF.
- [x] Historical migration SQL semantics and application behavior remain unchanged.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Test clean-checkout line endings and ledger bytes, not only the existing working directory.
- Use repository attributes (new .gitattributes if needed); normalize textual assertions only where byte identity is not the contract.

### Non-goals

Do not change compiler, scheduling, database behavior, package versions, or ledger history.

### Completion evidence

Task/child: T01

Starting HEAD: `17b3a603c202a28d1ae8c8fefdae6b2014da09ef` (`17b3a60`)

Implemented files: `.gitattributes`, `.github/workflows/ci.yml`, and the five named TypeScript test files. `supabase/production-ledger/manifest.json` and all historical SQL contents are unchanged.

Acceptance criterion → test/artifact:
- Windows/Linux checkout portability: `*.sql text eol=lf` is enforced by `.gitattributes`; `tests/production-ledger.test.ts` checks Git's clean-tree `eol` attribute and `git show HEAD:<path>` bytes; the CI quality job now runs on `ubuntu-latest` and `windows-latest` (rendered-route smoke remains on Ubuntu).
- Ledger integrity: the byte-exact manifest test and clean-tree blob test pass for all 12 entries; recorded lengths and Git blob SHA-1s match without manifest regeneration.
- Historical semantics/application behavior: the four affected multiline SQL assertion suites pass after newline normalization limited to textual assertions; no SQL content diff exists.

Commands and exit codes (Windows 11 PowerShell, Node `v22.19.0`, npm `10.9.3`, Git `2.51.0.windows.1`, `core.autocrlf=true`, nonproduction):
- `npm run lint` — 0 (2 pre-existing warnings).
- `npm run typecheck` — 0.
- `npm test` — 0; 45 files, 257 tests passed.
- `npm run build` — 0; Next.js 16.3.3 production build passed.
- Targeted affected suites — 0; 5 files, 45 tests passed.
- `git diff --check` — 0; `git diff --name-only -- '*.sql'` — empty; no production or database target was used.

Regression cases: strict raw ledger bytes remain byte-exact; clean Git-tree LF policy/blob bytes are verified; CRLF is normalized only for non-byte-contract SQL text assertions.

Commit/reference: uncommitted; no commit was authorized.

Risks/limitations: GitHub Actions has not been dispatched from this session; the new Ubuntu/Windows matrix and disposable DB step are configured for the next push/PR. T02 now provides `npm run test:db` with a successful local run; `npm run test:parity` and `npm run test:e2e` remain owned by T14 and T16.

Decision deviations: none.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T02.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, and `plans/NEXT.md`.

### Notes/blockers

No known blocker affected T01. T02 was subsequently implemented and accepted; T03 is READY after this dependency update.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T01 prompt](prompts/T01-line-ending-integrity.md)

<a id="t02"></a>

## T02 — Disposable database integration harness

| Field | Value |
|---|---|
| Task ID | T02 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | T01 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Reconstruct and test current database command behavior in a disposable environment.

### Why now

SQL text assertions cannot establish privileges, transaction rollback, migration reconstruction, or RLS behavior.

### Expected files/subsystems

- [supabase/bootstrap/2026-08-31-production-schema-baseline.sql](../supabase/bootstrap/2026-08-31-production-schema-baseline.sql)
- [supabase/production-ledger/README.md](../supabase/production-ledger/README.md)
- [supabase/production-ledger/manifest.json](../supabase/production-ledger/manifest.json)
- [supabase/migrations/README.md](../supabase/migrations/README.md)
- [package.json](../package.json)
- [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- [scripts/test-db.mjs](../scripts/test-db.mjs)
- [tests/database-harness.test.ts](../tests/database-harness.test.ts)
- [docs/testing/database-integration.md](../docs/testing/database-integration.md)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] A fresh disposable environment reconstructs the current schema through a documented, dependency-correct sequence.
- [x] Executed owner/editor/viewer/nonmember tests verify one governed write and stale-version rejection.
- [x] The harness refuses production targets and exposes npm run test:db, with an actionable setup failure rather than a silent skip.
- [x] Bootstrap/archive schema differences are resolved in test setup or forward migrations, never by rewriting historical SQL.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Inspect CLI/runtime availability before choosing tooling; use isolated Supabase when auth/vault dependencies require it.
- Document fixture identities, teardown, prerequisites, and migration ledger handling.
- Add a staging recovery procedure outline; no production restore.

### Non-goals

Do not reconcile the production ledger live, provision paid services, or build a general migration framework.

### Completion evidence

Task/child: T02

Starting HEAD: `17b3a603c202a28d1ae8c8fefdae6b2014da09ef` (`17b3a60`)

Implemented files: `scripts/test-db.mjs`, `tests/database-harness.test.ts`, `docs/testing/database-integration.md`, `package.json`, and `plans/TEST_STRATEGY.md`. Historical bootstrap/archive SQL, `supabase/production-ledger/manifest.json`, and ledger history were not edited.

Implemented behavior: the npm command validates the archive manifest's filenames/bytes/Git blob SHA-1s, refuses production and external targets, starts a pinned PostgreSQL 17.6 Docker image only after an explicit disposable opt-in, applies the documented auth/Vault shim, bootstrap compatibility bridge, archived V2.1, and ordered forward migration sequence, seeds the required deidentified Rulebook V2 migration witness plus four synthetic identities, and executes owner/editor/viewer/nonmember governed-write, RLS, stale-version, and legacy-RPC privilege assertions. Teardown is forced in `finally`; setup errors are nonzero and actionable.

Verified regression cases: `tests/database-harness.test.ts` passes local-target acceptance, production refusal from environment and command line, external-target refusal, and missing-opt-in failure cases. `node scripts/test-db.mjs --check-target` passes without opening a database.

Database evidence: the reconstructed studio's current Planning Dataset version was observed as `4`; the owner and editor governed writes advanced it to `5` and `6`. Viewer and nonmember writes were rejected by authorization, RLS hid all studio rows from the nonmember, the stale owner write was rejected without a row, and the legacy rule mutation privilege boundary passed.

Commands and exit codes (Windows 11 PowerShell, Node `v22.19.0`, npm `10.9.3`, Git `2.51.0.windows.1`, nonproduction):
- `npm run lint` — 0 (2 pre-existing warnings).
- `npm run typecheck` — 0.
- `npm test` — 0; 46 files, 262 tests passed.
- `npm run build` — 0; Next.js 16.3.3 production build passed.
- `npm run test:db` — 0; Docker Engine `29.7.2`, pinned PostgreSQL image index digest `sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94`; all archived V2.1 and forward migrations through V40 applied, then the integration assertions passed and the container was removed.

Commit/reference: uncommitted; no commit was authorized.

Decision deviation: `DEC-015` records the inspected-runtime choice of pinned PostgreSQL plus an explicit auth/Vault compatibility shim because the Supabase CLI is unavailable. The shim is isolated to the disposable harness and does not claim managed-service fidelity.

Resulting task status: DONE.

Newly READY tasks: T03.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, `plans/NEXT.md`, `plans/TEST_STRATEGY.md`, and `plans/DECISIONS.md`.

### Notes/blockers

Dependency accepted: T01 is DONE. T02 acceptance is complete; the prior local Docker blocker was resolved before the successful database run.

#### BLK-001 — Disposable database engine unavailable (resolved)

- Observation/date: `2026-09-06`; the initial run could not reach `npipe:////./pipe/dockerDesktopLinuxEngine`.
- Evidence/resolution: after Docker Desktop was updated, `docker info` reported Engine `29.7.2` and `npm run test:db` exited `0` after container cleanup.
- Affected criteria: all initially blocked DB criteria; now verified by the successful reconstruction and integration run.
- Impact: no remaining T02 blocker.
- Owner/action: no further action; retain this entry as historical evidence of the environment failure and recovery.
- Unblock condition: satisfied; this blocker is resolved.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T02 prompt](prompts/T02-database-integration-harness.md)

<a id="t03"></a>

## T03 — Canonical Constraint Model comparison

| Field | Value |
|---|---|
| Task ID | T03 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | T01, T02 |
| Size | S |
| Risk | Medium |
| Reversible? | Yes, preserve historical compatibility |

### Objective

Compare equivalent Constraint Model objects independently of JSON object-key order.

### Why now

A pure diagnostic probe showed equivalent models compare unequal after property reordering.

### Expected files/subsystems

- [lib/constraint-model-version.ts](../lib/constraint-model-version.ts)
- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [tests/constraint-model-version.test.ts](../tests/constraint-model-version.test.ts)
- [tests/solver-gateway.test.ts](../tests/solver-gateway.test.ts)
- [supabase/migrations/20260902163046_constraint_model_publication_v30.sql](../supabase/migrations/20260902163046_constraint_model_publication_v30.sql)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] Recursively reordered object keys compare equal; meaningful parameter and ordered-array differences compare unequal.
- [x] A real JSONB publication/read-back compares equal to the submitted semantic model.
- [x] Historical fingerprint compatibility is documented and tested; no silent historical rehash.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Define object canonicalization explicitly; preserve array ordering unless the contract already declares a set.
- Test nested selectors/parameters and model-sync drift detection.

### Non-goals

Do not weaken drift detection or change scheduling semantics.

### Completion evidence

Task/child: T03

Starting HEAD: `17b3a603c202a28d1ae8c8fefdae6b2014da09ef` (`17b3a60`)

Implemented files: [lib/constraint-model-version.ts](../lib/constraint-model-version.ts), [tests/constraint-model-version.test.ts](../tests/constraint-model-version.test.ts), [tests/solver-gateway.test.ts](../tests/solver-gateway.test.ts), [scripts/test-db.mjs](../scripts/test-db.mjs), and [docs/testing/database-integration.md](../docs/testing/database-integration.md). The V27 historical hash function, V30 historical publication migration, production-ledger archive, and manifest are unchanged.

Acceptance criterion → evidence:
- Recursive object-key comparison: the shared serializer sorts object keys at every depth, preserves array order, and tests nested selectors/parameters; reordered keys compare equal while changed nested parameters and reordered `ruleIds` compare unequal.
- JSONB publication/read-back: the disposable PostgreSQL run publishes a complete synthetic model containing nested selector/parameter objects, reads the stored `jsonb` snapshot, and verifies semantic equality; a recursively reordered resubmission returns `alreadyCurrent=true` with the original version and hash.
- Historical fingerprints: the same live V30 publication path reuses the original `snapshot_hash` for the semantically identical reordered JSONB model. The database remains the authority for historical hashes; the TypeScript canonical serializer is comparison-only and does not rehash historical artifacts.

Commands and exit codes (Windows 11 PowerShell, Node `v22.19.0`, npm `10.9.3`, Docker Engine `29.7.2`, pinned PostgreSQL image; nonproduction):
- `npm run lint` — 0 (2 pre-existing warnings).
- `npm run typecheck` — 0.
- `npm test` — 0; 46 files, 267 tests passed.
- `npm run build` — 0; Next.js 16.3.3 production build passed.
- `npm run test:db` — 0; archived V2.1 and forward migrations through V40 applied in a fresh disposable container, T02 role/RLS/stale-version checks passed, T03 JSONB publication/read-back and fingerprint reuse passed, and the container was removed.
- Targeted T03 suites — 0; 2 files, 21 tests passed.
- `git diff --check` — 0; `git diff --name-only -- 'supabase/**'` — empty. No production target or database was used.

Regression cases: recursive nested object-key reordering, nested parameter drift, ordered-array changes, model-sync drift classification, live JSONB read-back, and historical version/hash reuse.

Commit/reference: uncommitted; no commit was authorized.

Risks/limitations: PostgreSQL JSONB round-trip coverage uses the documented pinned plain-PostgreSQL/auth-Vault shim boundary from T02; it does not claim full managed Supabase service fidelity. Lint retains the two pre-existing warnings. No cross-platform CI dispatch was performed in this session.

Decision deviations: none.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T04 and T05; both now have verified DONE prerequisites. T04 remains the first executable task in numeric order.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, and `plans/NEXT.md`.

### Notes/blockers

T03 is accepted. T04 and T05 are now READY; no T03-specific blocker remains.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T03 prompt](prompts/T03-constraint-model-canonicalization.md)

<a id="t04"></a>

## T04 — Canonical candidate intervals

| Field | Value |
|---|---|
| Task ID | T04 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | T02, T03 |
| Size | M |
| Risk | High |
| Reversible? | Yes |

### Objective

Validate exactly the assignment intervals that adoption will persist.

### Why now

The gateway accepted a 15-minute interval for a 60-minute planning duration; SQL later recomputes the end.

### Expected files/subsystems

- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)
- [lib/schedule-command-candidate.ts](../lib/schedule-command-candidate.ts)
- [tests/solver-gateway.test.ts](../tests/solver-gateway.test.ts)
- [supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql](../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql)
- [supabase/migrations/20260906120000_solver_candidate_intervals_v41.sql](../supabase/migrations/20260906120000_solver_candidate_intervals_v41.sql)
- [scripts/test-db.mjs](../scripts/test-db.mjs)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] Start/end values and assignment shape are strictly validated; nonfinite, malformed, duplicate, unknown, or cross-midnight assignments are rejected.
- [x] End times derive from pinned session overrides/class durations before IR evaluation; inconsistent supplied end times fail.
- [x] Shortened intervals cannot evade teacher availability, sequencing, or overlap checks.
- [x] Adoption persists the exact validated assignment interpretation and rolls back rejected candidates.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Add a shortened-duration teacher-window regression and a per-session duration override case.
- Keep SQL structural validation as defense in depth; change current function through a forward migration.

### Non-goals

Do not trust browser validation or add an alternative business-rule engine in SQL.

### Completion evidence

Task/child: T04

Starting HEAD: `17b3a603c202a28d1ae8c8fefdae6b2014da09ef` (`17b3a60`)

Implemented files: [lib/solver-gateway.ts](../lib/solver-gateway.ts), [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts), [tests/solver-gateway.test.ts](../tests/solver-gateway.test.ts), [scripts/test-db.mjs](../scripts/test-db.mjs), [docs/testing/database-integration.md](../docs/testing/database-integration.md), and forward migration [supabase/migrations/20260906120000_solver_candidate_intervals_v41.sql](../supabase/migrations/20260906120000_solver_candidate_intervals_v41.sql). [lib/schedule-command-candidate.ts](../lib/schedule-command-candidate.ts) was inspected and remained unchanged. Historical adoption SQL, bootstrap/archive SQL, production-ledger files, and `manifest.json` were not rewritten.

Acceptance criterion → evidence:
- Canonical assignment shape: the gateway requires exactly six non-empty string fields, strict `HH:MM` values on the 15-minute grid, allowed days, known session/class/teacher/room identities, a positive non-cross-midnight interval, and exact session-set cardinality. Tests cover malformed/nonfinite/cross-midnight/extra-field, unknown teacher, and duplicate-session candidates.
- Pinned duration and IR: effective duration is resolved from the pinned session override before the class duration; the supplied end must match. Tests cover the 90-minute session override and a shortened candidate against a teacher day window, so the short interval cannot evade shared IR validation.
- Adoption equivalence and rollback: the route forwards the canonical validated `endTime`; V4.1 SQL repeats structural/identity/grid/duration checks and inserts the supplied validated end. The live disposable PostgreSQL harness adopts `17:00–18:30`, verifies the persisted assignment, rejects `17:00–17:15`, and verifies no schedule version or current-pointer change remains after rejection.

Commands and exit codes (Windows 11 PowerShell, Node `v22.19.0`, npm `10.9.3`, Docker Engine `29.7.2`, pinned PostgreSQL image; disposable/nonproduction):
- `npm run lint` — 0 (2 pre-existing warnings).
- `npm run typecheck` — 0.
- `npm test` — 0; 46 files, 272 tests passed.
- `npm run build` — 0; Next.js 16.3.3 production build passed.
- `npm run test:db` — 0; fresh container reconstructed bootstrap, archived V2.1, and forward migrations through V4.1; T02, T03, and T04 live adoption checks passed, then the container was removed.
- `git diff --check` — 0; production-ledger manifest validation passed within `npm run test:db`. No production or staging target was used.

Regression cases: strict assignment shape and time grammar, unknown resources, duplicate sessions, effective per-session duration, teacher-window protection against shortened intervals, exact persisted end time, SQL structural defense in depth, and atomic rejected-candidate rollback.

Commit/reference: uncommitted; no commit was authorized.

Risks/limitations: the DB run uses the documented pinned plain-PostgreSQL/auth-Vault shim and a disposable service-role privilege fixture; it does not claim full managed Supabase service fidelity. Lint retains the two pre-existing warnings. No cross-platform CI dispatch or production/staging restore was performed.

Decision deviations: none. The only database behavior change is the forward V4.1 adoption-function replacement; historical migration SQL and ledger fingerprints remain unchanged.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T05 and T06. T05 is the first executable task in numeric order; T06 now has its T02/T04 dependencies verified.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, `plans/NEXT.md`, `plans/TEST_STRATEGY.md`, and `plans/DWDE_RELEASE_PLAN.md` (A04 evidence).

### Notes/blockers

Dependencies T02 and T03 are verified DONE. T04 is DONE; T05 is the first executable task in numeric order and T06 is also READY.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T04 prompt](prompts/T04-canonical-candidate-intervals.md)

<a id="t05"></a>

## T05 — Unsupported DWDE policy guard

| Field | Value |
|---|---|
| Task ID | T05 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | T01, T03 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Prevent changed human policy from silently retaining obsolete static compiler behavior.

### Why now

Changing OPS-003 wording to a 19:00 close still compiled 21:30 in the audit.

### Expected files/subsystems

- [lib/constraint-compiler.ts](../lib/constraint-compiler.ts)
- [lib/constraint-compiler-v3.ts](../lib/constraint-compiler-v3.ts)
- [lib/reviewed-rulebook.ts](../lib/reviewed-rulebook.ts)
- [lib/schedule-readiness.ts](../lib/schedule-readiness.ts)
- [lib/domain.ts](../lib/domain.ts)
- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [tests/constraint-compiler.test.ts](../tests/constraint-compiler.test.ts)
- [supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql](../supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] Supported reviewed DWDE v3 behavior remains reproducible.
- [x] An unsupported change to wording, strength, status, or executable policy content cannot be marked supported/current by the static compiler.
- [x] The OPS-003 19:00 regression fails closed instead of silently returning a supposedly current 21:30 policy.
- [x] Draft/unsupported rules have clear readiness feedback and preserve immutable policy history.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Reuse reviewed-policy provenance and inspect existing content-pinned repair precedent.
- Treat this as a temporary DWDE adapter guard, to be replaced by structured rules in T21/T25; do not create new generic-kernel exceptions.

### Non-goals

Do not implement a prose parser or the whole generic rule authoring system.

### Completion evidence

Task/child: T05
Starting HEAD: `17b3a603c202a28d1ae8c8fefdae6b2014da09ef` (`17b3a60`)
Implemented files: [lib/domain.ts](../lib/domain.ts), [lib/server-studio-state.ts](../lib/server-studio-state.ts), [lib/reviewed-rulebook.ts](../lib/reviewed-rulebook.ts), [lib/constraint-compiler-v3.ts](../lib/constraint-compiler-v3.ts), [lib/schedule-readiness.ts](../lib/schedule-readiness.ts), and [tests/constraint-compiler.test.ts](../tests/constraint-compiler.test.ts). No database behavior changed, so no forward migration was required; historical V36 SQL remains untouched.

Acceptance criterion → evidence:
- Supported V3: the reviewed-provenance fixture remains complete and emits the canonical OPS-003 21:30 close; existing V3 compiler regressions remain green.
- Unsupported policy: snapshot/content comparison covers wording, strength, status, and executable parameters; unsupported policy removes affected static nodes and forces `completeHardConstraintCompilation=false`.
- OPS-003 19:00: regression proves the stale 21:30 node is absent and readiness reports `UNSUPPORTED_REVIEWED_POLICY`.
- Draft/history: readiness receives an actionable provenance message, while the loaded immutable Rulebook snapshot remains unchanged by drifted live rule data.

Commands and exit codes: `npm run lint` 0 (two pre-existing warnings); `npm run typecheck` 0; `npm test` 0 (46 files, 278 tests); `npm run build` 0 (Next.js 16.3.3); `npm run test:db` 0 (disposable Docker PostgreSQL, T02/T03/T04 checks also passed); `git diff --check` 0.
Environment: Windows 11, Node v22.19.0, npm 10.9.3, Docker 29.7.2. No production target or data was used.
Commit/reference: uncommitted; no commit was authorized.
Risks/limitations: this is an explicitly temporary DWDE adapter guard using the reviewed V3 identity, source hash, and immutable snapshot. T21/T25 must replace the static adapter with structured tenant policy before generic-kernel extraction; no manager acceptance or production deployment evidence is claimed.
Decision deviations: none. New blockers: none.
Resulting task status: DONE. T06 remains READY; T07 is NOT_STARTED pending T06.
Updated plan files: `plans/README.md`, `plans/NEXT.md`, `plans/TASKS.md`, and `plans/DWDE_LEAKAGE_REGISTER.md`.

### Notes/blockers

Dependencies T01 and T03 are verified DONE. T05 is DONE. T06 remains READY and is next in the numeric execution spine.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T05 prompt](prompts/T05-unsupported-dwde-policy-guard.md)

<a id="t06"></a>

## T06 — Archive-aware adoption

| Field | Value |
|---|---|
| Task ID | T06 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | T02, T04 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Make active inventory consistent between solver preparation and database adoption.

### Why now

The solver excludes archived sessions but adoption counts all studio sessions.

### Expected files/subsystems

- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql](../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql)
- [supabase/migrations/20260905034428_planning_inventory_archive_v40.sql](../supabase/migrations/20260905034428_planning_inventory_archive_v40.sql)
- [supabase/migrations/20260905034442_planning_inventory_archive_guards_v40.sql](../supabase/migrations/20260905034442_planning_inventory_archive_guards_v40.sql)
- [tests/planning-inventory-lifecycle.test.ts](../tests/planning-inventory-lifecycle.test.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] Every active session is required exactly once; archived sessions are excluded from current candidate completeness.
- [x] Archived teachers/rooms/classes cannot be introduced into a new active candidate.
- [x] Archive → confirm → solve → adopt and restore → reconfirm execute successfully in the disposable database.
- [x] Historical versions still resolve archived identities; adjacent current-state count/query defects are fixed or explicitly assigned to T11/T12.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Define active session inventory including parent-class state.
- Use a forward migration, retain historical records, and inspect lock/archive interactions.

### Non-goals

Do not delete archived records, rewrite historical schedules, or broaden into generic retention policies.

### Completion evidence

Task/child: T06

Starting HEAD: `879c7ecebef4156b1d40eddca29a08f1b8772e35` on `feat/pre-cami-hardening` (T01–T05 accepted).

Implemented files:
- [supabase/migrations/20260907030000_archive_aware_solver_adoption_v42.sql](../supabase/migrations/20260907030000_archive_aware_solver_adoption_v42.sql)
- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [tests/archive-aware-adoption.test.ts](../tests/archive-aware-adoption.test.ts)
- [scripts/test-db.mjs](../scripts/test-db.mjs)

Acceptance criterion → evidence:
- Active completeness: V4.2 counts only sessions whose session and parent class are both active, requires exact row/distinct-session cardinality, and the disposable lifecycle proves an archived-only active inventory accepts zero assignments while a restored active session is required exactly once; a duplicate-session candidate rejects atomically.
- Archived targets: V4.2 resolves candidate sessions, parent classes, teachers, and rooms only when active and repeats those joins during insert. The live lifecycle restores the class while leaving teacher/room archived and proves candidate adoption rejects without creating a ScheduleVersion.
- Archive/confirm/solve/adopt lifecycle: the test archives the class/session, teacher, and room; confirms Planning Dataset v10; exercises the solver-facing active-session boundary and adopts the resulting empty feasible candidate; restores class/session and confirms v11; rejects archived teacher/room usage; restores teacher and room, confirms v13, and adopts the restored one-session candidate. The CP-SAT implementation itself was unchanged by T06; this task verifies that solver-facing inventory and governed adoption agree on the same active entity set.
- Historical identity: after archive, a historical ScheduleVersion assignment still resolves the archived session, parent class, teacher, and room by preserved IDs. No archive row is deleted or historical schedule rewritten. Broader incremental ASSIGN/UNASSIGN archived-target behavior remains explicitly owned by T11, and archive-aware recovery/rebase behavior remains explicitly owned by T12.

Verification evidence: GitHub Actions run `34083389232` at commit `8aa233241462fab87bfaec9275a08492bd1cd341` completed successfully on Ubuntu and Windows. Ubuntu 24.04 used Node `v22.23.2` with npm pinned to `11.6.0`; the disposable DB harness used the existing pinned PostgreSQL 17.6 image.
- `npm run lint` — 0 on Ubuntu and Windows; two pre-existing warnings remain.
- `npm run typecheck` — 0 on Ubuntu and Windows.
- `npm test` — 0; Ubuntu reported 47 files / 284 tests passed, including 6 T06 regressions.
- `npm run build` — 0 on Ubuntu and Windows; Next.js 16.3.3 production build passed.
- `npm run test:db` — 0 on Ubuntu; migrations reconstructed through V4.2 and emitted `T06 PASS: archive -> confirm -> adopt excludes archived inventory; archived resources reject; historical identities resolve; restore -> reconfirm -> adopt requires each active session exactly once`.

Core implementation commit: `cd1b95f666ccdc07b8b037b288e606a5f436aa53`. Verification-assertion correction: `8aa233241462fab87bfaec9275a08492bd1cd341`. The first verification run exposed only a case-sensitive wording assertion in the new static test; the assertion was corrected without changing scheduling/database behavior or weakening the gate, then the full second run passed.

Risks/limitations: no production database was read or mutated for T06 verification and no application deployment was performed. V4.1/V4.2 remain forward migrations pending a separately authorized release/deployment step. T07 still owns coherent immutable solver snapshot construction, T11 owns broader incremental archived-target commands, and T12 owns archive-aware recovery semantics.

Decision deviations: none. Historical migration SQL and production-ledger fingerprints remain unchanged.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T07. T08 remains NOT_STARTED pending T07.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, `plans/NEXT.md`, and `plans/DWDE_RELEASE_PLAN.md` (A06 partial evidence).

### Notes/blockers

Dependencies T02 and T04 are verified DONE. T06 is accepted with no remaining task-specific blocker. T07 is READY and is now first in the numeric execution spine.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T06 prompt](prompts/T06-archive-aware-adoption.md)

<a id="t07"></a>

## T07 — Coherent solver snapshots

| Field | Value |
|---|---|
| Task ID | T07 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | T02, T03, T05, T06 |
| Size | M |
| Risk | High |
| Reversible? | Yes |

### Objective

Build solver requests from coherent immutable planning and policy context.

### Why now

Independent reads of mutable entities and version pointers can mix facts from different moments.

### Expected files/subsystems

- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [lib/solver-problem.ts](../lib/solver-problem.ts)
- [lib/planning-dataset.ts](../lib/planning-dataset.ts)
- [lib/constraint-model-version.ts](../lib/constraint-model-version.ts)
- [tests/solver-problem-contract.test.ts](../tests/solver-problem-contract.test.ts)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] Scheduling facts come from the pinned immutable planning snapshot, with compatible historical schema handling.
- [x] Rulebook/model/current schedule and lock references belong to a coherent context; pointer changes cause retry or rejection.
- [x] Concurrent planning/policy changes cannot submit a mixed-version request.
- [x] The request excludes unrelated tenant data and unnecessary historical assignments.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Prefer snapshot reconstruction plus coherent pointer reads over a new event store.
- Specify snapshot/hash checks and what is allowed to change during a long solve.

### Non-goals

Do not add caching, queues, or event sourcing merely to solve consistency.

### Completion evidence

Task/child: T07

Starting HEAD: `ac22a8ee775d62d6b844c21573b4b3fee10308c1` on `feat/pre-cami-hardening` (T01–T06 accepted).

Implemented files:
- [supabase/migrations/20260907050000_coherent_solver_snapshot_v43.sql](../supabase/migrations/20260907050000_coherent_solver_snapshot_v43.sql)
- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)
- [tests/coherent-solver-snapshot.test.ts](../tests/coherent-solver-snapshot.test.ts)
- [tests/planning-inventory-lifecycle.test.ts](../tests/planning-inventory-lifecycle.test.ts)
- [tests/archive-aware-adoption.test.ts](../tests/archive-aware-adoption.test.ts)
- [scripts/test-db.mjs](../scripts/test-db.mjs)

Acceptance criterion → evidence:
- Pinned immutable planning facts: V4.3 adds member-authorized `get_solver_snapshot_v43`, and server solver state reconstructs teachers/rooms/students/cohorts/classes/sessions from the current `PlanningDatasetVersion.snapshot` rather than independently querying mutable planning tables. Stored Planning Dataset and Constraint Model hashes are verified. Snapshot schemas 1.0–1.3 are recognized; when an older snapshot lacks immutable names required by the current name-bound DWDE compiler, preparation fails closed with `SOLVER_PLANNING_SNAPSHOT_SCHEMA_UNSUPPORTED` rather than borrowing names from today's mutable rows.
- Coherent policy/model/schedule/locks: the V4.3 context token binds current Rulebook identity/hash, live reviewed-policy content hash, Planning Dataset identity/hash/confirmation, EnforcementVersion, ConstraintModelVersion/hash, current ScheduleVersion and its pinned versions, plus the current-assignment/lock hash. Any difference makes the context stale.
- Concurrent mutation safety: feasibility reloads the whole coherent snapshot after any deterministic model publication and compares the original token with a fresh token immediately before and after the external solver call. Drift returns `SOLVER_CONTEXT_CHANGED_RETRY` instead of submitting/accepting a mixed-context result. The disposable DB test proves both a live policy mutation and a current assignment/lock mutation change the token.
- Tenant/history minimization: the RPC is explicitly studio-scoped and member-authorized. It returns only assignments belonging to the current ScheduleVersion; the disposable fixture contains historical assignments and proves they are excluded. Planning facts are carried by the pinned tenant Planning Dataset snapshot rather than a fan-out over mutable cross-version tables.

Verification evidence: GitHub Actions run `34085179827` completed successfully on Ubuntu and Windows. Ubuntu 24.04 used Node `v22.23.2` with npm pinned to `11.6.0`; the disposable DB harness used the existing pinned PostgreSQL 17.6 image.
- `npm run lint` — 0 on Ubuntu and Windows; two pre-existing warnings remain.
- `npm run typecheck` — 0 on Ubuntu and Windows.
- `npm test` — 0; Ubuntu reported 48 files / 290 tests passed, including 6 dedicated T07 coherent-snapshot tests.
- `npm run build` — 0 on Ubuntu and Windows; Next.js 16.3.3 production build passed.
- `npm run test:db` — 0 on Ubuntu; migrations reconstructed through V4.3 and emitted `T07 PASS: one coherent snapshot uses pinned planning facts/current assignments only; policy and lock/schedule drift invalidate the context token`.

Implementation commit: `5937349f0ad6a8677c5708af1ab1cc8569a39ba5` (`feat: make solver snapshots coherent`). The verification process first exposed test-fixture typing, then two stale T06 structural assertions that expected the retired mutable server loader, and finally a disposable-harness role issue for synthetic drift mutation. Each was corrected without weakening the T07 contract; the final full matrix and database run passed.

Risks/limitations: no production or staging database was read or mutated, and V4.3 remains a forward migration pending separately authorized deployment. T07 prevents mixed context during preparation and the external solve; T08 still owns binding the resulting reviewed candidate to its exact base ScheduleVersion/lock context through later adoption. Historical snapshots that predate immutable names intentionally fail closed while the current static DWDE compiler remains name-bound; T20/T21 later remove that coupling.

Decision deviations: none. No event store, queue, cache, or new infrastructure tier was introduced.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T08. T09 remains NOT_STARTED pending T08.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, `plans/NEXT.md`, and `plans/DWDE_RELEASE_PLAN.md` (A05 partial evidence).

### Notes/blockers

Dependencies T02, T03, T05, and T06 are verified DONE. T07 is accepted with no remaining task-specific blocker. T08 is READY and is now first in the numeric execution spine.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T07 prompt](prompts/T07-coherent-solver-snapshots.md)

<a id="t08"></a>

## T08 — Candidate stale-schedule binding

| Field | Value |
|---|---|
| Task ID | T08 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | T07 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Bind reviewed candidates to the base schedule and lock state.

### Why now

Adoption currently uses the schedule freshly loaded at adoption rather than the schedule the manager reviewed.

### Expected files/subsystems

- [lib/solver-problem.ts](../lib/solver-problem.ts)
- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)
- [components/solver-feasibility-card.tsx](../components/solver-feasibility-card.tsx)
- [tests/solver-gateway.test.ts](../tests/solver-gateway.test.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] Candidate context includes base ScheduleVersion and unambiguous lock identity alongside studio, Rulebook, planning, and compiler/model context.
- [x] An intervening schedule edit or lock change rejects stale adoption even when policy/planning versions are unchanged.
- [x] The UI preserves the reviewed context and explains the need to regenerate/re-review.
- [x] Transactional expected-version checks use submitted reviewed context, not substituted fresh values.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Test concurrent editors and repeated/double adoption.
- Version the wire contract compatibly and reject missing required context.

### Non-goals

Do not implement scenario merging or automatic conflict resolution.

### Completion evidence

Task/child: T08

Starting HEAD: `bcdfa92f8086c089f1e16809fc24ea43e5aa3e98` on `feat/pre-cami-hardening` (T01–T07 accepted).

Implemented files:
- [lib/solver-candidate-context.ts](../lib/solver-candidate-context.ts)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)
- [components/solver-feasibility-card.tsx](../components/solver-feasibility-card.tsx)
- [supabase/migrations/20260907070000_candidate_stale_schedule_binding_v44.sql](../supabase/migrations/20260907070000_candidate_stale_schedule_binding_v44.sql)
- [tests/solver-candidate-context.test.ts](../tests/solver-candidate-context.test.ts)
- [tests/candidate-stale-binding.test.ts](../tests/candidate-stale-binding.test.ts)
- [scripts/test-db.mjs](../scripts/test-db.mjs)

Acceptance criterion → evidence:
- Exact reviewed context: feasibility returns a separate versioned `candidateContext` without changing the CP-SAT service problem contract. It carries the complete T07 coherent token, including base ScheduleVersion ID/version and `scheduleAssignmentsHash`, plus compiler identity; missing/partial context fails closed.
- Stale schedule/lock rejection: adoption compares the submitted reviewed context against the current coherent context before revalidation, and V4.4 repeats the comparison transactionally under the existing scheduling advisory locks. The disposable DB regression changes only the lock bit while Rulebook/Planning remain unchanged and proves stale adoption rejects.
- Review-preserving UI: the candidate card displays reviewed ScheduleVersion and schedule/lock fingerprint. A stale response keeps the reviewed candidate visible, clears approval, disables adoption, and tells the manager to generate a fresh candidate and review it again.
- No fresh-version substitution: the application sends `p_expected_context: reviewedContext` unchanged. V4.4 derives the expected schedule/rulebook/enforcement/planning/model versions from that submitted context before delegating canonical persistence/legacy validation to V3.3. Concurrent-editor and repeated/double adoption regressions prove only the first exact reviewed context can commit.

Verification evidence: GitHub Actions run `34086356692` completed successfully on Ubuntu and Windows. Ubuntu 24.04 used Node `v22.23.2` with npm pinned to `11.6.0`; the disposable DB harness used the existing pinned PostgreSQL 17.6 image.
- `npm run lint` — 0 on Ubuntu and Windows; two pre-existing warnings remain.
- `npm run typecheck` — 0 on Ubuntu and Windows.
- `npm test` — 0; Ubuntu reported 50 files / 297 tests passed, including 3 reviewed-context and 4 stale-binding tests.
- `npm run build` — 0 on Ubuntu and Windows; Next.js 16.3.3 production build passed.
- `npm run test:db` — 0 on Ubuntu; migrations reconstructed through V4.4 and emitted `T08 PASS: exact reviewed context adopts once; same-version lock drift, concurrent editor stale review, and double adoption reject atomically without fresh-version substitution`.

Implementation commit: `0c8456826d22dd4d26c1bed194f6bcdbed481348` (`feat: bind reviewed solver candidates to base schedule`). The first disposable DB run exposed that the synthetic test crossed the intentionally private schema as `service_role`. The correction preserved that boundary: the service-role-only public V4.4 RPC is a narrow security-definer function while broad private-schema access remains ungranted; the final full matrix passed.

Risks/limitations: no production or staging database was read or mutated, and V4.4 remains a forward migration pending separately authorized deployment. T08 binds the currently supported aggregate schedule/lock fingerprint; T09 still owns session-specific multi-session lock semantics throughout prepare/solve/validate/adopt.

Decision deviations: none. The external solver-service wire contract was deliberately unchanged; review/adoption context is a separate versioned wrapper.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T09. T10 remains NOT_STARTED pending T09.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, `plans/NEXT.md`, and `plans/DWDE_RELEASE_PLAN.md` (A05 verified evidence).

### Notes/blockers

T07 and T08 are verified DONE. T08 is accepted with no remaining task-specific blocker. T09 is READY and is now first in the numeric execution spine.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T08 prompt](prompts/T08-candidate-stale-schedule-binding.md)

<a id="t09"></a>

## T09 — Session-specific solver locks

| Field | Value |
|---|---|
| Task ID | T09 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | T07, T08 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Lock exact weekly sessions independently of class display names.

### Why now

Multi-session locks are explicitly unsupported and assignment/session lock representations can diverge.

### Expected files/subsystems

- [lib/solver-problem.ts](../lib/solver-problem.ts)
- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [solver/dwde_solver/service.py](../solver/dwde_solver/service.py)
- [solver/dwde_solver/feasibility.py](../solver/dwde_solver/feasibility.py)
- [solver/tests/test_service.py](../solver/tests/test_service.py)
- [solver/tests/test_feasibility.py](../solver/tests/test_feasibility.py)
- [tests/solver-problem-contract.test.ts](../tests/solver-problem-contract.test.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] One selected session of a multi-session activity preserves day/start/teacher/room while other meetings remain movable.
- [x] Runtime locks bind stable session IDs and preserve canonical duration.
- [x] Assignment/session lock precedence is explicit; locked placements cannot be lost at preparation, solve, validation, or adoption.
- [x] Missing, stale, conflicting, and impossible locks fail with deterministic explanations.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

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

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Apply placements directly to session variables; preserve policy-fixed assignment behavior separately.
- Use shared serialized fixtures for lock semantics on both runtimes.

### Non-goals

Do not redesign all sequencing or introduce a general locking service.

### Completion evidence

Task/child: T09

Starting HEAD: `ccd51862a5bc4e981f93ce9c64c35fec837df8a8` on `feat/pre-cami-hardening` (T01–T08 accepted).

Implementation commit: `d4ca679b5648cbe2c0bd7fb13999acf3eefaca95` (`feat: make solver locks session-specific`).

Implemented outcome:
- TypeScript preparation now defines effective runtime lock precedence as `SESSION OR ASSIGNMENT`. Either representation protects the exact current placement; a false value on one side cannot cancel a true lock on the other. Active archived-out sessions remain historical rather than current lock obligations.
- Multi-session classes are no longer rejected merely because one meeting is locked. Solver payloads carry the exact locked `sessionId` and canonical current placement, while sibling sessions remain independently variable.
- CP-SAT applies runtime locks directly to the selected session variables for day/start/teacher/room. Runtime locks are not converted into class-name `FIXED_ASSIGNMENT` policy nodes; policy-fixed assignments remain separate constraints. Diagnostic solves name runtime assumptions as `runtime-lock:<sessionId>`, so a policy/runtime conflict can report both stable IDs.
- Canonical duration remains derived from the pinned session override/class duration. Preparation rejects an inconsistent locked current end time rather than silently changing the lock, and solver output derives the locked end from that canonical duration.
- Candidate validation independently rejects movement of the exact locked session and preserves the effective lock marker only for locked meetings.
- V4.5 wraps the canonical V3.3 adoption writer. The pre-V4.5 implementation is renamed and removed from the service-role surface; the canonical name now protects `session.locked OR current_assignment.locked`, invokes the historical validated writer, and carries assignment-only locks into the newly adopted ScheduleVersion. T08's reviewed-context V4.4 RPC automatically resolves the wrapped canonical V3.3 function, so no fresh-version substitution was introduced.
- Shared serialized fixture `tests/fixtures/session-lock-semantics.json` is consumed by TypeScript and Python regressions. It covers a 75-minute locked first meeting of a two-meeting class and an independently movable sibling.

Acceptance criterion → evidence:
- Multi-session exact meeting: the shared fixture and Python service/CP-SAT tests preserve `multi-session-1` at Monday 18:30 with its teacher/room while the sibling meeting remains movable and non-overlapping.
- Stable ID + duration: runtime CP-SAT constraints attach to `session['id']`; the fixture's 75-minute override returns 18:30–19:45.
- Precedence through adoption: TypeScript regressions prove assignment-lock and session-lock OR semantics; the disposable PostgreSQL lifecycle sets an assignment-only lock while `class_sessions.locked=false`, adopts an unchanged reviewed candidate, proves the new assignment remains locked, then proves movement rejects atomically.
- Deterministic failures: TypeScript returns `LOCKED_SESSION_PLACEMENT_UNRESOLVED`, `LOCKED_SESSION_PLACEMENT_STALE`, and `LOCKED_SESSION_DURATION_MISMATCH`; Python reports `runtime-lock:<sessionId>` for impossible locks and reports both runtime and policy-fixed IDs for a direct conflict.

Verification evidence: GitHub Actions run `34088739598` passed the required T09 quality matrix. Ubuntu and Windows passed `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`; Ubuntu additionally passed `npm run test:db` through V4.5 and `python -m pytest -q` in a disposable solver virtual environment. The DB harness emitted the T09 PASS lifecycle for assignment/session lock precedence and atomic movement rejection.

Risks/limitations: no production or staging database was read or mutated, and V4.5 remains a forward migration pending separately authorized deployment. T09 does not redesign lock authoring UI or all schedule mutation commands; T10–T13 still own canonical manual-command authority and legacy-write closure. Policy `FIXED_ASSIGNMENT` remains class-selector based by design and is separate from runtime session locks.

Decision deviations: none. No general locking service or new infrastructure tier was introduced.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T10. T11 remains NOT_STARTED pending T10.

### Notes/blockers

Dependencies T07 and T08 are verified DONE. T09 is READY and is the first executable unfinished task.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T09 prompt](prompts/T09-session-specific-locks.md)

<a id="t10"></a>

## T10 — Manual MOVE through authoritative IR

| Field | Value |
|---|---|
| Task ID | T10 |
| Status | DONE |
| Milestone | A |
| Priority | P0 |
| Dependencies | T03, T04, T05, T06, T07, T08, T09 |
| Size | M |
| Risk | High |
| Reversible? | Yes before final cutover |

### Objective

Route manual MOVE through server-side canonical candidate construction and IR validation.

### Why now

Desktop/mobile moves currently commit under weaker legacy semantics than solver adoption.

### Expected files/subsystems

- [components/workspace-provider.tsx](../components/workspace-provider.tsx)
- [components/schedule/schedule-view.tsx](../components/schedule/schedule-view.tsx)
- [components/schedule/mobile-schedule-view.tsx](../components/schedule/mobile-schedule-view.tsx)
- [lib/schedule-command-candidate.ts](../lib/schedule-command-candidate.ts)
- [lib/constraint-gate-equivalence.ts](../lib/constraint-gate-equivalence.ts)
- [lib/constraint-engine-v2.ts](../lib/constraint-engine-v2.ts)
- [supabase/migrations/20260902122425_schedule_commands_v25.sql](../supabase/migrations/20260902122425_schedule_commands_v25.sql)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [x] Server authenticates and authorizes the explicit workspace, reconstructs pinned context, derives duration, and evaluates IR before MOVE commits.
- [x] An IR-only illegal move is rejected without a new canonical version.
- [x] Valid desktop/mobile moves persist with version checks and audit evidence.
- [x] Draft completeness and repair behavior are explicit; moving within a partial schedule remains possible without a false publishable claim.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Add one contained command route and restricted transaction boundary; reuse adoption infrastructure where correct.
- For this first cutover, reject wrong selected tenants rather than silently choosing first membership; full multi-tenant provisioning remains T22/T23.
- Record remaining bypasses for T13 and keep interim release blocked.

### Non-goals

Do not migrate unrelated commands or delete legacy authority before T11–T13.

### Completion evidence

Task/child: T10

Implemented files: `app/api/schedule/move/route.ts`, `lib/manual-move-command.ts`, `components/workspace-provider.tsx`, forward migration `supabase/migrations/20260907110000_authoritative_manual_move_v46.sql`, `tests/manual-move-command.test.ts`, `tests/manual-move-route-contract.test.ts`, `tests/manual-move-migration.test.ts`, and `scripts/test-db.mjs`. Historical migrations and production-ledger bytes were not edited.

Verified behavior: desktop and mobile MOVE continue to share `WorkspaceProvider`, which now POSTs to one server route instead of calling V2.5 directly. The server authenticates the bearer token against the explicitly supplied studio, rejects VIEWER access, reconstructs the T07 coherent snapshot, requires current ScheduleVersion links, recompiles the deterministic Constraint IR, proves exact semantic equality with the pinned published ConstraintModelVersion, derives the candidate interval from session/class duration, evaluates IR plus the temporary legacy safety floor, and rechecks the context token before commit. V4.6 is service-role-only, rechecks the exact context under advisory locks, rejects a selected tenant that differs from the legacy active membership, delegates only canonical MOVE fields to V2.5, preserves the pinned ConstraintModelVersion on the new schedule, and appends authoritative IR validation/context evidence to the audit event.

Regression evidence: the TypeScript suite proves an IR-only room-capacity violation is rejected even while the legacy gate accepts it; a legal move ignores a caller-supplied shortened end time and derives the canonical end; partial schedules remain movable with `scheduleComplete=false` and `publishable=false`; repair mode is explicit; and assignment locks fail structurally. The disposable PostgreSQL lifecycle proves a valid duration-derived MOVE advances one version, preserves the model link, writes authoritative audit evidence, rejects stale context atomically, rejects the wrong selected tenant, and rejects a locked assignment atomically.

Verification run: GitHub Actions T10 implementation run on Ubuntu 24.04 and Windows. Ubuntu executed `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:db`; Windows executed lint/typecheck/test/build, with the Docker database gate intentionally Ubuntu-only. All required gates passed before the implementation/handoff commit.

Remaining limitation / T13 bypass register: `apply_schedule_command_v25` remains executable by authenticated callers for compatibility until T11/T12 migrate the remaining command/recovery paths and T13 revokes/delegates superseded write entry points. Therefore the interim release remains blocked against claiming the shared server authority is unavoidable.

Resulting task status: DONE. Newly READY task: T11.

### Notes/blockers

T10 acceptance is verified. T11 is now READY and is the first executable unfinished task. Direct authenticated V2.5 access remains intentionally tracked for T13; no claim of unavoidable server authority is made yet.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T10 prompt](prompts/T10-manual-move-authoritative-ir.md)

<a id="t11"></a>

## T11 — ASSIGN/UNASSIGN canonical authority

| Field | Value |
|---|---|
| Task ID | T11 |
| Status | READY |
| Milestone | A |
| Priority | P0 |
| Dependencies | T10 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes before final cutover |

### Objective

Use the shared canonical authority for incremental schedule construction.

### Why now

Partial editing must remain usable while enforcing the same placement semantics as generation.

### Expected files/subsystems

- [components/workspace-provider.tsx](../components/workspace-provider.tsx)
- [components/schedule/schedule-builder-panel.tsx](../components/schedule/schedule-builder-panel.tsx)
- [lib/schedule-command-candidate.ts](../lib/schedule-command-candidate.ts)
- [lib/constraint-engine-v2.ts](../lib/constraint-engine-v2.ts)
- [supabase/migrations/20260902122425_schedule_commands_v25.sql](../supabase/migrations/20260902122425_schedule_commands_v25.sql)
- [tests/schedule-command-candidate.test.ts](../tests/schedule-command-candidate.test.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] ASSIGN/UNASSIGN use the server candidate/validation/transaction boundary established by T10.
- [ ] Unknown or duplicate sessions, archived targets, and lock violations reject atomically.
- [ ] Partial schedules can be built and remain visibly incomplete; final completeness is evaluated separately.
- [ ] No new placement violation can be hidden by removing another assignment or comparing only aggregate counts.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Define missing-predecessor/fixed-session findings as completeness obligations where appropriate, not blanket blockers to incremental construction.
- Test legal incremental sequences, disallowed placements, and no-op/retry behavior.

### Non-goals

Do not introduce a drag-and-drop redesign or universal repair search.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Dependency T10 is verified DONE. T11 is READY and is now the first executable unfinished task.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T11 prompt](prompts/T11-assign-unassign-authority.md)

<a id="t12"></a>

## T12 — Rebase/undo canonical authority

| Field | Value |
|---|---|
| Task ID | T12 |
| Status | NOT_STARTED |
| Milestone | A |
| Priority | P0 |
| Dependencies | T10, T11 |
| Size | M |
| Risk | High |
| Reversible? | Yes with retained history |

### Objective

Use the shared authority for recovery and revalidation.

### Why now

Legacy recovery can reintroduce assignments invalid under the complete current model.

### Expected files/subsystems

- [components/workspace-provider.tsx](../components/workspace-provider.tsx)
- [components/versions-view.tsx](../components/versions-view.tsx)
- [lib/schedule-command-candidate.ts](../lib/schedule-command-candidate.ts)
- [supabase/migrations/20260902122425_schedule_commands_v25.sql](../supabase/migrations/20260902122425_schedule_commands_v25.sql)
- [tests/schedule-commands-v25.test.ts](../tests/schedule-commands-v25.test.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] Undo, rebase, and revalidation use coherent context and the same deterministic scheduling semantics.
- [ ] Recovery creates a new version and never rewrites historical assignments or facts.
- [ ] Incompatible current-policy restores fail clearly; historical inspection remains possible.
- [ ] Archive/duration changes and stale version tokens cannot corrupt recovered state.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Distinguish inspect old version from adopt old assignments under current policy.
- Preserve compatible one-step undo; generalized history branching is not needed.

### Non-goals

Do not implement scenario merge, arbitrary rollback of production data, or event sourcing.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T10, T11. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T12 prompt](prompts/T12-rebase-undo-authority.md)

<a id="t13"></a>

## T13 — Close legacy write bypasses

| Field | Value |
|---|---|
| Task ID | T13 |
| Status | NOT_STARTED |
| Milestone | A |
| Priority | P0 |
| Dependencies | T10, T11, T12 |
| Size | S |
| Risk | High |
| Reversible? | Forward repair; no insecure rollback |

### Objective

Make the shared server validation path unavoidable for canonical schedule writes.

### Why now

Leaving authenticated legacy RPCs callable defeats a UI-only migration.

### Expected files/subsystems

- [supabase/migrations/20260902122425_schedule_commands_v25.sql](../supabase/migrations/20260902122425_schedule_commands_v25.sql)
- [supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql](../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql)
- [supabase/migrations/20260902163046_constraint_model_publication_v30.sql](../supabase/migrations/20260902163046_constraint_model_publication_v30.sql)
- [lib/supabase.ts](../lib/supabase.ts)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] All superseded canonical scheduling write entry points are revoked or delegate safely; authenticated callers cannot bypass IR.
- [ ] Privileged transactions recheck the actor's current role for the explicit studio and version context.
- [ ] Constraint publication is server-derived or equivalently protected against arbitrary client artifacts.
- [ ] Executed privilege enumeration and direct-RPC tests demonstrate no legacy bypass; retained historical readers are documented.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Inventory grants/functions before removal; preserve minimum SQL structural safeguards.
- Ship grant changes only after every active client path is migrated.

### Non-goals

Do not delete historical migrations or roll back to a weaker authority if problems occur; keep read-only mode and forward-fix.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T10, T11, T12. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T13 prompt](prompts/T13-close-legacy-write-bypasses.md)

<a id="t14"></a>

## T14 — Representative full DWDE acceptance fixture/solve

| Field | Value |
|---|---|
| Task ID | T14 |
| Status | NOT_STARTED |
| Milestone | A |
| Priority | P0 |
| Dependencies | T05, T06, T07, T08, T09, T10, T11, T12, T13 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Prove the full real scheduling workload and establish shared parity fixtures.

### Why now

Small passing fixtures do not establish complete planning data or operational solve performance.

### Expected files/subsystems

- [tests/golden-schedule-fixtures.test.ts](../tests/golden-schedule-fixtures.test.ts)
- [tests/constraint-engine.test.ts](../tests/constraint-engine.test.ts)
- [tests/constraint-engine-coverage.test.ts](../tests/constraint-engine-coverage.test.ts)
- [tests/solver-problem-contract.test.ts](../tests/solver-problem-contract.test.ts)
- [solver/tests/test_feasibility.py](../solver/tests/test_feasibility.py)
- [lib/schedule-readiness.ts](../lib/schedule-readiness.ts)
- [lib/delegated-solver-preflight.ts](../lib/delegated-solver-preflight.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] A manager-reviewed complete DWDE snapshot records people/classes/sessions/rosters/qualifications/availability and known omissions explicitly.
- [ ] A representative full solve covers every active session; independent IR validation, adoption, edit, and recovery pass in staging.
- [ ] Shared serialized fixtures run against TypeScript and Python, including feasible/infeasible, qualifications, durations, locks, and delegated preconditions.
- [ ] Runtime/solver default-deny and name-normalization discrepancies are fixed; unsupported semantics fail closed.
- [ ] Benchmark records hardware, pinned versions, request hash, wall time, memory/concurrency envelope, and manager-agreed operational threshold.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Introduce npm run test:parity as the cross-runtime fixture command.
- Use private artifacts for identifiable studio data, deidentified fixtures in Git, and no live production writes.
- Missing complete data is a real external blocker; synthetic facts cannot be represented as manager-approved DWDE completeness.

### Non-goals

Do not call toy fixtures full DWDE acceptance or expand objectives before HARD correctness.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T05, T06, T07, T08, T09, T10, T11, T12, T13. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T14 prompt](prompts/T14-dwde-acceptance-fixture.md)

<a id="t15"></a>

## T15 — Bounded and understandable solve failures

| Field | Value |
|---|---|
| Task ID | T15 |
| Status | NOT_STARTED |
| Milestone | A |
| Priority | P0 |
| Dependencies | T14 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Bound total solving/diagnostics and explain failure without false guarantees.

### Why now

A diagnostic second solve can exceed gateway timeout; blocker IDs are not rendered usefully.

### Expected files/subsystems

- [solver/dwde_solver/feasibility.py](../solver/dwde_solver/feasibility.py)
- [solver/dwde_solver/service.py](../solver/dwde_solver/service.py)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)
- [components/solver-feasibility-card.tsx](../components/solver-feasibility-card.tsx)
- [solver/tests/test_service.py](../solver/tests/test_service.py)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] One total deadline bounds preparation/search/diagnostics and fits the deployment timeout budget.
- [ ] FEASIBLE, INFEASIBLE, UNKNOWN, unsupported, precondition, malformed-service, and transport failures are distinct.
- [ ] Existing diagnostic constraint IDs are mapped to readable policy/entity evidence; empty cores do not imply no conflict.
- [ ] Fixed-anchor cores are labeled sufficient/partial, never guaranteed globally minimal; repair proposals never mutate canonical state.
- [ ] Placement explanations and simple empty-domain checks point to actionable facts/rules.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Validate service context for non-success replies as well as candidates.
- Keep deterministic explanation provenance; measure model build time as well as solver time.

### Non-goals

Do not build exact minimal conflicts, minimum-cost repairs, or an academic diagnostic framework.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T14. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T15 prompt](prompts/T15-bounded-solve-diagnostics.md)

<a id="t16"></a>

## T16 — Manager workflow/export/mobile verification

| Field | Value |
|---|---|
| Task ID | T16 |
| Status | NOT_STARTED |
| Milestone | A |
| Priority | P0 |
| Dependencies | T14, T15 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Complete the smallest DWDE workflow a manager can use independently.

### Why now

Generation without practical review, recovery, printable output, and deployed verification is not operational readiness.

### Expected files/subsystems

- [components/schedule/schedule-view.tsx](../components/schedule/schedule-view.tsx)
- [components/schedule/mobile-schedule-view.tsx](../components/schedule/mobile-schedule-view.tsx)
- [components/solver-feasibility-card.tsx](../components/solver-feasibility-card.tsx)
- [components/settings-view.tsx](../components/settings-view.tsx)
- [components/versions-view.tsx](../components/versions-view.tsx)
- [lib/supabase.ts](../lib/supabase.ts)
- [.env.example](../.env.example)
- [vercel.json](../vercel.json)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] Every step and evidence requirement in DWDE_RELEASE_PLAN.md passes with Cami or a named delegated manager.
- [ ] Schedule export/print includes version context and all active sessions; mobile view and essential form-based edits work.
- [ ] Authenticated owner/editor/viewer staging checks and environment/solver credentials pass; production fallback defaults are removed safely.
- [ ] A documented disposable restore/recovery drill succeeds; live deployment/migration status is recorded by an authorized release operator.
- [ ] AI is either aligned enough for current factual explanation or misleading mutation/legacy guidance is hidden before launch.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Introduce npm run test:e2e for repeatable authenticated staging/local smoke tests, using test users only.
- Put hashes/compiler details in advanced views; distinguish user acceptance from HTTP 200 checks.
- Record open P1 preference needs; promote T17–T19 if first-feasible output is operationally unusable.

### Non-goals

Do not claim production certification without release evidence or silently implement all AI features.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T14, T15. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T16 prompt](prompts/T16-manager-workflow-export.md)

<a id="t17"></a>

## T17 — Preference scoring

| Field | Value |
|---|---|
| Task ID | T17 |
| Status | NOT_STARTED |
| Milestone | C |
| Priority | P1 |
| Dependencies | T14 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Define a small set of deterministic, manager-understandable preference scores.

### Why now

The current OPT priority spine is metadata rather than an executable objective.

### Expected files/subsystems

- [lib/constraint-ir.ts](../lib/constraint-ir.ts)
- [lib/constraint-compiler-v3.ts](../lib/constraint-compiler-v3.ts)
- [lib/domain.ts](../lib/domain.ts)
- [lib/solver-problem.ts](../lib/solver-problem.ts)
- [tests/constraint-compiler.test.ts](../tests/constraint-compiler.test.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] Initial preference families and their units are explicitly selected from manager needs.
- [ ] HARD remains feasibility; VERY_STRONG > MODERATE > LIGHT > BASELINE semantics are explicit.
- [ ] Known candidate pairs rank as intended and rescore deterministically with readable components.
- [ ] DWDE OPT codes map through tenant policy data/adapter, not a new reusable Rule-ID dispatch.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:parity
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Start with counts, days, or gap minutes; bound penalties and record policy priority decisions.
- Introduce shared serialized scoring fixtures and annotate unsupported preferences clearly.

### Non-goals

Do not invent arbitrary giant weights, implement every soft rule, or claim universal utility scores.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T14. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T17 prompt](prompts/T17-preference-scoring.md)

<a id="t18"></a>

## T18 — Soft optimization

| Field | Value |
|---|---|
| Task ID | T18 |
| Status | NOT_STARTED |
| Milestone | C |
| Priority | P1 |
| Dependencies | T17, T15 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Use CP-SAT to improve schedules while preserving deterministic HARD correctness.

### Why now

Good schedules are necessary for repeatable commercial use after trustworthy feasibility exists.

### Expected files/subsystems

- [solver/dwde_solver/feasibility.py](../solver/dwde_solver/feasibility.py)
- [solver/dwde_solver/service.py](../solver/dwde_solver/service.py)
- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [solver/tests/test_feasibility.py](../solver/tests/test_feasibility.py)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] Initial penalties translate consistently to CP-SAT and independent scoring.
- [ ] Hierarchical optimization protects higher-tier achieved results; proven optimality is distinguished from a time-limited incumbent.
- [ ] HARD violations remain zero and locks/version context remain intact.
- [ ] Reported score, bound/status, and per-tier units agree with deterministic rescoring under a bounded total request budget.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Prefer sequential tier optimization; if a tier is not proven optimal, report that limitation precisely.
- Retain a feasibility-only mode and consistent service contract.

### Non-goals

Do not replace CP-SAT or introduce a separate optimization service.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T17, T15. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T18 prompt](prompts/T18-soft-optimization.md)

<a id="t19"></a>

## T19 — Candidate comparison/persistence

| Field | Value |
|---|---|
| Task ID | T19 |
| Status | NOT_STARTED |
| Milestone | C |
| Priority | P1 |
| Dependencies | T18, T08, T16 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Persist and compare a small number of useful schedule alternatives.

### Why now

Current results are transient and repeatable same-seed solves do not provide meaningful choice.

### Expected files/subsystems

- [components/solver-feasibility-card.tsx](../components/solver-feasibility-card.tsx)
- [components/schedule/schedule-view.tsx](../components/schedule/schedule-view.tsx)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)
- [lib/solver-gateway.ts](../lib/solver-gateway.ts)
- [solver/dwde_solver/feasibility.py](../solver/dwde_solver/feasibility.py)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] Two or three materially distinct candidates can be generated within supported budgets, with explicit diversity criteria.
- [ ] Candidates survive refresh and retain immutable policy/planning/base-schedule/lock context.
- [ ] Candidate-versus-current and candidate-versus-candidate differences show understandable preference tradeoffs.
- [ ] All alternatives independently validate/rescore and adoption rejects stale context.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Add minimal candidate persistence via forward migration; keep canonical schedules separate.
- Protect candidate rows with tenant authorization and avoid storing unnecessary personal data.

### Non-goals

Do not implement unlimited enumeration, generalized scenarios, or branch merge.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T18, T08, T16. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T19 prompt](prompts/T19-candidate-comparison-persistence.md)

<a id="t20"></a>

## T20 — Typed ID targets/parameters

| Field | Value |
|---|---|
| Task ID | T20 |
| Status | NOT_STARTED |
| Milestone | B |
| Priority | P1 |
| Dependencies | T14 |
| Size | L |
| Risk | High |
| Reversible? | Additive with compatibility |

### Objective

Make executable rule targets and parameter contracts stable and tenant-neutral.

### Why now

Names, Unicode normalization, and broad JSON parameters currently carry identity and ambiguous semantics.

### Expected files/subsystems

- [lib/constraint-ir.ts](../lib/constraint-ir.ts)
- [lib/constraint-data-binding.ts](../lib/constraint-data-binding.ts)
- [lib/constraint-engine.ts](../lib/constraint-engine.ts)
- [lib/constraint-engine-v2.ts](../lib/constraint-engine-v2.ts)
- [lib/delegated-solver-preflight.ts](../lib/delegated-solver-preflight.ts)
- [solver/dwde_solver/feasibility.py](../solver/dwde_solver/feasibility.py)
- [lib/domain.ts](../lib/domain.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] Typed discriminated parameters cover all supported kinds with explicit unsupported-parameter rejection.
- [ ] teacherIds/studentIds/roomIds/classIds/cohortIds/sessionIds or equivalent typed targets bind uniquely within the pinned tenant dataset.
- [ ] Display-name renames and Unicode/punctuation differences cannot change legality or score.
- [ ] Existing DWDE artifacts remain reproducible through versioned compatibility; missing/archived IDs fail explicitly.
- [ ] Rule kind, selectors, exceptions, runtime, solver, and explanations share serialized parity cases.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Split as T20a target/binding contract, T20b placement/resource families, T20c sequencing/progression/exception families; parent DONE only after all pass.
- Resolve names during reviewed import; keep policy definition independent of mutable dataset contents.
- Use explicit taxonomy codes/relationships; no substring-based progression.

### Non-goals

Do not build an enormous DSL, rename every domain table, or add a policy plugin system.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T14. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T20 prompt](prompts/T20-typed-id-targets.md)

<a id="t21"></a>

## T21 — Convert DWDE policy into tenant records

| Field | Value |
|---|---|
| Task ID | T21 |
| Status | NOT_STARTED |
| Milestone | B |
| Priority | P1 |
| Dependencies | T20 |
| Size | L |
| Risk | High |
| Reversible? | Preserve old artifacts; staged migration |

### Objective

Retain DWDE's behavior as tenant policy while removing source-code dispatch.

### Why now

Compiler, readiness, intake, and SQL contain named people/classes, 178-rule assumptions, and curriculum special cases.

### Expected files/subsystems

- [lib/constraint-compiler.ts](../lib/constraint-compiler.ts)
- [lib/constraint-compiler-v3.ts](../lib/constraint-compiler-v3.ts)
- [lib/rule-execution-registry.ts](../lib/rule-execution-registry.ts)
- [lib/schedule-readiness.ts](../lib/schedule-readiness.ts)
- [lib/planning-class-structure.ts](../lib/planning-class-structure.ts)
- [lib/planning-roster-repair.ts](../lib/planning-roster-repair.ts)
- [lib/required-class-intake.ts](../lib/required-class-intake.ts)
- [supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql](../supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql)
- [supabase/migrations/20260904215241_shared_rulebook_roster_compiler_v38.sql](../supabase/migrations/20260904215241_shared_rulebook_roster_compiler_v38.sql)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] DWDE people, rules, exceptions, curriculum/enrollment requirements, and historical versions remain intact.
- [ ] Generic compilation and readiness no longer require DWDE Rule IDs, names, fixed count 178, or specific levels/subjects.
- [ ] New tenant records reproduce the golden DWDE semantics and renamed fixture invariance.
- [ ] DWDE intake triggers are tenant-scoped during transition; unrelated classes cannot activate DWDE repair policy.
- [ ] Every actionable leakage item is resolved or explicitly assigned with evidence.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Split T21a compiler/registry policy records and T21b readiness/intake/repair requirements.
- Use ordinary tenant records, forward data migrations, and a controlled DWDE adapter; retain historical migration text.

### Non-goals

Do not remove DWDE, reseed production destructively, or introduce policy-pack inheritance infrastructure.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T20. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T21 prompt](prompts/T21-dwde-tenant-policy.md)

<a id="t22"></a>

## T22 — Tenant-explicit database commands

| Field | Value |
|---|---|
| Task ID | T22 |
| Status | NOT_STARTED |
| Milestone | B |
| Priority | P1 |
| Dependencies | T02, T13, T16 |
| Size | L |
| Risk | High |
| Reversible? | Staged compatibility; privileges forward-only |

### Objective

Authorize and mutate the explicitly selected tenant in every command.

### Why now

First-membership actor selection risks wrong-workspace writes for users with multiple memberships.

### Expected files/subsystems

- [supabase/production-ledger/20260831123403_v2_1_governed_infrastructure.sql](../supabase/production-ledger/20260831123403_v2_1_governed_infrastructure.sql)
- [supabase/production-ledger/20260831123611_v2_1_entity_membership_mutations.sql](../supabase/production-ledger/20260831123611_v2_1_entity_membership_mutations.sql)
- [components/workspace-provider.tsx](../components/workspace-provider.tsx)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)
- [app/api/copilot/route.ts](../app/api/copilot/route.ts)
- [supabase/functions/user-openrouter/index.ts](../supabase/functions/user-openrouter/index.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] Every active public command accepts/derives an explicit request tenant and authorizes that exact membership inside its transaction.
- [ ] Two memberships with different roles never route a write to the first/stronger membership.
- [ ] Cross-tenant IDs/references, candidate access, policy/planning/version/audit reads and writes reject.
- [ ] New identifiers are globally opaque; tenant-local Rule display codes can repeat without identity collision.
- [ ] Old ambiguous RPCs are revoked or safe wrappers; role revocation races and last-owner behavior are tested.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Split T22a scheduling/planning, T22b policy/artifacts, T22c membership/AI and privilege audit.
- Add same-studio checks and composite relational constraints where practical; preserve existing IDs.

### Non-goals

Do not rebuild authentication or infer authorization from user-editable metadata.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T02, T13, T16. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T22 prompt](prompts/T22-tenant-explicit-commands.md)

<a id="t23"></a>

## T23 — Tenant initialization/selection

| Field | Value |
|---|---|
| Task ID | T23 |
| Status | NOT_STARTED |
| Milestone | C |
| Priority | P1 |
| Dependencies | T22 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Create and select independent organizations through a standard supported flow.

### Why now

Storage contains studios but the application and routes hard-code DWDE.

### Expected files/subsystems

- [components/workspace-provider.tsx](../components/workspace-provider.tsx)
- [components/app-shell.tsx](../components/app-shell.tsx)
- [components/planning-archive-panel.tsx](../components/planning-archive-panel.tsx)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)
- [app/api/copilot/route.ts](../app/api/copilot/route.ts)
- [supabase/bootstrap/2026-08-31-production-schema-baseline.sql](../supabase/bootstrap/2026-08-31-production-schema-baseline.sql)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] A new organization initializes required empty/versioned state without copying DWDE operational records.
- [ ] Membership selection determines all workspace reads/writes and survives navigation safely.
- [ ] Users with no membership have a clear provisioning path; users with multiple memberships can select explicitly.
- [ ] Standard operator provisioning is documented and retry-safe; DWDE remains prepopulated.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Manual operator provisioning is acceptable during pilot, bespoke SQL per customer is not.
- Keep initialization atomic and guard empty-tenant solving until setup completes.

### Non-goals

Do not build advanced self-service billing, organization hierarchy, or tenant cloning.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T22. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T23 prompt](prompts/T23-tenant-initialization-selection.md)

<a id="t24"></a>

## T24 — Remove DWDE operational UI assumptions

| Field | Value |
|---|---|
| Task ID | T24 |
| Status | NOT_STARTED |
| Milestone | C |
| Priority | P1 |
| Dependencies | T20, T21, T23 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Display and configure the actual tenant's operating structure.

### Why now

Weekly view truncates to three rooms; hours, days, and start defaults encode DWDE.

### Expected files/subsystems

- [components/schedule/schedule-view.tsx](../components/schedule/schedule-view.tsx)
- [components/schedule/mobile-schedule-view.tsx](../components/schedule/mobile-schedule-view.tsx)
- [lib/schedule-builder.ts](../lib/schedule-builder.ts)
- [lib/domain.ts](../lib/domain.ts)
- [components/settings-view.tsx](../components/settings-view.tsx)
- [components/app-shell.tsx](../components/app-shell.tsx)
- [app/layout.tsx](../app/layout.tsx)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] All configured rooms render; no slice(0,3) data loss.
- [ ] Morning hours and configured operating windows render and edit consistently on desktop/mobile.
- [ ] Supported days/grid are explicit and consistent across UI, commands, IR, Python, and SQL; unsupported inputs reject instead of truncate.
- [ ] Tenant name/terminology replaces misleading DWDE presentation defaults while DWDE retains its own branding/data.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Do not add Sunday/finer grids blindly: declare pilot scope, then implement if acceptance demand requires it.
- Separate display horizon from legal operating windows.

### Non-goals

Do not redesign the app or add arbitrary resource bundles/multi-instructor scheduling.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T20, T21, T23. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T24 prompt](prompts/T24-tenant-operational-ui.md)

<a id="t25"></a>

## T25 — Generic structured rule authoring

| Field | Value |
|---|---|
| Task ID | T25 |
| Status | NOT_STARTED |
| Milestone | C |
| Priority | P1 |
| Dependencies | T20, T21, T23 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Allow unrelated studios to express supported policy without source edits.

### Why now

Current human wording edits cannot safely author executable rule parameters.

### Expected files/subsystems

- [components/rulebook/rulebook-view.tsx](../components/rulebook/rulebook-view.tsx)
- [lib/domain.ts](../lib/domain.ts)
- [lib/constraint-ir.ts](../lib/constraint-ir.ts)
- [lib/constraint-compiler-v3.ts](../lib/constraint-compiler-v3.ts)
- [lib/copilot-contract.ts](../lib/copilot-contract.ts)
- [supabase/migrations/20260831160600_v2_2_rule_mutations.sql](../supabase/migrations/20260831160600_v2_2_rule_mutations.sql)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] Forms support agreed pilot qualification, availability, room, operating-hours, sequencing, lock-related policy, and preference families.
- [ ] Typed targets/exceptions/strengths preview deterministic meaning and provenance before approval.
- [ ] Unsupported HARD semantics block readiness; edits version policy and invalidate stale candidates appropriately.
- [ ] Studio #2 policies can be authored with no compiler/solver/application changes.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Implement one template family per bounded session under T25; record child traceability if necessary.
- Human wording remains readable alongside the structured authority.

### Non-goals

Do not implement free-form executable prose, a general DSL, or AI approval authority.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T20, T21, T23. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T25 prompt](prompts/T25-structured-rule-authoring.md)

<a id="t26"></a>

## T26 — CSV intake

| Field | Value |
|---|---|
| Task ID | T26 |
| Status | NOT_STARTED |
| Milestone | C |
| Priority | P1 |
| Dependencies | T23, T24, T25 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes via version/archive |

### Objective

Provide reviewed, repeatable planning-data imports.

### Why now

Manual bespoke loading does not establish commercial onboarding.

### Expected files/subsystems

- [lib/import-validator.ts](../lib/import-validator.ts)
- [components/people-view.tsx](../components/people-view.tsx)
- [components/classes-view.tsx](../components/classes-view.tsx)
- [lib/planning-inventory-client.ts](../lib/planning-inventory-client.ts)
- [lib/reviewed-rulebook.ts](../lib/reviewed-rulebook.ts)
- [tests/import-validator.test.ts](../tests/import-validator.test.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] CSV preview validates required fields, durations, supported day/grid, duplicate identity, qualification and roster references, and tenant ownership.
- [ ] Name resolution/ambiguities are reviewed at intake and committed as stable IDs.
- [ ] Atomic commit rejects the entire invalid batch; retries do not duplicate records.
- [ ] Import provenance and counts are recorded; planning changes invalidate confirmation/candidates; no production import during tests.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Use CSV before management-platform integration; preserve DWDE's reviewed importer as an explicitly tenant-specific adapter.
- Define external row keys separately from canonical IDs.

### Non-goals

Do not build deep integrations or accept unvalidated direct table writes.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T23, T24, T25. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T26 prompt](prompts/T26-csv-intake.md)

<a id="t27"></a>

## T27 — Studio #2 acceptance

| Field | Value |
|---|---|
| Task ID | T27 |
| Status | NOT_STARTED |
| Milestone | C |
| Priority | P1 |
| Dependencies | T19, T21, T22, T23, T24, T25, T26 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes |

### Objective

Demonstrate unrelated onboarding without bespoke code.

### Why now

This is the commercialization gate rather than inferred genericity from types.

### Expected files/subsystems

- [plans/STUDIO_2_ACCEPTANCE.md](../plans/STUDIO_2_ACCEPTANCE.md)
- [tests/golden-schedule-fixtures.test.ts](../tests/golden-schedule-fixtures.test.ts)
- [tests/solver-problem-contract.test.ts](../tests/solver-problem-contract.test.ts)
- [solver/tests/test_feasibility.py](../solver/tests/test_feasibility.py)
- [components/workspace-provider.tsx](../components/workspace-provider.tsx)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] Every criterion and evidence requirement in STUDIO_2_ACCEPTANCE.md passes.
- [ ] At least 4 instructors/4 rooms/30 participants/12 activities/20 weekly sessions use non-DWDE policy and taxonomy.
- [ ] Onboarding, solve, rescore, compare, adopt, edit, archive/restore, export, and selected-tenant isolation require zero tenant-specific code.
- [ ] Rename invariance and known infeasible/UNKNOWN cases pass; unverified criteria remain explicitly open.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Freeze implementation SHA before onboarding; any bespoke code resets this acceptance run.
- Use standard provisioning/imports; operator assistance can clarify input but cannot implement a customer-specific compiler.

### Non-goals

Do not call a renamed DWDE dataset Studio #2 or waive isolation criteria.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T19, T21, T22, T23, T24, T25, T26. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T27 prompt](prompts/T27-studio-2-acceptance.md)

<a id="t28"></a>

## T28 — AI canonical-context alignment

| Field | Value |
|---|---|
| Task ID | T28 |
| Status | NOT_STARTED |
| Milestone | E |
| Priority | P2 |
| Dependencies | T25, T22, T27 |
| Size | M |
| Risk | Medium |
| Reversible? | Yes; optional feature can remain hidden |

### Objective

Align optional AI assistance with the same coherent tenant/version context and reviewed templates.

### Why now

Copilot currently describes legacy enforcement mappings and omits planning/model freshness.

### Expected files/subsystems

- [app/api/copilot/route.ts](../app/api/copilot/route.ts)
- [lib/copilot-contract.ts](../lib/copilot-contract.ts)
- [components/copilot-panel.tsx](../components/copilot-panel.tsx)
- [supabase/functions/user-openrouter/index.ts](../supabase/functions/user-openrouter/index.ts)
- [tests/copilot-contract.test.ts](../tests/copilot-contract.test.ts)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] AI context uses selected tenant and pinned current policy/planning/model/schedule state, excluding archived facts unless explicitly historical.
- [ ] Rule proposals use supported structured templates and require human review; AI cannot mutate canonical state directly.
- [ ] Explanations cite deterministic findings; hallucinated IDs/unsupported parameters/stale proposals fail.
- [ ] Scenario requests remain proposals unless a real isolated scenario workflow exists; AI failure does not block manual scheduling.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- T16 handles minimum launch-safe hiding/correction earlier; this task is fuller optional alignment.
- Test injection, stale context, viewers, cross-tenant references, provider failure, and model output allowlists.

### Non-goals

Do not infer canonical policy from model output or implement judgment learning/autonomous changes.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T25, T22, T27. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T28 prompt](prompts/T28-ai-canonical-context.md)

<a id="t29"></a>

## T29 — Paid-pilot operations

| Field | Value |
|---|---|
| Task ID | T29 |
| Status | NOT_STARTED |
| Milestone | D/E/F |
| Priority | P2 |
| Dependencies | T16, T19, T27 |
| Size | M |
| Risk | Medium |
| Reversible? | Mostly; billing changes require review |

### Objective

Support 3–5 real pilots and repeatable commercial MVP operations, then measure 10–25 customer evidence.

### Why now

Commercial success requires operational reliability and manageable onboarding/support economics.

### Expected files/subsystems

- [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- [.github/workflows/solver-ci.yml](../.github/workflows/solver-ci.yml)
- [solver/Dockerfile](../solver/Dockerfile)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)
- [app/api/copilot/route.ts](../app/api/copilot/route.ts)
- [vercel.json](../vercel.json)
- [.env.example](../.env.example)
- [plans/DWDE_RELEASE_PLAN.md](../plans/DWDE_RELEASE_PLAN.md)

Paths above exist at the planning baseline. New routes, fixtures, forward migrations, or scripts must be named after inspecting the implementation; they are not claimed to exist yet.

### Acceptance criteria

- [ ] 3–5 organizations use real schedules with recorded generation/adoption success and onboarding effort.
- [ ] Tenant usage/concurrency limits, total deadlines, actionable redacted logs, support process, and recovery runbook are verified.
- [ ] Basic billing/entitlements or documented standard manual invoicing supports pilots; repeatable MVP operations are explicit.
- [ ] A 10–25 customer measurement protocol tracks paid retention, accepted schedules, support cost, bespoke engineering, and integration requests; growth itself is not falsely marked achieved.
- [ ] Data export/deletion handling, credential rotation, restore evidence, and supported workload limits have named operational owners.

### Required tests

Run the exact commands below from the repository root using the isolated test environment described in TEST_STRATEGY.md. Commands introduced by predecessor tasks must exist before execution; missing commands are a blocker, not a pass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
npm run test:e2e
```

Add regression tests exercising each acceptance criterion, including rejection/no-write behavior. Existing tests alone do not establish this task's completion. Database text assertions cannot substitute for executed transaction/RLS tests.

### Implementation notes

- Split operational slices under T29 if needed; external adoption and customer growth remain milestone evidence, not code-completion claims.
- AI optional; if shipped, T28 is an additional release dependency.
- Do not create automation or contact customers without separate authorization.

### Non-goals

Do not build advanced billing, broad integrations, scale infrastructure, or fabricate customer evidence.

### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

Waiting for dependency acceptance: T16, T19, T27. This is normal sequencing, not a BLOCKED status.

Record discovered blockers as BLK-NNN in this section with evidence, impact, owner/action, and unblock criterion; link cross-task blockers from README.md. Record plan changes in DECISIONS.md.

### Implementation prompt

[Open T29 prompt](prompts/T29-paid-pilot-operations.md)


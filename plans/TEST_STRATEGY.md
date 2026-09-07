# Verification Strategy

Tests prove behavior at the layer where it matters. Shared fixtures and executed database boundaries take priority over SQL substring assertions. Audit baseline `17b3a60`; initial results below are historical observations, not new task acceptance.

# Existing test layers

- Vitest, Node environment: [config](../vitest.config.ts), [tests](../tests), plus colocated lib tests.
- Python pytest: [feasibility tests](../solver/tests/test_feasibility.py), [service tests](../solver/tests/test_service.py).
- Application CI: lint, typecheck, Vitest, build, unauthenticated rendered-route curl checks.
- Solver CI: Python tests and Docker build; PR path trigger currently excludes TypeScript contract-only changes.
- Migration tests mostly inspect SQL text/provenance, not executed transaction behavior.

Audit: lint/typecheck/build passed; 2 lint warnings. Current Windows checkout had 15 CRLF-caused failures, 241 passes; isolated LF SQL copy passed all 256. Python isolated pinned dependencies passed 24 tests. Ten routes returned HTTP 200. No live DB/RLS, authenticated UI, full current DWDE solve, or restore certification.

# TypeScript tests

Existing exact root commands:
```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

T01 must fix portable checkout integrity without changing ledger hashes. Retain behavior tests for compilation/binding/readiness, immutable planning snapshots, candidates, import validation, rule proposals and repair semantics. Add negative/malformed cases and no-write assertions, not tests that merely mirror implementation strings.

Relevant suites include [gateway](../tests/solver-gateway.test.ts), [model versions](../tests/constraint-model-version.test.ts), [readiness](../tests/schedule-readiness.test.ts), [candidate](../tests/schedule-command-candidate.test.ts), [archive](../tests/planning-inventory-lifecycle.test.ts).

# Python solver tests

Use a disposable virtual environment and pinned [requirements](../solver/requirements.txt). Example setup from root (choose a fresh temporary path if already used):
```powershell
python -m venv "$env:TEMP\studio-scheduler-test-venv"
& "$env:TEMP\studio-scheduler-test-venv\Scripts\python.exe" -m pip install -r solver/requirements.txt
Push-Location solver
& "$env:TEMP\studio-scheduler-test-venv\Scripts\python.exe" -m pytest -q
Pop-Location
```

Task prompts use `python -m pytest -q` assuming that environment is activated or its Python is selected. Never modify the global Python installation for tests. Record Python/OR-Tools versions, solver seed, workers, and time budget. Pinning supports reproducibility but does not imply cross-version identical search output.

Cover feasible/infeasible/UNKNOWN/precondition/unsupported, service auth/context, exact session locks, parameter validation, capacity/qualifications, sequencing, and total diagnostic budget. Docker verification remains part of solver deployment checks; unavailable Docker is reported, not skipped silently.

# Disposable DB integration tests

**Implemented interface:** T02 provides [`npm run test:db`](../package.json) through [`scripts/test-db.mjs`](../scripts/test-db.mjs). The command still requires Docker Desktop because it exercises a real disposable PostgreSQL instance.

T02 documents how to reconstruct current schema from bootstrap, archive and forward migrations without assuming a plain replay is valid. Test setup must include needed Supabase auth/vault behavior. Validate target is explicitly disposable; deny production host/project identifiers and require a positive nonproduction opt-in. Never let missing env vars select the production fallback in lib/supabase.ts.

Execute role/RLS tests, not source searches: owner/editor/viewer/nonmember, direct legacy RPC denial, transaction rollback, version conflict, membership revocation, same-tenant references, artifact round trips, and archive completeness. T03 adds a live Constraint Model JSONB publication/read-back check and verifies that object-key reordering reuses the historical version/fingerprint. T04 adds live service-role adoption coverage: a session-level duration override must persist its exact validated end, while a shortened interval is rejected and leaves no schedule-version/current-pointer mutation. Restore an isolated backup to a second disposable instance and compare essential counts/versions. No production restore command is authorized.

Command contract after T02:
```powershell
npm run test:db
```

Fail clearly when setup is unavailable. The reconstruction, fixture identities, teardown, ledger handling, and staging recovery outline are documented in [`docs/testing/database-integration.md`](../docs/testing/database-integration.md). This plan does not invent credentials.

# Runtime/solver parity tests

**Planned interface:** T14 creates `npm run test:parity`, invoking both layers against shared serialized fixture inputs. T09/T20 add cases to that contract.

Each case stores typed model, pinned facts, expected feasibility/validation findings, fixed candidate for evaluation, and optional score expectation. Where possible fix a complete assignment in Python to test whether it agrees with TS legality; separately test search output with independent TS validation. Independent tests with unrelated hand-built models do not establish parity.

Required coverage:
- every IR kind and supported parameter combination;
- unknown kinds and unsupported parameter values fail closed;
- explicit consistent default-deny qualification (no CUR-007 behavior switch);
- stable ID binding and Unicode/punctuation/duplicate display names;
- durations/session overrides, boundaries, cross-midnight/malformed values;
- sequencing designated meeting versus every applicable successor;
- gaps/workdays/attendance and capacity exceptions;
- user locks versus policy fixed assignments;
- delegated progression/enrollment proofs;
- partial placement legality versus final completeness;
- deterministic preference scoring and tier priority.

Name normalization must never create semantic divergence. During compatibility, use explicit golden mapping cases; new scheduling identity uses IDs.

# Golden DWDE fixtures

T14 creates a complete representative fixture with manager evidence; existing small [golden tests](../tests/golden-schedule-fixtures.test.ts) remain useful but are not full data proof.

Store synthetic/deidentified fixture data in Git; personal roster sources in approved private storage. Record source reconciliation and exact versions/hashes. Include known feasible witness, controlled impossible variants, existing exceptions, archived identities, multi-session locks and actual workload scale.

# Renamed-DWDE genericity test

T20/T21 transform all display names, preserving opaque IDs and semantic taxonomy codes/relationships. Compare legality, target binding, precondition results, and objective values before/after. Also rename tenant-local Rule display codes independently of canonical IDs. Include non-ASCII names and punctuation collisions.

Do not require unchanged explanation text, display-inclusive hashes, or arbitrary equal-optimum assignments. Any changed semantic verdict due solely to labels is a failure.

# Studio #2 fixture

Run [STUDIO_2_ACCEPTANCE](STUDIO_2_ACCEPTANCE.md) through T27: non-DWDE music school, four rooms, thirty participants, twenty sessions, different taxonomy and morning hours. Freeze code before onboarding; source editing during setup invalidates zero-bespoke acceptance.

# Tenant isolation tests

For every exposed table/command/API: anonymous/nonmember denial, tenant A member denied tenant B, viewer denied writes, editor denied owner actions, dual membership chooses exact tenant, role revocation during request rejected at commit. Include candidate/model/planning/schedule/history/audit/AI/import surfaces. Test direct RPC access outside the UI.

Check both returned data and persisted rows: an error status alone does not prove rollback or absence of side effects. Use opaque IDs plus same-studio reference tests.

# Candidate stale-version tests

T08/T13 require candidate context to pin studio, Rulebook, Planning Dataset, Constraint Model/compiler, base ScheduleVersion, lock identity. Independently change each before adoption; reject atomically and preserve current version. Test concurrent adoption, retry, missing context, and membership changes.

T07 verifies coherent immutable input under concurrent pointer/fact changes. A newly loaded version number must never be substituted for the reviewed token.

# Archive/restore tests

T06/T12/T14: archive optional session/class/teacher/room/participant within guards, confirm active set, solve/adopt, restore/reconfirm. Ensure old snapshots resolve archived identities and active candidates cannot use archived resources. Test lock-protected archive rejection, parent/child state, roster references, completeness counts, and no partial transaction.

# Deployment/authenticated smoke tests

**Planned interface:** T16 creates `npm run test:e2e` for authenticated local/staging tests. Only disposable/staging test users and targets. Existing curl 200 tests prove rendering, not manager usability.

Verify role flow, current workspace, create/edit/review/adopt/undo/export, all rooms/morning hours, essential mobile form fallback, and service-down/UNKNOWN messaging. Capture browser/device and versions. Validate actual timeout budgets and service credentials without logging secrets.

T16 removes production config fallback, documents environment expectations and recovery. Authorized release operators can provide deployment SHA/migration metadata; automated tests must never target production. T14/T16/T20 update solver CI triggers to cover shared fixture and TypeScript contract changes when that contract is established.

# Full DWDE acceptance test

T14 proves complete data and engine workflow; T16 completes every manager step in [DWDE_RELEASE_PLAN](DWDE_RELEASE_PLAN.md). Record named reviewer, confirmed snapshot and source completeness, solve resource limits, exact candidate/persisted equivalence, manual IR-only rejection, undo, export and mobile evidence.

A release requires both executable checks and actual manager acceptance. Missing external data/reviewer evidence is a blocker to the relevant task/gate.

## Evidence retention

Record task/run ID, SHA, environment, commands and exit codes, dependency versions, case IDs, output hashes/artifact references, rejected-write DB state, reviewer and unresolved limitations. Do not commit secrets, tokens, private student records, or provider keys. Use private approved evidence roots for live studio artifacts and deidentified summaries in plans.

## Harness readiness

| Command | Exists at baseline? | Owner | Dependent tasks |
|---|---|---|---|
| npm run lint/typecheck/build; npm test | Yes | Existing | All code tasks |
| python -m pytest -q from solver | Yes with requirements | Existing | Solver/parity changes |
| npm run test:db | Yes — Docker required | T02 | Database/canonical boundary tasks |
| npm run test:parity | No — planned | T14 | Objective/generic kernel tasks |
| npm run test:e2e | No — planned | T16 | Onboarding/product acceptance |

No acceptance record may present a planned command as already run.

# Verification strategy

Current audit results are in [AUDIT_VERIFICATION](AUDIT_VERIFICATION.md). This file defines repeatable checks, not claims that future tests already exist.

## Existing commands

From repository root, with Node/npm versions in .github/workflows/ci.yml (Node 22, npm 11.6.0) and installed lockfile dependencies:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

SAFE-02 removes implicit Supabase configuration. A build with no Supabase values must succeed and render the local **Configuration required** state without constructing a Supabase client or attempting a network request. For an explicit no-data local render probe, set both public values to a loopback/disposable target:
```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='audit-disposable-placeholder'
npm run build
```
A dummy key permits rendering only, not authenticated workflow verification. Never point verification at production merely to make a page load. Do not print secrets when inspecting configuration.

Python, from root, isolated temporary environment (do not alter system packages):
```powershell
python -m venv "$env:TEMP\studio-scheduler-audit-venv"
& "$env:TEMP\studio-scheduler-audit-venv\Scripts\python.exe" -m pip install -r solver/requirements.txt
Push-Location solver
& "$env:TEMP\studio-scheduler-audit-venv\Scripts\python.exe" -m pytest -q -p no:cacheprovider
Pop-Location
```
Pinned solver requirements are current repository authority. Do not install an alternative solver merely because the base interpreter lacks ortools.

## Database and auth fidelity

`npm run test:db` creates pinned disposable PostgreSQL containers through the repository harnesses. It rejects production/external configuration and requires Docker daemon. It reconstructs effective schema and uses an explicit auth/Vault shim; this executes PostgreSQL functions/RLS/transactions but does not reproduce managed Supabase Auth. SAFE-01's second focused container exercises two simultaneous PostgreSQL connections so membership mutation and privileged commit ordering are real row-lock behavior rather than a source-text assertion.

Disposable database setup from PowerShell is simply:
```powershell
# Docker Desktop Linux containers must be running.
npm run test:db
```
The npm script passes `--target=docker-local --allow-disposable` explicitly. Do not supply a Supabase URL to this DB harness and do not substitute a shared/staging/production database. The synthetic users/roles/JWT claims created by `scripts/test-db.mjs` are test identities only. Managed Supabase Auth/OAuth behavior remains a separate VERIFY-01 responsibility.

For each migration test effective function definitions after all migrations replay; owner/editor/viewer/no-member/wrong-tenant/service-only grants; expected-context races; rollback/no-write counts; archived/history resolution. SAFE-01 adds absent membership and concurrent role-revocation tests with exact authorization failure, not any incidental foreign-key/candidate error. Lock row ordering makes transactions serializable relative to membership mutation; test both mutation orders.

VERIFY-01 introduces **new** `npm run test:parity` and `npm run test:e2e` commands. They are absent until that task is accepted. It must establish isolated authenticated fixtures, loopback allowlisting, disposable credentials and backend persistence assertions. Prefer a pinned local managed-service stack when real auth/RLS semantics are required; document dependency if necessary rather than pretending an HTTP mock proves auth. Existing browser tools may inspect UI but are not a committed reproducible harness. No silent shared/staging fallback.

## Required coverage by change

| Change | Required added evidence |
|---|---|
| Review/fingerprints/certification | unknown vs explicit-none, missing positive fact, slice-selective invalidation, policy/schema change, concurrency, tenant denial and no-write |
| Typed policy/compiler/IR | each family positive/negative/boundary, unsupported HARD, multi-rule bundle ownership, rename/permutation/duplicate labels, TS/Python parity, current SQL safeguards |
| Scheduling/locks/recovery | partial vs final, duration overrides, exact session lock, stale base/context, role revocation, archive/history, authoritative rejection without optimistic success |
| Inventory/import/cycles | atomic batch/version creation, stale writes, identity references, reviewed roster, retry/idempotence, historical reproducibility, privacy-safe exports |
| UI | authenticated desktop + 390px mobile + keyboard/tap, empty/loading/error/retry, retained form input, actual persisted accepted/rejected result, every configured room |
| Operations/tenancy | role matrix across two studios, zero/multi membership, support diagnostic redaction, backup restore reconciliation, incident/release procedure |
| Acceptance | actual participant, frozen SHA/config, complete workload, bounded timings, assistance log and exact pass/fail artifact links |

## Shared semantic fixtures

VERIFY-01 runs the same serialized cases through TS deterministic evaluator and Python service/solver. Include known feasible witness, proven impossible small cases, zero/partial schedules, unqualified teacher, overlap, mixed per-session duration, archived IDs, unsupported HARD and session locks. Add each typed family when introduced. Independent validation/rescoring must not simply trust the candidate's result or objective total.

Maintain DWDE golden historical regression plus deidentified full representative workload and rename metamorphic transformations; do not replace full manager acceptance with either. A pure feasible example only tests part of the problem. Avoid claiming minimal unsatisfiable causes when diagnostics merely identify known participating restrictions.

## Browser and operational acceptance

Primary journey: sign in → Setup → inventory/requirements → review → build → review candidate → adopt → edit → lock/regenerate → undo/recover → print/export. Test parallel stale update, unavailable/timeout/unsupported paths and AI off. Before B add empty new workspace, different rule count, morning/Sunday, 4 rooms, multi-membership and CSV. Before D add new cycle and restored history.

Final exported timetable must reconcile session IDs/counts/durations/placements to pinned schedule, with no unintended roster disclosure. A visibly labeled draft export is allowed while incomplete/stale; a reviewed final artifact must fail gate when stale or incomplete. Retain a printable artifact or image evidence and an automated content reconciliation, not screenshots alone.

Before operational release, operator supplies authorized app/solver/database migration versions, safe staging/config checks, restore evidence with count/hash comparison, supported limits and incident instructions. Running build is not deployment verification. Customer/private artifacts stay outside public Git; record secure reference and deidentified summary.

## CI repairs and completion

SAFE-02 expands Solver CI PR paths beyond `solver/**` to shared TypeScript constraint/compiler/gateway code and `tests/fixtures/**`, so a shared fixture-only PR schedules Python checks. Main CI still owns lint/typecheck/unit/build and disposable database integration. Current CI push trigger is main plus PRs; a branch push alone is not historical CI proof.

STANDARD tasks use bounded acceptance examples already in their prompts. POL-01 and GEN-01 require explicit semantic-family checkpoints and adversarial parity review. Unavailable required check means BLOCKED verification, not an assumed pass. Do not repeatedly broaden testing after appropriate checks pass absent new evidence.

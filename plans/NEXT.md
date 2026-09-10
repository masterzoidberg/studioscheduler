# Next autonomous run

**R4 — UX-01: make schedule generation and failures understandable**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R4 from implementation HEAD `03218ae750166445c1226b5d1b14988a5de822fb` on branch `feat/pre-cami-hardening`. SET-07 completed the bounded readiness and manager-certification gate matrix, server-prepared V60 confirmation context, certification-aware solver snapshot/adoption boundary, local disposable DB regression, parity and authenticated browser evidence. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [UX-01 prompt](prompts/UX-01.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-07 is complete; UX-01 is the only selected task.

Complete only UX-01: create the Build schedule action from Setup review, show bounded progress and candidate review before adoption, and distinguish created, infeasible, unknown/timeout, incomplete, unsupported, unavailable and stale outcomes. Cancellation must ignore late results and leave the canonical Schedule untouched; manager explanations link to policy/lock actions while raw diagnostics stay in Advanced.

Preserve canonical Rulebook/ConstraintModel/PlanningDataset/Schedule version authority, exact tenant/current-role authorization, deterministic HARD legality, review/certification context and stale/no-write rejection. Reuse the existing solver gateway and authoritative adoption route. Do not add an optimizer, minimum-unsatisfiable-core algorithm, background job service, deployment, production/private-data access, paid services, merge, push, external messages or destructive actions.

Required verification from the repository root with explicit disposable configuration:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
$env:PYTHON_BINARY='C:\Users\nicol\AppData\Local\Temp\studio-scheduler-audit-venv\Scripts\python.exe'; npm run test:parity
$env:PYTHONPATH='solver'; Push-Location solver; & 'C:\Users\nicol\AppData\Local\Temp\studio-scheduler-audit-venv\Scripts\python.exe' -m pytest -q -p no:cacheprovider; Pop-Location
npm run test:e2e
```

On acceptance, create one bounded UX-01 commit, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. Do not claim milestone A or external acceptance from this run alone.

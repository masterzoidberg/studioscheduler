# Next autonomous run

**R4 — UX-02: complete editing, locks and recovery journey**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R4 from implementation HEAD `675878a1c9efbcd45cacd6d0d109b284b4b3ba42` on branch `feat/pre-cami-hardening`. UX-01 completed the manager-facing Build schedule flow, bounded generation progress and cancellation, candidate review before adoption, understandable solver outcome classification, actionable recovery links and stale-result protection. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [UX-02 prompt](prompts/UX-02.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-07 and UX-01 are complete; UX-02 is the only selected task.

Complete only UX-02: make the inspector explicit about valid, incomplete, allowed preference warning, locked and rejected changes; support keyboard/tap assignment without drag, an unscheduled tray, lock/regenerate explanation, preview recovery before canonical mutation and usable version-history labels. Correct inspector duration to `sessionDurationMinutes` and render every configured room; existing room truncation and class-default duration must not mislead legality.

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

On acceptance, create one bounded UX-02 commit, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. Do not claim milestone A or external acceptance from this run alone.

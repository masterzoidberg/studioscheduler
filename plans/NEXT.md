# Next autonomous run

**R4 — SET-07: unify readiness and manager certification**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R4 from implementation HEAD `25a92a42842961a3c35e3506350ee97c5f14f872` on branch `feat/pre-cami-hardening`. SET-06 completed student restriction and relationship authoring, stable-ID compiler/runtime/preflight support, the V59 SQL safeguards, local disposable database, parity, pinned Python and authenticated browser evidence. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [SET-07 prompt](prompts/SET-07.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-06 is complete; SET-07 is the only selected task.

Complete only SET-07: implement the DEC-105 readiness and manager-certification gate matrix at UI, server and transaction boundaries, extending the existing planning confirmation with pinned Rulebook/model/review-set context. Keep unreviewed HARD meaning fail-closed and partial legal drafts editable under authoritative semantics.

Preserve canonical Rulebook/ConstraintModel/PlanningDataset/Schedule version authority, exact tenant/current-role authorization, deterministic HARD legality, dependency-closed policy replacement, review fingerprints and stale/no-write rejection. Reuse the POL-03 families; do not add generic relation graphs, prose parsing, invented minimum-attendance/full-presence semantics, deployment, production/private-data access, paid services, merge, push, external messages or destructive actions.

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

On acceptance, create one bounded SET-07 commit, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. Do not claim milestone A or external acceptance from this run alone.

# Next autonomous run

**R3 — SET-06: capture student restrictions and scheduling relationships**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R3 from implementation HEAD `e1a32d3a910d86b679515572ebc4ae85366bbc93` on branch `feat/pre-cami-hardening`. POL-03 completed the stable-ID policy schemas, compiler, TS/Python runtimes, completeness preflight and V58 SQL safeguards with local disposable database, parity and pinned Python evidence. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [SET-06 prompt](prompts/SET-06.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. POL-03 is complete; SET-06 is the only selected task and SET-07 remains queued behind it.

Complete only SET-06: add manager-facing structured latest-finish, maximum attendance-day, no-overlap participant-group, direct-after and linked-arrival/attendance policy authoring with explicit stable IDs. State relationship direction, allowed timing and participants. A sibling/family fact alone creates no HARD policy, and unsupported interpretation remains visible and blocking rather than silently compiled.

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

On acceptance, create one bounded SET-06 commit, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. Do not claim milestone A or external acceptance from this run alone.

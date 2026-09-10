# Next autonomous run

**R3 — POL-03: type linked attendance and sequencing policies**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R3 from implementation HEAD `5f2aa78750db57ba602db2827d2f0ee6ceb4199c` on branch `feat/pre-cami-hardening`. R2 completed SET-03, SET-04 and SET-05 with local disposable database, parity, pinned Python and authenticated browser evidence. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [POL-03 prompt](prompts/POL-03.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-05 is complete; POL-03 is the only selected task and SET-06 remains queued behind it.

Complete only POL-03: use the established bundle-replacement protocol to promote stable-ID no-overlap participant groups, maximum attendance days, direct-after predecessor/successor sessions, and the linked-arrival allowed offset interval. Directly-after means same day with successor start equal to predecessor end. Arrival delta is teacher first teaching start minus linked participant first attended session start per day, inclusive of the configured minimum and maximum. Preserve the fixed missing-session, absent-roster, self-edge, cycle, ambiguity and non-vacuous dependency behavior in the prompt.

Preserve canonical Rulebook/ConstraintModel/PlanningDataset/Schedule version authority, exact tenant/current-role authorization, deterministic HARD legality, dependency-closed policy replacement and stale/no-write rejection. Do not add a generic relation graph, prose parser, invented minimum-attendance family, full-presence semantics without evidence, deployment, production/private-data access, paid services, merge, push, external messages or destructive actions.

Required verification from the repository root with explicit disposable configuration:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
$env:PYTHON_BINARY='C:\Users\nicol\AppData\Local\Temp\studio-scheduler-audit-venv\Scripts\python.exe'; npm run test:parity
$env:PYTHONPATH='solver'; Push-Location solver; & 'C:\Users\nicol\AppData\Local\Temp\studio-scheduler-audit-venv\Scripts\python.exe' -m pytest -q -p no:cacheprovider; Pop-Location
```

On acceptance, create one bounded POL-03 commit, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. Do not claim milestone A or external acceptance from this run alone.

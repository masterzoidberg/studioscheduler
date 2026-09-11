# Next autonomous run

**R4 — UX-03: deliver usable schedule print/export and responsive review**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R4 from implementation HEAD `2fb44a07d6778b6c0394f0077c5917e34f304cd6` on branch `feat/pre-cami-hardening`. UX-02 and LOCK-01 completed the manager-facing editing, recovery, effective lock, governed lock/unlock, context staleness and authenticated disposable verification paths. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [UX-03 prompt](prompts/UX-03.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-07, UX-01, UX-02 and LOCK-01 are complete; UX-03 is the only selected task.

Complete only UX-03: add printable weekly and teacher/room views with readable pagination plus schedule CSV across all configured rooms and the configured horizon. Label draft/stale exports and allow reviewed final export only under current complete certification; redact student rosters by default and keep privileged data export separate.

Preserve canonical Rulebook/ConstraintModel/PlanningDataset/Schedule version authority, exact tenant/current-role authorization, deterministic HARD legality, review/certification context and stale/no-write rejection. Reuse existing schedule/version data and browser print where sufficient. Do not add a public share link, student portal, PDF service dependency, deployment, production/private-data access, paid services, merge, push, external messages or destructive actions.

Required verification from the repository root with explicit disposable configuration:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

After implementation, run `npm run test:e2e` for the changed authenticated journey. Run the pinned Python/parity and disposable DB suites if the changed path affects their authority or solver context. On acceptance, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. Do not claim milestone A or external acceptance from this run alone.

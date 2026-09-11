# Next autonomous run

**R5 — OPS-01: verify deployment configuration and recovery**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R5 from implementation HEAD `63ea804` on branch `feat/pre-cami-hardening`. UX-03 completed the governed print/export and responsive review surface on top of the manager-facing editing, recovery, effective lock, governed lock/unlock, context staleness and authenticated disposable verification paths. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [OPS-01 prompt](prompts/OPS-01.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-07, UX-01, UX-02, LOCK-01 and UX-03 are complete; OPS-01 is the only selected task.

Complete only OPS-01: add and run the disposable restore/migration rehearsal, validate the repository and deployment-shaped configuration without printing secrets, and prepare the rollback-to-read-only release checklist with exact expected app, solver, database-image and migration versions. Verify staging app/solver authentication, timeout limits and health checks only when explicitly authorized; no deployment or production access is implied.

Preserve canonical Rulebook/ConstraintModel/PlanningDataset/Schedule version authority, exact tenant/current-role authorization, deterministic HARD legality, review/certification context and stale/no-write rejection. Reuse the existing migration and disposable database harnesses; do not add a second database or release authority. Do not deploy, access production/private data, add paid services, merge, push, send external messages or perform destructive actions.

Required verification from the repository root with explicit disposable configuration:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

OPS-01 additionally runs `npm run ops:check-config` (with explicit staging values supplied by the operator) and `npm run ops:restore`. If staging/deployed evidence is unavailable or unauthorized, record that external gate and leave OPS-01 incomplete; do not claim milestone A or external acceptance from this run alone. On acceptance, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run.

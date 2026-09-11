# Next autonomous run

**R6 — GEN-01: replace remaining name-bound targets**
**Execution class: HIGH-REASONING IMPLEMENTATION**
**Milestone: B — Second-Studio Ready**
**Status: SELECTED; the only READY task and next run.**

Execute R6 from implementation HEAD `607a8ce` on branch `feat/pre-cami-hardening`. OPS-01’s disposable engineering rehearsal, secret-safe configuration checker and release checklist are complete; its staging/deployed evidence remains blocked on owner authorization. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [GEN-01 prompt](prompts/GEN-01.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-07, UX-01, UX-02, LOCK-01 and UX-03 are complete; OPS-01’s engineering portion is recorded as blocked on external evidence; GEN-01 is the only selected task.

Complete only GEN-01: replace remaining name-bound scheduling targets with stable tenant-owned identity references across the application, compiler/IR, solver and SQL boundaries, preserving deterministic HARD behavior, dependency-closed compilation, exact tenant authorization, and TypeScript/Python parity. Add focused rename/missing-ID/duplicate-reference regressions and do not begin GEN-02’s tenant-record conversion.

Preserve canonical Rulebook/ConstraintModel/PlanningDataset/Schedule version authority, exact tenant/current-role authorization, deterministic HARD legality, review/certification context and stale/no-write rejection. Read only the GEN-01 bounded prompt and current code paths; do not deploy, access production/private data, add paid services, merge, push, send external messages or perform destructive actions.

Required verification from the repository root with explicit disposable configuration:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

GEN-01 additionally runs the focused TypeScript, pinned Python, parity and disposable DB evidence required by its prompt. On acceptance, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. OPS-01 remains incomplete until its external gate is separately authorized and evidenced; this run does not claim milestone B.

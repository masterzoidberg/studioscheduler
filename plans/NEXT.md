# Next autonomous run

**R7 — GEN-02: convert DWDE policy to tenant records**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: B — Second-Studio Ready**
**Status: SELECTED; the only READY task and next run.**

Execute R7 from implementation HEAD `65e780504b6eaea9c2be9fc1ab7aa55ebf4885bf` on branch `feat/pre-cami-hardening`. GEN-01’s stable-ID extraction is accepted; OPS-01’s disposable engineering rehearsal, secret-safe configuration checker and release checklist are complete, but its staging/deployed evidence remains blocked on owner authorization. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [GEN-02 prompt](prompts/GEN-02.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. GEN-01, SET-07, UX-01, UX-02, LOCK-01 and UX-03 are complete; OPS-01’s engineering portion is recorded as blocked on external evidence; GEN-02 is the only selected task.

Complete only GEN-02: convert the reviewed DWDE policy to tenant records with per-rule provenance/disposition accounting, typed Rulebook records and typed preconditions, replacing static compiler/readiness/repair dispatch only after parity. Preserve historical readers and fixtures; do not begin GEN-03’s tenant-scoped command conversion.

Preserve canonical Rulebook/ConstraintModel/PlanningDataset/Schedule version authority, exact tenant/current-role authorization, deterministic HARD legality, review/certification context and stale/no-write rejection. Read only the GEN-02 bounded prompt and current code paths; do not deploy, access production/private data, add paid services, merge, push, send external messages or perform destructive actions.

Required verification from the repository root with explicit disposable configuration:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

GEN-02 runs the focused TypeScript, pinned Python, parity and disposable DB evidence required by its prompt, plus the changed user journey if applicable. On acceptance, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. OPS-01 remains incomplete until its external gate is separately authorized and evidenced; this run does not claim milestone B.

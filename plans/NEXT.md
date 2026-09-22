# Next autonomous run

**R15 — GEN-05: prove independent second-studio acceptance**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: B — Second-Studio Ready**
**Status: SELECTED; BLOCKED on EXT-STUDIO2.**

The preceding R14 / CAND-01 implementation is accepted in the uncommitted worktree from implementation HEAD `dd2cb1337e3270128f7faa0c599a85eeedde5e00`. CAND-01 passed the disposable database, full unit, build, parity and authenticated browser gates and is archived. R15 is the next ledger-order task, but cannot be completed without an authorized independent consenting studio/manager and private acceptance evidence. OPS-01 is separately blocked on authorized staging/deployed migration, configuration and restore evidence.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), [STUDIO_2_ACCEPTANCE](STUDIO_2_ACCEPTANCE.md), and the bounded [GEN-05 prompt](prompts/GEN-05.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. Do not infer acceptance from synthetic fixtures or source inspection.

GEN-05 requires a complete frozen-SHA S2 acceptance using normal account/setup/import/solve/review flows, different room count/hours/curriculum/IDs, an independent manager, recorded assistance, rename metamorphic evidence, feasible/impossible parity, and private artifact references. No source patch, fabricated participation, production test, deployment or external message is authorized by the task.

Exact blocker: no authorized independent studio/manager or private acceptance artifacts are available in the repository context. The local implementation prerequisites are present; engineering cannot safely manufacture the required acceptance evidence. Resume only when the owner supplies that authorized external input and private references.

While blocked, preserve canonical Rulebook/ConstraintModel/PlanningDataset/Schedule authority, exact tenant/current-role authorization, deterministic HARD legality, review/certification context and stale/no-write rejection. Do not begin OPS-02 or unrelated work, and do not deploy, merge, push, contact an external participant or use production as a verification fallback.

Required verification after the external gate is supplied, from the repository root with explicit disposable configuration:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
npm run test:e2e
```

Missing Docker, pinned Python, authorized manager evidence or private acceptance artifacts is a blocker, never a pass. On acceptance, record exact criteria/evidence/commands/exit codes/artifacts/limitations and the implementation reference in `TASKS.md`, update derived planning views atomically, archive this prompt, and select exactly one next run.

# Next autonomous run

**R2 — SET-03: manage studio hours and rooms through Setup**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R2 from implementation HEAD `15f5c79` on branch `feat/pre-cami-hardening`. R0 reconciled `9de8d07^..7f5c128` and adopted the reworked plan; R1/POL-04 then added the V54 forward SQL safeguard and disposable no-write regression, and POL-02 is DONE. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [SET-03 prompt](prompts/SET-03.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-04 and SET-05 remain queued and must not be pulled into R2.

Complete only SET-03: expose operating days and per-day windows through typed Rulebook policy; manage room identity, capacity and features through PlanningDataset commands; expose room unavailable windows and feature requirements through supported typed policy; and register room restriction review slices. Preserve the 15-minute grid and currently supported days until GEN-03. Reuse existing setup/forms/components and canonical authorities. Authorize the exact tenant/current role at server and transaction boundaries, validate entity membership and expected versions, preserve drafts on failure, and reject stale, conflicting, unsupported or unauthorized writes without canonical/version/audit success writes.

Use manager-facing Setup language, actionable empty/loading/error states, retained typed entries after failure, keyboard support and a 390px tap layout. Keep hashes, IR, RPC and version identifiers under Advanced. Do not add a second setup/policy/schedule store, overnight or dated calendars, a recurrence engine, arbitrary time quantum, unrelated setup slices, deployment, production/private-data access, paid services, merge, push, external messages or destructive actions.

Add regressions for the demonstrated behavior, including closed-day/unavailable-period parity, unknown capacity blocking, explicit no-additional-restriction review, contradiction links, and failed-write/no-write behavior. Inspect effective callers and migrations before editing; add forward migrations only. Run focused checks before broad checks and preserve the first failed full-suite result. Continue only while dependencies, ownership and verification remain clear; stop on the mandatory conditions in [AUTONOMOUS_EXECUTION_RUNBOOK](plan-rework/AUTONOMOUS_EXECUTION_RUNBOOK.md).

Required verification from the repository root with explicit disposable configuration:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
npm run test:e2e
```

On acceptance, create one bounded SET-03 commit, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. Do not claim milestone A or external acceptance from this run alone.

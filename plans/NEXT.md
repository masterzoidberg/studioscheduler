# Next autonomous run

**R2 — SET-04: manage teacher availability and qualifications**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R2 from implementation HEAD `d46e68c43ae920e99be40c7bd61e8a7d6c563728` on branch `feat/pre-cami-hardening`. R0 reconciled `9de8d07^..7f5c128` and adopted the reworked plan; R1/POL-04 closed the demonstrated POL-02 SQL safeguard gap; SET-03 then completed the studio-hours, room-policy and room-restriction review slice. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [SET-04 prompt](prompts/SET-04.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-05 and POL-03 remain queued and must not be pulled into this run.

Complete only SET-04: provide teacher allowed windows, unavailable days, earliest/latest times and eligible class/subject domains through typed Rulebook policy; keep teacher identity as PlanningDataset data; distinguish explicitly reviewed unrestricted availability from unknown; and require explicit qualification domains without inferring from notes. Preserve the supported 15-minute grid and current days until GEN-03. Reuse existing setup/forms/components and canonical authorities. Authorize the exact tenant/current role at server and transaction boundaries, validate entity membership and expected versions, preserve drafts on failure, and reject stale, conflicting, unsupported or unauthorized writes without canonical/version/audit success writes.

Use manager-facing Setup language, actionable empty/loading/error states, retained typed entries after failure, keyboard support and a 390px tap layout. Keep hashes, IR, RPC and version identifiers under Advanced. Do not add a second setup/policy/schedule store, private-life narrative fields, overnight or dated calendars, a recurrence engine, arbitrary time quantum, unrelated setup slices, deployment, production/private-data access, paid services, merge, push, external messages or destructive actions.

Add regressions for availability-slice invalidation, room-edit stability, unqualified-teacher rejection across TypeScript/Python/server, exact contradiction links, stale-write/no-write behavior and persisted review state. Inspect effective callers and migrations before editing; add forward migrations only. Run focused checks before broad checks and preserve the first failed full-suite result. Continue only while dependencies, ownership and verification remain clear; stop on the mandatory conditions in [AUTONOMOUS_EXECUTION_RUNBOOK](plan-rework/AUTONOMOUS_EXECUTION_RUNBOOK.md).

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

On acceptance, create one bounded SET-04 commit, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. Do not claim milestone A or external acceptance from this run alone.

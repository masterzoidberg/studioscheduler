# Next autonomous run

**R2 — SET-05: complete class/session and roster setup**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Execute R2 from implementation HEAD `c165f4ac0f688ac5f104227052fea45ca09bb682` on branch `feat/pre-cami-hardening`. R0 reconciled `9de8d07^..7f5c128` and adopted the reworked plan; R1/POL-04 closed the demonstrated POL-02 SQL safeguard gap; SET-03 and SET-04 then completed the studio-hours, room-policy, room-restriction review, teacher-availability and qualification slices. PR #55 remains open; no merge, push or deployment is authorized.

Authority: read [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md), [TEST_STRATEGY](TEST_STRATEGY.md), and the bounded [SET-05 prompt](prompts/SET-05.md). `TASKS.md` owns status and dependencies; this file selects exactly one run. SET-04 is complete; SET-05 is the only selected task and POL-03 remains queued.

Complete only SET-05: absorb reviewed class structure and roster repairs into class details; expose frequency and ordinal-specific durations, roster bulk selection, required/preferred teacher and room, and explicit class scope. Derive eligibility from typed policy rather than a second writable eligibleTeacherIds authority. Preserve canonical version/context/tenant authority, authorize the exact tenant/current role at server and transaction boundaries, validate entity membership and expected versions, preserve drafts on failure, and reject stale, conflicting, unsupported or unauthorized writes without canonical/version/audit success writes.

Use manager-facing Setup language, actionable empty/loading/error states, retained typed entries after failure, keyboard support and a 390px tap layout. Keep hashes, IR, RPC and version identifiers under Advanced. Do not add a second setup/policy/schedule store, private-life narrative fields, overnight or dated calendars, a recurrence engine, arbitrary time quantum, unrelated setup slices, deployment, production/private-data access, paid services, merge, push, external messages or destructive actions.

Add regressions for class-structure invalidation, roster-review stability, explicit-scope/empty-roster behavior, stale-write/no-write behavior and persisted review state. Inspect effective callers and migrations before editing; add forward migrations only. Run focused checks before broad checks and preserve the first failed full-suite result. Continue only while dependencies, ownership and verification remain clear; stop on the mandatory conditions in [AUTONOMOUS_EXECUTION_RUNBOOK](plan-rework/AUTONOMOUS_EXECUTION_RUNBOOK.md).

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

On acceptance, create one bounded SET-05 commit, record exact criteria/evidence/commands/exit codes/artifacts/limitations and start/final heads in `TASKS.md`, update derived planning views atomically, and select exactly one next run. Do not claim milestone A or external acceptance from this run alone.

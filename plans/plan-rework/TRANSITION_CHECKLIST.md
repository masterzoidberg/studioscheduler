# Transition checklist — R0 COMPLETE

R0 adoption completed on 2026-09-09. The audited implementation base was `7f5c1287ec838cb6e8cc2e9efc395b13c6e426da`; the planning-only adoption commit is recorded in the canonical ledger. POL-02 remains pending/BLOCKED and POL-04 is the only selected corrective run.

## 1. Reconcile repository and active work

- [x] Fetch/inspect origin and record branch, local HEAD, upstream HEAD, ahead/behind, all worktrees, and `git status`.
- [x] Confirm starting reconciliation head is `7f5c1287ec838cb6e8cc2e9efc395b13c6e426da`; no later implementation commit was present.
- [x] Inspect Codex/CI/PR activity and every worktree for an active run. No other active Studio Scheduler implementation run was found; PR #55 remains open with no merge/push/deployment.
- [x] Preserve unrelated tracked/untracked work. No reset, clean, auto-stash, history rewrite or destructive action was used.

## 2. Reconcile POL-02 without assumptions

- [x] Map inclusive commits `9de8d07^..7f5c128` to every POL-02 acceptance criterion and non-goal.
- [x] Record exact focused TypeScript tests, typed runtime parity, pinned Python tests, DB requirements, lint/typecheck/build, and CI results in `plans/TASKS.md`.
- [x] Verify no required migration/SQL safeguard criterion was silently omitted; the range contains no POL-02 forward migration and the effective SQL validator omits typed kinds.
- [x] Preserve the first failed full run and diagnose focused failures before retry.
- [x] Leave POL-02 pending/BLOCKED and create only bounded corrective task POL-04; no second POL-02 implementation run was created.

## 3. Adopt one authority atomically

- [x] User authorized and accepted execution of this rework checkpoint.
- [x] Keep `plans/TASKS.md` as the sole canonical status/dependency ledger.
- [x] Update `MASTER_PLAN.md` to outcome releases and classifications; update `README.md` as entry point.
- [x] Replace task-level NEXT with exactly one selected autonomous run in `NEXT.md`.
- [x] Update prompt index and generate only the selected R1/POL-04 run prompt.
- [x] Keep this directory as rationale/runbook, not a second status mirror; add adopted date/head banners.
- [x] Preserve all completed records, IDs, archives, `_OLD` evidence, failed runs, migrations, production ledgers, and ZIP bytes.

## 4. Validate graph, ownership, and links

- [x] Confirm the adopted dependency graph is acyclic.
- [x] Confirm every CORE/ASSISTED implementation capability has exactly one task owner and bounded acceptance/verification.
- [x] Confirm EXTERNAL_GATE, OPTIONAL, HISTORICAL/SUPERSEDED work is excluded from engineering-completion counts.
- [x] Confirm every parallel lane has disjoint file ownership and one integration owner for central files/migrations/ledger.
- [x] Confirm security-sensitive migrations/protocols remain sequential.
- [x] Resolve all internal Markdown links.
- [x] Run `python plans/check_integrity.py` and the additional R0 graph/link/diff-scope checks.
- [x] Run formatting/diff checks and verify only authorized planning files changed.

## 5. Select exactly one run

- [x] Select R1 after bounded corrective work was selected for the demonstrated POL-02 gap.
- [x] Record run ID, exact base implementation HEAD, contained task ID, lane ownership, synchronization points, verification level, and stop conditions in NEXT.
- [x] Ensure no task prompt, README, archive, or plan-rework document presents another READY/NEXT authority.
- [x] Commit the adoption atomically; deployment, merge, push, and external actions remain separately authorized.

# Next implementation session

**SAFE-01 — Reject missing or revoked membership at commit**  
**Execution class: STANDARD IMPLEMENTATION**  
**Milestone: A — DWDE Operational**  
**Status: READY for implementation; local database validation prerequisite unavailable during audit.**

Work on `feat/pre-cami-hardening`. Latest accepted implementation baseline is `91204390d8c025789e6af871a5939eb22decd517` (T13 handoff); audit fetched origin at the same SHA. Planning rebuild is uncommitted. Inspect status/HEAD/fetched remote again before editing; preserve untracked Python caches and other user work.

Read [SAFE-01 implementation prompt](prompts/SAFE-01.md). This is the only selected next task. Dependencies: none beyond existing T13 foundation. No manager data is needed.

Why first: in V49 adoption, SELECT of a missing studio membership leaves a NULL role; `IF role NOT IN (...)` does not reject it. Earlier route authorization cannot prove membership still exists at commit. Implement an additive, null-safe, transactionally serialized membership check and missing-member regression before expanding product behavior.

Inspect:
- `supabase/migrations/20260907190000_close_legacy_write_bypasses_v49.sql` (read-only historical definition);
- `app/api/solver/adopt/route.ts`;
- effective V44/V33 successor definitions;
- `scripts/test-db.mjs` T13 role tests and `tests/legacy-write-bypass-closure.test.ts`.

Required commands from root:
```powershell
git status --short
git branch --show-current
git fetch --prune origin
git rev-list --left-right --count HEAD...origin/feat/pre-cami-hardening
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

The audit's DB command failed because Docker Desktop's Linux daemon was unavailable. Bring up the existing disposable local Docker environment when safe and authorized; never fall back to any external database. If unavailable, implement and run independent checks, record verification BLOCKED, and do not mark SAFE-01 DONE. No test:parity/test:e2e script exists yet; SAFE-01 does not require the future interfaces.

Non-goals: no new setup features, tenant provisioning, solver rewrite, policy genericization, deployment or live data changes. Preserve historical SQL bytes, service-only grants, deterministic validation, snapshot/version checks, exact tenant authorization and unrelated working-tree changes. Escalate only if the current function chain differs materially or the fix would require widening authority. Follow the prompt for concurrency ordering and no-write evidence.

After accepted completion, update [TASKS](TASKS.md), archive the completed prompt, and derive the next task (normally SAFE-02). BLK-DWDE affects later ACC-01, not this task.


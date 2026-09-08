# Next implementation session

**SAFE-02 — Make local configuration and verification safe**  
**Execution class: STANDARD IMPLEMENTATION**  
**Milestone: A — DWDE Operational**  
**Status: READY for implementation.**

Work on `feat/pre-cami-hardening`. Latest accepted implementation baseline is `51fd92e35eaa3129f237f91c196e4ad603d58547` (SAFE-01). PR #55 CI run 324 and Solver CI run 43 passed at that SHA, including the disposable PostgreSQL authorization/revocation race regression. Inspect status/HEAD/fetched remote again before editing and preserve unrelated work.

Read [SAFE-02 implementation prompt](prompts/SAFE-02.md). This is the only selected next task. Dependency SAFE-01 is accepted. No manager data is needed.

Why next: `lib/supabase.ts` still has an implicit fallback to the real production Supabase project when configuration is absent. Local/dev verification must fail closed into a useful configuration-required state instead of silently making external requests. The same task also closes a solver-CI path gap for shared TypeScript IR/compiler/gateway/fixture changes and documents the disposable authenticated test setup.

Inspect:
- `lib/supabase.ts` and all callers that assume a client always exists;
- `.env.example` and build/runtime configuration handling;
- `.github/workflows/ci.yml` and `.github/workflows/solver-ci.yml` path triggers;
- `scripts/test-db.mjs` plus current configuration-related tests;
- AI/scenario normal-navigation exposure called out in the SAFE-02 containment section.

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
```

Acceptance must prove unset and partial configuration produce zero external requests, explicit loopback configuration still works, and a build without secrets succeeds with an actionable configuration state. A shared fixture-only PR must trigger the solver checks. Do not change package versions. No production fallback may be used for verification.

Non-goals: no deployment/configuration mutation in live environments, tenant provisioning, setup feature expansion, solver rewrite, policy genericization, or full AI reconstruction. SAFE-02 may hide legacy enforcement-based AI/scenario affordances from normal manager navigation, but canonical AI redesign remains later work. Preserve the four versioned authorities and deterministic legality path.

After accepted completion, update [TASKS](TASKS.md), archive the completed prompt, derive README/NEXT, and select the next dependency-satisfied task according to the ledger. BLK-DWDE affects later ACC-01, not this task.

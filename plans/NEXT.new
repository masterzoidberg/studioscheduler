# Next implementation session

**VERIFY-01 — Create shared parity and authenticated workflow harnesses**  
**Execution class: STANDARD IMPLEMENTATION**  
**Milestone: A — DWDE Operational**  
**Status: READY for implementation.**

Work on `feat/pre-cami-hardening`. Latest accepted implementation baseline is `7c2078f85c64ab0bf7b645a18662c7d145cee14f` (SAFE-02 implementation/correction). PR #55 CI run 327 and Solver CI run 46 passed at that SHA. Ubuntu passed lint, typecheck, unit tests, no-secrets build, disposable DB integration and route smoke tests; Windows passed lint, typecheck, unit tests and build.

Read [VERIFY-01 implementation prompt](prompts/VERIFY-01.md). This is the only selected next task. Dependency SAFE-02 is accepted. No private DWDE manager dataset is required.

Why next: TS and Python legality suites are still separate, and there is no reproducible authenticated browser workflow harness. VERIFY-01 creates a shared serialized parity contract plus a loopback-only authenticated e2e path before SET-01 and later manager-facing work rely on them.

Inspect:
- `scripts/test-db.mjs` and the SAFE-01 disposable extensions;
- `tests/golden-schedule-fixtures.test.ts` and `tests/fixtures/session-lock-semantics.json`;
- `solver/tests/test_session_locks.py` and current solver fixture contracts;
- `.github/workflows/ci.yml`, `.github/workflows/solver-ci.yml`, and `package.json`;
- existing auth/client boundaries before adding any browser-test dependency.

Required commands from root:
```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
npm run test:e2e
```

This task introduces the final two commands. Acceptance must detect deliberate legality mismatch, qualification default-deny, duration mismatch and stale candidate. The browser harness must use isolated loopback/disposable credentials and prove manager login/role fixture, an inventory write, and an authoritative rejected schedule edit with no persisted data change. Never use production or private DWDE data as test fixtures.

Non-goals: no real DWDE certification, setup feature expansion, solver replacement, deployment, paid services or live customer-data mutation. Prefer the smallest reproducible harness that exercises the existing authority boundaries.

After accepted completion, update [TASKS](TASKS.md), archive the completed prompt, derive README/NEXT, and select the next dependency-satisfied task according to ledger order. SET-01 depends on VERIFY-01 and SAFE-02.

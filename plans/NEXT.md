# Next implementation session

**SET-02 — Create one Studio Setup entry and dashboard**  
**Execution class: STANDARD IMPLEMENTATION**  
**Milestone: A — DWDE Operational**  
**Status: READY for implementation.**

Work on `feat/pre-cami-hardening`. Latest accepted implementation baseline is `7b43a00cdcbf6980e34bb52f79215d66b4e07a08` (POL-01 accepted implementation head before planning closeout). PR #55 CI run **428** and Solver CI run **147** passed at that SHA. Ubuntu passed planning integrity, lint, typecheck, 380 unit tests, build, the expanded disposable DB chain and route smoke tests after one unchanged retry of a Docker/PostgreSQL startup-socket flake; Windows passed lint, typecheck, unit tests and build; authenticated-e2e passed; Solver CI passed CP-SAT/service pytest, the production solver container build and TypeScript/Python runtime parity.

Read [SET-02 implementation prompt](prompts/SET-02.md). This is the only selected next task. Dependency SET-01 is accepted. POL-02 is also dependency-ready now that POL-01 is accepted, but remains unselected because ledger order selects SET-02 first. No private DWDE manager dataset is required.

Why next: the product now has targeted setup review evidence and its first stable-ID typed policy slice, but the manager setup job is still split across People, Classes, Planning Repairs, Readiness and Rulebook. SET-02 creates one manager-facing Setup entry/dashboard without changing legality or introducing a second setup-data store.

Implement the smallest manager-facing navigation slice:
- add one Setup entry/dashboard with sections Studio, Teachers, Classes, Students, Requirements, Preferences and Review;
- reuse existing inventory, review and repair components/commands rather than duplicating canonical data;
- retain old setup-related routes as redirects or deep-link compatibility where appropriate;
- give a first-time/empty workspace one clear setup action;
- let returning managers resume at a meaningful outstanding section without persisting duplicate setup state;
- when a later section is unavailable, say exactly what is missing rather than implying readiness;
- move raw Rulebook/readiness/version diagnostics to Settings → Advanced while keeping them accessible;
- preserve keyboard navigation and a usable 390px tap layout;
- do not change scheduling legality, typed-policy semantics or Supabase authority.

Inspect first:
- `components/app-shell.tsx`;
- `components/dashboard.tsx`;
- `components/planning-repairs-view.tsx`;
- `components/required-class-intake.tsx`;
- `app/planning-repairs/page.tsx`;
- existing home/navigation, People, Classes, Readiness, Rulebook and Settings/Advanced entry points before moving or redirecting anything.

Required verification from repository root:
```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

SET-02 is user-facing, so authenticated browser acceptance must cover both the first-time path and a returning manager path, including deep links, keyboard focus and narrow-screen behavior. Existing authoritative state must remain unchanged merely by navigating Setup.

Non-goals: no new setup-data store, no new policy schema, no changed legality, no full teacher/class/student editing expansion beyond the existing reusable workflows, no optimization, no deployment, no customer-data mutation and no external-service write.

After accepted completion, update [TASKS](TASKS.md), archive the completed prompt, derive README/NEXT, and select the next dependency-satisfied task according to ledger order.

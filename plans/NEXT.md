# Next implementation session

**POL-02 — Extend typed policy to studio and qualification families**  
**Execution class: STANDARD IMPLEMENTATION**  
**Milestone: A — DWDE Operational**  
**Status: READY for implementation.**

Work on `feat/pre-cami-hardening`. Latest accepted implementation baseline is `86a4e8d719b62c9aeab3a11b1b604f628ffe0d24` (SET-02 accepted implementation head before planning closeout). PR #55 CI run **432** and Solver CI run **151** passed at that SHA. Ubuntu passed planning integrity, lint, typecheck, unit tests, build, the full disposable DB chain and route smoke tests; Windows passed lint, typecheck, unit tests and build; authenticated-e2e passed the preserved VERIFY-01 and SET-01 journeys plus the new SET-02 empty/returning-manager workflow; Solver CI passed CP-SAT/service pytest, the production solver container build and TypeScript/Python runtime parity. The disposable DB runner now retries only the recognized missing-Postgres-socket startup signature with fresh containers and still fails SQL/assertion errors immediately.

Read [POL-02 implementation prompt](prompts/POL-02.md). This is the only selected next task. Dependency POL-01 is accepted. SET-02 is now accepted and archived. No private DWDE manager dataset is required.

Why next: POL-01 proved the bounded stable-ID typed-policy transition for one teacher-day-window family. POL-02 extends that same tested authority model to the remaining studio/resource/qualification families needed before Setup can manage operating hours, rooms and teacher qualifications without falling back to name-bound or static DWDE semantics.

Implement the bounded policy-family expansion:
- operating-day windows;
- capacity enforcement and required-feature policy consuming PlanningDataset room capacity/features;
- room unavailable windows;
- explicit class-teacher qualification domains;
- required teacher and required room policy;
- basic preference records;
- preserve existing family semantics unless an explicitly reviewed typed replacement consumes them;
- keep stable IDs, dependency-closed replacement accounting and fail-closed unsupported HARD behavior;
- do not add an arbitrary rules DSL, relationship families, or a second policy store.

Fixed semantics from the accepted prompt:
- room capacities/features remain PlanningDataset facts; policy only governs enforcement/required feature sets and closures;
- intervals are half-open `[start,end)`; zero/negative/overnight windows reject;
- multiple windows inside one allowed-window rule are a union; separate HARD allowed-window rules intersect;
- required feature sets use set inclusion;
- empty explicit qualification domain permits no classes; unresolved qualification is unreviewed;
- a required teacher must also qualify;
- missing required capacity cannot be waived as unrestricted;
- canonical sorting/deduplication preserves stable IDs.

Inspect first:
- `lib/constraint-ir.ts`;
- `lib/constraint-compiler-v3.ts`;
- `lib/constraint-data-binding.ts`;
- `lib/constraint-engine.ts`;
- `solver/dwde_solver/feasibility.py`;
- `lib/schedule-readiness.ts`;
- successor migrations, policy publication callers and existing POL-01 regression surfaces before editing.

Required verification from repository root with explicit disposable configuration:
```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
```

Because POL-02 changes solver/IR semantics, also run the pinned Python solver/service pytest path. Add positive, negative and boundary fixtures for each new family, including rename, missing IDs, duplicate references, closed day and interval endpoint behavior. Compiler accounting and SQL safeguard coverage must agree. Rejection/no-write behavior remains mandatory.

Non-goals: no relationship families, no full DWDE baseline conversion, no optimization, no deployment, no customer-data mutation and no external-service write.

After accepted completion, update [TASKS](TASKS.md), archive the completed prompt, derive README/NEXT, and select the next dependency-satisfied task according to ledger order.

# Next implementation session

**SET-01 — Add targeted setup review with room-capacity vertical slice**  
**Execution class: STANDARD IMPLEMENTATION**  
**Milestone: A — DWDE Operational**  
**Status: READY for implementation.**

Work on `feat/pre-cami-hardening`. Latest accepted implementation baseline is `04727b89c6e053c167af7f9dded51917ccd9489a` (VERIFY-01 accepted implementation head). PR #55 CI run **371** and Solver CI run **90** passed at that SHA. Ubuntu passed lint, typecheck, unit tests, build, disposable DB integration and route smoke tests; Windows passed lint, typecheck, unit tests and build; authenticated-e2e passed; Solver CI passed CP-SAT/service pytest, production solver container build and TypeScript/Python runtime parity.

Read [SET-01 implementation prompt](prompts/SET-01.md). This is the only selected next task. Dependencies SAFE-02 and VERIFY-01 are accepted. No private DWDE manager dataset is required.

Why next: the product has versioned planning facts and a reproducible authenticated verification harness, but manager review is still whole-dataset rather than targeted. SET-01 introduces the bounded DEC-103 review-attestation foundation using **room capacity** as the first complete UI/server/DB vertical slice.

Implement the smallest safe slice:
- add review attestations without duplicating canonical planning facts;
- add a deterministic slice fingerprint for room-capacity review;
- show **reviewed**, **missing**, and **changed** states in manager-facing UI;
- do not allow missing required capacity to be attested as “no restriction”;
- invalidate the affected room-capacity review when its authoritative capacity changes, while unrelated teacher notes do not invalidate it;
- reject stale fingerprints, archived/new-entity misuse and cross-tenant writes with no review success write;
- keep historical review readable;
- do **not** replace the overall scheduling/readiness gate yet.

Inspect:
- `lib/domain.ts`;
- `lib/planning-dataset.ts`;
- `components/people-view.tsx`;
- `components/planning-dataset-confirmation-card.tsx`;
- `lib/planning-confirmation-readiness.ts`;
- `scripts/test-db.mjs`;
- existing review/version/audit patterns before adding schema or commands.

Required commands from root:
```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:e2e
```

Run `npm run test:parity` as well if SET-01 touches shared solver/Constraint IR semantics or parity fixtures. Browser assertions must observe both the manager UI and authoritative persisted review state. Database acceptance requires executed transaction/RLS evidence, not SQL-text inspection.

Non-goals: no availability schema, policy compiler rewrite, global certification switch, real DWDE certification, deployment, paid services or live customer-data mutation.

After accepted completion, update [TASKS](TASKS.md), archive the completed prompt, derive README/NEXT, and select the next dependency-satisfied task according to ledger order. POL-01 and SET-02 both depend on SET-01; ledger order selects POL-01 unless evidence changes the dependency graph.

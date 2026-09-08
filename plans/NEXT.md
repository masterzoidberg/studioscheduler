# Next implementation session

**POL-01 — Introduce bounded typed policy authoring authority**  
**Execution class: HIGH-REASONING IMPLEMENTATION**  
**Milestone: A — DWDE Operational**  
**Status: READY for implementation.**

Work on `feat/pre-cami-hardening`. Latest accepted implementation baseline is `2403f6f21e029e43a438eaef731b73967e5d6fc2` (SET-01 accepted implementation head before planning closeout). PR #55 CI run **395** and Solver CI run **114** passed at that SHA. Ubuntu passed planning integrity, lint, typecheck, 358 unit tests, build, the expanded disposable DB chain and route smoke tests; Windows passed lint, typecheck, unit tests and build; authenticated-e2e passed both the preserved VERIFY-01 journey and the SET-01 room-capacity review journey; Solver CI passed CP-SAT/service pytest, production solver container build and TypeScript/Python runtime parity.

Read [POL-01 implementation prompt](prompts/POL-01.md). This is the only selected next task. Dependencies SET-01 and VERIFY-01 are accepted. SET-02 is also dependency-ready but remains unselected because ledger order selects POL-01 first. No private DWDE manager dataset is required.

Why next: the product now has a targeted review-attestation foundation for planning facts, but policy execution remains partly name-bound and guarded around a fixed reviewed DWDE baseline. POL-01 introduces the first bounded typed policy-authoring path without creating a second policy store or arbitrary DSL.

Implement the smallest dependency-closed policy slice:
- add schema-versioned typed policy envelopes inside versioned Rulebook snapshots;
- use stable teacher IDs rather than teacher names as execution targets;
- implement teacher availability/day-window parameters first;
- preserve immutable reviewed DWDE history and pin the verified residual baseline;
- replace one dependency-closed availability bundle so exactly one semantic source executes across compiler, readiness, runtime, solver and SQL safeguards;
- make teacher rename behavior invariant;
- reject invalid teacher references, changed residual HARD policy and unknown/unsupported HARD policy fail-closed;
- keep the active Rulebook honestly versioned rather than silently reinterpreting prose;
- update deterministic model/accounting through forward-only migration where required;
- do not add arbitrary DSL, AI policy parsing, full DWDE conversion, preference optimization or a second canonical policy table.

Inspect first:
- `lib/domain.ts`;
- `lib/constraint-ir.ts`;
- `lib/constraint-compiler.ts`;
- `lib/constraint-compiler-v3.ts`;
- `lib/reviewed-rulebook.ts`;
- `lib/constraint-data-binding.ts`;
- `lib/constraint-engine.ts`;
- `solver/dwde_solver/feasibility.py`;
- current Rulebook publication/governance migrations and execution-registry/accounting tests;
- parity fixtures before changing shared semantics.

Required verification from repository root:
```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
npm run test:e2e
```

Because POL-01 changes shared solver/Constraint IR semantics, also run the pinned Python solver pytest path defined in [TEST_STRATEGY](TEST_STRATEGY.md). Acceptance requires typed teacher-window roundtrip, rename invariance, unsupported-HARD rejection, invalid-reference default-deny, untouched baseline parity, exactly-one semantic source for the replaced bundle, and agreement among TypeScript, Python and database publication safeguards.

Non-goals: no full manager Setup screen for availability yet, no full DWDE policy conversion, no optimization, no deployment, no customer-data mutation and no external-service write.

After accepted completion, update [TASKS](TASKS.md), archive the completed prompt, derive README/NEXT, and select the next dependency-satisfied task according to ledger order.

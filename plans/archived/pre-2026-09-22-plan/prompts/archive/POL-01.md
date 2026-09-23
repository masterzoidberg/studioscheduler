# POL-01 — Introduce bounded typed policy authoring authority

Execution class: **HIGH-REASONING IMPLEMENTATION**. Milestone: **A**. Dependencies: **SET-01, VERIFY-01**.
Status is owned by [TASKS](../../TASKS.md); this prompt is archived historical instruction after accepted completion.

## Outcome and current state

Implement DEC-104 typed policy envelopes inside versioned Rulebook snapshots, stable teacher IDs and teacher availability/day-window parameters first. Pin verified immutable DWDE baseline; replace dependency-closed policy bundles across compiler, readiness, runtime, solver and SQL safeguards. Reject changed residual or unknown HARD policy. Update model accounting with a forward migration; active Rulebook remains honestly versioned.

Current evidence at audit HEAD `9120439`: StudioRule parameters exist but current execution is name-bound, guarded against exact reviewed DWDE content. Editing prose cannot implement a new restriction. For later tasks, predecessor behavior above is an expected contract, not a claim that it exists in this baseline.

## Architectural decisions already made

Read [DECISIONS](../../DECISIONS.md) and [execution rules](../../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts. Reuse existing commands/components; a planned route/schema is new work, not an existing path claim.

## Scope and required behavior

Implement DEC-104 typed policy envelopes inside versioned Rulebook snapshots, stable teacher IDs and teacher availability/day-window parameters first. Pin verified immutable DWDE baseline; replace dependency-closed policy bundles across compiler, readiness, runtime, solver and SQL safeguards. Reject changed residual or unknown HARD policy. Update model accounting with a forward migration; active Rulebook remains honestly versioned.

## Expected inspection points

- [lib/domain.ts](../../../lib/domain.ts)
- [lib/constraint-ir.ts](../../../lib/constraint-ir.ts)
- [lib/constraint-compiler.ts](../../../lib/constraint-compiler.ts)
- [lib/constraint-compiler-v3.ts](../../../lib/constraint-compiler-v3.ts)
- [lib/reviewed-rulebook.ts](../../../lib/reviewed-rulebook.ts)
- [lib/constraint-data-binding.ts](../../../lib/constraint-data-binding.ts)
- [lib/constraint-engine.ts](../../../lib/constraint-engine.ts)
- [solver/dwde_solver/feasibility.py](../../../solver/dwde_solver/feasibility.py)

Inspect successor migrations/callers and relevant assertions before editing. Add forward migrations only; historical paths above are evidence, not edit targets. Implement this coherent slice; if more than one independent migration/semantic family is needed, execute and verify each sequentially under this task with criterion-level evidence.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Check expected versions/fingerprints atomically. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write; preserve form draft for correction. Never replace stale candidate tokens with freshly fetched tokens. Validate incoming schemas and entity membership. A disabled AI service must not affect this flow.

## UX behavior

Expose structured actionable error codes/messages to the caller, keeping stack traces, SQL and hashes out of normal UI; technical diagnostic context must be redacted.

## Non-goals

No arbitrary DSL, AI parsing, full DWDE conversion, preference optimizer or new canonical policy table.

## Tests and acceptance criteria

- Typed teacher-window roundtrip and rename invariance; unsupported HARD blocks; invalid teacher references default-deny
- Untouched DWDE baseline parity passes; replacing one availability bundle executes exactly one semantic source across all consumers
- TS/Python and DB publication agree.

Add regressions that fail for the identified missing behavior, including rejection/no-write cases. Existing green tests are necessary but insufficient. DB tasks require executed transaction/RLS tests, not SQL substring checks. Browser workflow assertions must observe both UI and authoritative persisted state.

## Verification commands

Run from repository root with explicit disposable configuration; see [TEST_STRATEGY](../../TEST_STRATEGY.md) for Python and authenticated environment setup.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
```

VERIFY-01 introduces test:parity and test:e2e. Do not run or claim them before that dependency exists; after it is DONE, user-facing tasks additionally run npm run test:e2e for the changed journey. For solver/IR changes run pinned Python pytest as well. Missing Docker/credentials is a verification blocker, never a pass. No production fallback.

## Completion evidence

Record changed files, new test names, commands and exit codes, demonstrated behavior/artifact, remaining limitations, starting HEAD and final commit/reference (or uncommitted). Update TASKS and derived README/NEXT; archive prompt only after every criterion passes. External acceptance tasks require actual owner/manager evidence and private references rather than identifiable public fixtures.

## Escalation conditions

Escalate with a concrete reproducer if schema cannot preserve authority without duplicate truth; a required HARD semantic is unsupported; dependency-closed policy replacement cannot be proven; current code conflicts with accepted decisions; historical migrations would need rewriting; or this bounded scope expands materially. Resolve routine file/API uncertainty by inspection. Complete independent authorized work before asking for an external decision. No task prompt authorizes deployment, paid services, messages to others, or destructive customer-data operations.

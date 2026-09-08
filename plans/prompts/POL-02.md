# POL-02 — Extend typed policy to studio and qualification families

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **A**. Dependencies: **POL-01**.
Status is owned by [TASKS](../TASKS.md); do not infer readiness from this prompt existing.

## Outcome and current state

Apply the same tested bundle protocol to operating-day windows, capacity enforcement/required-feature policy consuming PlanningDataset capacity/features, room unavailable windows, explicit class-teacher qualification domains, required teacher/room and basic preference records. Define required feature semantics as set inclusion; unavailable windows cannot overlap occupied interval; qualification domain explicitly lists eligible class IDs. Preserve existing family semantics unless explicitly reviewed replacement.

Current evidence at audit HEAD `9120439`: POL-01 establishes versioned typed policy and safe residual adapter for teacher windows only. For later tasks, predecessor behavior above is an expected contract, not a claim that it exists in this baseline.

## Architectural decisions already made

Read [DECISIONS](../DECISIONS.md) and [execution rules](../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts. Reuse existing commands/components; a planned route/schema is new work, not an existing path claim.

## Scope and required behavior

Apply the same tested bundle protocol to operating-day windows, capacity enforcement/required-feature policy consuming PlanningDataset capacity/features, room unavailable windows, explicit class-teacher qualification domains, required teacher/room and basic preference records. Define required feature semantics as set inclusion; unavailable windows cannot overlap occupied interval; qualification domain explicitly lists eligible class IDs. Preserve existing family semantics unless explicitly reviewed replacement.

## Expected inspection points

- [lib/constraint-ir.ts](../../lib/constraint-ir.ts)
- [lib/constraint-compiler-v3.ts](../../lib/constraint-compiler-v3.ts)
- [lib/constraint-data-binding.ts](../../lib/constraint-data-binding.ts)
- [lib/constraint-engine.ts](../../lib/constraint-engine.ts)
- [solver/dwde_solver/feasibility.py](../../solver/dwde_solver/feasibility.py)
- [lib/schedule-readiness.ts](../../lib/schedule-readiness.ts)

Inspect successor migrations/callers and relevant assertions before editing. Add forward migrations only; historical paths above are evidence, not edit targets. Implement this coherent slice; if more than one independent migration/semantic family is needed, execute and verify each sequentially under this task with criterion-level evidence.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Check expected versions/fingerprints atomically. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write; preserve form draft for correction. Never replace stale candidate tokens with freshly fetched tokens. Validate incoming schemas and entity membership. A disabled AI service must not affect this flow.

## UX behavior

Expose structured actionable error codes/messages to the caller, keeping stack traces, SQL and hashes out of normal UI; technical diagnostic context must be redacted.

## Non-goals

No relationship families or full baseline conversion.

## Tests and acceptance criteria

- Each family has shared positive/negative/boundary fixture including rename, missing IDs, duplicate reference, closed day and interval endpoint
- No unsupported family falls through; compiler accounting and SQL safeguard coverage agree.

Add regressions that fail for the identified missing behavior, including rejection/no-write cases. Existing green tests are necessary but insufficient. DB tasks require executed transaction/RLS tests, not SQL substring checks. Browser workflow assertions must observe both UI and authoritative persisted state.

## Verification commands

Run from repository root with explicit disposable configuration; see [TEST_STRATEGY](../TEST_STRATEGY.md) for Python and authenticated environment setup.

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


## Fixed semantic contract

Room capacities/features remain PlanningDataset facts; Rulebook holds capacity enforcement, required feature sets and closure policies only. Intervals are half-open [start,end); zero/negative/overnight windows reject. Multiple windows inside one allowed-window rule are union; separate HARD allowed-window rules intersect. Required feature set must be a subset of room features. Empty explicit qualification domain permits no classes; unresolved qualification is unreviewed. A required teacher must also qualify. Missing required capacity cannot be waived as unrestricted. Canonical sorting/deduplication preserves stable IDs.

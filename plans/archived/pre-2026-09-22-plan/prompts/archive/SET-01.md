# SET-01 — Add targeted setup review with room-capacity vertical slice

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **A**. Dependencies: **SAFE-02, VERIFY-01**.
Status is owned by [TASKS](../../TASKS.md); this prompt is archived historical instruction after accepted completion.

## Outcome and current state

Implement DEC-103 review attestations and deterministic slice fingerprint helper; room capacity review is the first end-to-end UI/server/DB consumer. Missing required capacity cannot be marked no restriction. Show reviewed, missing and changed states. Do not yet replace overall scheduling gate.

Current evidence at audit HEAD `9120439`: Only whole-dataset confirmation exists. Capacity is already canonical planning data, making it a bounded first review slice. For later tasks, predecessor behavior above is an expected contract, not a claim that it exists in this baseline.

## Architectural decisions already made

Read [DECISIONS](../../DECISIONS.md) and [execution rules](../../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts. Reuse existing commands/components; a planned route/schema is new work, not an existing path claim.

## Scope and required behavior

Implement DEC-103 review attestations and deterministic slice fingerprint helper; room capacity review is the first end-to-end UI/server/DB consumer. Missing required capacity cannot be marked no restriction. Show reviewed, missing and changed states. Do not yet replace overall scheduling gate.

## Expected inspection points

- [lib/domain.ts](../../../lib/domain.ts)
- [lib/planning-dataset.ts](../../../lib/planning-dataset.ts)
- [components/people-view.tsx](../../../components/people-view.tsx)
- [components/planning-dataset-confirmation-card.tsx](../../../components/planning-dataset-confirmation-card.tsx)
- [lib/planning-confirmation-readiness.ts](../../../lib/planning-confirmation-readiness.ts)
- [scripts/test-db.mjs](../../../scripts/test-db.mjs)

Inspect successor migrations/callers and relevant assertions before editing. Add forward migrations only; historical paths above are evidence, not edit targets. Implement this coherent slice; if more than one independent migration/semantic family is needed, execute and verify each sequentially under this task with criterion-level evidence.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Check expected versions/fingerprints atomically. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write; preserve form draft for correction. Never replace stale candidate tokens with freshly fetched tokens. Validate incoming schemas and entity membership. A disabled AI service must not affect this flow.

## UX behavior

Use manager words: Setup, Must happen, Prefer, Build schedule, Review changes. Show helpful empty state, loading state without duplicate submission, inline actionable errors and retained input on failure. Support keyboard and 390px tap layout; put hashes/IR/RPC/version identifiers in Advanced.

## Non-goals

No availability schema, policy compiler rewrite or global certification switch.

## Tests and acceptance criteria

- Capacity change invalidates only that room capacity review; unrelated teacher notes do not; new/archived entity and cross-tenant review writes reject correctly
- Stale submitted fingerprint has no write
- Historical review remains readable.

Add regressions that fail for the identified missing behavior, including rejection/no-write cases. Existing green tests are necessary but insufficient. DB tasks require executed transaction/RLS tests, not SQL substring checks. Browser workflow assertions must observe both UI and authoritative persisted state.

## Verification commands

Run from repository root with explicit disposable configuration; see [TEST_STRATEGY](../../TEST_STRATEGY.md) for Python and authenticated environment setup.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

VERIFY-01 introduces test:parity and test:e2e. Do not run or claim them before that dependency exists; after it is DONE, user-facing tasks additionally run npm run test:e2e for the changed journey. For solver/IR changes run pinned Python pytest as well. Missing Docker/credentials is a verification blocker, never a pass. No production fallback.

## Completion evidence

Accepted completion evidence is recorded in [TASKS](../../TASKS.md). Final accepted implementation head before planning closeout: `2403f6f21e029e43a438eaef731b73967e5d6fc2`; PR #55 CI run 395 and Solver CI run 114 passed.

## Escalation conditions

Escalate with a concrete reproducer if schema cannot preserve authority without duplicate truth; a required HARD semantic is unsupported; dependency-closed policy replacement cannot be proven; current code conflicts with accepted decisions; historical migrations would need rewriting; or this bounded scope expands materially. Resolve routine file/API uncertainty by inspection. Complete independent authorized work before asking for an external decision. No task prompt authorizes deployment, paid services, messages to others, or destructive customer-data operations.

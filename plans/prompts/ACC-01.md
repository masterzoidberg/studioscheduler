# ACC-01 — Prove DWDE operational with manager data

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **A**. Dependencies: **UX-03, OPS-01**.
Status is owned by [TASKS](../TASKS.md); do not infer readiness from this prompt existing.

## Outcome and current state

Run private acceptance from in-app intake through confirmation, representative whole-week solve, manual edits, locks/regenerate, recovery and reconciled print/export. Manager performs routine workflow without developer data conversion. Record assistance/time, omissions, all pinned contexts, timings and pass/fail evidence.

Current evidence at audit HEAD `9120439`: BLK-DWDE: complete manager-reviewed private data and independent use are not established by this repository. For later tasks, predecessor behavior above is an expected contract, not a claim that it exists in this baseline.

## Architectural decisions already made

Read [DECISIONS](../DECISIONS.md) and [execution rules](../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts. Reuse existing commands/components; a planned route/schema is new work, not an existing path claim.

## Scope and required behavior

Run private acceptance from in-app intake through confirmation, representative whole-week solve, manual edits, locks/regenerate, recovery and reconciled print/export. Manager performs routine workflow without developer data conversion. Record assistance/time, omissions, all pinned contexts, timings and pass/fail evidence.

## Expected inspection points

- [tests/golden-schedule-fixtures.test.ts](../../tests/golden-schedule-fixtures.test.ts)
- [solver/tests/test_feasibility.py](../../solver/tests/test_feasibility.py)
- [plans/TEST_STRATEGY.md](../../plans/TEST_STRATEGY.md)
- [plans/MASTER_PLAN.md](../../plans/MASTER_PLAN.md)

Inspect successor migrations/callers and relevant assertions before editing. Add forward migrations only; historical paths above are evidence, not edit targets. Implement this coherent slice; if more than one independent migration/semantic family is needed, execute and verify each sequentially under this task with criterion-level evidence.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Check expected versions/fingerprints atomically. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write; preserve form draft for correction. Never replace stale candidate tokens with freshly fetched tokens. Validate incoming schemas and entity membership. A disabled AI service must not affect this flow.

## UX behavior

Record actual manager behavior and assistance; a prepared checklist is not acceptance.

## Non-goals

Never commit identifiable student fixtures or claim toy-data acceptance. This task does not authorize deployment or messages.

## Tests and acceptance criteria

- A manager-approved complete dataset and full independent legality/parity evidence; intentional infeasible and stale cases; repeat browser journey in authorized deployed environment
- If first-feasible quality is unusable after bounded manual finishing, do not waive: pull OPT-01/02 before acceptance.

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
npm run test:e2e
```

VERIFY-01 introduces test:parity and test:e2e. Do not run or claim them before that dependency exists; after it is DONE, user-facing tasks additionally run npm run test:e2e for the changed journey. For solver/IR changes run pinned Python pytest as well. Missing Docker/credentials is a verification blocker, never a pass. No production fallback.

## Completion evidence

Record changed files, new test names, commands and exit codes, demonstrated behavior/artifact, remaining limitations, starting HEAD and final commit/reference (or uncommitted). Update TASKS and derived README/NEXT; archive prompt only after every criterion passes. External acceptance tasks require actual owner/manager evidence and private references rather than identifiable public fixtures.

## Escalation conditions

Escalate with a concrete reproducer if schema cannot preserve authority without duplicate truth; a required HARD semantic is unsupported; dependency-closed policy replacement cannot be proven; current code conflicts with accepted decisions; historical migrations would need rewriting; or this bounded scope expands materially. Resolve routine file/API uncertainty by inspection. Complete independent authorized work before asking for an external decision. No task prompt authorizes deployment, paid services, messages to others, or destructive customer-data operations.


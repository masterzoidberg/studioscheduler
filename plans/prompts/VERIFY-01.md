# VERIFY-01 — Create shared parity and authenticated workflow harnesses

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **A**. Dependencies: **SAFE-02**.
Status is owned by [TASKS](../TASKS.md); do not infer readiness from this prompt existing.

## Outcome and current state

Introduce npm run test:parity consuming serialized feasible/impossible/partial/locked cases through TS and Python; introduce npm run test:e2e with isolated authenticated test fixtures and loopback-only guard. Add only the browser test dependency needed after inspecting existing tools; pin it.

Current evidence at audit HEAD `9120439`: Existing TS and Python suites are separate; test:parity and test:e2e do not exist. HTTP smoke reaches login only. For later tasks, predecessor behavior above is an expected contract, not a claim that it exists in this baseline.

## Architectural decisions already made

Read [DECISIONS](../DECISIONS.md) and [execution rules](../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts. Reuse existing commands/components; a planned route/schema is new work, not an existing path claim.

## Scope and required behavior

Introduce npm run test:parity consuming serialized feasible/impossible/partial/locked cases through TS and Python; introduce npm run test:e2e with isolated authenticated test fixtures and loopback-only guard. Add only the browser test dependency needed after inspecting existing tools; pin it.

## Expected inspection points

- [scripts/test-db.mjs](../../scripts/test-db.mjs)
- [tests/golden-schedule-fixtures.test.ts](../../tests/golden-schedule-fixtures.test.ts)
- [tests/fixtures/session-lock-semantics.json](../../tests/fixtures/session-lock-semantics.json)
- [solver/tests/test_session_locks.py](../../solver/tests/test_session_locks.py)
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- [package.json](../../package.json)

Inspect successor migrations/callers and relevant assertions before editing. Add forward migrations only; historical paths above are evidence, not edit targets. Implement this coherent slice; if more than one independent migration/semantic family is needed, execute and verify each sequentially under this task with criterion-level evidence.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Check expected versions/fingerprints atomically. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write; preserve form draft for correction. Never replace stale candidate tokens with freshly fetched tokens. Validate incoming schemas and entity membership. A disabled AI service must not affect this flow.

## UX behavior

Expose structured actionable error codes/messages to the caller, keeping stack traces, SQL and hashes out of normal UI; technical diagnostic context must be redacted.

## Non-goals

No real DWDE data, live auth credentials or full product acceptance claim.

## Tests and acceptance criteria

- Detect deliberate legality mismatch, qualification default-deny, duration mismatch and stale candidate
- Browser test proves manager login/role fixture, inventory write and authoritative rejected edit with no data change
- Never fake private DWDE certification.

Add regressions that fail for the identified missing behavior, including rejection/no-write cases. Existing green tests are necessary but insufficient. DB tasks require executed transaction/RLS tests, not SQL substring checks. Browser workflow assertions must observe both UI and authoritative persisted state.

## Verification commands

Run from repository root with explicit disposable configuration; see [TEST_STRATEGY](../TEST_STRATEGY.md) for Python and authenticated environment setup.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

This task introduces test:parity and test:e2e, then must run both. For solver/IR changes run pinned Python pytest as well. Missing Docker/credentials is a verification blocker, never a pass. No production fallback.

## Completion evidence

Record changed files, new test names, commands and exit codes, demonstrated behavior/artifact, remaining limitations, starting HEAD and final commit/reference (or uncommitted). Update TASKS and derived README/NEXT; archive prompt only after every criterion passes. External acceptance tasks require actual owner/manager evidence and private references rather than identifiable public fixtures.

## Escalation conditions

Escalate with a concrete reproducer if schema cannot preserve authority without duplicate truth; a required HARD semantic is unsupported; dependency-closed policy replacement cannot be proven; current code conflicts with accepted decisions; historical migrations would need rewriting; or this bounded scope expands materially. Resolve routine file/API uncertainty by inspection. Complete independent authorized work before asking for an external decision. No task prompt authorizes deployment, paid services, messages to others, or destructive customer-data operations.


## CI ownership

Wire the new parity and authenticated e2e commands into PR CI with loopback/disposable credentials; SAFE-02 owns initial solver path-trigger repair, this task verifies it covers every shared schema/fixture it introduces. Include the SET-01 capacity-review journey when SET-01 lands. Use PR CI for the hardening branch; no unsupported assertion that every branch push triggers checks. Record Node/Python versions and artifact retention without private fixture data.

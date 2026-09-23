# GEN-04 — Onboard an empty second workspace

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **B**. Dependencies: **GEN-03**.
Status is owned by [TASKS](../../TASKS.md); this archived prompt is historical evidence only.

## Outcome and current state

Owner creates empty studio atomically, selects workspace, enters neutral terminology and hours/rooms using existing setup. Support Sunday as aligned TS/Python/SQL/UI day with 15-minute grid; expose supported weekly single-timezone/no-overnight limits. No DWDE rules/people seeded. Zero-membership has create/accept invite path.

## Architectural decisions already made

Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts. Reuse existing commands/components; a planned route/schema is new work, not an existing path claim.

## Scope and required behavior

Owner creates empty studio atomically, selects workspace, enters neutral terminology and hours/rooms using existing setup. Support Sunday as aligned TS/Python/SQL/UI day with 15-minute grid; expose supported weekly single-timezone/no-overnight limits. No DWDE rules/people seeded. Zero-membership has create/accept invite path.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Check expected versions/fingerprints atomically. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write; preserve form draft for correction. Never replace stale candidate tokens with freshly fetched tokens. Validate incoming schemas and entity membership. A disabled AI service must not affect this flow.

## UX behavior

Expose structured actionable error codes/messages to the caller, keeping stack traces, SQL and hashes out of normal UI; technical diagnostic context must be redacted.

## Non-goals

No billing, custom calendars, variable grids or multi-timezone scheduling.

## Tests and acceptance criteria

- Provision retry cannot duplicate workspace; role selection unambiguous; four rooms/morning/Sunday work in editor/solver/export
- Tenant rename does not affect authority
- Failure leaves recoverable account state.

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
npm run test:e2e
```

Missing Docker/credentials is a verification blocker, never a pass. No production fallback.

## Completion evidence

Record changed files, new test names, commands and exit codes, demonstrated behavior/artifact, remaining limitations, starting HEAD and final commit/reference (or uncommitted). Update TASKS and derived README/NEXT; archive prompt only after every criterion passes. External acceptance tasks require actual owner/manager evidence and private references rather than identifiable public fixtures.

## Escalation conditions

Escalate with a concrete reproducer if schema cannot preserve authority without duplicate truth; a required HARD semantic is unsupported; dependency-closed policy replacement cannot be proven; current code conflicts with accepted decisions; historical migrations would need rewriting; or this bounded scope expands materially. Resolve routine file/API uncertainty by inspection. Complete independent authorized work before asking for an external decision. No task prompt authorizes deployment, paid services, messages to others, or destructive customer-data operations.

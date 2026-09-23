# LOCK-01 — Expose governed session lock and unlock controls

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **A**. Dependencies: **UX-02**.
Status is owned by [TASKS](../TASKS.md); do not infer readiness from this prompt existing.

## Outcome and current state

Add explicit lock/unlock action through authorized expected-version transaction using existing ClassSession.locked planning authority. Show exactly which session and current placement are protected. Lock change creates proper planning version/context, visibly stales candidate/certification as required; do not silently rebase. Reject lock on unassigned session unless existing contract can represent a fixed placement safely.

Current evidence at audit HEAD `9120439`: Session-specific solver protection exists, but manager lock/unlock action is absent from primary scheduling UI. For later tasks, predecessor behavior above is an expected contract, not a claim that it exists in this baseline.

## Architectural decisions already made

Read [DECISIONS](../DECISIONS.md) and [execution rules](../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts. Reuse existing commands/components; a planned route/schema is new work, not an existing path claim.

## Scope and required behavior

Add explicit lock/unlock action through authorized expected-version transaction using existing ClassSession.locked planning authority. Show exactly which session and current placement are protected. Lock change creates proper planning version/context, visibly stales candidate/certification as required; do not silently rebase. Reject lock on unassigned session unless existing contract can represent a fixed placement safely.

## Expected inspection points

- [lib/domain.ts](../../lib/domain.ts)
- [components/schedule/schedule-view.tsx](../../components/schedule/schedule-view.tsx)
- [components/workspace-provider.tsx](../../components/workspace-provider.tsx)
- [lib/planning-dataset.ts](../../lib/planning-dataset.ts)
- [lib/solver-candidate-context.ts](../../lib/solver-candidate-context.ts)
- [tests/session-specific-locks.test.ts](../../tests/session-specific-locks.test.ts)
- [scripts/test-db.mjs](../../scripts/test-db.mjs)

Inspect successor migrations/callers and relevant assertions before editing. Add forward migrations only; historical paths above are evidence, not edit targets. Implement this coherent slice; if more than one independent migration/semantic family is needed, execute and verify each sequentially under this task with criterion-level evidence.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Check expected versions/fingerprints atomically. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write; preserve form draft for correction. Never replace stale candidate tokens with freshly fetched tokens. Validate incoming schemas and entity membership. A disabled AI service must not affect this flow.

## UX behavior

Use manager words: Setup, Must happen, Prefer, Build schedule, Review changes. Show helpful empty state, loading state without duplicate submission, inline actionable errors and retained input on failure. Support keyboard and 390px tap layout; put hashes/IR/RPC/version identifiers in Advanced.

## Non-goals

No new lock model, class-wide inference or direct browser table writes.

## Tests and acceptance criteria

- Multi-session class locks only chosen session; changed lock invalidates old candidate; wrong tenant/viewer rejected; stale toggle writes nothing
- Browser keyboard/tap toggles and regenerate preserves placement
- Existing assignment locked semantics must be reconciled into effective lock without two writable toggles.

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

VERIFY-01 introduces test:parity and test:e2e. Do not run or claim them before that dependency exists; after it is DONE, user-facing tasks additionally run npm run test:e2e for the changed journey. For solver/IR changes run pinned Python pytest as well. Missing Docker/credentials is a verification blocker, never a pass. No production fallback.

## Completion evidence

Record changed files, new test names, commands and exit codes, demonstrated behavior/artifact, remaining limitations, starting HEAD and final commit/reference (or uncommitted). Update TASKS and derived README/NEXT; archive prompt only after every criterion passes. External acceptance tasks require actual owner/manager evidence and private references rather than identifiable public fixtures.

## Escalation conditions

Escalate with a concrete reproducer if schema cannot preserve authority without duplicate truth; a required HARD semantic is unsupported; dependency-closed policy replacement cannot be proven; current code conflicts with accepted decisions; historical migrations would need rewriting; or this bounded scope expands materially. Resolve routine file/API uncertainty by inspection. Complete independent authorized work before asking for an external decision. No task prompt authorizes deployment, paid services, messages to others, or destructive customer-data operations.


## Accepted lock precedence and atomic command

Current effective lock is session.locked OR assignment.locked. Setting only session.locked=false cannot unlock an assignment lock. The governed lock/unlock command is the single writable manager action: update the planning session lock and create a new current ScheduleVersion with the matching assignment lock value atomically. Preserve previous versions unchanged. Validate unchanged placements against current authority, explicitly show that this action updates planning/schedule context, and pin expected versions; do not silently rebase stale placements. For partial schedules, lock only an assigned session with a known placement. Unlock clears both current flags in this one transaction. A failure changes neither flag/version/audit success. Both old input flags remain historical readers, not separate user toggles. After successful toggle, certification is visibly stale and requires reconfirmation; do not silently carry it forward.

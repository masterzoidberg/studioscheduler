# SET-02 — Create one Studio Setup entry and dashboard

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **A**. Dependencies: **SET-01**.
Status is owned by [TASKS](../TASKS.md); do not infer readiness from this prompt existing.

## Outcome and current state

Add Setup with sections Studio, Teachers, Classes, Students, Requirements, Preferences, Review. Reuse existing inventory/repair components and commands; retain old route as redirect/deep-link compatibility. First entry guides sections; returning users see exact outstanding actions. Move raw Rulebook/readiness/version diagnostics to Advanced.

Current evidence at audit HEAD `9120439`: People, Classes, Planning Repairs, Readiness and Rulebook split a single setup job; homepage exposes implementation terminology. For later tasks, predecessor behavior above is an expected contract, not a claim that it exists in this baseline.

## Architectural decisions already made

Read [DECISIONS](../DECISIONS.md) and [execution rules](../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts. Reuse existing commands/components; a planned route/schema is new work, not an existing path claim.

## Scope and required behavior

Add Setup with sections Studio, Teachers, Classes, Students, Requirements, Preferences, Review. Reuse existing inventory/repair components and commands; retain old route as redirect/deep-link compatibility. First entry guides sections; returning users see exact outstanding actions. Move raw Rulebook/readiness/version diagnostics to Advanced.

## Expected inspection points

- [components/app-shell.tsx](../../components/app-shell.tsx)
- [components/dashboard.tsx](../../components/dashboard.tsx)
- [components/planning-repairs-view.tsx](../../components/planning-repairs-view.tsx)
- [components/required-class-intake.tsx](../../components/required-class-intake.tsx)
- [app/planning-repairs/page.tsx](../../app/planning-repairs/page.tsx)

Inspect successor migrations/callers and relevant assertions before editing. Add forward migrations only; historical paths above are evidence, not edit targets. Implement this coherent slice; if more than one independent migration/semantic family is needed, execute and verify each sequentially under this task with criterion-level evidence.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Check expected versions/fingerprints atomically. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write; preserve form draft for correction. Never replace stale candidate tokens with freshly fetched tokens. Validate incoming schemas and entity membership. A disabled AI service must not affect this flow.

## UX behavior

Use manager words: Setup, Must happen, Prefer, Build schedule, Review changes. Show helpful empty state, loading state without duplicate submission, inline actionable errors and retained input on failure. Support keyboard and 390px tap layout; put hashes/IR/RPC/version identifiers in Advanced.

## Non-goals

No new setup-data store or changed legality.

## Tests and acceptance criteria

- First-time empty state has one clear setup action; returning user resumes meaningful section without persisting duplicate data
- Deep links, keyboard focus and narrow screen work; unavailable later sections say what is missing rather than fake readiness.

Add regressions that fail for the identified missing behavior, including rejection/no-write cases. Existing green tests are necessary but insufficient. DB tasks require executed transaction/RLS tests, not SQL substring checks. Browser workflow assertions must observe both UI and authoritative persisted state.

## Verification commands

Run from repository root with explicit disposable configuration; see [TEST_STRATEGY](../TEST_STRATEGY.md) for Python and authenticated environment setup.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

VERIFY-01 introduces test:parity and test:e2e. Do not run or claim them before that dependency exists; after it is DONE, user-facing tasks additionally run npm run test:e2e for the changed journey. For solver/IR changes run pinned Python pytest as well. Missing Docker/credentials is a verification blocker, never a pass. No production fallback.

## Completion evidence

Record changed files, new test names, commands and exit codes, demonstrated behavior/artifact, remaining limitations, starting HEAD and final commit/reference (or uncommitted). Update TASKS and derived README/NEXT; archive prompt only after every criterion passes. External acceptance tasks require actual owner/manager evidence and private references rather than identifiable public fixtures.

## Escalation conditions

Escalate with a concrete reproducer if schema cannot preserve authority without duplicate truth; a required HARD semantic is unsupported; dependency-closed policy replacement cannot be proven; current code conflicts with accepted decisions; historical migrations would need rewriting; or this bounded scope expands materially. Resolve routine file/API uncertainty by inspection. Complete independent authorized work before asking for an external decision. No task prompt authorizes deployment, paid services, messages to others, or destructive customer-data operations.


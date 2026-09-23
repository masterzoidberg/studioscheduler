# SET-07 — Unify readiness and manager certification

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **A**. Dependencies: **SET-06**.
Status is owned by [TASKS](../../TASKS.md); this archived prompt is historical reference only.

## Outcome and current state

Implement DEC-105 gate matrix at UI, server and transaction boundaries; extend existing planning confirmation with pinned Rulebook/model/review-set context. Show READY/NOT READY and exact actions; known omissions are classified as must/prefer/informational. Review confirmation is one action, not a second certification subsystem.

## Architectural decisions already made

Read [DECISIONS](../../DECISIONS.md) and [execution rules](../../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts.

## Scope and required behavior

Implement DEC-105 gate matrix at UI, server and transaction boundaries; extend existing planning confirmation with pinned Rulebook/model/review-set context. Show READY/NOT READY and exact actions; known omissions are classified as must/prefer/informational. Review confirmation is one action, not a second certification subsystem.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Check expected versions/fingerprints atomically. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write; preserve form draft for correction. Never replace stale candidate tokens with freshly fetched tokens. Validate incoming schemas and entity membership. A disabled AI service must not affect this flow.

## UX behavior

Use manager words: Setup, Must happen, Prefer, Build schedule, Review changes. Show helpful empty state, loading state without duplicate submission, inline actionable errors and retained input on failure. Support keyboard and 390px tap layout; put hashes/IR/RPC/version identifiers in Advanced.

## Acceptance criteria

- Forged UI confirmation, stale policy and revoked review fail atomically.
- Unreviewed HARD slice blocks certify/solve/adopt/final export; missing preference only warns.
- Room change preserves teacher review but stales aggregate certification.
- Partial legal drafts remain editable under authoritative semantics.

## Completion evidence

Accepted on 2026-09-10 at the bounded implementation commit recorded in [TASKS](../../TASKS.md). The V60 forward migration, server-prepared confirmation route, readiness mapping, focused regressions, complete disposable DB chain, parity, solver and seven-journey authenticated E2E suite passed. This task does not claim milestone A or external acceptance.

## Certification preparation and race contract

Before showing final confirmation, the server compiles and, if needed, publishes the supported current model, reloads a coherent snapshot and returns review summary with exact confirmation token. Model publication does not require a solve or an already confirmed dataset. Confirmation rechecks expected policy/planning/model/review context under transaction serialization. Extend solver/adoption context with certification/review revision so a review invalidated or explicitly revoked after generation prevents adoption even if planning facts are unchanged. Preserve global fail-closed scheduling when any active HARD meaning is unsupported; do not invent a partial-HARD evaluator. Partial drafts are allowed only under complete supported semantics.

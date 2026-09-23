# SAFE-01 — Reject missing or revoked membership at commit

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **A**. Dependencies: **None**.
Status is owned by [TASKS](../../TASKS.md). This prompt is archived after accepted completion; it is historical evidence, not current instructions.

## Outcome and current state

Add a forward migration making current service-wrapper role checks explicitly reject null/missing membership; preserve exact selected studio, grants, function signatures and downstream validation. Acquire a row lock that conflicts with role changes/deletion through transaction completion; define concurrent revocation by database lock order.

Audit evidence at HEAD `9120439`: V49 compared nullable role with NOT IN; a missing row did not enter the rejection branch. Route authorization occurred earlier. SAFE-01 was subsequently implemented and accepted; see the canonical completion record in TASKS for commit and CI evidence.

## Architectural decisions already made

Read [DECISIONS](../../DECISIONS.md) and [execution rules](../../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts.

## Scope and required behavior

Add a forward migration making current service-wrapper role checks explicitly reject null/missing membership; preserve exact selected studio, grants, function signatures and downstream validation. Acquire a row lock that conflicts with role changes/deletion through transaction completion; define concurrent revocation by database lock order.

## Expected inspection points

- `supabase/migrations/20260907190000_close_legacy_write_bypasses_v49.sql`
- `app/api/solver/adopt/route.ts`
- `scripts/test-db.mjs`
- `tests/legacy-write-bypass-closure.test.ts`

Historical migrations remain read-only evidence.

## Data, authority and failure behavior

Authorize exact tenant and current human role at server and transaction boundaries. Stale/conflicting/unsupported/unauthorized input rejects with actionable error and no canonical, version or audit success write. A disabled AI service must not affect this flow.

## Tests and acceptance criteria

- Deleted membership and never-member actors fail with the authorization error before candidate parsing; VIEWER and wrong studio fail; valid OWNER/EDITOR succeeds.
- Exercise two-connection revocation ordering and assert unchanged schedule, versions, model and audit on rejection.
- SQL acceptance requires executed transaction tests, not source substring checks.

## Verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

## Accepted completion

Implemented by additive V5.0 migration and focused disposable PostgreSQL regression. Implementation SHA `51fd92e35eaa3129f237f91c196e4ad603d58547`; PR #55 CI run 324 and Solver CI run 43 passed. See [TASKS](../../TASKS.md) for criterion-level evidence. No production deployment or data mutation was part of acceptance.

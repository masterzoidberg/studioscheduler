# T04 — Canonical candidate intervals

## Task objective

Validate exactly the assignment intervals that adoption will persist.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T02, T03. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

The gateway accepted a 15-minute interval for a 60-minute planning duration; SQL later recomputes the end.

Deliver only T04, using the current architecture. 

## Explicit non-goals

Do not trust browser validation or add an alternative business-rule engine in SQL.

## Files/subsystems to inspect

- [lib/solver-gateway.ts](../../lib/solver-gateway.ts)
- [app/api/solver/adopt/route.ts](../../app/api/solver/adopt/route.ts)
- [lib/schedule-command-candidate.ts](../../lib/schedule-command-candidate.ts)
- [tests/solver-gateway.test.ts](../../tests/solver-gateway.test.ts)
- [supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql](../../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Add a shortened-duration teacher-window regression and a per-session duration override case.
- Keep SQL structural validation as defense in depth; change current function through a forward migration.

- Explain objective, assumptions, and smallest change points before editing.
- Preserve working behavior and historical reproducibility unless the selected acceptance criterion explicitly changes current behavior.
- Keep rejection paths atomic and tenant/version context explicit.
- Any necessary deviation must be evidenced in the ledger and decision log; no silent scope expansion.

## Tests

Read [TEST_STRATEGY](../TEST_STRATEGY.md). Add behavior regressions for each acceptance criterion, then run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] Start/end values and assignment shape are strictly validated; nonfinite, malformed, duplicate, unknown, or cross-midnight assignments are rejected.
- [ ] End times derive from pinned session overrides/class durations before IR evaluation; inconsistent supplied end times fail.
- [ ] Shortened intervals cannot evade teacher availability, sequencing, or overlap checks.
- [ ] Adoption persists the exact validated assignment interpretation and rolls back rejected candidates.

## Safety constraints

- Preserve unrelated working-tree changes.
- Never use production for tests or mutate production data as part of this prompt.
- Never rewrite historical production migrations or ledger fingerprints; use forward migrations.
- Do not weaken tests, bypass unsupported HARD semantics, or substitute browser/AI assertions for server legality.
- Solver output remains a candidate; canonical mutation requires pinned context and governed authorization.
- Add no DWDE-specific behavior to reusable logic. A temporary existing DWDE adapter must be explicitly isolated and tracked for extraction.
- Do not send messages, provision paid infrastructure, deploy, or start recurring automation without separate task authorization.

## Expected completion report

Report the implemented outcome, exact files, tests and exit codes, environment, risks/limitations, and any blocker. Update TASKS.md with commit/reference and evidence; mark DONE only after every criterion passes. Recompute readiness and synchronize README.md/NEXT.md. Update milestone checklists, leakage status, and DECISIONS.md only where the verified work changes them. If unfinished, state the precise remaining condition instead of claiming completion.


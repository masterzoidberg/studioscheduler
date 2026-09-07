# T02 — Disposable database integration harness

## Task objective

Reconstruct and test current database command behavior in a disposable environment.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T01. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

SQL text assertions cannot establish privileges, transaction rollback, migration reconstruction, or RLS behavior.

Deliver only T02, using the current architecture. 

## Explicit non-goals

Do not reconcile the production ledger live, provision paid services, or build a general migration framework.

## Files/subsystems to inspect

- [supabase/bootstrap/2026-08-31-production-schema-baseline.sql](../../supabase/bootstrap/2026-08-31-production-schema-baseline.sql)
- [supabase/production-ledger/README.md](../../supabase/production-ledger/README.md)
- [supabase/production-ledger/manifest.json](../../supabase/production-ledger/manifest.json)
- [supabase/migrations/README.md](../../supabase/migrations/README.md)
- [package.json](../../package.json)
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Inspect CLI/runtime availability before choosing tooling; use isolated Supabase when auth/vault dependencies require it.
- Document fixture identities, teardown, prerequisites, and migration ledger handling.
- Add a staging recovery procedure outline; no production restore.

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

- [ ] A fresh disposable environment reconstructs the current schema through a documented, dependency-correct sequence.
- [ ] Executed owner/editor/viewer/nonmember tests verify one governed write and stale-version rejection.
- [ ] The harness refuses production targets and exposes npm run test:db, with an actionable setup failure rather than a silent skip.
- [ ] Bootstrap/archive schema differences are resolved in test setup or forward migrations, never by rewriting historical SQL.

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


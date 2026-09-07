# T05 — Unsupported DWDE policy guard

## Task objective

Prevent changed human policy from silently retaining obsolete static compiler behavior.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T01, T03. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Changing OPS-003 wording to a 19:00 close still compiled 21:30 in the audit.

Deliver only T05, using the current architecture. 

## Explicit non-goals

Do not implement a prose parser or the whole generic rule authoring system.

## Files/subsystems to inspect

- [lib/constraint-compiler.ts](../../lib/constraint-compiler.ts)
- [lib/constraint-compiler-v3.ts](../../lib/constraint-compiler-v3.ts)
- [lib/reviewed-rulebook.ts](../../lib/reviewed-rulebook.ts)
- [lib/schedule-readiness.ts](../../lib/schedule-readiness.ts)
- [tests/constraint-compiler.test.ts](../../tests/constraint-compiler.test.ts)
- [supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql](../../supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Reuse reviewed-policy provenance and inspect existing content-pinned repair precedent.
- Treat this as a temporary DWDE adapter guard, to be replaced by structured rules in T21/T25; do not create new generic-kernel exceptions.

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
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] Supported reviewed DWDE v3 behavior remains reproducible.
- [ ] An unsupported change to wording, strength, status, or executable policy content cannot be marked supported/current by the static compiler.
- [ ] The OPS-003 19:00 regression fails closed instead of silently returning a supposedly current 21:30 policy.
- [ ] Draft/unsupported rules have clear readiness feedback and preserve immutable policy history.

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


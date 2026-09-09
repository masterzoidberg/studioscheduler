> HISTORICAL — superseded and INCOMPLETE, not a completed task. Replacement mapping: [TASKS](../TASKS.md).

# T27 — Studio #2 acceptance

## Task objective

Demonstrate unrelated onboarding without bespoke code.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T19, T21, T22, T23, T24, T25, T26. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

This is the commercialization gate rather than inferred genericity from types.

Deliver only T27, using the current architecture. 

## Explicit non-goals

Do not call a renamed DWDE dataset Studio #2 or waive isolation criteria.

## Files/subsystems to inspect

- [plans/STUDIO_2_ACCEPTANCE.md](../../plans/STUDIO_2_ACCEPTANCE.md)
- [tests/golden-schedule-fixtures.test.ts](../../tests/golden-schedule-fixtures.test.ts)
- [tests/solver-problem-contract.test.ts](../../tests/solver-problem-contract.test.ts)
- [solver/tests/test_feasibility.py](../../solver/tests/test_feasibility.py)
- [components/workspace-provider.tsx](../../components/workspace-provider.tsx)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Freeze implementation SHA before onboarding; any bespoke code resets this acceptance run.
- Use standard provisioning/imports; operator assistance can clarify input but cannot implement a customer-specific compiler.

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
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
npm run test:e2e
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] Every criterion and evidence requirement in STUDIO_2_ACCEPTANCE.md passes.
- [ ] At least 4 instructors/4 rooms/30 participants/12 activities/20 weekly sessions use non-DWDE policy and taxonomy.
- [ ] Onboarding, solve, rescore, compare, adopt, edit, archive/restore, export, and selected-tenant isolation require zero tenant-specific code.
- [ ] Rename invariance and known infeasible/UNKNOWN cases pass; unverified criteria remain explicitly open.

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


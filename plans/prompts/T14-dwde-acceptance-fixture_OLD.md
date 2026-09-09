> HISTORICAL — superseded and INCOMPLETE, not a completed task. Replacement mapping: [TASKS](../TASKS.md).

# T14 — Representative full DWDE acceptance fixture/solve

## Task objective

Prove the full real scheduling workload and establish shared parity fixtures.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T05, T06, T07, T08, T09, T10, T11, T12, T13. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Small passing fixtures do not establish complete planning data or operational solve performance.

Deliver only T14, using the current architecture. 

## Explicit non-goals

Do not call toy fixtures full DWDE acceptance or expand objectives before HARD correctness.

## Files/subsystems to inspect

- [tests/golden-schedule-fixtures.test.ts](../../tests/golden-schedule-fixtures.test.ts)
- [tests/constraint-engine.test.ts](../../tests/constraint-engine.test.ts)
- [tests/constraint-engine-coverage.test.ts](../../tests/constraint-engine-coverage.test.ts)
- [tests/solver-problem-contract.test.ts](../../tests/solver-problem-contract.test.ts)
- [solver/tests/test_feasibility.py](../../solver/tests/test_feasibility.py)
- [lib/schedule-readiness.ts](../../lib/schedule-readiness.ts)
- [lib/delegated-solver-preflight.ts](../../lib/delegated-solver-preflight.ts)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Introduce npm run test:parity as the cross-runtime fixture command.
- Use private artifacts for identifiable studio data, deidentified fixtures in Git, and no live production writes.
- Missing complete data is a real external blocker; synthetic facts cannot be represented as manager-approved DWDE completeness.

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
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] A manager-reviewed complete DWDE snapshot records people/classes/sessions/rosters/qualifications/availability and known omissions explicitly.
- [ ] A representative full solve covers every active session; independent IR validation, adoption, edit, and recovery pass in staging.
- [ ] Shared serialized fixtures run against TypeScript and Python, including feasible/infeasible, qualifications, durations, locks, and delegated preconditions.
- [ ] Runtime/solver default-deny and name-normalization discrepancies are fixed; unsupported semantics fail closed.
- [ ] Benchmark records hardware, pinned versions, request hash, wall time, memory/concurrency envelope, and manager-agreed operational threshold.

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


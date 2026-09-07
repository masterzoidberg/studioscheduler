# T18 — Soft optimization

## Task objective

Use CP-SAT to improve schedules while preserving deterministic HARD correctness.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T17, T15. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Good schedules are necessary for repeatable commercial use after trustworthy feasibility exists.

Deliver only T18, using the current architecture. 

## Explicit non-goals

Do not replace CP-SAT or introduce a separate optimization service.

## Files/subsystems to inspect

- [solver/dwde_solver/feasibility.py](../../solver/dwde_solver/feasibility.py)
- [solver/dwde_solver/service.py](../../solver/dwde_solver/service.py)
- [lib/solver-gateway.ts](../../lib/solver-gateway.ts)
- [solver/tests/test_feasibility.py](../../solver/tests/test_feasibility.py)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Prefer sequential tier optimization; if a tier is not proven optimal, report that limitation precisely.
- Retain a feasibility-only mode and consistent service contract.

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
Push-Location solver
python -m pytest -q
Pop-Location
npm run test:parity
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] Initial penalties translate consistently to CP-SAT and independent scoring.
- [ ] Hierarchical optimization protects higher-tier achieved results; proven optimality is distinguished from a time-limited incumbent.
- [ ] HARD violations remain zero and locks/version context remain intact.
- [ ] Reported score, bound/status, and per-tier units agree with deterministic rescoring under a bounded total request budget.

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


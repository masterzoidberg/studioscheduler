# T19 — Candidate comparison/persistence

## Task objective

Persist and compare a small number of useful schedule alternatives.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T18, T08, T16. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Current results are transient and repeatable same-seed solves do not provide meaningful choice.

Deliver only T19, using the current architecture. 

## Explicit non-goals

Do not implement unlimited enumeration, generalized scenarios, or branch merge.

## Files/subsystems to inspect

- [components/solver-feasibility-card.tsx](../../components/solver-feasibility-card.tsx)
- [components/schedule/schedule-view.tsx](../../components/schedule/schedule-view.tsx)
- [app/api/solver/adopt/route.ts](../../app/api/solver/adopt/route.ts)
- [lib/solver-gateway.ts](../../lib/solver-gateway.ts)
- [solver/dwde_solver/feasibility.py](../../solver/dwde_solver/feasibility.py)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Add minimal candidate persistence via forward migration; keep canonical schedules separate.
- Protect candidate rows with tenant authorization and avoid storing unnecessary personal data.

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

- [ ] Two or three materially distinct candidates can be generated within supported budgets, with explicit diversity criteria.
- [ ] Candidates survive refresh and retain immutable policy/planning/base-schedule/lock context.
- [ ] Candidate-versus-current and candidate-versus-candidate differences show understandable preference tradeoffs.
- [ ] All alternatives independently validate/rescore and adoption rejects stale context.

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


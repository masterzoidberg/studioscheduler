> HISTORICAL — completed bounded foundation work. Not current instructions. See [archive index](README.md).

# T07 — Coherent solver snapshots

## Task objective

Build solver requests from coherent immutable planning and policy context.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../../README_OLD.md), [master plan](../../MASTER_PLAN_OLD.md), [task ledger](../../TASKS_OLD.md), and [operating rules](../../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T02, T03, T05, T06. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Independent reads of mutable entities and version pointers can mix facts from different moments.

Deliver only T07, using the current architecture. 

## Explicit non-goals

Do not add caching, queues, or event sourcing merely to solve consistency.

## Files/subsystems to inspect

- [lib/server-studio-state.ts](../../../lib/server-studio-state.ts)
- [lib/solver-problem.ts](../../../lib/solver-problem.ts)
- [lib/planning-dataset.ts](../../../lib/planning-dataset.ts)
- [lib/constraint-model-version.ts](../../../lib/constraint-model-version.ts)
- [tests/solver-problem-contract.test.ts](../../../tests/solver-problem-contract.test.ts)
- [app/api/solver/feasibility/route.ts](../../../app/api/solver/feasibility/route.ts)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Prefer snapshot reconstruction plus coherent pointer reads over a new event store.
- Specify snapshot/hash checks and what is allowed to change during a long solve.

- Explain objective, assumptions, and smallest change points before editing.
- Preserve working behavior and historical reproducibility unless the selected acceptance criterion explicitly changes current behavior.
- Keep rejection paths atomic and tenant/version context explicit.
- Any necessary deviation must be evidenced in the ledger and decision log; no silent scope expansion.

## Tests

Read [TEST_STRATEGY](../../TEST_STRATEGY.md). Add behavior regressions for each acceptance criterion, then run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] Scheduling facts come from the pinned immutable planning snapshot, with compatible historical schema handling.
- [ ] Rulebook/model/current schedule and lock references belong to a coherent context; pointer changes cause retry or rejection.
- [ ] Concurrent planning/policy changes cannot submit a mixed-version request.
- [ ] The request excludes unrelated tenant data and unnecessary historical assignments.

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


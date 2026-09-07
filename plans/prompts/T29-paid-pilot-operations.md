# T29 — Paid-pilot operations

## Task objective

Support 3–5 real pilots and repeatable commercial MVP operations, then measure 10–25 customer evidence.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T16, T19, T27. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Commercial success requires operational reliability and manageable onboarding/support economics.

Deliver only T29, using the current architecture. 

## Explicit non-goals

Do not build advanced billing, broad integrations, scale infrastructure, or fabricate customer evidence.

## Files/subsystems to inspect

- [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- [.github/workflows/solver-ci.yml](../../.github/workflows/solver-ci.yml)
- [solver/Dockerfile](../../solver/Dockerfile)
- [app/api/solver/feasibility/route.ts](../../app/api/solver/feasibility/route.ts)
- [app/api/copilot/route.ts](../../app/api/copilot/route.ts)
- [vercel.json](../../vercel.json)
- [.env.example](../../.env.example)
- [plans/DWDE_RELEASE_PLAN.md](../../plans/DWDE_RELEASE_PLAN.md)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Split operational slices under T29 if needed; external adoption and customer growth remain milestone evidence, not code-completion claims.
- AI optional; if shipped, T28 is an additional release dependency.
- Do not create automation or contact customers without separate authorization.

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

- [ ] 3–5 organizations use real schedules with recorded generation/adoption success and onboarding effort.
- [ ] Tenant usage/concurrency limits, total deadlines, actionable redacted logs, support process, and recovery runbook are verified.
- [ ] Basic billing/entitlements or documented standard manual invoicing supports pilots; repeatable MVP operations are explicit.
- [ ] A 10–25 customer measurement protocol tracks paid retention, accepted schedules, support cost, bespoke engineering, and integration requests; growth itself is not falsely marked achieved.
- [ ] Data export/deletion handling, credential rotation, restore evidence, and supported workload limits have named operational owners.

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


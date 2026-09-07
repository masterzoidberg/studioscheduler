# T24 — Remove DWDE operational UI assumptions

## Task objective

Display and configure the actual tenant's operating structure.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T20, T21, T23. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Weekly view truncates to three rooms; hours, days, and start defaults encode DWDE.

Deliver only T24, using the current architecture. 

## Explicit non-goals

Do not redesign the app or add arbitrary resource bundles/multi-instructor scheduling.

## Files/subsystems to inspect

- [components/schedule/schedule-view.tsx](../../components/schedule/schedule-view.tsx)
- [components/schedule/mobile-schedule-view.tsx](../../components/schedule/mobile-schedule-view.tsx)
- [lib/schedule-builder.ts](../../lib/schedule-builder.ts)
- [lib/domain.ts](../../lib/domain.ts)
- [components/settings-view.tsx](../../components/settings-view.tsx)
- [components/app-shell.tsx](../../components/app-shell.tsx)
- [app/layout.tsx](../../app/layout.tsx)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Do not add Sunday/finer grids blindly: declare pilot scope, then implement if acceptance demand requires it.
- Separate display horizon from legal operating windows.

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
npm run test:e2e
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] All configured rooms render; no slice(0,3) data loss.
- [ ] Morning hours and configured operating windows render and edit consistently on desktop/mobile.
- [ ] Supported days/grid are explicit and consistent across UI, commands, IR, Python, and SQL; unsupported inputs reject instead of truncate.
- [ ] Tenant name/terminology replaces misleading DWDE presentation defaults while DWDE retains its own branding/data.

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


> HISTORICAL — superseded and INCOMPLETE, not a completed task. Replacement mapping: [TASKS](../TASKS.md).

# T26 — CSV intake

## Task objective

Provide reviewed, repeatable planning-data imports.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T23, T24, T25. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Manual bespoke loading does not establish commercial onboarding.

Deliver only T26, using the current architecture. 

## Explicit non-goals

Do not build deep integrations or accept unvalidated direct table writes.

## Files/subsystems to inspect

- [lib/import-validator.ts](../../lib/import-validator.ts)
- [components/people-view.tsx](../../components/people-view.tsx)
- [components/classes-view.tsx](../../components/classes-view.tsx)
- [lib/planning-inventory-client.ts](../../lib/planning-inventory-client.ts)
- [lib/reviewed-rulebook.ts](../../lib/reviewed-rulebook.ts)
- [tests/import-validator.test.ts](../../tests/import-validator.test.ts)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Use CSV before management-platform integration; preserve DWDE's reviewed importer as an explicitly tenant-specific adapter.
- Define external row keys separately from canonical IDs.

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
npm run test:e2e
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] CSV preview validates required fields, durations, supported day/grid, duplicate identity, qualification and roster references, and tenant ownership.
- [ ] Name resolution/ambiguities are reviewed at intake and committed as stable IDs.
- [ ] Atomic commit rejects the entire invalid batch; retries do not duplicate records.
- [ ] Import provenance and counts are recorded; planning changes invalidate confirmation/candidates; no production import during tests.

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


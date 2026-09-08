> HISTORICAL — completed bounded foundation work. Not current instructions. See [archive index](README.md).

# T01 — Line-ending and test portability

## Task objective

Make the existing quality gate reliable on Windows and Linux without weakening ledger integrity.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../../README_OLD.md), [master plan](../../MASTER_PLAN_OLD.md), [task ledger](../../TASKS_OLD.md), and [operating rules](../../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: none. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

The audit reproduced 15 failures caused by SQL CRLF conversion; normalized isolated SQL passed all 256 tests.

Deliver only T01, using the current architecture. 

## Explicit non-goals

Do not change compiler, scheduling, database behavior, package versions, or ledger history.

## Files/subsystems to inspect

- [tests/production-ledger.test.ts](../../../tests/production-ledger.test.ts)
- [tests/atomic-rulebook-structure-repair.test.ts](../../../tests/atomic-rulebook-structure-repair.test.ts)
- [tests/fluid-planning-inventory.test.ts](../../../tests/fluid-planning-inventory.test.ts)
- [tests/rulebook-v36-governance.test.ts](../../../tests/rulebook-v36-governance.test.ts)
- [tests/schedule-commands-v25.test.ts](../../../tests/schedule-commands-v25.test.ts)
- [supabase/production-ledger/manifest.json](../../../supabase/production-ledger/manifest.json)
- [.github/workflows/ci.yml](../../../.github/workflows/ci.yml)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Test clean-checkout line endings and ledger bytes, not only the existing working directory.
- Use repository attributes (new .gitattributes if needed); normalize textual assertions only where byte identity is not the contract.

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
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] Windows and Linux checkouts pass all existing TypeScript tests.
- [ ] Canonical ledger byte lengths and hashes remain unchanged; no manifest regeneration to accommodate CRLF.
- [ ] Historical migration SQL semantics and application behavior remain unchanged.

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


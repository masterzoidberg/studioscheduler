# T03 — Canonical Constraint Model comparison

## Task objective

Compare equivalent Constraint Model objects independently of JSON object-key order.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T01, T02. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

A pure diagnostic probe showed equivalent models compare unequal after property reordering.

Deliver only T03, using the current architecture. 

## Explicit non-goals

Do not weaken drift detection or change scheduling semantics.

## Files/subsystems to inspect

- [lib/constraint-model-version.ts](../../lib/constraint-model-version.ts)
- [lib/solver-gateway.ts](../../lib/solver-gateway.ts)
- [tests/constraint-model-version.test.ts](../../tests/constraint-model-version.test.ts)
- [tests/solver-gateway.test.ts](../../tests/solver-gateway.test.ts)
- [supabase/migrations/20260902163046_constraint_model_publication_v30.sql](../../supabase/migrations/20260902163046_constraint_model_publication_v30.sql)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Define object canonicalization explicitly; preserve array ordering unless the contract already declares a set.
- Test nested selectors/parameters and model-sync drift detection.

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
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] Recursively reordered object keys compare equal; meaningful parameter and ordered-array differences compare unequal.
- [ ] A real JSONB publication/read-back compares equal to the submitted semantic model.
- [ ] Historical fingerprint compatibility is documented and tested; no silent historical rehash.

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


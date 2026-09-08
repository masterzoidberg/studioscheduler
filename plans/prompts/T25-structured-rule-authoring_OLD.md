> HISTORICAL — superseded and INCOMPLETE, not a completed task. Replacement mapping: [TASKS](../TASKS.md).

# T25 — Generic structured rule authoring

## Task objective

Allow unrelated studios to express supported policy without source edits.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T20, T21, T23. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Current human wording edits cannot safely author executable rule parameters.

Deliver only T25, using the current architecture. 

## Explicit non-goals

Do not implement free-form executable prose, a general DSL, or AI approval authority.

## Files/subsystems to inspect

- [components/rulebook/rulebook-view.tsx](../../components/rulebook/rulebook-view.tsx)
- [lib/domain.ts](../../lib/domain.ts)
- [lib/constraint-ir.ts](../../lib/constraint-ir.ts)
- [lib/constraint-compiler-v3.ts](../../lib/constraint-compiler-v3.ts)
- [lib/copilot-contract.ts](../../lib/copilot-contract.ts)
- [supabase/migrations/20260831160600_v2_2_rule_mutations.sql](../../supabase/migrations/20260831160600_v2_2_rule_mutations.sql)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Implement one template family per bounded session under T25; record child traceability if necessary.
- Human wording remains readable alongside the structured authority.

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
npm run test:parity
npm run test:e2e
```

The DB/parity/e2e scripts are planned interfaces created by T02/T14/T16 respectively. If the selected task owns an interface, implement and run it; otherwise verify its prerequisite has created it. Python commands require an activated disposable environment with solver/requirements.txt. Never treat skipped/unavailable infrastructure as a passing test.

## Acceptance criteria

- [ ] Forms support agreed pilot qualification, availability, room, operating-hours, sequencing, lock-related policy, and preference families.
- [ ] Typed targets/exceptions/strengths preview deterministic meaning and provenance before approval.
- [ ] Unsupported HARD semantics block readiness; edits version policy and invalidate stale candidates appropriately.
- [ ] Studio #2 policies can be authored with no compiler/solver/application changes.

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


> HISTORICAL — superseded and INCOMPLETE, not a completed task. Replacement mapping: [TASKS](../TASKS.md).

# T21 — Convert DWDE policy into tenant records

## Task objective

Retain DWDE's behavior as tenant policy while removing source-code dispatch.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T20. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Compiler, readiness, intake, and SQL contain named people/classes, 178-rule assumptions, and curriculum special cases.

Deliver only T21, using the current architecture. Record and select a bounded child from the split described in TASKS.md before implementation. Parent completion requires all child acceptance.

## Explicit non-goals

Do not remove DWDE, reseed production destructively, or introduce policy-pack inheritance infrastructure.

## Files/subsystems to inspect

- [lib/constraint-compiler.ts](../../lib/constraint-compiler.ts)
- [lib/constraint-compiler-v3.ts](../../lib/constraint-compiler-v3.ts)
- [lib/rule-execution-registry.ts](../../lib/rule-execution-registry.ts)
- [lib/schedule-readiness.ts](../../lib/schedule-readiness.ts)
- [lib/planning-class-structure.ts](../../lib/planning-class-structure.ts)
- [lib/planning-roster-repair.ts](../../lib/planning-roster-repair.ts)
- [lib/required-class-intake.ts](../../lib/required-class-intake.ts)
- [supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql](../../supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql)
- [supabase/migrations/20260904215241_shared_rulebook_roster_compiler_v38.sql](../../supabase/migrations/20260904215241_shared_rulebook_roster_compiler_v38.sql)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Split T21a compiler/registry policy records and T21b readiness/intake/repair requirements.
- Use ordinary tenant records, forward data migrations, and a controlled DWDE adapter; retain historical migration text.

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

- [ ] DWDE people, rules, exceptions, curriculum/enrollment requirements, and historical versions remain intact.
- [ ] Generic compilation and readiness no longer require DWDE Rule IDs, names, fixed count 178, or specific levels/subjects.
- [ ] New tenant records reproduce the golden DWDE semantics and renamed fixture invariance.
- [ ] DWDE intake triggers are tenant-scoped during transition; unrelated classes cannot activate DWDE repair policy.
- [ ] Every actionable leakage item is resolved or explicitly assigned with evidence.

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


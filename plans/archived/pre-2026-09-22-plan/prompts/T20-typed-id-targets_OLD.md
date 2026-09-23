> HISTORICAL — superseded and INCOMPLETE, not a completed task. Replacement mapping: [TASKS](../TASKS.md).

# T20 — Typed ID targets/parameters

## Task objective

Make executable rule targets and parameter contracts stable and tenant-neutral.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T14. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Names, Unicode normalization, and broad JSON parameters currently carry identity and ambiguous semantics.

Deliver only T20, using the current architecture. Record and select a bounded child from the split described in TASKS.md before implementation. Parent completion requires all child acceptance.

## Explicit non-goals

Do not build an enormous DSL, rename every domain table, or add a policy plugin system.

## Files/subsystems to inspect

- [lib/constraint-ir.ts](../../lib/constraint-ir.ts)
- [lib/constraint-data-binding.ts](../../lib/constraint-data-binding.ts)
- [lib/constraint-engine.ts](../../lib/constraint-engine.ts)
- [lib/constraint-engine-v2.ts](../../lib/constraint-engine-v2.ts)
- [lib/delegated-solver-preflight.ts](../../lib/delegated-solver-preflight.ts)
- [solver/dwde_solver/feasibility.py](../../solver/dwde_solver/feasibility.py)
- [lib/domain.ts](../../lib/domain.ts)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Split as T20a target/binding contract, T20b placement/resource families, T20c sequencing/progression/exception families; parent DONE only after all pass.
- Resolve names during reviewed import; keep policy definition independent of mutable dataset contents.
- Use explicit taxonomy codes/relationships; no substring-based progression.

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

- [ ] Typed discriminated parameters cover all supported kinds with explicit unsupported-parameter rejection.
- [ ] teacherIds/studentIds/roomIds/classIds/cohortIds/sessionIds or equivalent typed targets bind uniquely within the pinned tenant dataset.
- [ ] Display-name renames and Unicode/punctuation differences cannot change legality or score.
- [ ] Existing DWDE artifacts remain reproducible through versioned compatibility; missing/archived IDs fail explicitly.
- [ ] Rule kind, selectors, exceptions, runtime, solver, and explanations share serialized parity cases.

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


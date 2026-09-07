# T11 — ASSIGN/UNASSIGN canonical authority

## Task objective

Use the shared canonical authority for incremental schedule construction.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T10. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

Partial editing must remain usable while enforcing the same placement semantics as generation.

Deliver only T11, using the current architecture. 

## Explicit non-goals

Do not introduce a drag-and-drop redesign or universal repair search.

## Files/subsystems to inspect

- [components/workspace-provider.tsx](../../components/workspace-provider.tsx)
- [components/schedule/schedule-builder-panel.tsx](../../components/schedule/schedule-builder-panel.tsx)
- [lib/schedule-command-candidate.ts](../../lib/schedule-command-candidate.ts)
- [lib/constraint-engine-v2.ts](../../lib/constraint-engine-v2.ts)
- [supabase/migrations/20260902122425_schedule_commands_v25.sql](../../supabase/migrations/20260902122425_schedule_commands_v25.sql)
- [tests/schedule-command-candidate.test.ts](../../tests/schedule-command-candidate.test.ts)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Define missing-predecessor/fixed-session findings as completeness obligations where appropriate, not blanket blockers to incremental construction.
- Test legal incremental sequences, disallowed placements, and no-op/retry behavior.

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

- [ ] ASSIGN/UNASSIGN use the server candidate/validation/transaction boundary established by T10.
- [ ] Unknown or duplicate sessions, archived targets, and lock violations reject atomically.
- [ ] Partial schedules can be built and remain visibly incomplete; final completeness is evaluated separately.
- [ ] No new placement violation can be hidden by removing another assignment or comparing only aggregate counts.

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


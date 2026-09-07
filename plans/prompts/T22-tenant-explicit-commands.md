# T22 — Tenant-explicit database commands

## Task objective

Authorize and mutate the explicitly selected tenant in every command.

## Repository context

Work in `G:\Projects\studio-scheduler`. Read [planning guide](../README.md), [master plan](../MASTER_PLAN.md), [task ledger](../TASKS.md), and [operating rules](../CODEX_EXECUTION_RULES.md). The audit baseline is `17b3a60`; inspect current HEAD, working-tree changes, applicable instructions, actual implementations, and dependency evidence before editing. Do not blindly assume this prompt remains current.

Task prerequisites: T02, T13, T16. If any prerequisite lacks verified DONE evidence, record the issue and do not bypass it. TASKS.md is the status authority; prompts are scope/acceptance references.

## Exact scope

First-membership actor selection risks wrong-workspace writes for users with multiple memberships.

Deliver only T22, using the current architecture. Record and select a bounded child from the split described in TASKS.md before implementation. Parent completion requires all child acceptance.

## Explicit non-goals

Do not rebuild authentication or infer authorization from user-editable metadata.

## Files/subsystems to inspect

- [supabase/production-ledger/20260831123403_v2_1_governed_infrastructure.sql](../../supabase/production-ledger/20260831123403_v2_1_governed_infrastructure.sql)
- [supabase/production-ledger/20260831123611_v2_1_entity_membership_mutations.sql](../../supabase/production-ledger/20260831123611_v2_1_entity_membership_mutations.sql)
- [components/workspace-provider.tsx](../../components/workspace-provider.tsx)
- [app/api/solver/adopt/route.ts](../../app/api/solver/adopt/route.ts)
- [app/api/copilot/route.ts](../../app/api/copilot/route.ts)
- [supabase/functions/user-openrouter/index.ts](../../supabase/functions/user-openrouter/index.ts)

Inspect successor routes/functions introduced by earlier tasks too. Historical SQL files above are read-only evidence; create forward migrations for changed database behavior.

## Implementation requirements

- Split T22a scheduling/planning, T22b policy/artifacts, T22c membership/AI and privilege audit.
- Add same-studio checks and composite relational constraints where practical; preserve existing IDs.

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

- [ ] Every active public command accepts/derives an explicit request tenant and authorizes that exact membership inside its transaction.
- [ ] Two memberships with different roles never route a write to the first/stronger membership.
- [ ] Cross-tenant IDs/references, candidate access, policy/planning/version/audit reads and writes reject.
- [ ] New identifiers are globally opaque; tenant-local Rule display codes can repeat without identity collision.
- [ ] Old ambiguous RPCs are revoked or safe wrappers; role revocation races and last-owner behavior are tested.

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


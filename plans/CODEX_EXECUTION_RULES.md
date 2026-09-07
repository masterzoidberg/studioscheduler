# Codex Execution Rules

Read [README](README.md), [MASTER_PLAN](MASTER_PLAN.md), and [TASKS](TASKS.md) at the start. These instructions govern plan execution within the user's authorized scope.

1. Inspect current HEAD, applicable instructions, working tree, relevant code, and dependency evidence before editing.
2. One primary task or bounded child per execution session unless tightly coupled correctness work demands otherwise.
3. Do not silently widen scope. Record evidence and task linkage for necessary adjacent changes.
4. Never edit historical production migrations or ledger fingerprints.
5. Add forward migrations; inspect existing grants and callers before changing a function.
6. Never connect to production for tests; fail rather than fall back to a production endpoint.
7. Use disposable database environments and synthetic/deidentified fixtures.
8. Never weaken correctness tests merely to pass. Byte-integrity tests remain byte-integrity tests.
9. Keep TypeScript runtime and Python solver semantics aligned through shared serialized fixtures.
10. Any new Constraint IR kind requires typed parameters, compiler support, runtime support, solver support (or explicit proven delegation), tests, and explanation provenance.
11. No DWDE-specific branching in reusable kernel code. Track temporary legacy adapter guard behavior for T21 extraction.
12. Tenant ID must be explicit at authorization boundaries; check the exact membership transactionally.
13. AI never decides legality or applies authoritative policy.
14. Solver adoption requires the reviewed pinned studio/Rulebook/planning/model/base-schedule/lock context.
15. Update TASKS status/evidence and derived README/NEXT pointers after each accepted task. Update related acceptance/leakage/decision files where affected.
16. Record discovered blockers with evidence, impact, owner/action, and unblock criterion; do not work around them invisibly.
17. Prefer deleting superseded paths after safe cutover and privilege verification.
18. Avoid architecture expansion without demonstrated need.
19. Preserve unrelated user changes. Do not clean caches, rewrite configs, or refactor unrelated files as a side effect.
20. No task is DONE without criterion-level evidence. Failed, skipped, or unavailable checks are reported explicitly.
21. Keep draft placement legality separate from finalized completeness; do not “repair” a schedule by hiding missing required sessions.
22. Do not deploy, provision paid services, contact others, or create automations merely because a future roadmap mentions them.
23. L-sized tasks must be sliced under their parent ID before implementation; preserve the T01–T29 execution spine.
24. Never claim data completeness, authenticated usability, production recovery, or customer adoption from a unit test alone.

## Completion record template

```text
Task/child:
Starting HEAD:
Implemented files:
Acceptance criterion → test/artifact:
Commands and exit codes:
Environment (confirm nonproduction):
Commit/reference (or uncommitted):
Risks/limitations:
Decision deviations:
New blockers and unblock condition:
Resulting task status:
Newly READY tasks:
Updated plan files:
```

## Blocker record template

```text
BLK-NNN:
Observed:
Task/criteria affected:
Evidence:
Impact:
Owner / next action:
Unblock condition:
Resolution evidence (when resolved):
```

TASKS.md holds records; README links cross-task blockers. DECISIONS records changes to scope or architecture, not every implementation detail.


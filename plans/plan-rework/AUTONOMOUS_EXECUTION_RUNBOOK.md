# Autonomous execution runbook

## Run contract

An autonomous run is a coherent milestone-sized group, not a license to broaden scope. Read repository instructions, canonical plan/decisions, the selected run prompt, and each contained task prompt. Inspect branch, exact HEAD, origin, worktrees, status, active tasks, and relevant code before changes.

For each contained task:

1. Confirm dependencies and file ownership.
2. Add/adjust the smallest regression that demonstrates the required behavior.
3. Implement the bounded task without unrelated cleanup.
4. Run Level 1 focused verification.
5. Create one bounded commit for that task. Corrective commits remain attributed to the same task and are squashed only if explicitly authorized.
6. Continue automatically to the next authorized dependency-satisfied task while checks are green.

At the run checkpoint, integrate lane heads, run the specified Level 2 or 3 checks, record exact start/final heads, commits, commands, exit codes, artifacts, failures, limitations, and environment. Update `TASKS.md` and derived `README.md`/`NEXT.md` atomically in one planning checkpoint commit. Do not update the ledger independently in parallel lanes.

## Optimized sequence and commit boundaries

| Run | Contained work | Commit boundaries | Checkpoint verification |
|---|---|---|---|
| R0 | POL-02 evidence reconciliation; plan adoption | No product commit unless a demonstrated defect gets a new bounded ID; one planning adoption commit | Required POL-02 focused/parity/Python/DB/build evidence and repository CI; planning integrity |
| R1 | POL-04 corrective SQL safeguard closure | One commit for the bounded corrective task | Forward migration, executed typed DB rejection/no-write regression, planning integrity |
| R2 | SET-03, SET-04, SET-05 | One commit per ID | Focused UI/DB per task; integrated DB, parity, e2e, typecheck |
| R3 | POL-03, SET-06 | One commit per ID | Focused fixtures/Python/DB; integrated parity, e2e, unit |
| R4 | UX-01, UX-02 | One commit per ID | Focused UI/API tests; integrated authenticated workflow and unit/build |
| R5 | SET-07, LOCK-01, UX-03 | One commit per ID | Full isolated setup-to-export journey; Level 3 suite |
| R6 | OPS-01 disposable engineering portion; RC checkpoint | One implementation/docs commit; one checkpoint record | Restore/config rehearsal, Level 3 suite, named export/restore artifacts |
| R7 | GEN-01, GEN-02 | One commit per ID or bounded semantic-family child under same ID | Per-family parity; full DB/parity/Python at integration |
| R8 | GEN-03, GEN-04; conditional IMPORT-01 | One commit per accepted ID | Two-tenant role matrix, onboarding e2e, DB, parity, full milestone |
| R9 | Conditional OPT-01, OPT-02, CAND-01 | One commit per accepted ID | Independent scores, timeout/incumbent, stale candidate, full semantic/e2e checkpoint |
| R10 | OPS-02/03 engineering portions | One commit per ID | Role/privacy deletion rehearsal, redaction, outage/help flow, restore drill |
| R11 | CYCLE-01 | One commit | Cycle/history DB and browser journey; full milestone |

ACC-01, GEN-05, PILOT-01, deployed OPS evidence, and V1-01 are qualification runs. They freeze a head and collect named evidence. They do not absorb fixes; a failure creates a bounded defect task and invalidates only affected qualification evidence.

## Safe parallelization

- Parallelize only after contracts and base HEAD are frozen and worktrees/branches are explicit.
- Assign file ownership. No two lanes edit central constraint files, migrations, `package.json`, shared test runners, `workspace-provider.tsx`, root schedule components, or canonical planning ledgers concurrently.
- A single integration owner orders migrations, resolves shared fixtures, runs lane verification, and updates the ledger.
- Never parallelize dependent security-sensitive migration/protocol steps: typed replacement accounting, grants/RLS, certification, lock transition, tenant command cutover.
- Stop a lane at the agreed synchronization point; rebase/merge only through the integration owner and without history rewriting.

## Automatic continuation

Continue without asking when the next task is named in the selected run, dependencies are satisfied, ownership is clear, no unrelated tracked changes overlap, and focused verification is green. Do not stop merely for a session boundary, an already-resolved design, or unavailable later human evidence.

If a lane completes early, it may take another task only if that task is already authorized in the same run and has disjoint ownership. Otherwise wait for integration; do not widen the run.

## Mandatory stop conditions

Stop and record concrete evidence for:

- unresolved acceptance/test failure after focused diagnosis;
- ambiguous product meaning or data contract not resolved by `DECISIONS.md`;
- overlapping unrelated tracked changes or uncertain ownership;
- destructive action or historical-byte rewrite;
- new dependency, service, environment variable, or architectural expansion;
- paid execution or external-provider commitment;
- production/trial access, deployment, merge, or release authorization;
- physical-device, sign-in/wake, private-data, or human evaluation evidence;
- required external/commercial/legal input;
- insufficient context to continue safely;
- branch divergence that cannot be fast-forwarded safely.

Retain the first failed full-suite result. Diagnose with focused tests; repeat the full suite only after the focused cause is fixed. Never alter assertions, semantics, or acceptance thresholds merely to proceed.

## Reusable autonomous-run prompt

```text
Execute <RUN_ID> from the adopted Studio Scheduler plan at <START_HEAD> on <BRANCH>.

Authority: AGENTS.md; plans/README.md; plans/TASKS.md; plans/MASTER_PLAN.md;
plans/DECISIONS.md; plans/NEXT.md; the selected run prompt and contained task prompts.

Contained task IDs: <IDS>. Complete them in dependency order, one bounded commit per task,
with focused verification after each. Continue automatically while dependencies, ownership,
and checks are green. Use only the assigned file ownership; the integration owner alone edits
shared central files and canonical planning ledgers.

At the run checkpoint run <LEVEL_2_OR_3_COMMANDS>. Preserve the first failed full run, diagnose
with focused tests before repeating it, and do not weaken tests. Record start/final heads,
commits, commands, exit codes, artifacts, limitations, and pending external evidence.

Stop only for a mandatory runbook condition. Do not deploy, access production/private data,
commit paid services, merge, or contact people without explicit authorization. At successful
checkpoint update TASKS and derived README/NEXT atomically and select exactly one next run.
```

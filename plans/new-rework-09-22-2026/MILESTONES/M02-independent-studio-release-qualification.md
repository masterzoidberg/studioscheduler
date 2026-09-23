# M02 — Independent studio and release qualification

**Status:** BLOCKED ON EXTERNAL EVIDENCE. **Objective:** A frozen build is observed operating safely in an authorized environment for the first studio and a distinct independent studio. This milestone closes the prior A/B outcome gates without interpreting local test success as customer acceptance.

## Scope

Complete the external portions of archived `OPS-01`, `ACC-01`, and `GEN-05`, including [S201–S218](../../archived/pre-2026-09-22-plan/STUDIO_2_ACCEPTANCE.md). Record private artifact references, observed assistance and frozen implementation SHA. Failures create bounded corrective tasks in the relevant milestone and require a new qualification baseline where affected.

## Out of scope

Fabricated participation, public identifiable manager/student data, unauthorized deployment, production tests, source patches during a frozen acceptance run, pilot commercial commitments, next-cycle features.

## Current evidence

**Verified:** M01 account/privacy, operations, setup assignment, full local DB/browser/unit/build and disposable OPS-01 config/restore gates passed at the uncommitted snapshot recorded in the [M01 completion record](M01-supported-operations-engineering.md). The latest `npm run ops:check-config` on this workspace exited 1 and reported all seven deployment variables missing without printing secret values. The accepted M01 implementation remains uncommitted, so current `HEAD` does not identify a frozen release. Setup/import/solver/edit/export paths and generic tenancy are implemented; prior accepted GEN-04/IMPORT-01 and OPT/CAND records are in the [archive ledger](../../archived/pre-2026-09-22-plan/TASKS.md). **Unknown:** current deployed migration/config/restore state, complete DWDE manager outcome, independent second-studio outcome. **Blocked:** `EXT-RELEASE`, `BLK-DWDE`, `EXT-STUDIO2` have no authorized artifacts in repository context. M01 local test success is not a frozen release or manager acceptance.

## Work required

| ID / status | Goal and relevant systems | Dependencies | Acceptance criteria | Validation |
|---|---|---|---|---|
| **M02-T01 — blocked: EXT-RELEASE** | Complete authorized staging/deployed release gate from [OPS checklist](../../archived/pre-2026-09-22-plan/OPS-01_RELEASE_CHECKLIST.md): app/solver versions, migration head, auth/health/invalid-token/timeout, backup/restore and write-isolation rollback. | M01 engineering; owner-authorized environment. | Exact deployed version/config and restore evidence; rollback/read-only procedure exercised; no secrets in artifacts. | Checklist commands and observations, disposable restore, exact SHA, authorized environment references. |
| **M02-T02 — blocked: BLK-DWDE** | Actual DWDE manager runs setup, review/certification, solve, edit/lock/recover and final print/CSV. See archived `prompts/ACC-01.md`; app setup/schedule and solver. | M02-T01; manager-controlled complete private facts. | Complete week validates every required session/roster/qualification/lock; failure/stale paths understood; accepted usable output and measured assistance; no high-severity safety defect. | Private artifact references, independent parity/legality check, authenticated browser observation, exact frozen SHA and commands. |
| **M02-T03 — blocked: EXT-STUDIO2** | Independent studio/manager uses normal creation/selection/setup/import/solve/review flows with different rooms, hours, curriculum and IDs. See archived `prompts/GEN-05.md`. | M01 and M02-T01; authorized distinct studio/manager. | All S201–S218 have evidence; rename metamorphic case and independently feasible/impossible cases agree; no DWDE-specific source edit; assistance recorded. | Frozen-SHA private checklist/artifacts, full lint/typecheck/unit/build/disposable DB/parity/e2e, exact outcomes and limitations. |

## Completion gate

All three qualification tasks pass at compatible frozen SHA(s), with explicit artifact references and no critical/high unresolved data-loss, tenant-isolation or HARD-legality defect. Record actual environment and manager observations separately from repository tests. If authorized input is absent, leave this milestone blocked and retain existing implementation evidence; do not call it complete.

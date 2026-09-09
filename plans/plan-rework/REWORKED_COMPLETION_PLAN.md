# Reworked completion plan

## A. Current plan assessment

The existing plan is safety-conscious and preserves the correct four authorities, but delivery is slowed by a mostly serial 27-task queue, repeated full-suite commands in nearly every prompt, and engineering mixed with human/deployment/commercial qualification. Several dependencies express narrative order rather than technical prerequisites. The result is a long critical path from SET-03 through UX-03 even where setup slices and schedule UX can be developed independently.

`TASKS.md` is the canonical status authority. At R0 start, audited HEAD `7f5c128` still said POL-02 was READY. The Git history after accepted SET-02 contains 27 POL-02 implementation/test commits and about 3,000 changed lines. R0 reconciled that implementation evidence against the prompt: typed application/runtime/compiler/solver/parity criteria pass, but the effective SQL safeguard criterion is a demonstrated gap. POL-02 remains **PENDING/BLOCKED** and POL-04 is the single bounded corrective task selected by R1.

Primary recommendation: retain IDs, architectural decisions, acceptance strength, and completion history, but execute the remaining work as outcome-sized autonomous runs with narrow commit boundaries and milestone test checkpoints. This fits the repository because its immutable/versioned boundaries reward focused vertical slices, while its shared compiler, migration chain, workspace provider, and schedule UI make unconstrained parallel task execution risky.

Alternatives are less efficient here: preserving one session per task repeats setup and full suites; merging all work into a few giant tasks destroys evidence and rollback boundaries; broad parallelism would create conflicts in central files and unsafe migration ordering; cutting correctness/acceptance would produce a demo rather than a trustworthy scheduler.

## Release definitions

1. **Useful DWDE engineering release (first usable release):** manager can configure the supported weekly inputs, review/certify them, generate, adopt, edit, lock, recover, and export a complete schedule in disposable/isolated verification. This is engineering completion, not production or manager acceptance.
2. **DWDE operational qualification:** the engineering release plus authorized environment/restore evidence and actual manager/private-data acceptance. These are CHECKPOINT/EXTERNAL_GATE outcomes.
3. **Independent-studio expansion:** stable tenant policy, explicit tenancy, empty-workspace onboarding, and efficient intake, followed by independent second-studio qualification.
4. **Supported-product expansion:** deterministic optimization/candidate review, privacy/role lifecycle, operations/help, cycle support, then external pilot and v1 qualification.

## Classification and disposition

| Work | Classification | Disposition |
|---|---|---|
| T01–T13, SAFE-01, SAFE-02, VERIFY-01, SET-01, POL-01, SET-02 | HISTORICAL/SUPERSEDED | Preserve DONE records and archives; never execute again. New defects get new IDs. |
| POL-02 | CORE, PENDING/BLOCKED | Preserve the passing typed evidence; accept only after POL-04 closes SQL safeguard parity and executed no-write coverage. |
| POL-04 | CORE, R1 SELECTED CORRECTIVE | Add the smallest forward SQL safeguard and disposable transaction/no-write evidence demonstrated as missing by R0. |
| SET-03, SET-04, SET-05 | CORE | Independent setup vertical slices after POL-02 contract is accepted; remove artificial SET-03→04→05 chain. |
| POL-03 then SET-06 | CORE | Keep policy semantics before its manager UI; sequential security/semantic lane. |
| SET-07 | CORE | Integration gate depending on all required setup/review slices, not on UX work. |
| UX-01, UX-02 | CORE | May start from accepted harness/contracts; UX-02 does not technically require UX-01. Integrate after readiness. |
| LOCK-01 | CORE | Sequential after UX-02 because it changes shared schedule/context UI and an atomic command. |
| UX-03 | CORE | Depends on current setup horizon and schedule review, not on LOCK-01 except for final journey integration. |
| OPS-01 engineering rehearsal | CHECKPOINT | Split from external environment evidence; disposable restore/config/runbook work may proceed independently. |
| OPS-01 deployed evidence, ACC-01 | EXTERNAL_GATE | Never counted as unfinished engineering. A failure opens a bounded defect task. |
| GEN-01, GEN-02, GEN-03, GEN-04 | ASSISTED/EXPANSION | Required for independent multi-studio product, not first useful DWDE release. Keep semantic/migration order; tenant audit can begin earlier after contract freeze. |
| IMPORT-01 | ENHANCEMENT for DWDE; ASSISTED for second studio | Do not block first release. For second-studio qualification, require only if measured setup effort needs it. |
| GEN-05 | EXTERNAL_GATE | Independent participant/data qualification, not feature work. |
| OPT-01, OPT-02 | ENHANCEMENT until measured usability requires them; then CORE defect-response | Keep off first critical path. Promote only if ACC-01 shows first-feasible plus bounded manual finish is unusable. |
| CAND-01 | ENHANCEMENT | Durable comparison is useful, not required for first usable or second-studio feasibility release. |
| OPS-02, OPS-03 engineering portions | ASSISTED/EXPANSION | Required before supported external operation; split legal/owner/provider facts into gates. |
| PILOT-01 | EXTERNAL_GATE | Commercial/human evidence only; defects become separate tasks. |
| CYCLE-01 | ASSISTED/EXPANSION | Required for full intended v1, not first release. |
| V1-01 | CHECKPOINT + EXTERNAL_GATE | Named release qualification, never open-ended implementation. |
| Conversational AI, integrations, custom calendars/grids, public sharing | OPTIONAL | Separate product decision; no critical-path task. |
| T14–T29 `_OLD`, old roadmaps, ZIP | HISTORICAL/SUPERSEDED | Preserve as evidence; never execute. |

## B. Redundant, unnecessary, optional, or misclassified work

- POL-02 is likely implemented and awaiting reconciliation; repeating it would be waste.
- ACC-01, GEN-05, PILOT-01, and much of V1-01 are qualifications, not feature phases.
- OPS-01 currently combines executable rehearsal with unauthorized deployed-environment proof; split the checkpoint from the gate.
- OPT-01/02 and CAND-01 are not prerequisites for a safe first release unless measured acceptance demonstrates unusable output.
- IMPORT-01 should not block second-studio engineering; it becomes required only for the chosen acceptance workload or an explicit product requirement.
- SET-03/04/05 are separate user outcomes but do not genuinely depend on one another. Their shared prerequisites are accepted typed policy and Setup shell.
- UX-01 and UX-02 share a journey, not a strict code dependency. They can be developed in separate ownership lanes after shared response/state contracts are frozen.
- UX-03 does not technically require lock implementation; only the final end-to-end checkpoint requires both.
- Repeating lint, typecheck, all unit tests, build, DB, parity, and e2e after every small task is excessive. Focused checks belong per commit; broad checks belong at lane/milestone checkpoints.

## C. Dependency changes

Proposed acyclic edges (`A -> B` means B needs A):

```text
R0 reconcile POL-02
  -> POL-04 corrective SQL safeguard
POL-04 -> POL-02 acceptance
POL-02 -> {SET-03, SET-04, SET-05, POL-03, UX-01, UX-02, OPS-01 rehearsal}
POL-03 -> SET-06
{SET-03, SET-04, SET-05, SET-06} -> SET-07
UX-02 -> LOCK-01
{SET-03, UX-02} -> UX-03
{SET-07, UX-01, UX-02, LOCK-01, UX-03} -> CORE-INTEGRATION
{CORE-INTEGRATION, OPS-01 rehearsal} -> ENGINEERING-RC
ENGINEERING-RC -> {ACC-01 gate, GEN-01}
GEN-01 -> GEN-02 -> GEN-03 -> GEN-04
GEN-04 -> GEN-05 gate
{SET-07, UX-02} -> OPT-01 -> OPT-02 -> CAND-01
{GEN-04, OPS-01 rehearsal} -> OPS-02 -> OPS-03
{GEN-05 gate, OPS-03, optional CAND-01 if adopted} -> PILOT-01 gate
PILOT-01 gate -> CYCLE-01 -> V1-01 qualification
```

Removed dependencies are narrative rather than technical: SET-04 no longer waits for room UI; SET-05 no longer waits for teacher UI; POL-03 can use stable fixtures before class UI completion; UX-02 no longer waits for generation-copy work; UX-03 no longer waits for lock UI; GEN engineering does not wait for private DWDE acceptance. Release promotion still requires the relevant integration and external gates.

## D. Revised critical path

`POL-02 reconciliation → parallel setup/policy and schedule-workflow lanes → SET-07 readiness integration → core end-to-end integration → engineering release candidate.`

The first useful release excludes optimization, durable candidate comparison, generalized tenancy/onboarding, CSV, external manager evidence, deployment, pilot, and next-cycle work. Those are valuable later outcomes but must not delay proving the full DWDE workflow in an isolated environment.

## E. Parallel lanes and conflict controls

| Lane | Work | Safe ownership | Synchronization |
|---|---|---|---|
| P — policy/setup | POL-03, SET-03–06 | One integration owner for `lib/constraint-*`, typed policy, migrations, `package.json`, shared DB/parity fixtures | Freeze typed payloads after R0; migrations merge strictly in timestamp/ledger order; SET-07 only after all slice heads integrate. |
| S — schedule experience | UX-01, UX-02, then LOCK-01/UX-03 | One owner for `workspace-provider`, schedule components, solver/adopt routes, e2e harness | Freeze API error/candidate state contract first; serialize edits to shared schedule components. |
| O — operations evidence | OPS-01 disposable rehearsal/docs | Own new rehearsal artifacts and ops docs; no production access | Integrate after application/migration head is frozen for RC. |
| G — generic expansion | GEN-01/02 semantic lane; GEN-03 tenancy audit can inspect in parallel | GEN-01/02 own compiler/IR; GEN-03 later owns tenant provider/routes/RLS | Merge semantic migrations before tenant onboarding; single integration owner resolves central-file edits. |

Do not parallel-edit `TASKS.md`, `NEXT.md`, `package.json`, shared migration runners, `workspace-provider.tsx`, central constraint files, or schedule root components. The run integration owner updates these after lane commits land. Security-sensitive migrations, grants, policy replacement, certification, lock protocols, and tenant command changes remain sequential.

## F. Autonomous run sequence

1. **R0 — Reconcile POL-02 and adopt the rework (COMPLETE CHECKPOINT).** Compare `9de8d07^..7f5c128` with every POL-02 criterion; preserve the first failed full run, record CI/local evidence, and open only the demonstrated POL-04 corrective.
2. **R1 — Close POL-02 SQL safeguard parity (SELECTED).** POL-04 adds the forward migration and executed disposable transaction/no-write evidence; POL-02 is accepted only after every original criterion passes.
3. **R2 — Core setup inputs.** SET-03, SET-04, SET-05 as bounded commits; parallel only with disjoint UI/client files and a single policy/migration integrator. Focused checks after each; lane DB/parity/e2e once after integration.
4. **R3 — Relationship policy and setup.** POL-03 then SET-06, one commit per ID. Full semantic parity and DB integration at lane end.
5. **R4 — Generation/editing foundation.** UX-01 and UX-02, potentially parallel after shared contract freeze; integrate authenticated flows once.
6. **R5 — Certification and schedule completion.** SET-07, LOCK-01, UX-03 in that dependency order. Run the complete isolated setup→generate→adopt→edit→lock→recover→export journey.
7. **R6 — Engineering release checkpoint.** OPS-01 disposable rehearsal plus full milestone suites and named artifacts. Produce an engineering RC; do not deploy or claim manager acceptance.
8. **Q-A — DWDE operational qualification.** ACC-01 and deployed OPS evidence only when authorized inputs/environment exist. Failures open defects and return to the narrowest affected run.
9. **R7 — Independent-studio kernel.** GEN-01 then GEN-02; semantic-family commits and parity checkpoints.
10. **R8 — Explicit tenancy and onboarding.** GEN-03 then GEN-04. IMPORT-01 only if adopted/required by measured intake needs.
11. **Q-B — Second-studio qualification.** GEN-05 against frozen SHA; external evidence only.
12. **R9 — Quality enhancements.** OPT-01, OPT-02, CAND-01 when accepted, or earlier only from a recorded usability failure.
13. **R10 — Supported operations.** OPS-02 and OPS-03 engineering portions; separate owner/legal/provider gates.
14. **Q-C / R11 / Q-D.** PILOT-01 gate; CYCLE-01 implementation; V1-01 named qualification.

## G. Verification strategy

- **Level 1 — focused per task/commit:** changed unit tests plus relevant typecheck/lint targets; migration tasks execute their focused disposable transaction harness; IR/solver tasks run changed parity fixtures and focused Python tests; UI tasks run the changed authenticated journey.
- **Level 2 — lane integration:** full unit/typecheck for each lane; DB replay for migration lanes; parity/Python suite for semantic lanes; combined e2e for UI lanes.
- **Level 3 — milestone:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:db`, `npm run test:parity`, pinned full Python pytest, and `npm run test:e2e` at R4/R5, generic-kernel integration, and release candidates.
- **Level 4 — qualification:** frozen SHA/config/version manifest plus named print/CSV, restore, private manager, second-studio, pilot, or cycle artifacts only where applicable.

Expected reduction: replace six-to-eight broad commands per task with focused checks per commit, one broad lane check per 2–4 tasks, and one full milestone run. A failed full run is stored once; diagnose and rerun focused failures before repeating the full suite. Never weaken tests or acceptance.

## Acceptance checkpoints, risks, and controls

| Risk | Control / checkpoint |
|---|---|
| POL-02 status is stale | R0 criterion-by-criterion reconciliation; no inferred completion. |
| Parallel semantic drift | Freeze schemas/fixtures; one integration owner; shared parity before merge. |
| Migration/grant race | Sequential forward migrations and executed no-write/RLS tests. |
| UI says success while canonical write fails | Authenticated e2e asserts persisted state and rejection witnesses. |
| External evidence blocks engineering | Separate gates; continue only on independent authorized runs. |
| First-feasible schedule is unusable | ACC-01 measures it; promote OPT-01/02 only on recorded failure. |
| Planning authorities diverge | Atomic ledger adoption; link/integrity validator; one NEXT. |

Progress is measured by outcomes: supported setup slices reviewable; complete certification; generated candidate independently valid; authoritative edit/lock/recovery journey; reconciled export; disposable restore; independent tenant onboarding; qualified external use. Raw task percentage is not a release metric, and OPTIONAL/EXTERNAL_GATE work is excluded from engineering-completion counts.

## J. Remaining decisions and external gates

No architectural decision is needed to begin R0. Adoption of this proposal is required before it replaces current authority. Later decisions: whether measured intake requires IMPORT-01; whether actual DWDE output requires early optimization; whether CAND-01 is required for the chosen pilot; external manager/data/environment access; retention/support targets; deployment/merge/commercial authorization. None is assumed.

## K. Exact next autonomous run

**R1 — POL-04 SQL safeguard parity and no-write closure.** Start from implementation base `7f5c1287ec838cb6e8cc2e9efc395b13c6e426da` plus the planning-only R0 adoption commit recorded in the canonical ledger. Do not reimplement POL-02. Add only the demonstrated forward SQL safeguard and disposable transaction/no-write evidence, preserve the first failed full-suite result, and stop on the runbook conditions. `TASKS.md` is the sole status/dependency ledger and `NEXT.md` is the sole selected-run view.

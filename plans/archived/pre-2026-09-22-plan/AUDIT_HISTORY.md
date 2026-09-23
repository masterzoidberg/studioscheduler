# Planning history and instruction audit

Audit date: 2026-09-07. Evidence baseline: `9120439` on `feat/pre-cami-hardening`. This is an evidence appendix, not an execution queue. Follow README and NEXT for current work.

## Evidence standard

The old ledger's accepted completion records, implementation commits, current source, regression suites, and disposable database harness support retaining T01–T13 as completed foundation work. This audit independently inspected those artifacts; it did **not** independently rerun their historical GitHub Actions runs. CI run numbers below are recorded historical claims until verified through GitHub. Tests present in source establish coverage intent, not runtime success. Current audit command results belong in the current audit report, separately from these records.

No complete manager-reviewed private DWDE dataset, authenticated manager acceptance recording, operational recovery drill, or second-studio acceptance evidence was established by this history inspection. Their absence from public Git is not proof that private evidence does not exist; acceptance requires obtaining it from its owner.

## Instruction map and material conflicts

Repository-wide tracked and hidden-file inspection found no AGENTS.md, nested AGENTS.md, CLAUDE.md, local SKILL.md, or `.codex` directory at the baseline. `.devcontainer/devcontainer.json` describes environment setup. `.github/workflows/ci.yml` and `solver-ci.yml` are executable verification configuration, not product acceptance.

| Source | Finding | Resolution |
|---|---|---|
| User audit request | Explicitly authorizes planning replacement, `_OLD` preservation, completed-prompt archiving; prohibits implementing planned features | Controls this audit |
| plans/CODEX_EXECUTION_RULES.md | Rule 23 requires preservation of T01–T29; rule 2 defaults to one task per session | Replace obsolete spine requirement; permit coherent bounded authorized work without arbitrary session limits |
| plans/TASKS.md | T01–T13 DONE, T14 BLOCKED; historical baseline still `17b3a60`; T01–T05 records say uncommitted despite subsequent commit | Preserve accepted evidence in historical file; use current baseline in replacement |
| plans/NEXT.md | Contains T09 READY and T10 NOT_STARTED alongside appended T13 completion | Replace wholesale; one next task only |
| plans/README.md | Correct T13 handoff but treats manager data as a stop for the execution spine | Split external acceptance gate from independently executable setup/parity/diagnostics work |
| Root README.md | Says solver is future, IR is diagnostic, legacy mutation remains canonical | Correct current architecture summary and link to canonical plan; preserve useful authority explanations |
| plans/ARCHITECTURE_CUTOVER.md | Current-state table names v25/v33 as canonical manual/adoption gates | Preserve `_OLD`; completed cutover facts belong in current architecture decisions |
| plans/DWDE_LEAKAGE_REGISTER.md | L23 still describes fixed-workspace adoption and assigns T13 work NOT_STARTED | Retain distinct inventory purpose, revalidate rows and replace old task/status references |
| docs/architecture, docs/baselines, docs/releases | Dated decisions and releases | Retain historical context; never promote historical status over current code |
| plans/plans.zip | Duplicate old planning package | Preserve as historical packaged source; do not treat as a second active plan |

Stable AGENTS.md would reduce recurrence: link to plans/README and NEXT; protect historical migrations, tenant isolation, deterministic authority, private acceptance data, and user work; require evidence; keep task IDs/status out of stable instructions.

## Individual old-task disposition

| Old task | Evidence / actual state | Disposition in rebuilt roadmap |
|---|---|---|
| T01 line endings | `.gitattributes`, ledger tests and OS CI matrix; incorporated by `879c7ec` | Retain DONE; archive prompt |
| T02 disposable DB | `scripts/test-db.mjs`, database-harness tests, testing documentation, npm script; `879c7ec` | Retain DONE; archive prompt; maintain harness |
| T03 model comparison | `canonicalConstraintModelJson` recursively sorts object keys, preserves arrays; JSONB roundtrip in DB harness; `879c7ec` | Retain DONE; archive prompt |
| T04 intervals | V41 migration, solver gateway and DB interval assertions; `879c7ec` | Retain DONE; archive prompt |
| T05 unsupported policy | Compiler/gateway policy coverage guard and tests; `879c7ec` | Retain DONE for bounded DWDE guard, not arbitrary rule support; archive prompt |
| T06 archive adoption | V42, inventory lifecycle/DB assertions; implementation `cd1b95f`, accepted `ac22a8e`; recorded CI `34083389232` | Retain DONE; archive prompt |
| T07 coherent snapshots | V43, coherent-solver-snapshot tests, immutable snapshot gateway; accepted `bcdfa92`; recorded CI `34085179827` | Retain DONE; archive prompt |
| T08 stale binding | V44, candidate-stale-binding/context tests; accepted `ccd5186`; recorded CI `34086356692` | Retain DONE; archive prompt |
| T09 session locks | V45, shared `session-lock-semantics.json`, TS/Python tests; implementation `d4ca679`, accepted `bcc03e3`; recorded CI `34088739598` | Retain DONE; archive prompt; broaden parity independently of real data |
| T10 MOVE authority | V46, manual-move command/route/migration tests and executed-harness cases; implementation `a78bca1`, accepted `9aea0ee` | Retain DONE; archive prompt; browser usability remains unproven |
| T11 ASSIGN/UNASSIGN | V47, incremental tests/harness; implementation `af8f99e`, accepted `3235a4f` | Retain DONE; archive prompt |
| T12 recovery | V48, schedule-recovery and route tests/harness; implementation `53ac7f3`, accepted `3efe138`; recorded CI `34148258020` | Retain DONE; archive prompt; operational restore drill is separate |
| T13 bypass closure | V49 revocations/service publication/adoption; `legacy-write-bypass-closure.test.ts`, harness direct-call denials; implementation `e608455`, accepted `9120439`; recorded CI `34154652798` | Retain DONE; archive prompt; do not reopen retired RPC grants |
| T14 full DWDE acceptance | No manager-confirmed complete input established; parity npm command absent | Split into immediately executable parity/acceptance harness and later private manager acceptance; setup work creates the path to data confirmation |
| T15 solve diagnostics | Existing feasibility service is not proof of bounded, understandable complete failure UX | Bring forward independently of manager fixture; synthetic infeasible/timeout cases suffice for development |
| T16 manager workflow/export/mobile | Existing schedule UI/recovery does not establish full manager journey | Split navigation/setup, schedule review/export/mobile, authenticated verification, and operational configuration/recovery |
| T17 preference scoring | Future ledger task; feasibility is not objective scoring | Retain deterministic score definitions; pair with bounded optimization implementation after correctness parity |
| T18 soft optimization | Future ledger task | Retain; require independent rescoring and unchanged HARD legality; define required initial objectives before coding |
| T19 candidate comparison/persistence | Existing scenarios are not accepted candidate comparison | Reuse existing schedule/scenario model; include minimum durable review/reopen behavior before dependable operations, defer elaborate comparison UX |
| T20 typed targets | Name/Rule-ID coupling still documented in compiler/solver leakage | Move necessary stable-ID semantics before generic setup authoring; bound children by supported semantic families |
| T21 tenant DWDE policy | Hard-coded DWDE policy still exists | Extract tenant records incrementally with parity; historical fixtures/migrations remain intact |
| T22 tenant commands | Schedule commands improved, broader implicit first-membership paths remain | Retain transactional explicit-tenant audit/cutover; do not equate schedule-route fixes with complete tenancy |
| T23 tenant onboarding | Existing auth/membership differs from empty-studio provisioning/selection | Retain before second-studio acceptance; verify truly empty studio, selection, roles, no DWDE seed dependence |
| T24 generic operational UI | DWDE vocabulary/assumptions remain | Merge general navigation work with setup UX; retain second-studio-specific residual cleanup and verification |
| T25 structured rules | Current arbitrary prose cannot imply executable semantics | Pull supported deterministic rule forms ahead of manager-driven setup completion; unsupported HARD must block safety claims |
| T26 CSV intake | No import script/API command evidenced in current task record | Split minimal bulk roster/paste before operational workload where needed; CSV preview/validation before second studio; spreadsheet platform post-v1 |
| T27 second studio | Planned only | Retain objective rename + structurally different fixture + independent manager workflow acceptance; technical fixture alone is insufficient |
| T28 AI alignment | Copilot exists; generic safe onboarding proposal flow unverified | Separate canonical-context correctness from optional conversational setup; deterministic forms first; no AI dependency for operational readiness |
| T29 paid pilot | Bundles distinct operational outcomes without enough bounded scope | Split privacy/security/support/monitoring/recovery/deployment documentation and pilot acceptance; explicitly add Product v1 exit criteria |

T01–T13 completion does not certify production deployment of the migrations or all-product correctness. It records the accepted implementation foundation represented in this checkout.

## Prompt inventory and archive eligibility

Tracked working-tree inventory contains exactly 29 T01–T29 implementation prompt files and their README. No supplemental implementation prompts were found in tracked files or the inspected working-tree planning directory. The ZIP contains the same 29 prompt names and planning documents, not extra supplemental prompts. Therefore no supplemental prompt can honestly be claimed archived.

Move the 13 T01–T13 prompt files to `prompts/archive/` as **completed history**. Preserve T14–T29 as **superseded, incomplete history**, separately labeled; they must not remain an active alternative queue and must not be called completed. Archive README must distinguish these groups. New prompts should point to current decisions and exact commands, not the full historical ledger.

## Planning-file disposition

| File | Recommended action | Reason |
|---|---|---|
| README | Preserve `_OLD`, replace | Single entry point and actual executable next task |
| MASTER_PLAN | Preserve `_OLD`, replace | New setup-to-v1 completion spine |
| TASKS | Preserve `_OLD`, replace | Retain 29-task evidence without duplicating active statuses |
| NEXT | Preserve `_OLD`, replace | Contradictory old queue requires decisive replacement |
| DECISIONS | Preserve `_OLD`, replace/consolidate accepted decisions | Carry live invariants and new resolved architecture with historical traceability |
| CODEX_EXECUTION_RULES | Revise | Most safety rules remain valuable; obsolete spine/session constraints do not |
| TEST_STRATEGY | Revise | Distinguish existing commands, planned commands, private evidence and current CI gaps |
| DWDE_RELEASE_PLAN | Preserve `_OLD`, merge current acceptance into master/test strategy | Avoid parallel milestone authority |
| GENERIC_PRODUCT_PLAN | Preserve `_OLD`, merge | Genericization belongs in one dependency spine |
| STUDIO_2_ACCEPTANCE | Retain/revise as acceptance checklist, or merge with explicit equivalence | Distinct scenario details useful; remove separate roadmap status |
| ARCHITECTURE_CUTOVER | Preserve `_OLD`, merge live invariant into decisions | Foundational cutover complete; outdated current-state table dangerous |
| DWDE_LEAKAGE_REGISTER | Retain/revise | Concrete residual inventory has distinct ongoing purpose |

## Sequence and external gates

The main audit subsequently identified a SQL null-membership authorization finding and assigned **SAFE-01** as the exact next task. That concrete safety fix precedes this history review's product sequence; see the canonical task ledger for its evidence and prompt.

Recommended subsequent order: repair safe local/runtime configuration and establish shared parity harness; define stable-ID supported policy semantics and narrow review metadata; expose existing inventory through setup forms and deterministic actionable completeness; manager confirmation uses existing versioned authority; implement bounded generation/review/recovery/export and minimal scoring; perform private DWDE operational acceptance; finish explicit tenancy, empty-studio provisioning and bulk imports; second-studio acceptance; pilot security/support/monitoring/recovery; optional safe AI assistance and Product v1 validation. This paragraph explains the historical recommendation; TASKS and NEXT control final IDs and dependencies.

Only external evidence gates are manager-supplied truthful input and review, access to authorized private acceptance environments/accounts, representative second-studio participant/data, and operator-owned release/recovery evidence when that milestone is reached. None justifies blocking deterministic setup, parity, diagnostics, or synthetic failure-path development. No additional owner architecture decision was identified as necessary to begin that work.

## CI limitations discovered

`ci.yml` runs lint/typecheck/test/build on Ubuntu and Windows, DB harness on Ubuntu, and HTTP route curl smoke on Ubuntu. Route HTTP success is not authenticated usability. Its push trigger is `main`, plus pull requests; a push solely to the hardening branch is not guaranteed a CI run. `solver-ci.yml` PR filtering covers only `solver/**` and its workflow, so shared TS/schema/fixture changes can miss solver checks. `package.json` defines neither `test:parity` nor `test:e2e`; future prompts must first introduce these interfaces and cannot claim existing execution. The pinned PostgreSQL/auth-Vault shim harness is useful transaction evidence, not full managed Supabase fidelity.

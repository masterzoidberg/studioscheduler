# Canonical task ledger

Baseline `9120439`, 2026-09-07. Current milestone **A**, selected next **SAFE-02**. Historical T01–T13 remain DONE as bounded foundation work. SAFE-01 is DONE after additive commit-time membership hardening and CI-backed two-connection PostgreSQL verification; its prompt is archived.

## Status and execution contract

READY = dependencies accepted and implementation may begin; NOT_STARTED = dependency waiting; IN_PROGRESS = active work; BLOCKED = concrete impediment to acceptance recorded; DONE = every criterion verified; DEFERRED = intentionally outside release. Missing local verification infrastructure must be reported and prevents DONE when no equivalent required evidence exists; it does not prohibit independent implementation. External acceptance needs are recorded now, but tasks become BLOCKED only when they are otherwise executable and that input prevents completion.

Use ledger order among dependency-satisfied unfinished tasks, with NEXT selecting exactly one. Do not stop the project merely because one later acceptance gate is unavailable. A/B/C/D milestone criteria live only in MASTER_PLAN. Full scope, tests, UX and escalation are in the linked prompt. Each task is a coherent slice; sequential implementation checkpoints under its ID are allowed without architectural rediscovery.

## Active tasks

| ID / prompt | Outcome | Status | Milestone | Dependencies | Execution class |
|---|---|---|---|---|---|
| [SAFE-01](prompts/archive/SAFE-01.md) | Reject missing or revoked membership at commit | DONE | A | None | STANDARD IMPLEMENTATION |
| [SAFE-02](prompts/SAFE-02.md) | Make local configuration and verification safe | READY | A | SAFE-01 | STANDARD IMPLEMENTATION |
| [SET-01](prompts/SET-01.md) | Add targeted setup review with room-capacity vertical slice | NOT_STARTED | A | SAFE-02, VERIFY-01 | STANDARD IMPLEMENTATION |
| [VERIFY-01](prompts/VERIFY-01.md) | Create shared parity and authenticated workflow harnesses | NOT_STARTED | A | SAFE-02 | STANDARD IMPLEMENTATION |
| [POL-01](prompts/POL-01.md) | Introduce bounded typed policy authoring authority | NOT_STARTED | A | SET-01, VERIFY-01 | HIGH-REASONING IMPLEMENTATION |
| [SET-02](prompts/SET-02.md) | Create one Studio Setup entry and dashboard | NOT_STARTED | A | SET-01 | STANDARD IMPLEMENTATION |
| [POL-02](prompts/POL-02.md) | Extend typed policy to studio and qualification families | NOT_STARTED | A | POL-01 | STANDARD IMPLEMENTATION |
| [SET-03](prompts/SET-03.md) | Manage studio hours and rooms through Setup | NOT_STARTED | A | POL-02, SET-02 | STANDARD IMPLEMENTATION |
| [SET-04](prompts/SET-04.md) | Manage teacher availability and qualifications | NOT_STARTED | A | SET-03 | STANDARD IMPLEMENTATION |
| [SET-05](prompts/SET-05.md) | Complete class/session and roster setup | NOT_STARTED | A | SET-04 | STANDARD IMPLEMENTATION |
| [POL-03](prompts/POL-03.md) | Type linked attendance and sequencing policies | NOT_STARTED | A | SET-05 | STANDARD IMPLEMENTATION |
| [SET-06](prompts/SET-06.md) | Capture student restrictions and scheduling relationships | NOT_STARTED | A | POL-03 | STANDARD IMPLEMENTATION |
| [SET-07](prompts/SET-07.md) | Unify readiness and manager certification | NOT_STARTED | A | SET-06 | STANDARD IMPLEMENTATION |
| [UX-01](prompts/UX-01.md) | Make schedule generation and failures understandable | NOT_STARTED | A | VERIFY-01, SET-07 | STANDARD IMPLEMENTATION |
| [UX-02](prompts/UX-02.md) | Complete editing, locks and recovery journey | NOT_STARTED | A | UX-01 | STANDARD IMPLEMENTATION |
| [LOCK-01](prompts/LOCK-01.md) | Expose governed session lock and unlock controls | NOT_STARTED | A | UX-02 | STANDARD IMPLEMENTATION |
| [UX-03](prompts/UX-03.md) | Deliver usable schedule print/export and responsive review | NOT_STARTED | A | LOCK-01 | STANDARD IMPLEMENTATION |
| [ACC-01](prompts/ACC-01.md) | Prove DWDE operational with manager data | NOT_STARTED | A | UX-03, OPS-01 | STANDARD IMPLEMENTATION |
| [GEN-01](prompts/GEN-01.md) | Replace remaining name-bound targets | NOT_STARTED | B | UX-03, VERIFY-01 | HIGH-REASONING IMPLEMENTATION |
| [GEN-02](prompts/GEN-02.md) | Convert DWDE policy to tenant records | NOT_STARTED | B | GEN-01 | STANDARD IMPLEMENTATION |
| [GEN-03](prompts/GEN-03.md) | Make every command explicitly tenant scoped | NOT_STARTED | B | GEN-02 | STANDARD IMPLEMENTATION |
| [GEN-04](prompts/GEN-04.md) | Onboard an empty second workspace | NOT_STARTED | B | GEN-03 | STANDARD IMPLEMENTATION |
| [IMPORT-01](prompts/IMPORT-01.md) | Add reviewed CSV intake | NOT_STARTED | B | GEN-04 | STANDARD IMPLEMENTATION |
| [GEN-05](prompts/GEN-05.md) | Prove independent second-studio acceptance | NOT_STARTED | B | IMPORT-01 | STANDARD IMPLEMENTATION |
| [OPT-01](prompts/OPT-01.md) | Score schedule quality deterministically | NOT_STARTED | C | SET-07, VERIFY-01 | STANDARD IMPLEMENTATION |
| [OPT-02](prompts/OPT-02.md) | Optimize within proven HARD feasibility | NOT_STARTED | C | OPT-01, UX-02 | STANDARD IMPLEMENTATION |
| [CAND-01](prompts/CAND-01.md) | Persist candidate review without a second schedule model | NOT_STARTED | C | OPT-02 | STANDARD IMPLEMENTATION |
| [OPS-01](prompts/OPS-01.md) | Verify deployment configuration and recovery | NOT_STARTED | A | SAFE-02, VERIFY-01 | STANDARD IMPLEMENTATION |
| [OPS-02](prompts/OPS-02.md) | Finish account roles and privacy lifecycle | NOT_STARTED | C | GEN-05 | STANDARD IMPLEMENTATION |
| [OPS-03](prompts/OPS-03.md) | Add operational monitoring and manager help | NOT_STARTED | C | OPS-01, OPS-02 | STANDARD IMPLEMENTATION |
| [PILOT-01](prompts/PILOT-01.md) | Accept a supported external commercial pilot | NOT_STARTED | C | CAND-01, OPS-03 | STANDARD IMPLEMENTATION |
| [CYCLE-01](prompts/CYCLE-01.md) | Support next season and safe archive lifecycle | NOT_STARTED | D | PILOT-01 | STANDARD IMPLEMENTATION |
| [V1-01](prompts/V1-01.md) | Close product v1 acceptance | NOT_STARTED | D | CYCLE-01 | STANDARD IMPLEMENTATION |

31 STANDARD IMPLEMENTATION; two HIGH-REASONING IMPLEMENTATION (POL-01 and GEN-01); zero ARCHITECTURAL REVIEW REQUIRED. These two involve cross-runtime semantic transition, not unresolved product scope. Decisions in DECISIONS prevent reopening the authority architecture.

## Historical task mapping

T01–T13: retain completed identity and evidence in TASKS_OLD.md and [history audit](AUDIT_HISTORY.md); their 13 prompts are in [archive](prompts/archive/README.md). SAFE-01 is also archived with its current completion record below. Do not infer complete production safety from bounded task acceptance.

| Superseded unfinished task | New owner |
|---|---|
| T14 | VERIFY-01 + SET-01–07 + ACC-01 |
| T15 | UX-01 |
| T16 | SAFE-02 + SET-02 + UX-02/03 + LOCK-01 + OPS-01 |
| T17 | OPT-01 |
| T18 | OPT-02 |
| T19 | CAND-01 |
| T20 | POL-01/02/03 + GEN-01 |
| T21 | GEN-02 (bounded early bridge POL-01) |
| T22 | GEN-03 |
| T23 | GEN-04 + OPS-02 |
| T24 | SET-02/03 + UX-03 + GEN-04 |
| T25 | POL-01/02/03 + SET-03–07 |
| T26 | IMPORT-01 |
| T27 | GEN-05 |
| T28 | SAFE-02 containment; optional aligned AI POST-V1 |
| T29 | OPS-01/02/03 + PILOT-01 + CYCLE-01 + V1-01 |

Former milestones/phase labels are superseded by A DWDE Operational, B Second-Studio Ready, C Commercial Pilot Ready, D Product v1. Completed cutover and generic/DWDE release roadmaps are historical _OLD files; there is no second active queue.

## Blockers and external gates

| ID | Observation/evidence | Affected work | Owner/action and objective unblock |
|---|---|---|---|
| ENV-DB | Audit machine Docker Linux daemon was unavailable on 2026-09-07. GitHub Actions Linux CI run 324 subsequently passed `npm run test:db`, including SAFE-01's focused disposable two-connection regression. | Future local DB verification if Docker remains unavailable | Local operator starts Docker Desktop when local DB execution is required; CI evidence may satisfy a task only when that task's specified required regression actually runs there. Never substitute production. |
| BLK-DWDE | No current complete manager-confirmed private dataset or independent workflow evidence established; replaces old BLK-014 | ACC-01 only | Studio manager completes in-app intake/review and supplies private acceptance references; full parity/solve/workflow evidence passes. Public toy fixtures cannot unblock. |
| EXT-RELEASE | Deployed environment migration/config/restore acceptance not inspected | OPS-01/ACC-01 operational criteria | Owner authorizes environment validation/release separately; operator supplies exact deployed versions and restore evidence. |
| EXT-STUDIO2 | Independent participant/data not established | GEN-05 | Owner supplies participant and supported dataset; frozen-SHA checklist passes without source patches. |
| EXT-PILOT | External operating/support/commercial evidence not established | PILOT-01 | Owner/operator supplies arrangement, support/privacy limits and actual two-cycle evidence. |

Private evidence may already exist outside Git; “not established here” is not an assertion that it does not exist. No new owner architectural question is required to begin. No roadmap entry authorizes contacting people, deployment, paid provisioning or live customer-data changes.

## Completion records

### SAFE-01 — DONE

- Starting implementation HEAD: `2b589f1106a127142e41c3ee0f3e737c8a9b082a`.
- Implementation commits: `d76c9aad13d35c9a93dacd0c01a788326e776af8` and corrective narrowing `51fd92e35eaa3129f237f91c196e4ad603d58547`.
- Changed implementation/test surface: additive `20260908010000_safe01_commit_membership_authorization_v50.sql`, `scripts/test-safe01-db.mjs`, `tests/legacy-write-bypass-closure.test.ts`, and the `test:db` script chain in `package.json`.
- Authorization behavior: `private.assert_editor_context()` now locks the legacy resolved membership only at editor write boundaries; the shared STABLE read resolver is unchanged. V4.9 adoption locks the exact selected `(studio_id,user_id)` row with `FOR UPDATE` and rejects `NOT FOUND`, VIEWER and wrong-tenant actors with SQLSTATE 42501 before downstream adoption.
- Race semantics: command-first holds the membership row through commit and revocation waits; revocation-first holds the row, adoption waits, then re-evaluates the committed VIEWER/deleted state and rejects.
- Rejection evidence: focused disposable regression verifies never-member, deleted-member, VIEWER and wrong-tenant rejection; OWNER and EDITOR success; unchanged schedule/model/audit witness state; no downstream adoption write on rejection; both two-connection orderings.
- CI evidence at implementation SHA `51fd92e`: PR #55, CI run **324** success (Ubuntu lint/typecheck/test/build/disposable DB/smoke and Windows matrix), Solver CI run **43** success. The Ubuntu disposable database step completed successfully with the SAFE-01 regression in the `npm run test:db` chain.
- Historical migrations and production data were not modified. No deployment was performed or implied by task acceptance.
- Result: SAFE-01 DONE; dependency SAFE-02 becomes READY and is the sole NEXT task.

## Audit completion record

Planning rebuild established the new queue without claiming implementation. SAFE-01 is the first post-rebuild accepted implementation slice. Remaining product work follows the active dependency graph above.

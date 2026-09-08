# Canonical task ledger

Baseline `9120439`, 2026-09-07. Current milestone **A**, selected next **POL-01**. Historical T01–T13 remain DONE as bounded foundation work. SAFE-01, SAFE-02, VERIFY-01 and SET-01 are DONE after CI-backed hardening and verification; their prompts are archived.

## Status and execution contract

READY = dependencies accepted and implementation may begin; NOT_STARTED = dependency waiting; IN_PROGRESS = active work; BLOCKED = concrete impediment to acceptance recorded; DONE = every criterion verified; DEFERRED = intentionally outside release. Missing local verification infrastructure must be reported and prevents DONE when no equivalent required evidence exists; it does not prohibit independent implementation. External acceptance needs are recorded now, but tasks become BLOCKED only when they are otherwise executable and that input prevents completion.

Use ledger order among dependency-satisfied unfinished tasks, with NEXT selecting exactly one. Do not stop the project merely because one later acceptance gate is unavailable. A/B/C/D milestone criteria live only in MASTER_PLAN. Full scope, tests, UX and escalation are in the linked prompt. Each task is a coherent slice; sequential implementation checkpoints under its ID are allowed without architectural rediscovery.

## Active tasks

| ID / prompt | Outcome | Status | Milestone | Dependencies | Execution class |
|---|---|---|---|---|---|
| [SAFE-01](prompts/archive/SAFE-01.md) | Reject missing or revoked membership at commit | DONE | A | None | STANDARD IMPLEMENTATION |
| [SAFE-02](prompts/archive/SAFE-02.md) | Make local configuration and verification safe | DONE | A | SAFE-01 | STANDARD IMPLEMENTATION |
| [VERIFY-01](prompts/archive/VERIFY-01.md) | Create shared parity and authenticated workflow harnesses | DONE | A | SAFE-02 | STANDARD IMPLEMENTATION |
| [SET-01](prompts/archive/SET-01.md) | Add targeted setup review with room-capacity vertical slice | DONE | A | SAFE-02, VERIFY-01 | STANDARD IMPLEMENTATION |
| [POL-01](prompts/POL-01.md) | Introduce bounded typed policy authoring authority | READY | A | SET-01, VERIFY-01 | HIGH-REASONING IMPLEMENTATION |
| [SET-02](prompts/SET-02.md) | Create one Studio Setup entry and dashboard | READY | A | SET-01 | STANDARD IMPLEMENTATION |
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

T01–T13: retain completed identity and evidence in TASKS_OLD.md and [history audit](AUDIT_HISTORY.md); their 13 prompts are in [archive](prompts/archive/README.md). SAFE-01, SAFE-02, VERIFY-01 and SET-01 are also archived with current completion records below. Do not infer complete production safety from bounded task acceptance.

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
| ENV-DB | Audit machine Docker Linux daemon was unavailable on 2026-09-07. GitHub Actions Linux CI runs 324 and 327 subsequently passed `npm run test:db`; VERIFY-01 CI run 371 passed the disposable DB suite and authenticated browser harness; SET-01 CI run 395 passed the expanded DB chain and combined authenticated browser workflow. | Future local DB verification if Docker remains unavailable | Local operator starts Docker Desktop when local DB execution is required; CI evidence may satisfy a task only when that task's specified required regression actually runs there. Never substitute production. |
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
- CI evidence at implementation SHA `51fd92e`: PR #55, CI run **324** success, Solver CI run **43** success.
- Historical migrations and production data were not modified. No deployment was performed or implied by task acceptance.

### SAFE-02 — DONE

- Starting accepted baseline: `51fd92e35eaa3129f237f91c196e4ad603d58547`.
- Implementation commit: `2e946817b74fc84699c20ae21bcab7bc6bab9e52`; type-only test correction: `7c2078f85c64ab0bf7b645a18662c7d145cee14f`.
- Configuration behavior: removed the hard-coded production Supabase URL/key fallback; `resolveSupabasePublicConfiguration` requires URL and publishable key together, validates the URL, and exposes an actionable configuration-required state. Browser/server/admin helpers throw locally before `createClient` when configuration is absent or partial.
- UI behavior: root layout renders a safely-offline configuration-required screen before `WorkspaceProvider` mounts. Legacy Copilot is no longer mounted in normal manager navigation; legacy scenario creation was removed and historical scenario records remain read-only under Settings → Advanced.
- CI behavior: Solver CI PR path filters now include shared Constraint IR/compiler/gateway/server-state and fixture/test paths. `.env.example` uses explicit loopback placeholders rather than the production project.
- New regression: `tests/safe-local-configuration.test.ts` covers missing/partial/invalid configuration, explicit loopback client creation, removal of the former production fallback, root-layout containment, solver workflow triggers, and AI/scenario navigation containment.
- CI evidence at SHA `7c2078f`: PR #55, CI run **327** success and Solver CI run **46** success. Ubuntu passed lint/typecheck/test/build, disposable DB integration and route smoke tests with no Supabase env injected; Windows passed lint/typecheck/test/build. The no-secrets build/smoke path therefore exercised the configuration-required branch rather than any fallback target.
- Package versions were not changed. No production configuration, deployment, customer data, or external service was mutated.
- Result: SAFE-02 DONE; VERIFY-01 becomes READY and is the sole NEXT task.

### VERIFY-01 — DONE

- Starting accepted baseline: `7c2078f85c64ab0bf7b645a18662c7d145cee14f`.
- Accepted implementation head before planning closeout: `04727b89c6e053c167af7f9dded51917ccd9489a`.
- New shared parity surface: `tests/fixtures/solver-runtime-parity.json`, `tests/runtime-parity.test.ts`, `solver/tests/runtime_parity_runner.py`, `solver/tests/test_runtime_parity.py`, and `scripts/test-parity.mjs`; `npm run test:parity` is wired into Solver CI with Node 22 and Python 3.12.
- New authenticated browser surface: `scripts/test-e2e.mjs` and `tests/e2e/verify01-authenticated.spec.mjs`; the harness is loopback/disposable-only, creates synthetic local Auth/Supabase fixtures, and never uses private DWDE data or production fallback credentials.
- Parity behavior: serialized feasible/impossible/partial/locked cases exercise both TypeScript authority and Python solver behavior, including deliberate legality mismatch, qualification default-deny, duration mismatch and stale candidate coverage.
- Browser behavior: synthetic OWNER signs in by local magic link, explicitly enters schedule Editing mode, performs a real authoritative MOVE request, receives a structured HTTP 409 conflict when the assignment becomes concurrently locked, and then completes a governed room inventory write.
- No-write proof: rejected MOVE leaves ScheduleVersion count/current version/current schedule ID unchanged, preserves assignment placement fields, and creates no `SCHEDULE_COMMAND` success audit row. The concurrent lock is visible as the conflicting authoritative state and is explicitly cleaned up before the inventory-write leg.
- Error-boundary correction: `app/api/schedule/move/route.ts` now normalizes known transaction conflicts whether Supabase returns them in `result.error` or throws them, preventing `LOCKED_`/HARD validation conflicts from leaking as generic 500s while keeping diagnostic SQL/stack detail out of the normal response.
- CI wiring: PR CI contains the authenticated disposable e2e job; Solver CI path filters include parity fixtures/scripts/shared constraint surfaces. `package.json` exposes `test:parity` and `test:e2e`.
- CI evidence at SHA `04727b8`: PR #55, CI run **371** success and Solver CI run **90** success. Ubuntu passed lint, typecheck, unit tests, build, disposable DB integration and route smoke tests; Windows passed lint, typecheck, unit tests and build; authenticated-e2e passed; Solver CI passed CP-SAT/service pytest, production solver container build, and runtime parity.
- No deployment, real DWDE certification, customer-data mutation or external-service write was performed or implied.
- Result: VERIFY-01 DONE; SET-01 becomes READY and is the sole NEXT task.

### SET-01 — DONE

- Starting implementation HEAD: `c427820d4aa6eed886aba6ba248d321fa7cfda40`.
- Accepted implementation head before planning closeout: `2403f6f21e029e43a438eaef731b73967e5d6fc2`.
- Changed implementation/test surface: additive `supabase/migrations/20260908035000_set01_room_capacity_review_v51.sql`; `app/api/setup/review/room-capacity/route.ts`; `lib/setup-review-client.ts`; `components/room-capacity-review-panel.tsx`; `app/people/page.tsx`; `scripts/test-set01-db.mjs`; `scripts/run-disposable-db-regression.mjs`; `tests/e2e/set01-room-capacity-review.spec.mjs`; the `test:db` chain in `package.json`; and a narrowly disambiguated existing VERIFY room assertion.
- Authority model: room capacity remains canonical PlanningDatasetVersion data. `setup_review_attestations` is append-only supplemental evidence and does not duplicate or overwrite the reviewed capacity value. Current status is derived from immutable planning history plus a deterministic room-capacity slice fingerprint.
- Review behavior: manager UI exposes Needs review, Capacity missing, Changed since review, Reviewed and blocked states without exposing hashes or RPC/version mechanics. Missing/non-positive capacity cannot be attested as reviewed. OWNER/EDITOR can confirm the current value; history remains readable after archive.
- Invalidation behavior: changing only the reviewed room capacity invalidates that room's capacity review; unrelated planning changes do not. Returning a room to a formerly reviewed capacity after an intervening different capacity does not resurrect the old review because immutable PlanningDatasetVersion history proves the intervening semantic change.
- Transaction/rejection behavior: exact tenant and current human role are rechecked at the server and database command boundary; stale PlanningDatasetVersion/fingerprint, archived/nonexistent room, cross-tenant actor and insufficient role reject without review/audit success writes.
- Database evidence: `scripts/test-set01-db.mjs` executes the V5.1 migration against disposable PostgreSQL and covers initial review, unrelated-edit stability, capacity-only invalidation, old-value non-resurrection, missing/archived/nonexistent/cross-tenant/stale rejection, no-write witnesses, and archived-history readability. A transport-only disposable Postgres retry helper was added after CI exposed a missing-socket startup race; it retries only that startup signature and never retries SQL/assertion failures.
- Browser evidence: the synthetic authenticated OWNER journey renders the Room Capacity review, confirms the existing room, observes Reviewed/history in the UI, and verifies the authoritative persisted attestation. The pre-existing VERIFY workflow runs first in the same disposable harness and remains green after its inventory-heading selector was narrowed to the inventory card.
- CI evidence at SHA `2403f6f`: PR #55, CI run **395** success and Solver CI run **114** success. Ubuntu passed planning integrity, lint, typecheck, 358 unit tests, build, expanded disposable DB integration and route smoke tests; Windows passed lint, typecheck, unit tests and build; authenticated-e2e passed both VERIFY-01 and SET-01 workflows; Solver CI passed CP-SAT/service pytest, production solver container build, and TypeScript/Python runtime parity.
- No global readiness/certification switch, availability-policy schema, deployment, private DWDE certification, customer-data mutation or external-service write was performed or implied.
- Result: SET-01 DONE. POL-01 and SET-02 are dependency-ready; ledger order selects POL-01 as the sole NEXT task.

## Audit completion record

Planning rebuild established the new queue without claiming implementation. SAFE-01, SAFE-02, VERIFY-01 and SET-01 are accepted post-rebuild implementation slices. Remaining product work follows the active dependency graph above, beginning with POL-01.

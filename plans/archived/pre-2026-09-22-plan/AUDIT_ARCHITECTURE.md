# Architecture and correctness evidence

Audit date: 2026-09-07. This is supporting repository evidence, not a competing execution ledger. Follow [README](README.md) for the accepted execution order. Application files were inspected; no application changes or live-data operations were performed for this report. Test execution results belong in the canonical verification record; test names below identify inspected coverage, not a claim that every test ran during this sub-audit.

## What is actually implemented

| Area | Inspected implementation | Finding |
|---|---|---|
| Operational facts | `lib/domain.ts` PlanningDatasetSnapshotV1; `lib/planning-dataset.ts`; migrations v25/v29/v31/v39/v40 | Immutable planning snapshots cover teacher identities/names, room capacity/features, student/cohort identities, class structure/rosters, sessions and duration overrides; whole-snapshot manager attestation and archive guards exist. This is substantial working infrastructure, not a future design. |
| Policy compilation | `lib/constraint-compiler.ts`, `lib/constraint-compiler-v3.ts`, `lib/reviewed-rulebook.ts`, `lib/rule-execution-registry.ts` | Versioned, deterministic compilation exists. It remains a guarded DWDE adapter: exact reviewed policy identity/source/snapshot support matters. Arbitrary edited prose is not compiled. |
| Coherent reads | `lib/server-studio-state.ts`; `20260907050000_coherent_solver_snapshot_v43.sql` | Immutable planning reconstruction, studio checks, planning/model hash integrity, current-assignment checks and comprehensive context tokens exist. Historical missing names fail closed rather than falling back to mutable rows. |
| Search | `lib/solver-problem.ts`, `lib/solver-gateway.ts`, `solver/dwde_solver/feasibility.py`, `service.py` | CP-SAT service accepts candidate-only work, supports session-specific locks, and has token authentication. Next.js preflights, checks context and independently validates returned candidates. Search is feasibility work; an objective-priority metadata list is not evidence of a complete preference optimizer. |
| Manual edits | `app/api/schedule/move/route.ts`, `incremental/route.ts`, `lib/manual-move-command.ts`, `lib/schedule-command-candidate.ts` | MOVE, ASSIGN and UNASSIGN use server compilation/model checks and authoritative candidate evaluation. Draft placement semantics exist separately from final completeness. |
| Recovery | `app/api/schedule/recovery/route.ts`, `lib/schedule-recovery.ts`; v48 migration | REBASE and UNDO evaluate candidates through the authoritative path. Historical schedules are sources for a new version, not mutable historical truth. |
| Database boundary | v46/v47/v48/v49 migrations | Service-only write wrappers, current-context rechecks and revocation of old direct schedule/publication/adoption entry points exist. Retained historical functions are implementation primitives, not proof of an open browser bypass. A NULL-authorization defect remains below. |
| Adoption | `app/api/solver/adopt/route.ts`; v41/v42/v44/v49 migrations | Reviewed context includes schedule/assignment/lock identity; adoption reloads state, validates independently and checks archive-aware session completeness and intervals. |
| AI | `app/api/copilot/route.ts`, `lib/copilot-contract.ts`, `components/copilot-panel.tsx` | Proposal allowlists and explicit application exist. Context still uses independently loaded legacy enforcement data and fixed DWDE tenant; it does not yet share the authoritative snapshot/version contract. |

The previous architecture cutover document's claims that manual writes still use v25 and coherent reads are absent are obsolete. New work must verify and finish the implemented boundary, not repeat T07–T13. Retained legacy validator/SQL checks still need parity evidence before removal.

## Findings ranked by impact

### P1: missing-membership check is NULL-unsafe at privileged adoption

`supabase/migrations/20260907190000_close_legacy_write_bypasses_v49.sql`, function `adopt_solver_candidate_v49`, selects a role and checks `if v_selected_role not in ('OWNER','EDITOR')`. With no membership row, the value is NULL and PL/pgSQL does not enter that rejection branch. `adopt_solver_candidate_v44` delegates to v33; those inspected primitives do not provide a replacement human-membership check. The route authenticates membership earlier, so this is specifically a missing/deleted-actor or authorization-change boundary gap, not evidence that an unauthenticated browser can call the service-only RPC.

Existing `tests/legacy-write-bypass-closure.test.ts` checks source text and references a database downgrade-to-VIEWER regression. It does not establish denial after membership deletion. Similar NULL-sensitive checks exist in v46/v47/v48 and v49 model publication, although their downstream `private.assert_editor_context()` adds protection. Use a forward migration with explicit null-safe existence checks throughout current wrappers; exercise deleted membership, unknown actor, VIEWER, valid OWNER/EDITOR, wrong selected tenant, and no-write/audit behavior in disposable PostgreSQL. Also verify serialization/locking against a concurrent membership change rather than assuming a route check survives until commit. Do not edit historical migrations or call this an already-proven production exploit.

The effective downstream v33 definition is in `20260907030000_archive_aware_solver_adoption_v42.sql`, replacing the original v33 source: it checks actor non-null and records the actor but does not query `studio_members`. v44 is in `20260907070000_candidate_stale_schedule_binding_v44.sql`; it checks candidate context and delegates directly to v33. Therefore test the final replayed v49→v44→v42-defined-v33 chain. Extend `scripts/test-db.mjs` alongside `tests/legacy-write-bypass-closure.test.ts`. Capture current schedule ID/version, assignment count and audit count before denied calls and assert unchanged afterward. An unknown actor test should use an existing authenticated user without membership, so an unrelated foreign-key failure cannot falsely demonstrate authorization rejection.

### P1: manager setup cannot yet represent and review the complete scheduling input

`PlanningDatasetSnapshotV1` contains no teacher availability, qualification records, operating hours, room closures, participant restriction records or slice review attestations. Teacher `subjects` and class `eligibleTeacherIds` in the server's reconstructed state are empty arrays; scheduling policy comes through compiled rules. An inventory editor is therefore not a complete onboarding system. `confirm_current_planning_dataset_v39` accepts four manager attestation booleans for the exact planning hash; it does not prove every teacher restriction has been reviewed and does not deterministically execute all readiness checks inside the confirmation RPC. Its UI helper filters readiness blockers, which is insufficient as a future certification boundary.

### P1: AI explanations can describe obsolete authority

`app/api/copilot/route.ts` tells the model that approved EnforcementVersion mappings are the deterministic authority and loads multiple tables independently. `CopilotProposalContext` carries rulebook/enforcement/schedule versions but no planning/model context. The current deterministic write boundary is stronger than that explanation. Until the AI task aligns snapshot context and previews with current authority, keep AI optional and do not make it the setup or certification path. An AI answer or generated prose never supplies enforcement coverage.

### P1 for second studio: tenant selection and compiler coupling remain

`components/workspace-provider.tsx` loads the fixed studio UUID; solver routes, copilot and archive UI also retain fixed tenant selection. Manual/recovery routes accept explicit studio IDs, but SQL wrappers deliberately reject mismatches with legacy first-membership context. This is evidence of fail-closed compatibility, not second-studio usability. Test account membership in two studios, reverse membership ordering, no access, archived IDs, and cross-tenant version/candidate replay when replacing it.

`lib/constraint-ir.ts` selectors use names and free-form parameter bags. `lib/constraint-data-binding.ts` resolves names; `lib/schedule-readiness.ts` requires exactly 178 rules and includes Ballet, Tap 1 and Karly's daughter logic. The Python qualification default-deny switch depends on provenance rule `CUR-007`. Renaming labels cannot establish a generic kernel. Avoid an unbounded plugin platform; extract the few actually supported rule families and stable-ID references.

### P2: production configuration fallback weakens local operational safety

`lib/supabase.ts` falls back to a production project URL and publishable key when configuration is absent. The publishable key is not a service credential, but a local app can silently point at production. Require explicit deployment/local configuration and an actionable unconfigured state; preserve disposable-database safeguards. Never prove an onboarding mutation by running it against that fallback.

### P2: read-side and legacy duplication can mislead

`components/workspace-provider.tsx` independently loads mutable rows and all version lists; coherent write preparation is in the server, not a global guarantee for every screen. `ScheduleVersion` in `lib/domain.ts` does not expose all constraint-model metadata present in the coherent token. `lib/validator.ts`, `constraint-engine.ts`, `constraint-engine-v2.ts`, SQL legacy checks, mapping UI and copilot still present overlapping concepts. First make status/preview authoritative; retire duplicate semantic consumers only after caller inventory and parity. Do not delete SQL reference, duration, transaction or tenant defenses as “duplicate validation.”

## Resolved setup authority decisions

Use the existing four versioned authorities. Do not create `SetupDataset`, separate onboarding policy, a second schedule, or a general workflow engine.

| Information | Canonical owner | Treatment |
|---|---|---|
| Names, people inventory, room capacity/features, class subject/level/duration/frequency, sessions, roster/cohort membership | PlanningDatasetVersion | Extend existing snapshots and governed inventory transactions where needed. |
| Studio operating windows, teacher availability/qualifications/maximum days, student attendance restrictions, room closures/restrictions, eligible/required teachers or rooms, fixed sessions, sequencing and cross-person timing | Structured policy in RulebookVersion | Generic forms edit typed rule records using stable IDs; do not copy enforceable fields into independent setup rows. Human-readable descriptions are generated from or paired with the same typed payload. |
| Relationship identities needed by a policy, such as family membership or linked participants | PlanningDatasetVersion | Store identity facts once; the policy referencing those IDs belongs in RulebookVersion. |
| Preferred days/teachers/rooms, gaps and compactness | Structured soft policy in RulebookVersion | Classify supported objective versus recorded preference; never silently upgrade to HARD or claim a stored preference affects search before implementation. |
| Compiled constraints and supported-policy accounting | ConstraintModelVersion | Deterministically derived and server-published, never independently editable or AI-published. |
| Placements and assignment locks | ScheduleVersion | Existing planning-session lock semantics remain compatible; do not invent a third lock store. |
| Human review, no-restriction attestation, known-omission classification | Narrow supplemental review attestations in Supabase | References to canonical IDs/slices only, without duplicated scheduling facts. |

Use an append-only `setup_review_attestations` structure, scoped by studio, subject kind/ID, concern, review contract version, server-derived fingerprint, reviewer, timestamp, and disposition (`REVIEWED` or `NO_ADDITIONAL_RESTRICTION`). A review concerns a deterministic required slice, not arbitrary client keys. Store linked source versions for audit, but do not use the entire version number as the slice fingerprint. Known omissions must reference an entity/concern or explicit missing inventory item and have an unresolved/resolved classification; unresolved possible HARD omissions block certification. An optional note cannot override a deterministic blocker.

Compute fingerprints server-side from a canonical projection of that concern's facts and relevant typed rule payloads, including applicable exceptions, active identity/relation dependencies and policy strength/status. Sort sets by stable ID. Exclude unrelated capacity or availability fields and decorative display labels after ID migration. Hash schema/contract revision so a semantic projection change explicitly invalidates older reviews. Related roster/eligibility changes invalidate the dependent concern; unrelated room capacity changes do not invalidate a teacher's availability. Until name-based rules are migrated, names that affect binding are semantic dependencies and must invalidate relevant slices.

Do not persist derived status enums. Derive `MISSING` for absent required values, `NEEDS_REVIEW` for no attestation, `CHANGED_SINCE_REVIEW` for mismatched projection, `BLOCKED` for contradiction/unsupported required meaning, and `REVIEWED` for a matching admissible attestation. Empty optional restrictions are reviewed only after an explicit `NO_ADDITIONAL_RESTRICTION` attestation; an empty list alone means no recorded restrictions, not that somebody checked. No-restriction is invalid for required positive facts such as class duration or room capacity.

Final certification must pin current planning/rulebook/model context and the relevant attestation set/contract, with actor and time, and recompute deterministic readiness at its governed boundary. Retain v39 historical evidence and compatibility fields; a planning-only timestamp must not certify a later policy version. The supplemental certificate stores evidence references, not copied operational data. Unrelated changes may preserve slice reviews, but changing any scheduling authority requires re-evaluating aggregate certification and schedule staleness.

## Accepted gate semantics

| Action | Blocking conditions | Allowed |
|---|---|---|
| Save setup | Invalid structure/reference/role/version | Incomplete setup and explicit unresolved notes; save must not imply certification. |
| Record a slice review | Missing required facts, invalid no-restriction assertion, stale submitted fingerprint, contradiction in that slice | Unrelated incomplete slices remain open. |
| Certify scheduling inputs | Any required review missing/stale, unresolved possible HARD omission, inconsistent structure, unsupported/ambiguous active HARD meaning, invalid binding | Missing optional preferences do not block. A stale old schedule does not block input certification. |
| Generate | Uncertified/stale input context, incomplete HARD model, invalid bindings/delegated preconditions or locks | Existing stale schedule may be replaced by a fresh solve. Keep current `SCHEDULE_PLANNING_DATASET_STALE` solve-remediable behavior. |
| Manual placement/recovery | Unsupported HARD meaning, stale command context, invalid IDs/locks, disallowed placement or inadmissible repair transition | Partial required-session placement remains a draft. Setup editing and historical viewing remain available while scheduling is blocked. |
| Adopt candidate / publish | Current certified inputs and full current model required; exact active sessions once, zero HARD violations, locks/context intact | Preference misses can be displayed and explicitly accepted; never waive HARD. |
| Draft export | Privacy/role and format validation | Incomplete/stale draft may be exported only with conspicuous draft/status/version evidence. Published output uses the finalization gate. |
| Optimization | Same HARD guarantees as feasibility; only supported enabled soft objectives scored | Missing/unimplemented optional preferences warn and do not prevent feasibility scheduling. |

Unsupported HARD policy remains visible and unresolved; offer correction, supported structured expression, explicit manager reclassification/retirement with audit, or engineering support. “Manually checked” does not grant automatic enforcement. Unknown prose with unknown strength is a potential HARD omission until classified. Never silently translate it into a closest rule, disable it, or label zero detected conflicts fully valid.

## Smallest necessary genericization

Before onboarding forms become canonical: introduce typed stable-ID targets for the supported policy families and a bounded structured Rulebook write path; isolate existing reviewed DWDE compilation as a named compatibility adapter. Add concern projections/review evidence over those authorities. Do not build a generalized constraint DSL or duplicate migration of all historical policy.

The safe incremental bridge does not require converting every DWDE rule before availability forms. Retain a verified immutable V3 baseline reference; compare every residual legacy rule's executable/reviewed semantics against its baseline entry. Typed current rules explicitly replace a dependency-closed set of original rule IDs. Compile the residual baseline and typed current subset into one current model, with exactly-once active-policy accounting and unchanged-rule parity. New current versions must remain honest current versions, not spoof V3 metadata. Removing the DWDE document type to obtain the current helper's unrecognized-artifact success is expressly forbidden.

Start that bridge with teacher availability/day-window rules and all consumers that enforce those rules. A node may cite multiple rule IDs, so removal by one matching provenance ID can accidentally remove unrelated sequencing or governance semantics. A replacement must own the complete dependent bundle or split it with parity proof. The same replacement accounting must reach readiness/delegated preflight and active legacy SQL checks; otherwise the old availability can still reject the manager's legitimate change. Change live SQL through forward migrations, including the current exact-178 model accounting where applicable. Unknown changed residual HARD semantics stay blocked. Port qualifications, class/room restrictions and relationships in subsequent bounded families; complete named-DWDE extraction only before second-studio acceptance. A capacity-only review vertical can precede this bridge because it reviews an existing planning fact without introducing new enforceable policy.

Before second-studio acceptance: remove hardcoded route/provider studio selection and first-membership mutation inference; create a minimal new-studio initialization path; replace 178-rule and named curriculum readiness with capability accounting and typed tenant requirements; move default-deny teacher eligibility from `CUR-007` provenance to explicit supported semantics; support the admitted calendar/room horizon consistently. Six-day/15-minute limits may be explicit pilot constraints, but do not advertise Sunday or arbitrary grid support without coordinated SQL/TypeScript/Python/UI changes.

Keep immutable historical imports, production ledger and deidentified golden fixtures. DWDE names in authentic tenant records are not a reason to edit history. Naming-only packages such as `dwde_solver` are lower priority than actual runtime dispatch. Stable IDs, all configured room rendering, operating windows and explicit tenant routing deliver more value than renaming modules.

## Evidence still required

- Full manager-reviewed DWDE workload and acceptance evidence: toy/golden correctness is not complete studio acceptance.
- Semantic parity for every admitted HARD family across TypeScript evaluation and Python feasibility, including unsatisfiable examples, session locks and partial/final differences. Existing coverage is strongest in targeted units/contracts; some tests inspect SQL strings instead of executing failure behavior.
- Executed disposable migration replay, privilege denial, absent-member/concurrency, stale-candidate, archive, rebase/undo and no-write tests. `scripts/test-db.mjs` and `tests/database-harness.test.ts` are the existing entry points; extend them rather than introduce another database harness.
- Private acceptance dataset handling and restore rehearsal. Current `SettingsView` exports JSON; that does not establish human schedule export or a tested operational restore procedure.
- New-studio smoke with different names, rule count, rooms, teachers and hours, plus a multi-membership account. A renamed DWDE fixture alone does not establish this.
- AI stale-context/unsupported-policy/proposal behavior and disclosure of what external model context contains before commercial use. Core scheduling must work with AI disabled.

Migration provenance is intentionally split: `supabase/migrations/README.md`, `supabase/production-ledger/manifest.json` and `supabase/bootstrap/2026-08-31-production-schema-baseline.sql` explain replay and ledger distinctions. Preserve historical bytes; add forward migrations. Local test success cannot establish which migrations are deployed remotely.

## Reconciled final decisions

The design proposals above were synthesized into DEC-101–109; those canonical decisions control exact contracts. Known omissions are classified governed Rulebook records, while narrow supplemental attestations record review only. Initial relationship policies refer directly to existing person IDs; no separate family-data subsystem is planned without a demonstrated need. Certification extends the existing confirmation event/metadata rather than creating a separate certificate lifecycle. Lock/unlock uses the explicit atomic two-flag transition in DEC-109. Residual name-based bindings remain fingerprint dependencies until their typed conversion. The final roadmap commits Sunday support in GEN-04 while retaining a 15-minute non-overnight weekly scope.

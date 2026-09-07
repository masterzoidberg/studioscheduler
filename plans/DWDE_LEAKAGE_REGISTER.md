# DWDE Leakage Register

Baseline: `17b3a60`. This register tracks existing behavior; referenced historical SQL is evidence, not an edit target. Change live functions with forward migrations. Statuses follow [README](README.md). No extraction is verified complete.

### Legitimate DWDE tenant data

People, rosters, rooms, rules, exceptions, seed records, historical confirmations, and golden fixtures belong in tenant data/history. Retain them. DEFERRED on a historical/fixture entry means no extraction work is needed for the data itself, not neglected debt.

### Illegitimate reusable-kernel coupling

Dispatch on a DWDE Rule ID, named entity, level, subject, fixed studio count, or implicit studio membership inside reusable compilation/validation/routing is coupling. Extract behavior without erasing DWDE.

| ID | File/subsystem | Tenant-specific dependency | Category | Blocks Studio #2? | Intended extraction target | Task | Status |
|---|---|---|---|---|---|---|---|
| L01 | [lib/constraint-compiler.ts](../lib/constraint-compiler.ts) | Named teachers/rooms/classes, subject domains, level finish times, fixed windows and curriculum sequencing | compiler | Yes | Tenant structured policy/targets/exceptions | T21 | NOT_STARTED |
| L02 | [lib/constraint-compiler-v3.ts](../lib/constraint-compiler-v3.ts) | Aimee/Kiran, pointe node IDs, OPS/ADV/SEQ dispatch | compiler | Yes | Versioned DWDE adapter then tenant records | T05, T21 | NOT_STARTED |
| L03 | [lib/rule-execution-registry.ts](../lib/rule-execution-registry.ts) | Enumerated DWDE Rule IDs and execution families | compiler | Yes | Generic capability/disposition registry; tenant rule accounting | T21 | NOT_STARTED |
| L04 | [lib/schedule-readiness.ts](../lib/schedule-readiness.ts) | Exactly 178 rules; Ballet classes; advanced roster requirements; Karly daughter; Tap 1 exception | readiness | Yes | Generic completeness plus tenant requirements | T21 | NOT_STARTED |
| L05 | [lib/planning-class-structure.ts](../lib/planning-class-structure.ts) | Ballet/Pointe frequencies and named durations | planning repair/intake | Yes | Explicit class/session requirements | T21 | NOT_STARTED |
| L06 | [lib/planning-structure-repair.ts](../lib/planning-structure-repair.ts) | Repairs derived from DWDE structure requirements | planning repair/intake | Yes | Generic requirement-driven repair proposal | T21 | NOT_STARTED |
| L07 | [lib/planning-roster-repair.ts](../lib/planning-roster-repair.ts) | Level 4A/4B/5 participation and Karly relationship | planning repair/intake | Yes | ID-based enrollment/linked participant requirements | T21 | NOT_STARTED |
| L08 | [lib/required-class-intake.ts](../lib/required-class-intake.ts) | Class-name parsing infers subjects and levels | planning repair/intake | Yes | Reviewed import suggestions; explicit canonical fields | T21, T26 | NOT_STARTED |
| L09 | [lib/delegated-solver-preflight.ts](../lib/delegated-solver-preflight.ts) | Fixed level progression and Ballet/Jazz/Tap/Contemporary families | readiness | Yes for progression | Typed progression/enrollment relationship graph | T20, T21 | NOT_STARTED |
| L10 | [solver/dwde_solver/feasibility.py](../solver/dwde_solver/feasibility.py) | CUR-007 condition enables default-deny qualification | solver | Yes | Explicit invariant/qualification semantics | T14, T20 | NOT_STARTED |
| L11 | [lib/constraint-ir.ts](../lib/constraint-ir.ts) | Name selectors, studentRelation, generic parameters permit daughter-specific terms | compiler | Yes | Typed stable ID targets and linked-attendance parameters | T20 | NOT_STARTED |
| L12 | [lib/constraint-engine.ts](../lib/constraint-engine.ts) | Name/level normalization, CUR-007 provenance, daughterClassNames | solver | Yes | Typed ID runtime evaluation; generic invariant provenance | T14, T20 | NOT_STARTED |
| L13 | [lib/constraint-engine-v2.ts](../lib/constraint-engine-v2.ts) | Duplicated subject/name/level semantics | solver | Yes | Shared typed runtime evaluation and parity | T20 | NOT_STARTED |
| L14 | [lib/constraint-data-binding.ts](../lib/constraint-data-binding.ts) | Runtime identity from ASCII-stripped display names and relationship labels | compiler | Yes | ID binding; reviewed name resolution at intake only | T20 | NOT_STARTED |
| L15 | [lib/reviewed-rulebook.ts](../lib/reviewed-rulebook.ts) | DWDE format, Rulebook ID and exact reviewed hash | planning repair/intake | Yes if generic entry point | Retain explicitly DWDE importer; generic format separately | T21, T26 | NOT_STARTED |
| L16 | [supabase/migrations/20260902132207_constraint_model_versions_v27.sql](../supabase/migrations/20260902132207_constraint_model_versions_v27.sql) | Current model validation requires 178 active rules | database | Yes | Forward generic model validation; historical file retained | T21 | NOT_STARTED |
| L17 | [supabase/migrations/20260904185218_reviewed_required_class_intake_v34.sql](../supabase/migrations/20260904185218_reviewed_required_class_intake_v34.sql) | Named required-class trigger/intake | database | Yes | Tenant-scoped adapter then generic requirements | T21 | NOT_STARTED |
| L18 | [supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql](../supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql) | Exact DWDE v3 identity/hash guard and named repairs | database | Yes if applied generically | Isolated DWDE adapter; typed requirement transactions | T05, T21 | NOT_STARTED |
| L19 | [supabase/migrations/20260904215241_shared_rulebook_roster_compiler_v38.sql](../supabase/migrations/20260904215241_shared_rulebook_roster_compiler_v38.sql) | Named roster and Karly daughter requirements | database | Yes | Generic ID enrollment requirement records | T21 | NOT_STARTED |
| L20 | [components/workspace-provider.tsx](../components/workspace-provider.tsx) | Fixed DWDE studio UUID, export IDs/name and membership selection | tenant routing | Yes | Explicit selected tenant, tenant metadata | T22, T23 | NOT_STARTED |
| L21 | [components/planning-archive-panel.tsx](../components/planning-archive-panel.tsx) | Fixed studio UUID for history reads | tenant routing | Yes | Selected-tenant archive queries | T23 | NOT_STARTED |
| L22 | [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts) | Fixed DWDE workspace authorization/loading | tenant routing | Yes | Explicit request tenant authorization | T22, T23 | NOT_STARTED |
| L23 | [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts) | Fixed DWDE workspace adoption | tenant routing | Yes | Explicit reviewed tenant and transaction actor check | T13, T22, T23 | NOT_STARTED |
| L24 | [app/api/copilot/route.ts](../app/api/copilot/route.ts) | Fixed tenant, DWDE prompt examples, legacy enforcement authority | tenant routing | Yes for AI | Selected tenant/pinned canonical context | T16, T22, T28 | NOT_STARTED |
| L25 | [supabase/production-ledger/20260831123403_v2_1_governed_infrastructure.sql](../supabase/production-ledger/20260831123403_v2_1_governed_infrastructure.sql) | Current actor helper selects first membership | database | Yes | Explicit tenant helper in forward migration | T22 | NOT_STARTED |
| L26 | [supabase/functions/user-openrouter/index.ts](../supabase/functions/user-openrouter/index.ts) | DWDE membership and fixed deployment origin | tenant routing | Yes for AI | Explicit tenant membership and configured allowed origins | T22, T28 | NOT_STARTED |
| L27 | [lib/domain.ts](../lib/domain.ts) | Monday–Saturday Day type, DWDE reviewed package type, dance-specific names | compiler | Conditional | Explicit supported days; generic import; UI terminology for naming-only issues | T20, T24, T26 | NOT_STARTED |
| L28 | [solver/dwde_solver/service.py](../solver/dwde_solver/service.py) | Monday–Saturday, name-based single-class runtime locks | solver | Yes for multi-session; conditional days | Session-ID locks and explicit supported calendar contract | T09, T24 | NOT_STARTED |
| L29 | [solver/dwde_solver/feasibility.py](../solver/dwde_solver/feasibility.py) | Six days and fixed 15-minute grid | solver | Conditional | Declared pilot limits; consistent configured quantum if demanded | T24 | NOT_STARTED |
| L30 | [lib/schedule-command-candidate.ts](../lib/schedule-command-candidate.ts) | Six-day/15-minute placement assumptions | compiler | Conditional | Consistent supported planning contract | T24 | NOT_STARTED |
| L31 | [supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql](../supabase/migrations/20260904032500_governed_solver_candidate_adoption.sql) | Six-day and 15-minute adoption checks | database | Conditional | Forward change aligned with supported calendar contract | T24 | NOT_STARTED |
| L32 | [components/schedule/schedule-view.tsx](../components/schedule/schedule-view.tsx) | Fixed hours and first-three-room weekly truncation | UI | Yes for 4 rooms/morning | All configured rooms and tenant display horizon | T24 | NOT_STARTED |
| L33 | [components/schedule/mobile-schedule-view.tsx](../components/schedule/mobile-schedule-view.tsx) | Fixed days/hours and grid visualization | UI | Yes for morning | Tenant horizon with consistent supported grid | T24 | NOT_STARTED |
| L34 | [lib/schedule-builder.ts](../lib/schedule-builder.ts) | Saturday/weekday DWDE start defaults | UI | Yes for other hours | Tenant operating-window defaults | T24 | NOT_STARTED |
| L35 | [components/app-shell.tsx](../components/app-shell.tsx) | DWDE name/logo/loading/access wording | branding | Presentation | Tenant name/branding | T23, T24 | NOT_STARTED |
| L36 | [components/login-screen.tsx](../components/login-screen.tsx) | DWDE product branding | branding | Presentation | Product/tenant appropriate branding | T24 | NOT_STARTED |
| L37 | [app/layout.tsx](../app/layout.tsx) | DWDE metadata title/description | branding | Presentation | Product/tenant metadata | T24 | NOT_STARTED |
| L38 | [components/settings-view.tsx](../components/settings-view.tsx) | DWDE export filename and labels | branding | Presentation | Tenant-aware export | T16, T24 | NOT_STARTED |
| L39 | [components/rulebook/rulebook-view.tsx](../components/rulebook/rulebook-view.tsx) | DWDE title/export and Cami-specific explanation | branding | Presentation | Tenant-aware wording and structured rules | T24, T25 | NOT_STARTED |
| L40 | [components/copilot-panel.tsx](../components/copilot-panel.tsx) | Named DWDE suggested questions | branding | Presentation | Tenant-neutral/contextual suggestions | T28 | NOT_STARTED |
| L41 | [lib/supabase.ts](../lib/supabase.ts) | Fallback to production DWDE project configuration | tenant routing | Environment risk | Explicit environment, no production fallback for tests | T16 | NOT_STARTED |
| L42 | [supabase/bootstrap/2026-08-31-production-schema-baseline.sql](../supabase/bootstrap/2026-08-31-production-schema-baseline.sql) | DWDE studio bootstrap identity | acceptable historical/fixture data | No | Retain historical bootstrap; separate generic initialization | T23 | DEFERRED |
| L43 | [supabase/migrations/20260902130713_rulebook_v3_post_review_confirmations.sql](../supabase/migrations/20260902130713_rulebook_v3_post_review_confirmations.sql) | DWDE reviewed confirmations and immutable Rulebook history | acceptable historical/fixture data | No | Retain immutable provenance | T21 | DEFERRED |
| L44 | [tests/golden-schedule-fixtures.test.ts](../tests/golden-schedule-fixtures.test.ts) | DWDE named golden fixture | acceptable historical/fixture data | No | Keep, expand full fixture, add rename transformation | T14, T20 | DEFERRED |
| L45 | [lib/schedule-visuals.ts](../lib/schedule-visuals.ts) | Dance subject markers used for presentation | UI | No correctness blocker | Retain fallback; tenant terminology when useful | T24 | NOT_STARTED |
| L46 | [components/versions-view.tsx](../components/versions-view.tsx) | DWDE labels and obsolete three-history explanation | branding | Misleading UX | Current version model wording, advanced details | T16, T24 | NOT_STARTED |
| L47 | [lib/types.ts](../lib/types.ts) | Older dance-specific types duplicate current domain | compiler | Maintenance risk | Migrate remaining consumers then retire duplicate types | T20 | NOT_STARTED |
| L48 | [components/scenarios-view.tsx](../components/scenarios-view.tsx) | Legacy mapping-centric what-if presentation | UI | No for baseline scheduling | Label actual capabilities; generalized scenario work deferred | T16 | NOT_STARTED |

## Updating

For an extraction, append evidence keyed by L-ID: implementation commit, new tenant data/typed target location, regression and rename/parity result, remaining compatibility reader, and task linkage. Mark DONE only when reusable behavior has actually moved and verified. Do not mark a branding fix as proof of a generic kernel.

## Evidence log

- 2026-09-06, T05, uncommitted: the temporary DWDE compiler/readiness adapter now requires the reviewed V3 identity, source hash, and immutable Rulebook snapshot before static semantics are considered complete. OPS-003 wording, strength, status, and executable-parameter drift fail closed. This is guard evidence only; L02, L15, and L18 remain NOT_STARTED until T21/T25 extract policy into structured tenant records.

> HISTORICAL — superseded by the 2026-09-07 rebuild. Not current instructions or status. Start at [current planning entry](README.md).

# Generic Product Plan

> Do not remove DWDE from the product. Remove DWDE from the reusable logic.

Primary owners: T20–T27. Preserve working DWDE behavior and history while evolving the current architecture.

# Generic Kernel

Keep the domain centered on recurring classes/activities with one instructor and one room per session initially. Preserve internal Studio/Teacher/Student/Class naming unless a semantic change is necessary. Presentation terminology may vary by tenant.

System invariants: valid same-tenant references, positive canonical durations, teacher/room/participant no-overlap, immutable history, and exact active session completeness at finalization. Qualification must be explicit and default-deny consistently; tenant records describe who is qualified.

Do not branch on named teachers, Ballet/Pointe, levels 4A/4B/5, Studio A, or OPS/ADV/CUR IDs. Capabilities dispatch on typed kinds. Existing coupling stays tracked in [leakage register](DWDE_LEAKAGE_REGISTER.md) until extracted.

# Tenant Layer

Store operating hours, qualification domains, availability, room requirements/capacity exceptions, sequencing, enrollment/progression relationships, attendance limits, preferences, labels and branding as ordinary organization-owned facts/rules. Supported template contracts define semantics; no plugin engine is needed.

Facts and policy are distinct: room capacity/roster/duration are planning facts; exceptions and requirements are policy. Locks are explicit user inputs, not inferred policy prose.

# DWDE Seed/Tenant Data

Retain current DWDE people, rooms, classes, Rulebook, exceptions, rosters, and all historical versions. The bootstrap is schema evidence with a studio record, not a complete production business-data backup.

Extract compiler specification tables and planning requirements into tenant records through reviewed forward migrations. DWDE importer/content guards can remain a clearly named adapter while generic forms are established. Scope any temporary name-based SQL intake trigger to DWDE so Studio #2 cannot trigger its policy.

Keep deidentified full DWDE golden fixtures and an optional controlled seed/export package. Do not invent policy-pack inheritance, publish a marketplace, or overwrite live DWDE records during tests.

# Generic Constraint Architecture

Preserve the current small IR family: resource no-overlap, grid, operating/teacher windows, prohibited days, gaps/workdays/attendance, room/teacher requirements, progression preconditions, qualification domains, sequencing, fixed placements, capacity, linked-start relationships.

T20 introduces discriminated parameter types and explicit selector semantics. Validate unsupported parameter combinations as well as unknown kinds. Every kind requires runtime, solver or proven delegated evaluation, and explanation support.

Use three stages:
1. Structured reviewed tenant rule definitions with stable IDs.
2. Deterministic policy compilation independent of current mutable planning contents.
3. Binding to a pinned Planning Dataset, validating references and producing the solve problem.

Explanation provenance links invariant/constraint → rule → targets/facts. Enrollment/progression can remain deterministic preflight when it is a data requirement rather than a temporal decision. Proof is pinned to the same problem.

# ID Migration Strategy

1. Inventory existing identity fields and historical references; preserve all existing canonical IDs.
2. Add typed teacher/student/room/class/cohort/session ID targets and explicit taxonomy codes/relationships.
3. Generate opaque globally unique IDs for new entities; expose separate tenant-local display codes (including Rule codes).
4. Resolve imported display names once during reviewed intake. Missing/duplicate/Unicode-colliding names require user resolution, never fuzzy runtime identity.
5. Translate DWDE named policy through a migration adapter; compare golden outcomes before cutover.
6. Retain versioned compatibility readers for historical artifacts; new writes use IDs.
7. Run renamed-DWDE and Studio #2 invariance tests; remove live name dispatch after acceptance.

Changing a display label may change provenance/display hashes if that contract includes names, but must not change legality/objective values. Do not demand identical explanatory text or solver tie-breaking where multiple equivalent optima exist.

# Generic Readiness

Replace “178/178 plus required Ballet inventory” with:
- all active rules explicitly accounted for by supported disposition;
- bound, nonambiguous IDs;
- complete active class/session structure and canonical durations;
- valid rosters and instructor qualifications;
- required enrollment/precondition evidence;
- explicit operating windows and supported grid/day contract;
- exact snapshot confirmation;
- coherent policy/model/planning/locks.

Separate “current schedule stale” from “new solve impossible”: a replacement solve may repair an old schedule while still preserving reviewed locks. Unknown HARD meaning blocks. Optional source manifests are provenance, not permanent inventory freezes.

# Tenant Routing

T23 replaces fixed UUIDs in provider, archive panel, solver/Copilot routes, exports, and UI with selected organization context. A user with multiple memberships chooses explicitly; navigation/context refresh cannot retain another organization's records.

Empty organizations initialize required version records in one supported flow and remain not ready until setup completes. Standard operator provisioning is acceptable in pilots.

# Tenant Authorization

T22 replaces first-membership helpers with explicit tenant checks at every command. Each privileged transaction rechecks actor role, version tokens, and same-tenant targets. RLS controls reads; service-role use never bypasses application authorization design.

Protect planning, Rulebooks, candidate/model/schedule versions, audit, scenario, import, and AI contexts. Ensure removed roles cannot commit through an earlier authorization race. Test owner/editor/viewer/nonmember and dual-membership users.

Global opaque IDs avoid collisions; same-tenant reference checks/composite constraints prevent privileged code from linking two studios. No wholesale schema rename is required.

# Onboarding

1. Create organization and owner.
2. Import/add instructors.
3. Import/add rooms.
4. Import/add participants/cohorts.
5. Import/add activities, sessions and rosters.
6. Set operating hours.
7. Set availability and qualifications.
8. Define HARD requirements.
9. Define preferences.
10. Review structured policy.
11. Reconcile completeness and confirm dataset.
12. Generate.
13. Inspect missing data/conflicts.
14. Compare candidates.
15. Adopt/edit/recover/export.

No step may require tenant-specific code. A pilot helper may clean input using standard tools or explain templates, but cannot write a custom compiler.

# Imports

T26 starts with CSV preview and atomic reviewed commit. Validate required fields, duplicates, foreign references, tenant ownership, durations and supported time/day constraints. Record source/import identity and retry behavior. Resolve names to IDs at intake. Invalid batches must not partially commit.

Preserve the DWDE reviewed Rulebook importer as a tenant-specific adapter; generic imports cannot require its document type/hash. Defer Studio Pro/Jackrabbit/GymDesk integrations until repeated demand.

# Preferences

T17 defines a small transparent score; T18 optimizes hierarchically; T19 persists and compares a small diverse set. HARD is never a weighted tradeoff. VERY_STRONG precedes MODERATE, then LIGHT and BASELINE. Capture the DWDE OPT priority mapping as policy data rather than Rule-code parsing.

Report concrete unmet requirements/gap minutes/days and solver status. A time-limited incumbent is not a proof of optimality. Validate/rescore independently before showing a candidate as legal.

# AI Assistance

AI is optional. T16 hides/corrects misleading legacy guidance for DWDE launch. T28 uses selected-tenant pinned context and supported template proposals. Ambiguity triggers clarification only when safe representation is impossible. Every policy change remains human-reviewed and every assignment remains deterministically validated.

Explain deterministic findings; do not invent canonical entities, claim a change applied, or imply saved prose scenarios have been solved. Defer rule learning from overrides.

# Product UX

Show Studio Setup, Missing Information, Rules Need Review, Ready to Schedule, Schedule Candidate, Why This Placement, and Changed Since This Candidate. Hide compiler hashes/raw blocker codes behind an advanced panel while preserving traceability.

T24 removes three-room truncation and fixed DWDE display hours. All configured rooms must render; morning hours must be usable. Supported Sunday/finer-grid scope must be explicit—implement only if acceptance demands it, never silently truncate.

Keep names configurable at presentation; do not redesign all internal types to market to several industries.

## Commercial boundaries

Before Studio #2: deterministic templates, IDs, explicit tenants, generic readiness, imports, good candidate workflow, isolation tests.
Manual during pilot: standardized provisioning, input cleanup assistance, onboarding calls, invoices.
Before ten customers: repeatable onboarding, usage limits, support, recovery, basic billing/entitlements, measurements.
Before scale: add queues/integrations only after workload and customer evidence, not speculative architecture.


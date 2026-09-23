# Accepted product and architecture decisions

Accepted 2026-09-07 against `9120439`. These are design decisions, not implementation claims. [TASKS](TASKS.md) owns delivery status. Historical DEC-001–015 remain in DECISIONS_OLD.md; their authority/safety principles are consolidated here, their obsolete sequencing is superseded.

## DEC-101 — Keep the proven scheduling foundation

Keep Next.js, Supabase, Python OR-Tools CP-SAT, immutable snapshots, audit history and canonical server commands. Current manual MOVE, ASSIGN/UNASSIGN, recovery and adoption use server Constraint IR routes with restricted service-role transactions. T01–T13 remain accepted history, with SAFE-01 correcting the newly identified missing-member case. Do not redo the cutover or reopen legacy grants.

PlanningDatasetVersion owns inventory, sessions, durations, rosters, room capacity/features and existing session lock facts. RulebookVersion owns scheduling requirements and preferences. ConstraintModelVersion is deterministic policy meaning; its fingerprint excludes mutable planning facts. ScheduleVersion owns adopted placements. Context binds studio, Rulebook, planning, model, base schedule and effective locks. Canonical writes validate from coherent snapshots and reject stale context.

Keep draft placement legality separate from final completeness: missing sessions may exist in a clearly incomplete draft, but an illegal placement cannot be saved by calling it a draft. Historical versions remain explainable under historical authority; recovery into current authority must revalidate.

## DEC-102 — One manager setup journey

Primary navigation becomes Home, Setup, Schedule; History and Settings remain accessible, raw Rulebook/compiler/readiness/scenarios diagnostics move under Advanced. Setup sections: Studio, Teachers, Classes, Students (Dancers is DWDE display vocabulary), Requirements, Preferences, Review. Rooms belong under Studio. Existing People/Classes forms and Planning Repairs are reused within these sections. Preserve old deep links with redirects/section anchors.

First visit guides the same sections in order; subsequent visits show an actionable dashboard. Derive progress from actual completeness/review, not a separately maintained wizard completion flag. “Must happen” maps to HARD requirements; “Prefer” maps to reviewed soft tiers. Raw Rulebook history remains available to authorized managers/support; ordinary setup uses forms, not compiler administration.

## DEC-103 — Narrow review metadata, never duplicate planning truth

Persist append-only studio-scoped review attestations in a narrow supplemental structure, because absence cannot distinguish unknown from affirmatively unrestricted. Proposed record contract: studio ID, scope kind, entity ID (nullable only for studio scope), aspect, review-schema version, server-computed dependency fingerprint, outcome, reviewer user ID, timestamp, optional short note. Outcomes are REVIEWED_VALUE, REVIEWED_NO_ADDITIONAL_RESTRICTION, NEEDS_REVIEW; MISSING, CHANGED_SINCE_REVIEW and BLOCKED are derived UI states, not competing stored truth.

Examples: ROOM/capacity, ROOM/restrictions, TEACHER/availability, TEACHER/qualifications, CLASS/structure, CLASS/roster, STUDENT/restrictions, RULE/interpretation. Fingerprint canonical sorted values and related policy semantics/IDs required for that slice, not whole dataset/rulebook version IDs, timestamps, display colors or unrelated records. Include review-schema version so changed interpretation invalidates affected reviews.

Room capacity includes that room capacity only; room restrictions include its relevant policy and feature values. Teacher availability includes its applicable windows/exceptions and operating-window policy dependencies, not a different room capacity. Qualification includes the explicit eligibility domain and referenced class membership. Class structure includes frequency and ordered session durations; roster includes roster IDs and required-participation policy. Relationship review includes linked IDs, scope and timing semantics. An absent expected record is MISSING, existing data without attestation is NEEDS_REVIEW, mismatched fingerprint is CHANGED_SINCE_REVIEW. Invalid/unsupported semantics are BLOCKED even if someone previously attested.

Server recomputes fingerprints from canonical snapshots, never trusts client hashes. Review command pins expected source versions, checks membership, locks/serializes against mutations and writes only if fingerprint still matches. Relevant changes append facts/policy versions normally; stale review is derived, not a global mass invalidation write. Archive removes active obligation but preserves review history; unarchive/new cycle requires fresh review. Returning to a prior value does not silently revive an attestation revoked by NEEDS_REVIEW.

“No additional restriction” is valid for optional availability/restriction slices only after the manager has seen applicable studio-wide rules. It cannot fill missing capacity/duration, infer qualification, waive required roster membership, or erase a contradictory HARD rule. Do not automatically backfill review for historical data.

## DEC-104 — Typed policy in the existing Rulebook, bounded adapter transition

Use discriminated, schema-versioned typed parameters and stable entity IDs in Rulebook snapshots. No second policy store and no general DSL. Availability/time restrictions, teacher qualifications, required/preferred teachers/rooms, operating windows, linked attendance and sequencing are policy. Notes/subjects/eligibleTeacherIds must not become competing editable enforcement authority. Forms derive eligibility from compiled qualification policy.

Planning facts remain facts: rosters, class/session structure, room capacities/features, student/cohort identities. Family identity can be represented by explicit linked IDs in a policy; no unrelated family-person database is needed. Capture scheduling effect, not private life narratives. Exceptions are typed, explicitly scoped policy with provenance and known replacement/priority behavior; reject ambiguity.

**Transition protocol:** POL-01 starts with teacher availability/day-window bundles. Pin and verify the immutable reviewed DWDE V3 baseline artifact and its source fingerprint. Current Rulebook version is separate and truthfully reflects edits. Untouched residual baseline semantics must match per-rule semantic fingerprints against that verified artifact. Typed replacements declare consumed baseline rule IDs; compute dependency closure across nodes citing multiple rules, readiness/preflight checks, compiler enrichments and SQL legacy safeguards. Replace the complete bundle across every executing consumer. Exactly one semantic source owns each consumed requirement. Reject partial bundle replacement, duplicate ownership, changed residual requirements, unknown active HARD policy or unrecognized types. Do not bypass the guard by changing documentType or falsely labeling current text as reviewed V3.

Forward-update publication accounting from fixed 178 to verified residual-plus-typed rule coverage; never weaken completeness to a count alone. Legacy SQL safeguards must be replaced with equivalent typed/current safeguards for that bundle, not simply disabled. Canonical model remains policy-only; entity binding occurs against pinned planning snapshot. Incrementally add other supported families in POL-02/03. GEN-01/02 later remove residual name dispatch and static DWDE rules after complete parity. Whole-kernel genericization is not required to begin useful setup.

Required features mean set inclusion; unavailable intervals cannot intersect placement intervals. Directly-after means same day, successor starts at predecessor end. Linked-arrival means explicit offset interval between specified first attended/teaching sessions. Sibling identity implies nothing automatically. Unsupported full-presence or new relationship semantics remain recorded and blocking for HARD use; never pretend an arrival-window constraint enforces them.

## DEC-105 — One readiness report, operation-specific gates

Extend existing readiness evaluation rather than building an independent percentage engine. Return stable issue code, affected entities/rules, severity, required action/deep link, and operations blocked. Setup dashboard and Advanced readiness render the same findings.

| Condition | Certification | Automatic solve | Candidate adoption | Manual draft edits | Reviewed final export |
|---|---|---|---|---|---|
| Required fact missing, relevant review unknown/stale, unclassified omission | Block | Block | Block | Allow only commands whose authoritative placement semantics are evaluable; retain incomplete label | Block |
| Unsupported/unreviewed HARD meaning or contradiction | Block | Block | Block | Globally block canonical scheduling while active HARD meaning is unsupported; read-only/history still available | Block |
| Missing optional preference | Warn | Allow feasibility | Allow legal complete result | Allow | Allow with known quality limitations |
| Planning/policy/model changed since certification | Reconfirm current context | Block until reconfirmed | Block stale candidate | Require current authority/rebase as existing command contract demands | Block |
| Only old schedule stale or incomplete, setup otherwise valid | Allow | Allow fresh solve | Allow fresh complete validated candidate bound to current base | Governed repair/recovery allowed | Block until current complete version |
| Solver timeout/unavailable | Unaffected | Report unknown/unavailable | No absent/invalid candidate to adopt | Unaffected | Existing current complete schedule may export |
| Known omission explicitly informational | Record acknowledgement | Allow | Allow | Allow | Allow with appropriate note |

Extend the existing PlanningDatasetVersion confirmation event/metadata with Rulebook version, model fingerprint, review-set fingerprint/schema and reviewer/time. One aggregate certification event, not a separate lifecycle. A new planning version or changed policy/model/review status invalidates effective certification. Reconfirmation may reference the same planning version if only policy changed; retain append-only prior confirmation evidence. These checks must execute at server and database commit boundaries, not only the existing UI blocker filter. Do not trust a browser-submitted “ready” flag. No need to pin current schedule into setup certification: schedule changes are not changes to setup.

“Publishing” in this product means a reviewed final schedule artifact; public online distribution is post-v1. Draft/history exports stay available but are visibly labeled and cannot masquerade as current certified schedules.

## DEC-106 — Explicit supported product scope and simplification

v1 is weekly recurring classes for a studio in one scheduling timezone, daytime/non-overnight sessions on a 15-minute grid. GEN-04 aligns Sunday across TS/Python/SQL/UI. Scheduling dates/holiday exceptions, attendance tracking, payments, student portal, marketing, payroll, full SIS, arbitrary rules DSL, offline sync and custom integrations are post-v1 or not needed for this product. Do not add enterprise SaaS infrastructure before independent studio evidence.

Keep supported policies discoverable; unsupported HARD is “Recorded; automatic scheduling cannot enforce this yet” and blocks safety claims. Unsupported preferences are visible warnings and excluded from optimization. Known omissions live as governed Rulebook records with classification and resolution; unresolved classification blocks certification. Manager cannot waive a requirement merely to make readiness green.

Use browser print and CSV before a dedicated PDF service. Candidate records store existing Assignment shape plus context, never an alternate canonical schedule. Reuse version history for recovery. ClassSession.locked remains canonical existing lock fact; no competing lock toggle/store. Preference scoring is deterministic and separate from feasibility, with explicit tiers/units. DWDE may use feasibility plus manual finishing if manager accepts actual usability; otherwise OPT-01/02 move ahead of ACC-01 as recorded gate adjustment.

## DEC-107 — AI containment and eventual assistance

KEEP NOW only read-only explanations demonstrably bound to current canonical context and accurate capabilities. CHANGE BEFORE DWDE: hide current Copilot/scenario affordances that imply legacy mutation/legality; SAFE-02 contains exposure until an aligned path is verified. REMOVE/HIDE legacy enforcement approval or unsupported direct mutation suggestions. DEFER conversational intake and automated difference summaries until deterministic forms and pilot evidence exist. REBUILD LATER only the context/proposal adapter, not the whole application.

Optional future vocabulary: planning-entity proposal, roster proposal, policy proposal, review confirmation request, known omission, clarification question. A review confirmation request is not an attestation until a human acts through the governed command. Proposals pin tenant/base versions, show structured interpretation, require human review and use existing commands. No autonomous canonical mutation, inferred HARD meaning or dependency on AI service availability.

## DEC-108 — Execution and acceptance

31 STANDARD tasks and two HIGH-REASONING tasks (POL-01, GEN-01); no unresolved ARCHITECTURAL REVIEW task required to begin. Higher reasoning is reserved for cross-runtime semantic transition/parity, not vague prompts. For each family use explicit parameter schemas, fixtures and sequential checkpoints. Standard implementation should read AGENTS, README/NEXT and assigned prompt, then task-specific decisions; no full historical archaeology.

Keep historical T01–T13 accepted completion; new corrective findings receive new IDs. Future T14–T29 are superseded with explicit mapping. TASKS is status authority, MASTER_PLAN milestone authority, NEXT exactly one selected task. No fixed one-task-per-session restriction; a coherent authorized slice may be completed autonomously. Missing external acceptance evidence does not block unrelated product development.


## DEC-109 — Certification preparation and lock transition

Model publication must be available during confirmation preparation without solving or requiring prior confirmation. Server compiles/publishes complete supported meaning, reloads coherent context, then the manager confirms that exact policy/planning/model/review token. Solver/adoption tokens include certification/review revision; revocation after solve invalidates adoption even without changed facts. Global unsupported HARD blocks canonical scheduling; no unproven partial-HARD evaluator is introduced.

Existing effective locks OR session and assignment flags. One governed lock/unlock command changes planning session lock plus new current ScheduleVersion assignment lock atomically, validating unchanged placements/current authority and showing the context change. Prior versions remain immutable. Unlock clears both current flags; no two independent writable controls. Lock change stales aggregate certification/candidates and requires explicit reconfirmation. This is an explicit action, never a silent rebase.

Optimization engineering depends on SET-07/VERIFY-01 and UX-02, not private acceptance. Default milestone is C, but ACC-01 can require it earlier without a dependency cycle. Generic engineering starts after UX-03/VERIFY-01; B release still requires A acceptance. Private data gates block acceptance, not independent engineering.

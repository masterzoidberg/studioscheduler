# ADR 0001: Scheduling foundation decisions

Status: Accepted

Date: 2026-09-02

## Context

DWDE has a working manual visual scheduler, a human-reviewed Rulebook, versioned schedules, governed mutation RPCs, and deterministic partial HARD validation. The next phase adds entity-centered Rulebook navigation, complete Rule accounting, a compiled constraint model, planning-data versioning, and eventually automatic schedule generation.

The main architectural risk is creating multiple competing truths across the Rulebook, UI, validator, database, AI, and solver. The migration must preserve the current manual scheduler while reducing semantic duplication.

## Decisions

### 1. Rulebook versions are immutable policy history

A sealed RulebookVersion is not edited in place. New human policy clarifications or changes create a new RulebookVersion with provenance and a new canonical hash. Existing Rulebook v2 remains historical once a successor is sealed.

### 2. Entity-centered presentation, canonical Rule storage

Teachers, rooms, classes, dancers/students, and the studio may expose Rules as an entity-centered view. Rules remain canonical first-class records stored once. Typed RuleTarget relationships will connect one Rule to one or more entities without duplicating Rule content.

### 3. Facts and Rules remain distinct

Presentation facts and entity identity data are not converted into Rules merely for consistency. Scheduling-significant facts may be derived from reviewed Rules where policy is their authority. The compiler will preserve provenance from the source Rule.

### 4. No custom human-facing scheduling DSL

DWDE will use structured rule templates and a deliberately small machine Constraint IR. The IR is an implementation representation, not a language the studio manager must learn.

### 5. No blanket human approval for deterministic mappings

The studio manager has already reviewed policy. Translating unambiguous reviewed policy into deterministic machine semantics is an engineering task verified by tests. Human review is required only when a genuine policy ambiguity or contradiction remains.

### 6. One compiled constraint model is the semantic spine

The canonical Rulebook will compile deterministically into one Constraint IR / ConstraintModelVersion. Client validation, authoritative server validation, solver translation, and explanations must consume that same model rather than independently reinterpreting Rule prose.

Browser validation is preview feedback, not authority. The authoritative normal mutation validator will run server-side before governed writes. Postgres continues to enforce authentication, authorization, version checks, transactional integrity, structural invariants, audit, and ScheduleVersion creation.

### 7. The AI and solver are never canonical write authorities

AI output remains a proposal or explanation. Solver output remains a candidate. Both must pass through the same authenticated, version-aware, validation-gated adoption/mutation boundary used by human edits before canonical state changes.

### 8. Reproducibility will use snapshots, not event sourcing

DWDE will introduce a content-addressed PlanningDatasetVersion for solver-significant facts rather than full event sourcing or bitemporal modeling. Presentation-only changes will not create new planning dataset versions.

### 9. Solver choice remains provisional until a bake-off passes

OR-Tools CP-SAT in Python is the current front-runner. It is not an irreversible architecture decision until a representative DWDE feasibility/infeasibility spike proves modeling ergonomics, validation conformance, pinning, diagnostics, solve time, and maintainability. Timefold remains the fallback candidate if the spike exposes material shortcomings.

### 10. The manual scheduler remains continuously usable

The current visual/manual scheduling workflow is protected throughout migration. New architecture is introduced additively and cut over behind conformance checks; no greenfield rewrite is authorized by this ADR.

## Consequences

- Rulebook v2 remains preserved even when Cami's new clarifications are sealed into a later Rulebook version.
- The existing EnforcementVersion concept will be evolved toward ConstraintModelVersion rather than expanded indefinitely.
- Existing SQL and TypeScript scheduling semantics may temporarily run in parallel during conformance testing, but duplicate handwritten rule engines are not the target architecture.
- Entity-centered Rule editing should wait until the canonical target/registry/compiler model is stable enough to keep edits safe and auditable.
- Automatic schedule generation must not begin until the input dataset and HARD constraint coverage pass a Ready-to-Schedule gate.

## Rejected alternatives

- Duplicate Rule records on teacher/room/class rows.
- A custom scheduling DSL for Cami.
- Full event sourcing.
- Treating the LLM as legality authority.
- Treating the solver as a direct database writer.
- Permanently maintaining separate SQL, TypeScript, and solver rule interpretations.
- Adopting Timefold or OR-Tools solely from documentation without a representative DWDE spike.

# OPT-02 — Optimize within proven HARD feasibility

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **C**. Dependencies: **OPT-01, UX-02**.
Status is owned by [TASKS](../../TASKS.md); this prompt is historical completion evidence.

## Outcome and current state

Bound optimization by existing service deadline; lexicographically improve reviewed objectives, retain feasible incumbent, independently validate/rescore results. Explain best-found vs proven optimal. Return feasible incumbent when time expires; never relax HARD policy.

## Architectural decisions already made

Read [DECISIONS](../../DECISIONS.md) and [execution rules](../../CODEX_EXECUTION_RULES.md). Supabase remains operational truth: planning facts in PlanningDatasetVersion, policy in RulebookVersion, deterministic compiled meaning in ConstraintModelVersion, adopted placements in ScheduleVersion. Preserve pinned historical authority and typed unsupported-policy rejection. Review metadata never duplicates facts. Reuse existing commands/components; a planned route/schema is new work, not an existing path claim.

## Scope and required behavior

Bound optimization by existing service deadline; lexicographically improve reviewed objectives, retain feasible incumbent, independently validate/rescore results. Explain best-found vs proven optimal. Return feasible incumbent when time expires; never relax HARD policy.

## Implementation

The existing CP-SAT feasibility model now applies supported typed Objective IR tiers in reviewed rank/strength/rule order, with deadline-bounded stages and incumbent retention. The service reports feasibility-only, proven-optimal, feasible-incumbent and no-feasible-solution outcomes. The TypeScript gateway independently validates HARD legality, rescoring the returned candidate and comparing it with the current schedule without introducing a second schedule authority.

## Verification and limitations

Known-optimum, timeout outcome, lock preservation and HARD-parity regressions pass in the pinned Python suite. Full TypeScript tests, lint, typecheck, production build, disposable DB chain, pinned parity and authenticated disposable e2e all pass. Timeout contract tests use deterministic solver stubs for timing-independent coverage; no production/private-data access, deployment, merge, push or destructive operation occurred. See the OPT-02 completion record in [TASKS](../../TASKS.md).

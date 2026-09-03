# DWDE CP-SAT feasibility engine

This package is the deterministic HARD-feasibility engine for the DWDE Studio Scheduler.

## Contract

The solver consumes **versioned planning facts + compiled Constraint IR**. It does not read prose Rulebook text and it does not write canonical schedule data directly.

The caller is responsible for supplying the exact Rulebook/ConstraintModel/PlanningDataset context that passed the application readiness gate.

`solve_feasibility(problem)` returns one of:

- `FEASIBLE` — a complete candidate assignment exists under every solver-enforced HARD node and every delegated data precondition supplied by the caller.
- `INFEASIBLE` — no candidate exists under the supplied HARD model.
- `PRECONDITION_REQUIRED` — a HARD requirement delegated to planning/readiness has not been explicitly proven by the caller.
- `UNSUPPORTED` — the model contains a Constraint IR kind the solver does not understand. This is fail-closed.
- `UNKNOWN` — CP-SAT did not prove feasibility or infeasibility within the configured limit.

## Current enforcement

The CP-SAT model directly enforces:

- resource no-overlap for rooms, teachers, and dancer rosters
- 15-minute time grid
- scoped day/time operating windows and explicit overrides
- prohibited days
- teacher and dancer maximum gaps
- maximum teacher workdays
- dancer-level latest finish
- maximum dancer attendance days
- required room and teacher assignments
- teacher subject/level qualification domains
- teacher day/time availability windows
- directly-after sequencing, including selectable designated weekly Ballet meetings
- policy-fixed assignments
- room capacity with reviewed exemptions
- Karly/daughter start alignment

`REQUIRED_LOWER_LEVEL` is currently delegated to the Ready-to-Schedule data-precondition layer because it is an enrollment/progression fact, not a time-placement relation. The solver will refuse to run unless the caller includes that node in `preflight.validatedDelegatedConstraintIds`.

## Safety properties

- one search worker and a fixed seed are used for same-runner reproducibility
- unsupported semantics fail closed
- teacher qualification can be default-deny when the Constraint Model carries the `CUR-007` governance assertion
- fixed-anchor assumptions are used for the current infeasibility-core diagnostic pass
- generated assignments are candidates only; adoption must pass the governed application mutation/revalidation boundary

Soft optimization is intentionally out of scope for this package until HARD feasibility is proven on real DWDE planning data.

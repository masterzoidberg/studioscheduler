# DWDE CP-SAT feasibility engine

This package is the deterministic HARD-feasibility engine for the DWDE Studio Scheduler.

## Contract

The solver consumes **versioned planning facts + compiled Constraint IR**. It does not read prose Rulebook text and it does not write canonical schedule data directly.

The application is responsible for supplying the exact Rulebook/ConstraintModel/PlanningDataset context that passed the readiness gate. `lib/solver-problem.ts` is the canonical application-side request builder. A solve request is not valid merely because it is syntactically correct.

`solve_feasibility(problem)` returns one of:

- `FEASIBLE`: a complete candidate assignment exists under every solver-enforced HARD node and every delegated data precondition supplied by the caller.
- `INFEASIBLE`: no candidate exists under the supplied HARD model.
- `PRECONDITION_REQUIRED`: a HARD requirement delegated to planning/readiness has not been explicitly proven by the caller.
- `UNSUPPORTED`: the model contains a Constraint IR kind the solver does not understand. This is fail-closed.
- `UNKNOWN`: CP-SAT did not prove feasibility or infeasibility within the configured limit.

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

`REQUIRED_LOWER_LEVEL` is delegated to the Ready-to-Schedule data-precondition layer because it is an enrollment/progression fact rather than a time-placement relation. The application validates that requirement deterministically and supplies the exact validated node ID in `preflight.validatedDelegatedConstraintIds`. The solver refuses to run when that proof is absent.

## HTTP service

The production boundary is a small FastAPI service in `dwde_solver/service.py`.

- `GET /healthz` reports service health and whether internal authentication is configured.
- `POST /v1/feasibility` accepts `{ problem, maxSeconds }`.
- `SOLVER_INTERNAL_TOKEN` is mandatory for solve requests and is supplied as `Authorization: Bearer <token>`.
- the service validates the request contract and verifies that RulebookVersion, PlanningDatasetVersion, and compiler version agree with the embedded Constraint Model before CP-SAT is invoked.
- solve time is capped server-side at 30 seconds.
- the service never authenticates studio users directly and never reads Supabase. User authorization and canonical data construction belong to the application backend. This keeps the solver stateless and prevents a browser from submitting arbitrary scheduling truth.

The included Dockerfile is suitable for a stateless container platform such as Cloud Run. It runs as a non-root user and uses one Uvicorn worker so CP-SAT resource use stays predictable.

Local container example:

```bash
docker build -t dwde-solver ./solver
docker run --rm -p 8080:8080 -e SOLVER_INTERNAL_TOKEN=local-dev-secret dwde-solver
```

## Published container image

`.github/workflows/solver-image.yml` publishes the tested production container to GitHub Container Registry when solver code reaches `main`, and can also be invoked manually.

The package name is:

```text
ghcr.io/masterzoidberg/studioscheduler-solver
```

Every publication gets both a convenience `main` tag and an immutable commit tag of the form `sha-<full-git-sha>`. The workflow also emits an OCI image digest and generates BuildKit provenance plus an SBOM.

Production deployments should pin the **image digest** (or at minimum the immutable SHA tag), not the moving `main` tag. That makes the running solver traceable to the exact repository revision that CI tested. GHCR package visibility is managed separately from repository visibility, so consumers must not assume the package is public.

No runtime credential is baked into the image. A deployed service must receive `SOLVER_INTERNAL_TOKEN` through its platform secret/environment mechanism. The Next.js backend must receive the matching token as `SOLVER_INTERNAL_TOKEN` plus the deployed HTTPS endpoint as `SOLVER_SERVICE_URL`. Neither value belongs in `NEXT_PUBLIC_*` configuration.

## Safety properties

- one search worker and a fixed seed are used for same-runner reproducibility
- unsupported semantics fail closed
- delegated HARD data semantics require explicit proof
- teacher qualification is default-deny when the Constraint Model carries the `CUR-007` governance assertion
- fixed-anchor assumptions are used for the current infeasibility-core diagnostic pass
- generated assignments are candidates only; adoption must pass the governed application mutation/revalidation boundary
- the HTTP service requires an internal server-to-server credential and echoes the exact version context used for every result
- production images are content-addressable and traceable to the tested Git commit

Soft optimization remains intentionally out of scope until HARD feasibility is proven on a ready DWDE Planning Dataset.

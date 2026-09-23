# OPS-01 engineering release checkpoint

This checklist is the bounded engineering portion of OPS-01. It prepares a release and recovery rehearsal without deploying, connecting to production, changing customer data, or claiming managed Supabase Auth fidelity.

## Repository contract

Run from the repository root:

```powershell
node scripts/ops01-rehearsal.mjs --check-repo
```

The checker verifies the Vercel branch deployment policy, non-root single-worker solver image, `/healthz` probe, documented internal solver credential, server/public environment boundary, and a version manifest. The current expected versions are printed from source rather than copied into a second configuration system:

| Component | Expected source |
|---|---|
| App/package and Next.js | `package.json` |
| Node/npm CI toolchain | `.github/workflows/ci.yml` |
| Solver service/Python/OR-Tools | `solver/dwde_solver/service.py`, `solver/Dockerfile`, `solver/requirements.txt` |
| Database image | pinned digest in `scripts/test-db.mjs` |
| Migration head | lexicographically latest SQL filename in `supabase/migrations/` |

## Staging configuration gate

Supply values from the separately authorized staging app and solver environments, then run:

```powershell
npm run ops:check-config
```

The command fails visibly when any required value is absent or malformed and never prints secret contents. It requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SOLVER_SERVICE_URL`, `SOLVER_INTERNAL_TOKEN`, `SOLVER_MAX_SECONDS` in the inclusive range 1–30, and `APP_URL`. Staging URLs must be HTTPS and non-loopback. The solver credential must be distinct from both Supabase credentials. A passing local loopback check is available only as an explicitly named diagnostic with `--allow-loopback`; it is not staging evidence.

When staging access is authorized, the operator must additionally observe:

1. the app authenticates a synthetic staging user and rejects an unauthenticated request;
2. the app reaches the solver only through the server-side bearer credential;
3. the solver returns `/healthz` with `status: ok`, the expected `serviceVersion`, and `authConfigured: true`;
4. an invalid solver bearer is rejected, a valid solve is accepted, and a request over the configured limit is rejected before CP-SAT runs; and
5. the app timeout is the solver limit plus its five-second transport margin, with timeout surfaced as unknown/unavailable rather than infeasible.

These observations require the owner’s staging credentials and are not fabricated by the disposable rehearsal.

## Disposable backup and restore rehearsal

Run only against the pinned local disposable PostgreSQL container:

```powershell
npm run ops:restore
```

The rehearsal replays the repository bootstrap, archived ledger provenance and forward migrations through the existing harness, seeds deidentified canonical data, creates an ephemeral plain `pg_dump`, restores it into a second disposable database, and compares stable summaries of:

- RulebookVersion, PlanningDatasetVersion, ConstraintModelVersion and ScheduleVersion counts/fingerprints;
- current-schedule identity and assignment count/content hash; and
- the canonical studio inventory represented by the dump.

It then runs an intentionally failing migration transaction. The pre-existing rehearsal history row must remain the only history row, and the migration’s new object must not exist after the failed transaction. The temporary database and dump are removed during cleanup. The command prints the named rehearsal stages and reconciliation result; it does not retain private or credential-bearing artifacts.

Migration failure is a hard failure. No historical migration or production-ledger file may be edited to make the rehearsal pass. New schema changes must remain forward migrations with a version above the recorded production head.

## Rollback-to-read-only procedure

This repository has role-scoped read-only access for `VIEWER`, but it does not currently have a global application maintenance/read-only switch. A Vercel rollback or disabling new deployments alone must therefore not be described as write isolation.

For an authorized incident:

1. stop promotion and record the deployed app SHA, migration head, solver image/version and incident time;
2. use the approved platform/database traffic-control procedure to stop write-capable traffic while retaining read access; if that control is not available and verified, stop and do not call the system read-only;
3. restore the last known compatible immutable app deployment, without rewriting migration or schedule history;
4. verify app configuration, solver `/healthz`, migration head and version/hash/assignment reconciliation in the isolated recovery target;
5. keep the system read-only while any context, restore or migration discrepancy is investigated; and
6. re-enable write-capable traffic only after the owner records the health and reconciliation evidence.

The platform/database steps and real deployed evidence remain an external owner gate. OPS-01 engineering completion does not authorize deployment, production testing, or customer-data recovery.

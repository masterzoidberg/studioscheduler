# Disposable database integration harness

`npm run test:db` reconstructs the current database command surface in a fresh, disposable PostgreSQL 17.6 container pinned by the Docker image index digest `sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94`. It never imports `lib/supabase.ts`, reads application Supabase credentials, connects to an external host, or mutates a project outside the container.

## Prerequisites

- Docker Desktop must be installed and its daemon running.
- Node.js 20 or newer is required by the current Supabase-supported local tooling/runtime.
- No Supabase CLI or host `psql` installation is required; `psql` is executed inside the pinned PostgreSQL image.
- Run from the repository root after `npm ci`.

The command itself is the positive disposable opt-in:

```powershell
npm run test:db
```

CI runs this command on the Ubuntu quality leg, where the hosted runner provides Docker; the Windows leg covers the cross-platform TypeScript gate.

For a direct script invocation, pass `--allow-disposable`. The optional `STUDIO_SCHEDULER_TEST_DB_TARGET` value may only be `docker-local`. Any configured production or external Supabase URL is rejected before Docker starts. If Docker is unavailable, the command exits with an actionable setup error; it does not skip.

## Reconstruction sequence

Each step runs as PostgreSQL owner in its own transaction and is discarded with the container on failure:

1. Create the ephemeral `auth`, `vault`, `extensions`, and `private` schemas, non-production database roles, and the minimum `auth.uid()`/Vault behavior required by the application SQL.
2. Apply the unchanged `supabase/bootstrap/2026-08-31-production-schema-baseline.sql`. The harness removes only its `CREATE EXTENSION supabase_vault` statement at runtime because the plain PostgreSQL image cannot provide the Supabase-managed extension; the shim provides the required test boundary.
3. Apply a test-only compatibility bridge for the bootstrap snapshot's pre-V2.1 `public.entity_versions` columns. It adds the versioned `before_entity`/`after_entity` shape expected by the archived V2.1 SQL without changing the historical bootstrap file. The same bridge supplies inert definitions for legacy RPC signatures that the archive revokes, so the historical revoke statements remain unchanged and the signatures remain non-executable.
4. Validate the archived production-ledger filenames, byte lengths, and Git blob SHA-1 values against `manifest.json`, then apply the archived V2.1 SQL in filename order. Archive files are provenance inputs for this fresh disposable reconstruction only; they are not moved into `supabase/migrations/` or recorded as new production migrations.
5. Before `20260902130713_rulebook_v3_post_review_confirmations.sql`, seed a deidentified 178-rule V2 witness containing the two rule descriptions that migration explicitly verifies. This resolves the bootstrap's documented schema-only/data-import boundary in test setup rather than weakening or rewriting the migration.
6. Apply every repository-authored file in `supabase/migrations/` in filename order. A migration failure names the exact file and destroys the incomplete container.
7. Seed only synthetic T02 identities in the baseline DWDE studio, then run the governed planning-entity RPC as owner, editor, viewer, and nonmember.

## Fixture identities and assertions

All four users use the reserved `.example.test` domain and fixed UUIDs local to the disposable container:

| Identity | UUID suffix | Membership | Expected result |
|---|---:|---|---|
| T02 Owner | `...0001` | `OWNER` | Governed teacher create succeeds |
| T02 Editor | `...0002` | `EDITOR` | Governed teacher create succeeds |
| T02 Viewer | `...0003` | `VIEWER` | Write rejected; studio rows remain RLS-visible |
| T02 Nonmember | `...0004` | none | Write rejected; studio rows are RLS-hidden |

The harness reads the reconstructed studio's current Planning Dataset version, then verifies that owner and editor writes advance it by one. A subsequent owner write using the version observed before the editor write must be rejected as `STALE_PLANNING_DATASET` and must leave no teacher row. The harness also verifies that the legacy rule mutation RPC is not executable by the authenticated role.

## Constraint Model JSONB round trip

The same disposable run publishes a synthetic, complete Constraint Model with nested selector and parameter objects through `publish_constraint_model_v30`, reads the stored `jsonb` snapshot back, and checks PostgreSQL JSONB semantic equality. It then submits the same model with recursively reordered object keys. The publisher must return `alreadyCurrent=true` with the original version and `snapshot_hash`; this exercises the historical `constraint_model_hash_v27` path without changing or regenerating any historical fingerprint. Array order is preserved in both submissions and remains significant in TypeScript comparisons.

## Canonical candidate interval adoption

The run then seeds synthetic T04 resources (`t04-teacher`, `t04-room`, `t04-class`, and `t04-session`) in the reserved T02 studio. The class duration is 60 minutes and the session has a 90-minute override. The fixture confirms the exact current Planning Dataset snapshot through the v3.9 evidence-bearing confirmation RPC, constructs a current schedule, and grants the disposable `service_role` shim the equivalent RLS bypass/table boundary needed by the adoption RPC.

The service-role adoption test submits `Monday 17:00–18:30` and verifies that the current schedule contains exactly that persisted end time. It then submits the shortened `17:00–17:15` interpretation, requires `CANDIDATE_INVALID_ASSIGNMENTS`, and verifies that the schedule-version count and current pointer remain unchanged after the rejected transaction. The fixture is synthetic and is discarded with the container; it does not alter the production ledger or any external database.

## Teardown and ledger safety

The container uses `--rm` and is force-removed in a `finally` block after success or failure. Its only database password and all fixture data exist inside that short-lived container. The harness does not run `supabase db push`, `supabase db reset`, a restore command, or any command against a production/staging project.

The production-ledger manifest remains the byte authority. A manifest mismatch fails before migrations run. Historical SQL is read-only evidence; any future behavior change must be a new forward migration with a version greater than the recorded production head.

## Staging recovery outline

This task does not execute recovery. For an authorized staging incident, the release operator should:

1. Stop staging writes and record the deployment SHA, migration head, current Rulebook/Constraint Model/Planning Dataset/Schedule versions, and essential row counts.
2. Restore the approved staging backup into a second disposable staging project, never into production, and keep the original staging project unchanged for forensics.
3. Verify the restored migration head against the repository ledger and run `npm run test:db` plus the relevant parity checks against the disposable copy.
4. Compare versions, hashes, membership/RLS behavior, and archive completeness; obtain release-owner approval before any staging promotion.
5. If recovery is not proven, preserve both copies and escalate with the captured metadata rather than attempting an unverified production restore.

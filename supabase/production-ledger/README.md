# Production migration ledger archive

The `.sql` files in this directory are archival copies of the exact V2.1 SQL statements recorded as successful migrations in the production Supabase project's `supabase_migrations.schema_migrations` ledger.

They are stored outside `supabase/migrations/` on purpose. They provide provenance and auditability without pretending that repository migration tracking existed before these changes were applied.

## Integrity rule

For every archived `.sql` file, the Git blob SHA-1 of the file contents must equal the Git blob SHA-1 computed from the corresponding production migration SQL statement. The V2.1 stabilization release was verified 11/11 against this invariant.

## Do not replay blindly

These files describe migrations that have already run in production. Do not move them into `supabase/migrations/` or apply them to an existing environment without an explicit reconciliation plan.

New migrations created from the repository after this stabilization belong in `supabase/migrations/`.
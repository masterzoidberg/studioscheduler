# Production migration ledger archive

The `.sql` files in this directory are archival copies of exact SQL statements recorded as successful migrations in the production Supabase project's `supabase_migrations.schema_migrations` ledger when those statements were not already represented byte-for-byte by repository-authored migration files.

The archive began with the V2.1 stabilization set and now also records later direct-production reconciliation material, including the `20260901041429_fix_list_studio_members_v21_return_types` hotfix.

They are stored outside `supabase/migrations/` on purpose. They provide provenance and auditability without pretending that repository migration tracking existed before those changes were applied or causing an already-applied direct-production migration to be replayed.

## Integrity rule

For every archived `.sql` file, the Git blob SHA-1 of the file contents must equal the Git blob SHA-1 computed from the corresponding production migration SQL statement. The manifest in this directory pins the production version, migration name, byte length, and Git blob SHA-1 for every archived entry.

## Do not replay blindly

These files describe migrations that have already run in production. Do not move them into `supabase/migrations/` or apply them to an existing environment without an explicit reconciliation plan.

Repository-authored migrations created after migration tracking became operational belong in `supabase/migrations/` and must use versions that match the production migration ledger once applied.

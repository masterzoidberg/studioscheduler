# Supabase migrations

This directory intentionally contains **no reconstructed or invented SQL migration history**.

The production database existed before complete repository migration tracking was established. Earlier draft SQL files were removed because they did not byte-for-byte represent the migrations actually applied to production.

Use:

- `../bootstrap/` for a reconstructable schema/bootstrap snapshot.
- `../production-ledger/` for archival copies of the exact successful V2.1 SQL statements recorded in `supabase_migrations.schema_migrations` in production.
- This directory for **new migrations created from this repository going forward**.

Do not copy archival ledger files into this directory and replay them against an existing environment unless a deliberate migration-reconciliation plan has been reviewed first.
# Supabase migrations

V2.2 is the point where repository-authored migration tracking became operational for this project.

The V2.2 SQL in this directory was authored in GitHub before application. Supabase assigned the successful production migration versions at apply time, so the filename prefixes here are reconciled to those **actual production ledger versions**. This prevents a future migration tool from treating already-applied V2.2 work as new migrations.

## Important distinction

The files here preserve the reviewed repository source used for the V2.2 rollout. Some production ledger statements differ byte-for-byte because comments/formatting and the exact submitted SQL payload were not always identical to the source file text.

Therefore:

- the filename/version is authoritative for migration reconciliation;
- `../production-ledger/` is the archival provenance area for exact production-ledger material from stabilization;
- do not claim byte-for-byte identity unless an integrity check explicitly proves it;
- never replay an already-recorded production version merely because its source text differs cosmetically.

New migrations must use a new version greater than the current production ledger head and should be committed before application whenever possible.

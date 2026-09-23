# Account and workspace privacy lifecycle

This runbook covers invitations, workspace export, and owner-requested workspace deletion in the current Studio Scheduler implementation. It is an operator procedure; it does not authorize deletion or provide legal retention terms.

## Invitations

- A current workspace Owner creates an invitation for one email and role from Settings. Invitations expire seven days after creation.
- The app does not send an invitation email. The Owner shares the sign-in URL through a channel they choose.
- The invitee signs in with the same confirmed email address, reviews the workspace name and role, and explicitly accepts. Signup never attaches a user to a workspace automatically.
- The acceptance transaction checks the exact invitation ID, selected workspace ID, current Auth email, confirmation state, expiry, and pending/revoked status. It serializes against workspace role changes and revocation.
- An Owner can revoke a pending invitation. An expired or revoked invitation cannot be accepted. A new invitation creates a fresh pending record.
- The invitee sees only invitations for the email on their current Auth account. An invitation to a different email or workspace produces no membership write.

## Owner workspace export

In **Settings → Export workspace data**, a current Owner can download the selected workspace as `studio-scheduler/workspace-v1` JSON. The server authorizes the selected workspace and Owner role before returning data. The export includes the studio, current members and invite history, and the tenant rows for inventory, rosters, classes, policies, planning and constraint-model versions, schedules and assignments, scenarios, setup reviews and assignments, import records, solver candidate reviews, and audit history.

The export contains student and staff details and may contain names or notes in historical records. The Owner should store and share the downloaded file as private data. Auth credentials, access tokens, and user-level API keys are not included. The export is tenant-scoped; it does not export another studio or project-level backups.

The separate **Export current Rulebook** action remains a policy-only export and is not a substitute for the workspace export.

## Owner-requested workspace deletion

There is no delete button or self-service account deletion endpoint. A deployment must publish a named support contact before it can claim an operational deletion intake path. Until then, do not route requests through public issues or include roster data in support messages.

For a request received through the deployment’s private support channel:

1. Verify the requester by having them sign in and confirm that they are a current Owner of the exact workspace. Record the workspace UUID, requester identity, request scope, and verification in the private support record.
2. Clarify whether the request is to remove one member, delete the whole workspace, or delete a user’s Auth account. These are separate actions. Removing a member does not remove that person’s account or data in other workspaces.
3. Offer the Owner the workspace export before deletion. Keep any exported file only in the approved private support location and follow the deployment’s retention terms.
4. Rehearse the deletion in an isolated disposable database containing a deidentified copy. Scenarios and schedules restrict deletion of their pinned ConstraintModelVersion; schedules also pin an EnforcementVersion; ConstraintModelVersion restricts deletion of its RulebookVersion. Delete dependent scenario rows, then schedule rows, then constraint-model rows before deleting the exact `public.studios` row. Confirm that no tenant rows remain and that shared Auth users remain.
5. Have a second operator review the exact workspace UUID, dependency order, and expected cascade before any live deletion. Run the approved SQL in one transaction, verify affected rows against the request, then commit. Record the operator, reviewer, timestamp, tenant UUID, and row-count evidence in the private support record; do not put student names in that record.

For the reviewed live operation, the dependency order is:

```sql
begin;
delete from public.scenarios where studio_id = '<verified-workspace-uuid>';
delete from public.schedule_versions where studio_id = '<verified-workspace-uuid>';
delete from public.constraint_model_versions where studio_id = '<verified-workspace-uuid>';
delete from public.studios where id = '<verified-workspace-uuid>' returning id;
-- Verify the studio is absent and no rows remain in tenant tables before commit.
-- Roll back on any mismatch; commit only after the independent review.
```
6. Keep the Auth account unless the request separately covers that account and an operator has verified it has no other workspace access or restricted references. User-level API credentials are account-scoped, not workspace-scoped.
7. Report completion as deletion from the live workspace database only until the project’s backup, point-in-time recovery, email, and log retention windows have been checked. Deleting live rows does not erase older backups. Do not promise immediate or complete erasure from those systems without verified retention evidence.

The repository does not establish a deployment’s named support contact, contractual retention period, backup expiry, or live deletion authority. Those must be supplied by the project operator before accepting a real request or claiming full purge completion. The disposable deletion rehearsal in `scripts/test-db.mjs` is the engineering check; it does not delete or authorize deletion of customer data.

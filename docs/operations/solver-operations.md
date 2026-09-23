# Solver operations and manager recovery

This runbook covers the application-to-solver path and local recovery steps. It does not establish a deployed support contract, backup schedule, or production restore authority.

## Manager response to a failed build

1. A blocked build means the current Setup or Must happen review needs attention. Open **Setup** or **Must happen requirements** and resolve the findings there.
2. A timeout or service outage is not an infeasibility result. No candidate is saved and the current schedule remains unchanged. Check build readiness, wait briefly, and retry once.
3. If the failure repeats, copy the **safe support details** shown with the error and send them only to the workspace's approved private support contact. The copied bundle contains a request ID, solver error code, and HTTP status; it contains no studio, student, teacher, room, roster, or schedule data.
4. Continue to use the existing current schedule while the operator investigates. A candidate changes canonical schedule history only after explicit review and governed adoption.
5. To review a prior schedule, use **Versions** and the existing recovery flow. Recovery is revalidated against current policy. Do not interpret an application rollback as read-only protection: this repository has no global write-disable switch.

## Operator triage

Each feasibility POST emits one JSON event to the existing application host logs:

```json
{"event":"solver_feasibility_request","requestId":"<uuid>","httpStatus":503,"durationMs":24,"outcome":"UNAVAILABLE","failure":true,"code":"SOLVER_SERVICE_UNAVAILABLE"}
```

A request that reaches the gateway's server-side time limit is logged with HTTP `504`, outcome `TIMEOUT`, and code `SOLVER_SERVICE_TIMEOUT`.

The event contains a correlation ID, HTTP status, elapsed milliseconds, a bounded outcome, a countable failure flag, and an optional solver error code. It must never include request or response bodies, credentials, workspace IDs, assignments, or names. Search the host logs by `requestId`; count `failure: true` events over the host's chosen time window to see repeated failures. The repository does not configure an alerting threshold or a second telemetry store.

Interpret outcomes before acting:

- `INFEASIBLE` is a completed solve that found no legal placement under the supplied current model. It is not a service incident.
- `TIMEOUT` or `UNAVAILABLE` means no feasibility conclusion was reached. Check the app-to-solver network path and service health.
- `BLOCKED` means setup, policy, or version preflight rejected the build before a solver result.
- `ERROR` means the gateway or service returned an operational failure. Use the request ID and code; do not export or request the solve payload for routine triage.

Check required app configuration with `npm run ops:check-config`. This reports variable names and validation failures without printing secret contents. Check the solver's private `/healthz` endpoint from its configured network; expect `status: ok`, the deployed `serviceVersion`, and `authConfigured: true`. Never copy bearer tokens into tickets or logs.

If deployment state, migration head, or schedule-version reconciliation is uncertain, stop promotion and follow [OPS-01 rollback-to-read-only](../../plans/OPS-01_RELEASE_CHECKLIST.md). The procedure requires a verified platform/database traffic control before calling the system read-only, then a compatible immutable app restore and reconciliation in an isolated recovery target. Do not restore customer data or change production from this repository runbook alone.

## Restore and backup evidence

`npm run ops:restore` is a disposable engineering rehearsal. It creates an ephemeral local `pg_dump`, restores it into another disposable database, and compares canonical version and schedule summaries. It does not test a hosted backup, retention policy, recovery point, restore time, or customer-data recovery.

The following deployment facts are not established in this repository and must be supplied by the operator before claiming operational backup or support readiness:

| Required fact | Current evidence |
| --- | --- |
| Named support owner and private contact | Not recorded or configured |
| Backup owner | Not recorded |
| Backup interval and retention period | Not verified |
| Restore target, recovery point, and recovery time | No deployed restore observation recorded |

Do not accept real deletion, incident, or restore requests through public issues. Do not promise full erasure or recovery times until the owner verifies the platform's backup, point-in-time recovery, email, and log retention behavior.

## Supported scheduling boundary

The product handles recurring weekly studio sessions with explicit weekdays, a single studio time context, and 15-minute time increments. Scheduling uses the current Rulebook, Planning Dataset, compiled Constraint Model, and Schedule versions. Operating windows and rule exceptions must be represented in that reviewed context.

The solver does not schedule dated calendar events or infer holidays, attendance, payroll, billing, or substitute staffing. A returned candidate remains a proposal until a manager reviews and adopts it.

# M01 — Supported operations engineering

**Status:** COMPLETE — 2026-09-22. **Objective:** The existing scheduler has governed account/privacy controls and an operable support surface ready for real qualification. This milestone proves engineering behavior on disposable infrastructure; deployed and human acceptance are M02/M03.

## Scope

Complete the unfinished engineering portions of archived `OPS-02` and `OPS-03`. Close the already implemented setup-assignment slice's missing verification or explicitly exclude it from release. Preserve existing canonical authorities and the current uncommitted work. See [prior OPS-02](../../archived/pre-2026-09-22-plan/prompts/OPS-02.md), [OPS-03](../../archived/pre-2026-09-22-plan/prompts/OPS-03.md), and [TASKS](../../archived/pre-2026-09-22-plan/TASKS.md) as requirements/evidence inputs, not status authority.

## Out of scope

Deployed release action, real deletion of customer data, legal terms, independent manager/studio acceptance, pilot agreement, next-cycle work, and optional AI improvements.

## Current evidence

**Verified:** T01 account/privacy lifecycle, T02 redacted solver diagnostics and timeout/outage recovery, and T03 setup assignments all pass their required local DB, browser, unit, build and repository checks at the accepted implementation snapshot, now frozen at `cb6520d985d3febd2297e01311b298bb65e3c392`. The OPS-01 disposable configuration and restore rehearsals pass. Docker named-pipe access requires an elevated local test invocation in this sandbox. **Unknown and explicitly not claimed:** deployed service/configuration, named support owner/contact, hosted backup owner/interval/retention, and deployed restore target or recovery times. See the completion record below; M02 owns deployed and manager qualification.

**M01-T01 — VERIFIED COMPLETE, 2026-09-22 (verified from start HEAD `a0a1900b6325f9792bd7868885f8b4e09daccfa6`; frozen at `cb6520d985d3febd2297e01311b298bb65e3c392`):** Forward migrations V70–V72 serialize owner role/removal changes and invitation acceptance/revocation, protect the final owner, bind acceptance to the confirmed signed-in email and exact workspace/invite, expire invitations after seven days, and provide a tenant-scoped Owner export. Direct legacy mutation grants are revoked. `components/pending-invitations.tsx`, the workspace-selection and Settings flows provide explicit acceptance/revocation/export UI. `docs/operations/account-privacy-lifecycle.md` documents export contents, deletion dependencies, operator verification/review, and backup-retention limits; no actual deletion is authorized or claimed.

**T01 evidence:** The full disposable DB suite re-executed invitation lifecycle/races, exact membership/no-write boundaries, owner concurrency, scoped export and deletion rehearsal. The authenticated browser journey explicitly accepted the invite, and all full M01 gates passed against the accepted snapshot.

**M01-T02 — VERIFIED COMPLETE, 2026-09-22:** `app/api/solver/feasibility/route.ts` records request ID, HTTP outcome, duration and bounded error code through `lib/solver-operations.ts`; `lib/solver-outcome.ts` and `components/solver-feasibility-card.tsx` distinguish service timeout/unavailability, preserve the current schedule, and expose only a safe support bundle. `docs/operations/solver-operations.md` documents incident triage, manager help, restore/read-only steps, supported scheduling boundaries, and the support/backup facts that an operator must supply. The E2E harness provides loopback-only outage and hanging-timeout modes and rejects non-loopback inherited solver URLs.

**T02 evidence:** `tests/solver-operations.test.ts` covers failure countability, timeout classification and redaction. The targeted outage and timeout browser runs each passed (1 test); both verified the request correlation header, visible actionable UI, four-field support bundle, redacted host event and unchanged schedule, audit and planning state. `node scripts/ops01-rehearsal.mjs --check-repo --check-config --allow-loopback` passed with synthetic loopback-only values; these do not establish deployed configuration. The disposable OPS-01 restore rehearsal passed.

**M01-T03 — VERIFIED COMPLETE, 2026-09-22:** V69 and the setup-assignment UI/client slice were preserved and accepted after disposable DB and authenticated browser evidence. The assignment path remains tenant-scoped, uses canonical forms and rejects viewer/stale/cross-tenant writes.

**T03 evidence:** `npm run test:db` passed through SETUP-ASSIGNMENTS and later DB regressions. The full `npm run test:e2e` run passed SET-08 and the invitation journey.

## Completion record

**Starting reference:** branch `feat/pre-cami-hardening`, HEAD `a0a1900b6325f9792bd7868885f8b4e09daccfa6`. Local gates ran against the accepted worktree implementation snapshot, SHA-256 `ed09fcd08b3c0b1f04b22e1ae8c37d984801f2d7eb9aad80ae50dac7a5fdc0cf` (binary diff from starting HEAD plus non-plan untracked source/docs/tests/migrations; generated `.next`, `supabase/.temp`, Python caches and `test-results` excluded; plan records excluded to avoid a self-referential hash). That implementation was frozen in local commit `cb6520d985d3febd2297e01311b298bb65e3c392` on 2026-09-22. No user changes were reset or stashed.

**Executed checks:** `npm run lint` (exit 0; four warnings), `npm run typecheck` (exit 0), `npm test` (exit 0; 565 passed, 4 skipped), `npm run build` (exit 0), `npm run test:db` (exit 0; including M01, GEN-03 and SETUP-ASSIGNMENTS), `npm run test:e2e` (exit 0; 14 passed, 1 mode-specific skip), targeted disposable outage and timeout E2E (each exit 0, 1 passed), `node scripts/ops01-rehearsal.mjs --check-repo --restore --allow-disposable` (exit 0; backup/restore reconciliation and migration rollback), `node scripts/ops01-rehearsal.mjs --check-repo --check-config --allow-loopback` with synthetic loopback values (exit 0), `node --check` on both harnesses and the authenticated spec (exit 0), and `python plans/check_integrity.py` (exit 0 after final plan status edits). `npm run test:parity` was not applicable because no solver/IR semantics changed.

**Limits:** These checks establish local engineering behavior only. No deployed environment, real manager data, external support contact, hosted backup/retention terms, or deployed restore target was used or verified. M02 remains blocked on owner-authorized external release and manager evidence.

## Work required

| ID / status | Goal and likely files | Dependencies | Acceptance criteria | Validation |
|---|---|---|---|---|
| **M01-T01 — VERIFIED COMPLETE** | Finish governed account, roles and privacy mechanisms. Inspect latest membership/invite RPCs and grants, `components/settings-view.tsx`, `components/workspace-provider.tsx`, relevant migrations/tests; add forward migrations only. | Existing GEN-04 and OPS-01 disposable rehearsal; no deployed gate for local engineering. | Exact current tenant/role checks; invite/revoke/last-owner behavior; privacy export/deletion procedure and explicit operator limits; stale/unauthorized paths make no writes. | Full disposable DB and browser regressions, lint/typecheck/unit/build passed; see completion record. |
| **M01-T02 — VERIFIED COMPLETE** | Complete operator diagnostics, failure/timeout visibility, redacted logs, manager help and runbook. | T01 complete; no deployed gate for local engineering. | Synthetic outage and timeout are observable; safe support details; actionable manager help and restore/read-only limitations recorded. Unknown operator terms are not presented as verified. | Targeted unit/outage/timeout E2E, repository/config check, disposable OPS-01 restore, full lint/typecheck/unit/build/DB/E2E gates; see completion record. |
| **M01-T03 — VERIFIED COMPLETE** | Verify V69 setup-assignment migration, UI/client, and regressions. | Disposable DB and authenticated browser. | Owner/Editor assignments remain tenant-scoped; assignee uses canonical forms; viewer/cross-tenant/stale requests reject without writes. | Full `npm run test:db` and `npm run test:e2e`; SETUP-ASSIGNMENTS and SET-08 passed. |

## Completion gate

All three tasks have accepted exact-reference evidence at the recorded implementation snapshot, frozen at `cb6520d985d3febd2297e01311b298bb65e3c392`. SQL transactions and authenticated browser checks passed; operator steps and limits are documented without asserting deployed readiness. ROADMAP and NEXT now point to M02's blocked external qualification gate. No deployment, production test, external contact, real-data deletion, or paid service was performed.

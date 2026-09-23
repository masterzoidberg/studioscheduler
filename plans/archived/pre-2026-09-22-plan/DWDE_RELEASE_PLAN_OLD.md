> HISTORICAL — superseded by the 2026-09-07 rebuild. Not current instructions or status. Start at [current planning entry](README.md).

# DWDE Release Plan

**Question:** what must be true before DWDE should trust this application for real scheduling?

Release status: NOT_STARTED. Implementation task status is in [TASKS](TASKS_OLD.md). No current live deployment, full DWDE data, authenticated manager workflow, or restore was certified by the audit.

# P0 Release Blockers

| Gate | Required condition | Tasks | Required evidence |
|---|---|---|---|
| A01 | People, classes, sessions, durations, rosters, rooms, qualifications, availability, exceptions are complete and manager-reviewed | T14, T16 | Snapshot/hash, source reconciliation, named manager attestations; list omissions explicitly |
| A02 | All active HARD policy is supported, bound, and deterministically enforced; unsupported semantic edits fail closed | T05, T14 | Policy-edit regressions, exact model/version, coverage and delegated proofs |
| A03 | Equivalent Constraint Models survive canonical comparison and database round trip | T03 | Nested reorder and semantic-difference tests; JSONB result |
| A04 | Validated assignment intervals exactly match persistence | T04 | Verified in the T04 ledger: shortened interval rejection, duration override tests, exact persisted diff; overall release gate remains open until the remaining A-gates pass |
| A05 | Solver input is coherent and reviewed candidates bind base schedule/locks | T07, T08 | Verified: T07 coherent snapshot/in-solve drift tests plus T08 exact reviewed-context, same-version lock drift, concurrent-editor, and double-adoption transaction tests; overall release remains open until all A-gates pass |
| A06 | Every active required session appears once; archived sessions excluded; history preserved | T06, T11, T12 | Verified: T06 archive/restore and exact-session-set transactions, T11 active-target incremental transactions, and T12 archive-aware recovery/history-preservation lifecycle. |
| A07 | Individual multi-session meetings can be locked; locks survive all workflows | T09 | T09 verified shared stable-session lock fixture, deterministic impossible/conflict diagnostics, candidate validation, and assignment/session OR lock preservation through transactional adoption |
| A08 | MOVE/ASSIGN/UNASSIGN/rebase/undo/adoption/revalidation use shared scheduling semantics | T10–T13 | Verified: T10 MOVE, T11 ASSIGN/UNASSIGN, T12 rebase/undo, and T13 executed privilege/direct-call closure leave current service Constraint-IR authority as the application write surface. |
| A09 | Partial editing remains possible; incomplete drafts cannot be published/adopted as complete | T10–T12 | Verified: T10/T11 command drafts plus T12 recovery drafts preserve explicit unscheduled/completeness obligations and cannot claim publishability unless complete and independently valid. |
| A10 | Real full DWDE workload solves within a manager-agreed budget with zero independent HARD violations | T14 | Complete fixture, environment/versions, timing/memory, result/rescore |
| A11 | Conflict, missing information, INFEASIBLE, UNKNOWN, unsupported semantics, and service failures are distinct/actionable | T15 | Deterministic result fixtures and user-visible output |
| A12 | Manager can review/adopt/edit/recover/export and use mobile viewing without engineering | T16 | Workflow below, export artifact, device/browser evidence |
| A13 | Auth/roles, deployment configuration, explicit environment selection, restore procedure verified | T02, T13, T16 | Nonproduction role suite, deployment metadata from authorized operator, restore drill |
| A14 | AI cannot mislead about current authority; disable unsupported proposals/legacy guidance if alignment is unfinished | T16; T28 later | Enabled capability list, context checks, absence of direct AI writes |

No P0 waiver based solely on a deadline. If a criterion changes, record the decision and explain the impact on trust.

# P1 Strongly Preferred

- [ ] Initial high-value preference scoring and optimization produce useful schedules (T17/T18).
- [ ] Candidate/current comparison and a small diverse persistent candidate set (T19).
- [ ] Readable quality breakdown and deterministic rescoring (T17/T19).
- [ ] Explain existing fixed-anchor diagnostic evidence (T15); broader diagnostics may follow.
- [ ] Small atomic multi-placement edits for swaps if single-edit repair rules prevent reasonable work (future bounded T11/T12 child only on evidence).
- [ ] Candidate review survives refresh (T19).

**Conditional escalation:** if Cami cannot obtain an acceptable schedule with bounded manual finishing, preferences/comparison become P0. Record the manager's threshold and affected task dependencies; do not call first-feasible output “good” without acceptance.

# Post-Launch

Exact minimum conflicting sets, globally cheapest repairs, generalized scenarios/branch merge, AI judgment learning, broad integrations, many alternatives, and sophisticated mobile gestures. Basic safe form fallback is preferable to blocking release on gesture polish.

DWDE remains the first high-complexity golden fixture. Never delete/reseed its data to make release tests easier.

# Manager Acceptance Workflow

Run in a dedicated staging tenant from a confirmed source copy; do not test against production. Release operators may separately verify deployed metadata with appropriate authorization. Store identifiable evidence privately; commit deidentified manifests only.

| Step | Action | Pass condition | Evidence captured |
|---|---|---|---|
| 1 | Authenticate | Authorized manager signs in; viewer/nonmember restrictions work | Test-user role, environment, login result, denied-write result |
| 2 | Verify people | Current teachers/participants complete, no unexplained missing/duplicate identities | Counts, ID list/hash, source comparison, reviewer |
| 3 | Verify classes | Full activity catalog present with accurate subject/level/frequency | Catalog export, source reconciliation, exceptions |
| 4 | Verify sessions | Required weekly meetings and per-meeting durations correct | Session IDs/ordinals/durations and class-frequency comparison |
| 5 | Verify rosters | Every expected enrollment/relationship present; unknown IDs rejected | Roster hash/counts, manager signoff, delegated progression evidence |
| 6 | Verify rooms | Names, capacities, features and usable inventory correct | Room IDs/facts, archive state, restriction review |
| 7 | Verify qualifications | Every scheduled instructor has explicit eligible domain | Typed qualification policy/model targets; default-deny check |
| 8 | Verify availability | Operating and instructor windows accurately reflect actual studio policy | Window records/version; known unavailable placement rejection |
| 9 | Verify Rulebook | Supported reviewed policy/exceptions match executable meaning | Rulebook/model IDs/hashes, coverage, unresolved rules list (empty for HARD) |
| 10 | Confirm Planning Dataset | Manager attests exact complete snapshot, not generic “looks fine” | Version/hash, evidence flags, reviewer identity, source/completeness note |
| 11 | Pass Ready to Schedule | No unresolved HARD/structural blocker; warnings explained | Readiness report, binding/delegated proof, confirmed context |
| 12 | Generate full schedule | All active sessions solved within agreed resource/time limit | Request hash/context, pinned solver version/settings, wall time/memory/status |
| 13 | Review candidate | Manager can inspect every placement and changes versus current | Candidate ID/context, row count, review acknowledgment; quality feedback |
| 14 | Inspect conflicts | Known bad move explains rule/entity; impossible/UNKNOWN distinct | Deterministic finding IDs, displayed explanation, non-success result |
| 15 | Adopt | Fresh candidate atomically becomes new ScheduleVersion | Before/after versions, exact assignment comparison, audit event, no stale overwrite |
| 16 | Manually edit | Legal move/assign/unassign works; illegal/stale/locked edits reject | Command matrix, resulting versions, denied writes with no persisted change |
| 17 | Undo/recover | Compatible restore makes new valid version; history unchanged | Version chain, recovery validation, incompatible-recovery rejection |
| 18 | Export/print | Usable complete weekly output matches adopted version | PDF/print or CSV artifact, visible context, row/session reconciliation |
| 19 | Verify mobile view | All required rooms/sessions visible; details readable; essential form edit usable | Browser/device/viewport, screenshots or recording, task outcome |

## Acceptance evidence manifest

Each run records run ID, date of execution (not a promised date), environment identifier, nonproduction target confirmation, app SHA, migration head, Python/OR-Tools versions, exact policy/planning/model/base-schedule/lock identifiers, fixture checksum, manager name/role, steps with pass/fail/artifact, command exit codes, limitations and unresolved BLK IDs.

Recommended private artifact layout: `<approved-evidence-root>/<run-id>/manifest.json`, `context.json`, `checks/`, `candidate/`, `exports/`, `manager-review.md`. These are future artifacts, not existing repository paths. Store only access-controlled/deidentified references in this plan.

Release is accepted only when A01–A14 and all workflow steps have evidence. A green build or current code feature list does not satisfy this gate.

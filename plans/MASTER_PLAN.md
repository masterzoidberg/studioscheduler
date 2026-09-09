# Studio Scheduler product completion plan

Canonical baseline: `91204390d8c025789e6af871a5939eb22decd517`, 2026-09-07. Scope is a trustworthy weekly scheduling application that managers configure and operate independently. [TASKS](TASKS.md) owns task status; [NEXT](NEXT.md) selects one task. This plan supersedes prior release/generic/cutover roadmaps.

## What exists and what does not

Current code implements versioned policy/planning/schedules, deterministic Constraint IR, CP-SAT feasibility, coherent candidate context, per-session solver locks, authoritative manual commands/recovery and restricted legacy writes. T01–T13 are accepted historical work. New P1 correctness finding: V49 adoption's nullable membership check fails to reject a missing row; SAFE-01 fixes this before new features.

The manager product is incomplete: inventory forms omit scheduling availability/qualification intake, readiness is DWDE-specific, review is global rather than scoped, onboarding is absent, normal UI exposes internal architecture, lock controls and schedule print/export are missing, all-room/mobile/duration behavior needs repair. Copilot still carries legacy authority assumptions. Tenant UUIDs, names, 178-rule accounting and calendar defaults prevent independent onboarding. Passing tests do not prove private data completeness, deployed migration state or independent manager use.

Evidence: [architecture audit](AUDIT_ARCHITECTURE.md), [UX journey audit](AUDIT_UX.md), [history/instruction audit](AUDIT_HISTORY.md), [verification record](AUDIT_VERIFICATION.md). These are dated evidence appendices, not competing task queues.

## Delivery route

1. SAFE-01 closes the missing-member authorization gap; SAFE-02 makes local configuration safe and contains misleading AI. VERIFY-01 provides parity and authenticated disposable verification.
2. SET-01 adds narrow review state through one existing room-capacity workflow. POL-01/02/03 progressively support governed typed policy forms; SET-02–07 build a unified manager setup and certification journey.
3. UX-01/02, LOCK-01, UX-03 complete generation, editing, lock/regeneration, recovery and usable export. OPS-01 proves release configuration/recovery prerequisites. ACC-01 tests actual DWDE use; a data blocker is an acceptance gate, not a stop on development.
4. GEN-01/02 finish generic policy extraction; GEN-03/04 deliver explicit tenancy and empty-workspace onboarding. IMPORT-01 reduces bulk setup effort; GEN-05 proves a distinct studio.
5. OPT-01/02 and CAND-01 provide reviewed quality improvement and durable candidate comparison. OPS-02/03 finish account/privacy/support/monitoring. PILOT-01 proves supported operation.
6. CYCLE-01 supports returning next season. V1-01 verifies repeatable independent use, recovery and product scope with AI disabled.

Priority is the ledger order among dependency-satisfied tasks; NEXT remains the single selected task. OPS-01 is intentionally executable before ACC-01 despite appearing later in thematic discussion. No dependency waits on fake customer evidence. If required independent support/evidence is unavailable, record the gate and continue ready engineering tasks.

## Objective milestone exits

**A — DWDE Operational:** all A tasks DONE. Cami or delegated actual manager completes in-app inventory, scheduling restrictions, review/no-restriction states and confirmation with actual complete private studio data; whole-week solve independently validates every required session/roster/qualification/lock; infeasible/unknown/stale/unavailable states are understandable; manager assigns/moves/unassigns/locks/regenerates/recovers without developer data repair; printable/CSV schedule reconciles with accepted version; desktop, mobile and keyboard paths pass; authorized deployment/configuration and disposable restore evidence exists. First-feasible output must be usable with manager-accepted bounded manual finishing; otherwise pull optimization forward. No outstanding critical/high security, data-loss or HARD legality defect. A is not achieved today.

**B — Second-Studio Ready:** A plus all B tasks DONE. A different organization creates/chooses its workspace and completes setup/import with no DWDE seed requirements, names, first-membership routing or tenant-specific code edits. Four rooms, different curriculum/hours and Sunday work within declared grid. Every active policy accounted deterministically; all roles/reads/writes tenant-isolated; rename metamorphic and independent witness fixtures pass. A real independent manager succeeds at frozen SHA; [S2 checklist](STUDIO_2_ACCEPTANCE.md) controls evidence detail. B is not achieved today.

**C — Commercial Pilot Ready:** B plus all C tasks DONE. Supported external studio completes two weekly build/review/revision cycles; deterministic quality preferences and candidate reopening work; invitations/role revocation/last-owner behavior proven; privacy/export/deletion/support responsibilities and limitations documented; monitored solver failures and restore drill observable; named operator can support incidents; no unresolved critical/high defect. Owner supplies commercial/privacy arrangements and authorization for actual operation. Billing automation is not required.

**D — Product v1:** C plus CYCLE-01 and V1-01 DONE. Two studios repeat full intake-to-final-export without developer data transformation, including next-cycle carry-forward/review, archive/history and restore. Required browser/role/concurrency/parity regressions pass, user help covers supported failure paths, operator can maintain/upgrade/recover service, monitoring and private-data handling accepted. AI-disabled workflow is complete. Known lower-risk limitations are visible. This is a bounded weekly scheduling product, not an all-purpose studio management suite.

## Capability gap matrix

Current statuses are evidence classifications, not delivery claims. “Verified” means current local tests for that bounded behavior; “partial” means code exists without the complete product criterion.

| Capability | Current | A: DWDE | B: second studio | C: pilot | D: v1 |
|---|---|---|---|---|---|
| Setup/teacher/student/room management | Basic inventory partial; scheduling intake absent | SET-01–07 complete | Empty neutral studio works | Repeated intake supported | Independent repeat |
| Planning data/classes/sessions/rosters | Versioned CRUD/repair partial | Complete in-app review | Typed ID dependencies | Reviewed bulk intake | New-cycle reuse |
| Qualifications/availability | Compiler semantics; no full forms | Explicit policy forms | No name bindings | Supported limits documented | Regression maintained |
| Policy/rules/HARD validation | Guarded DWDE + IR verified; arbitrary prose unsupported | Typed supported bundles; fail closed | Tenant record accounting | Generic supported authoring | Stable documented vocabulary |
| Preferences | Priority metadata only | Record honestly; feasibility + manual finish accepted | Same | OPT-01/02 measured | Repeatable quality |
| Completeness/certification | Global attestation partial | Scoped review + operation gates | Tenant-neutral | Supported | Cycle-aware |
| Solver/generation | Feasibility/code tests verified | Whole actual dataset and failures proven | Independent fixture/manager | Bounded optimization | Operating reliability |
| Manual editing | Authoritative routes tested; UX partial | Full keyboard/tap/drag journey | All rooms/hours | Supported | Repeated |
| Locks/regeneration | Session protection tested; toggle absent | LOCK-01 controls/context | Generic | Supported | Repeated |
| Recovery/history/audit | Versions/undo/rebase code; restore unproven | UI recovery + OPS-01 restore | Cross-tenant denial | Operator drill | Cycle/history retained |
| Onboarding/login/auth | OAuth/magic link code; local login rendered | Clear setup entry | Empty workspace + select | Invite/revoke verified | Repeatable |
| Imports | Validation/package code; manager CSV absent | Forms sufficient; honest effort gate | IMPORT-01 preview/apply | Support/limits | Stable |
| AI | Legacy context/proposal code partial | Hide misleading paths; not required | Optional/off | Optional/off | Optional/off |
| Mobile/accessibility | Login rendered only; schedule source partial | All primary actions 390px + keyboard | Generic room/horizon | Regression | Acceptance repeated |
| Print/export | JSON export; schedule artifact absent | Reviewed schedule print/CSV | Tenant-aware | Privacy-safe support | Old/new cycle artifacts |
| Candidate comparison | Transient/legacy scenarios partial | Review before adopt | No false compare claims | CAND-01 durable compare | Supported |
| Tenancy/roles/security | Membership/RLS partial; NULL gap | SAFE-01; fixed DWDE scope explicit | Every boundary explicit | Lifecycle/privacy | Maintained |
| Backups/staging/migrations | Ledger/harness; operational restore unproven | OPS-01 evidence | Per-tenant integrity | Operator-owned recovery | Upgrade/restore proven |
| Support/monitoring | CI only; operations unverified | Minimum release runbook | Documented limits | OPS-03 monitored support | Repeatable maintenance |
| Documentation/help | Technical README, stale claims | In-app guidance + release notes | Neutral onboarding/import help | Contextual help/runbook | Complete supported scope |
| Archive/account lifecycle | Archive primitives/membership partial | Safe archive feedback | Workspace creation/selection | OPS-02 ownership/invites/privacy | CYCLE-01 reuse/retention |

## Feature classification and exclusions

MUST HAVE BEFORE DWDE: auth/editor authorization, inventory/classes/sessions/rosters/qualifications/availability, supported HARD requirements, honest preferences, deterministic validation, setup review/certification, generation/manual editing/locks/recovery/history/conflict explanations, mobile/keyboard, print/export, audit, error handling, backup/release configuration and current user guidance.

MUST HAVE BEFORE SECOND STUDIO: complete tenant isolation, neutral empty-workspace onboarding/selection, generic supported rule authoring, all configured rooms/hours, Sunday, CSV templates/preview, second-studio acceptance. Existing invitations must not undermine isolation; complete lifecycle is C.

MUST HAVE BEFORE COMMERCIAL PILOT: quality scoring/optimization, durable candidate compare, owner/account/invite/revoke lifecycle, privacy/export/deletion procedures, monitored operations, support/help, external pilot evidence. MUST HAVE BEFORE PRODUCT V1: next cycle and independent repeated acceptance.

POST-V1: optional conversational setup and AI explanations/summaries after canonical-context alignment; public schedule links, dated calendars/holiday exceptions, custom grids, third-party integrations and more sophisticated conflict minimization only with evidence. NOT NEEDED for this product: student billing, payroll, attendance register, generic CRM, arbitrary policy DSL, alternative solver bake-off, second canonical setup/policy/schedule model.

## Adversarial decisions incorporated

Why could this still fail? A technically valid first schedule may be unusable or intake may take a developer a week. ACC-01 explicitly measures manager assistance and usable output; it cannot pass by counting green tests. Optimization may be pulled ahead of A if actual usability requires it. Forms must work before external acceptance, rather than wait for a developer-transcribed fixture.

Overengineering risk: a second setup database, standalone certification engine, huge DSL and broad SaaS features. Removed in DEC-102–106: shared forms/readiness, narrow attestations, existing version authorities, supported typed families and explicit scope.

Underestimated work: static semantics appear in compiler, readiness, Python and SQL, sometimes spanning multiple source rules. POL-01 and GEN-01 retain HIGH-REASONING classification with dependency-closed replacement and shared parity. Turning off one guard is not a migration strategy. LOCK-01 is a real command/context change, not a button-only task.

Most important unasked question: can the manager maintain the data next season without losing trusted history? CYCLE-01 and D acceptance now require this. Another first-season demo does not close v1.

Deferred decisions have deadlines: exact private roster/availability facts are supplied inside Setup before ACC-01; actual solve budget/acceptable manual finishing is measured and accepted at ACC-01, no invented SLA; external studio chosen before GEN-05; backup/support response targets and retention terms supplied by operator before PILOT-01. If a customer's must-have semantic lies outside supported vocabulary, record a concrete generic extension before accepting that customer, rather than promise arbitrary rule support.


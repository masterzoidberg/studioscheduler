# POL-04 — Close POL-02 typed SQL safeguard parity and no-write coverage

Execution class: **STANDARD IMPLEMENTATION**. Milestone: **A**. Dependencies: **POL-01**.
Status is owned by [TASKS](../TASKS.md); this is the single corrective task selected by R1. It exists only to close the demonstrated POL-02 acceptance gap; do not reimplement the already-evidenced TypeScript/Python work.

## Outcome and current state

Make the supported POL-02 typed HARD families enforceable at the effective PostgreSQL safeguard boundary with the same pinned meaning already exercised by TypeScript and Python. The R0 audit proved that the current `validate_schedule_hard_v25` path delegates to legacy V2.2 checks and adds only `CLASS_DURATION`; V47/V48/V49 wrappers carry caller-supplied application validation but do not independently enforce the POL-02 typed kinds. POL-02 remains pending until this gap is closed.

## Scope and required behavior

Add only forward migration/test changes needed to replace or extend the effective SQL safeguard for:

- studio operating windows and closed days;
- room unavailable windows;
- explicit teacher qualification domains;
- required teacher and required room;
- room capacity enforcement and required feature set inclusion.

Keep room capacity/features as PlanningDataset facts, policy as Rulebook data, compiled meaning as the current ConstraintModelVersion, and adopted placements as ScheduleVersion data. The SQL boundary must validate the pinned current context and authoritative current model rather than trusting `p_application_validation` as proof. Preserve half-open intervals, closed-day behavior, explicit empty qualification domains, stable IDs, missing-capacity blocking, and no optimization semantics. Do not add a second policy store, arbitrary DSL, relationship families or full baseline conversion.

## Code inspection points

Inspect the effective definitions and callers of `validate_schedule_hard_v25`, `apply_authoritative_move_v46`, `apply_authoritative_incremental_command_v47`, `apply_authoritative_schedule_recovery_v48`, `publish_server_constraint_model_v49` and `adopt_solver_candidate_v49`. Historical migrations and production-ledger bytes are evidence only and must not be edited.

## Data, authority and failure behavior

Reject malformed, stale, unauthorized, unsupported or semantically illegal typed input with an actionable stable error. A rejected MOVE, ASSIGN/UNASSIGN, REBASE/UNDO, publication or candidate adoption must leave canonical rows, current version, model/version context and success audit evidence unchanged. Keep exact tenant and current human membership checks. Never replace a stale token with a freshly read token and never use production or a shared database for tests.

## UX behavior

No new manager UI is required. If an existing route is touched to surface the typed SQL rejection, preserve the current redacted error contract and draft input; do not expose SQL, stack traces, hashes or RPC/version mechanics in normal UI.

## Non-goals

No unrelated product work, manager setup forms, optimization, relationship policy, full DWDE conversion, deployment, merge, push, production access, private customer-data mutation or external-service write.

## Tests and acceptance criteria

- Add an executed disposable PostgreSQL regression, wired into the repository DB verification path, that proves each supported POL-02 HARD family is rejected when its typed meaning is violated and accepted at the documented boundary when satisfied.
- Include positive, negative and boundary cases for rename/stable-ID binding, missing or duplicate references, closed days, half-open interval endpoints, empty qualification domains, required teacher/room, missing capacity and feature set inclusion.
- Exercise the canonical write paths that invoke SQL validation, including at minimum candidate adoption and the current authoritative schedule mutation/recovery path(s) affected by the inspected validator. Every rejected case proves no ScheduleVersion, assignment, model/version or success-audit write.
- Prove the SQL safeguard consumes the pinned authoritative model/context and cannot be bypassed by a caller claiming `valid: true` in `p_application_validation`.
- Keep TypeScript runtime, pinned Python feasibility and shared parity fixtures green. Unsupported HARD families still fail closed; preferences remain records only.
- Use a forward migration for live SQL behavior. Do not rewrite historical migration or production-ledger bytes.

## Verification commands

Run from repository root with explicit disposable configuration and the pinned solver environment:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
$env:PYTHONPATH='solver'; & 'C:\Users\nicol\AppData\Local\Temp\studio-scheduler-audit-venv\Scripts\python.exe' -m pytest solver/tests/test_pol02_typed_feasibility.py
```

Run focused tests before the full commands. Preserve the first failed full-suite result, diagnose with focused tests, and do not weaken assertions or repeat a full suite until focused cause verification is green. Missing Docker or pinned dependencies is a blocker, never a pass.

## Completion evidence

Record the starting and final heads, forward migration filename, changed files, exact test names, commands and exit codes, disposable database output/artifacts, no-write witnesses, parity/Python evidence, CI references and limitations in [TASKS](../TASKS.md). Mark POL-02 DONE and archive its prompt only after the SQL safeguard, executed transaction/no-write tests and all existing criteria pass. If a second independent gap appears, stop and create a separately bounded task rather than widening POL-04.

## Escalation conditions

Stop with a concrete reproducer if current SQL cannot consume the authoritative typed model without duplicating policy truth; a migration would require historical-byte edits; the required semantics conflict with [DECISIONS](../DECISIONS.md); tenant or membership authority cannot be preserved; the scope expands beyond this shared SQL safeguard; or deployment, production/private data, paid services, external participants or destructive actions would be required.

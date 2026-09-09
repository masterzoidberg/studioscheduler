# Next autonomous run

**R1 — POL-04: close POL-02 typed SQL safeguard parity and no-write coverage**
**Execution class: STANDARD IMPLEMENTATION**
**Milestone: A — DWDE Operational**
**Status: SELECTED; the only READY task and next run.**

Work on `feat/pre-cami-hardening` from implementation base `7f5c1287ec838cb6e8cc2e9efc395b13c6e426da`. R0 audited commits `9de8d07^..7f5c128` and adopted the reworked plan. The planning adoption commit adds no product code; `TASKS.md` records the final checkpoint head. PR #55 remains open and no merge, push or deployment is authorized.

Read [POL-04](prompts/POL-04.md), [TASKS](TASKS.md), [MASTER_PLAN](MASTER_PLAN.md), [DECISIONS](DECISIONS.md), [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md) and the effective SQL callers before editing. POL-02 remains BLOCKED/pending; do not archive `prompts/POL-02.md` or claim it DONE from the passing TypeScript/Python evidence.

Implement only the demonstrated SQL safeguard gap. Add a forward migration and executed disposable database regression for the supported POL-02 HARD families: operating windows/closed days, room unavailable windows, explicit qualification domains, required teacher/room, room capacity and required features. The safeguard must consume the pinned authoritative current model/context, not trust a caller-supplied `valid: true` application payload. Preserve stable IDs, PlanningDataset facts, Rulebook policy, ConstraintModelVersion meaning, ScheduleVersion history, exact membership/tenant checks, rejection/no-write behavior and all fixed POL-02 interval, qualification, capacity and feature semantics.

Do not add unrelated setup/UI work, a second policy store, arbitrary DSL, relationship families, full baseline conversion, optimization, deployment, production access, private customer-data mutation, merge, push or external-service writes.

Required verification from repository root with the isolated pinned Python environment:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
$env:PYTHONPATH='solver'; & 'C:\Users\nicol\AppData\Local\Temp\studio-scheduler-audit-venv\Scripts\python.exe' -m pytest solver/tests/test_pol02_typed_feasibility.py
```

Run focused tests before the full commands. Preserve the first failed full-suite result, diagnose with focused tests, and do not weaken assertions. Stop on any mandatory runbook condition, including an authority conflict, overlapping changes, historical-byte rewrite, missing dependency, production/private-data access or a second independent gap. On success, mark POL-02 DONE only when every original criterion passes, archive its prompt, update the canonical ledger and derived views atomically, and select the next run.

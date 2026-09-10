# Studio Scheduler plan rework — ADOPTED

## Purpose

This directory proposes a faster, evidence-preserving route from the current implementation to a coherent release. It audits the accepted plan at repository HEAD `7f5c1287ec838cb6e8cc2e9efc395b13c6e426da` on `feat/pre-cami-hardening` (2026-09-09). It changes planning only; it does not claim product implementation or acceptance.

## Authority and adoption

Adopted at R0 on 2026-09-09 from audited implementation head `7f5c1287ec838cb6e8cc2e9efc395b13c6e426da`. R0 correctly left POL-02 pending/BLOCKED because effective SQL safeguard coverage was absent. R1/POL-04 was then completed at implementation head `15f5c79`, adding the V54 forward safeguard and executed disposable no-write evidence; POL-02 is now DONE. SET-03 was completed at implementation head `d46e68c`; SET-04 was completed at implementation head `c165f4a`; the canonical ledger now selects R2/SET-05 as the sole next run. The R0 adoption commit was planning-only; later implementations and final status are recorded in the canonical ledger.

- Current authority remains [`../TASKS.md`](../TASKS.md) for status, [`../MASTER_PLAN.md`](../MASTER_PLAN.md) for milestone exits, [`../DECISIONS.md`](../DECISIONS.md) for accepted design, and [`../NEXT.md`](../NEXT.md) for the one authorized next task.
- This directory is **ADOPTED rationale and runbook material**, not a competing execution queue. Status and dependencies are authoritative only in [`../TASKS.md`](../TASKS.md); the selected run is authoritative only in [`../NEXT.md`](../NEXT.md).
- Adoption is one atomic planning change: reconcile pending work, approve the reworked graph, update `TASKS.md` as the sole ledger, derive `MASTER_PLAN.md`, `README.md`, `NEXT.md`, and the prompt index, then generate only the selected run prompt.
- Accepted decisions, completed records, established IDs, historical prompts, migrations, production ledgers, and failed evidence remain intact.
- There is exactly one status ledger (`TASKS.md`) and exactly one selected run (`NEXT.md`). This directory contains rationale, reconciliation evidence and execution rules, not a second READY/NEXT status mirror.

## Index

- [`REWORKED_COMPLETION_PLAN.md`](REWORKED_COMPLETION_PLAN.md): assessment, classification, revised graph, releases, lanes, and checkpoints.
- [`AUTONOMOUS_EXECUTION_RUNBOOK.md`](AUTONOMOUS_EXECUTION_RUNBOOK.md): run protocol, commit/test boundaries, continuation and stop rules, and reusable prompt.
- [`TRANSITION_CHECKLIST.md`](TRANSITION_CHECKLIST.md): safe adoption and reconciliation procedure.

## Recorded evidence versus assumptions

Recorded: the single worktree and origin both resolved to `7f5c128` at R0 start; commits `9de8d07^..7f5c128` implement and test POL-02-related behavior; completed records through SET-02 remain in `TASKS.md`; the R0 rollback-only disposable witness demonstrated the missing typed SQL safeguard; R1/POL-04 added V54 and the permanent disposable no-write regression; current npm scripts expose lint, typecheck, unit, build, disposable DB, parity, and authenticated e2e checks.

Not yet established: current private DWDE acceptance; authorized deployment/restore evidence; independent second-studio evidence; commercial pilot evidence. These remain pending or external gates. POL-02 SQL transaction/no-write acceptance is established locally by the V54 disposable regression; no V54 CI artifact exists because the branch was not pushed.

# M03 — Supported commercial pilot

**Status:** NOT STARTED. **Objective:** A supported external studio repeatedly builds, reviews and revises a weekly schedule while a named operator can respond to incidents and protect private data.

## Scope

Archived `PILOT-01` qualification, operator support/privacy agreement, monitoring and recovery observation. Product engineering prerequisites are M01; M02 proves release and distinct-studio viability.

## Out of scope

Billing automation, arbitrary policy DSL, student portal, public distribution, attendance/payroll, next-season carry-forward and optional AI assistance.

## Current evidence

**Verified:** deterministic quality scoring, CP-SAT optimization and durable candidate comparison exist (`lib/schedule-quality.ts`, solver code, CAND migration and tests). **Unknown:** any supported commercial arrangement, actual two-cycle external operation, agreed retention/support terms, or production incident/restore evidence. Archived `PILOT-01` is not started and `EXT-PILOT` is open.

## Work required

| ID / status | Goal and relevant systems | Dependencies | Acceptance criteria | Validation |
|---|---|---|---|---|
| **M03-T01 — not started** | Freeze supported scope, named operator, support/privacy/retention limits and pilot agreement; inspect M01 runbook, deployed config and archived `prompts/PILOT-01.md`. | M02; owner/operator decisions. | Terms and responsibilities explicitly accepted; privacy/export/deletion and incident response match actual mechanisms. | Private agreement/reference and operator review; no repository prose alone counts as agreement. |
| **M03-T02 — not started** | Observe an external studio completing two weekly build/review/revision cycles, including candidate reopening, solver failure path and support handoff. | M03-T01. | Two accepted versioned final outputs; support/monitoring/restore observations; no critical/high unresolved defect; assistance and limitations recorded. | Frozen-SHA private artifacts, current DB/browser/parity suite and actual operator logs/observations with private data protected. |

## Completion gate

M03-T01/T02 pass with named private evidence and exact implementation references. The supported pilot can be repeated and recovered by the operator. If a required customer semantic is unsupported, record a specific defect/extension and do not promise arbitrary rule support or mark the milestone complete.

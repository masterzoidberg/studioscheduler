# Studio Scheduler — Canonical Development Plan

These files are the **canonical active development plan** for DWDE production readiness, a reusable scheduling kernel, Studio #2, and commercial pilots. The original audit conversation is not required to execute this plan. Existing architectural ADRs and migration archives remain historical/design evidence; they are not competing task roadmaps.

**Project objective:** finish a trustworthy DWDE scheduling workflow, then onboard unrelated recurring class/activity organizations without bespoke application, compiler, or solver code. DWDE remains prepopulated and becomes one configured tenant.

- Current phase: Phase 0 — Verification foundation.
- Current milestone: A — DWDE Operational.
- Current task: **T06 — archive-aware adoption**.
- Next task: T07 after T06 acceptance.
- Planning baseline: HEAD `17b3a60`, inspected 2026-09-06.
- Implementation progress: T01, T02, T03, T04, and T05 have verified DONE evidence. T02's disposable reconstruction and role/RLS/stale-version run passed; T03's canonical comparison and live JSONB publication/read-back run passed; T04's canonical interval gateway and live adoption/rollback run passed; T05's reviewed-policy provenance/content guard and OPS-003 fail-closed regressions passed. T06 is READY and T07 is NOT_STARTED pending T06.

## Navigation

| File | Purpose |
|---|---|
| [MASTER_PLAN](MASTER_PLAN.md) | Product objective, architecture, findings, milestones, critical paths, risks |
| [TASKS](TASKS.md) | Authoritative status, dependencies, task scope, acceptance, verification, evidence |
| [NEXT](NEXT.md) | Immediate T01–T10 execution queue |
| [DWDE_RELEASE_PLAN](DWDE_RELEASE_PLAN.md) | DWDE release blockers and manager acceptance |
| [GENERIC_PRODUCT_PLAN](GENERIC_PRODUCT_PLAN.md) | Tenant extraction and productization |
| [STUDIO_2_ACCEPTANCE](STUDIO_2_ACCEPTANCE.md) | Formal independent-studio acceptance specification |
| [ARCHITECTURE_CUTOVER](ARCHITECTURE_CUTOVER.md) | Migration from split to shared scheduling authority |
| [DWDE_LEAKAGE_REGISTER](DWDE_LEAKAGE_REGISTER.md) | Located coupling, extraction targets, and task ownership |
| [TEST_STRATEGY](TEST_STRATEGY.md) | Existing and required verification layers and commands |
| [DECISIONS](DECISIONS.md) | Active decisions and evidenced deviations |
| [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md) | Operating constraints for implementations |
| [Prompts index](prompts/README.md) | Ready-to-use briefs for all T01–T29 tasks |

## Status meanings

Use only these task statuses:

- `NOT_STARTED`: not underway; prerequisites are not all DONE.
- `READY`: dependencies are verified DONE (or none), and no known external blocker prevents starting.
- `IN_PROGRESS`: one selected task/child is actively being implemented; record owner/session.
- `BLOCKED`: a concrete impediment prevents accepted completion; record evidence and unblock condition.
- `DONE`: every acceptance criterion is verified and evidence is recorded.
- `DEFERRED`: deliberately excluded from active execution by a recorded decision; it does not satisfy dependencies.

Dependency waiting is normally NOT_STARTED, not BLOCKED. READY is not release approval. Related code, green old tests, or merged partial work are not sufficient for DONE.

TASKS.md owns task statuses; NEXT.md and this file are derived navigation views. Milestone checklists own release acceptance. A finished implementation does not automatically prove a live operational milestone.

### Execution Rule

Future Codex sessions should:

1. Read plans/README.md.
2. Read plans/MASTER_PLAN.md.
3. Inspect plans/TASKS.md.
4. Identify the first executable non-complete task whose dependencies are satisfied.
5. Inspect the actual repository before implementation.
6. Implement only the selected task unless adjacent changes are correctness-critical.
7. Run required verification.
8. Update task status and evidence.
9. Commit/document any discovered deviation from the plan.

## Updating after implementation

Record selected task/child and starting SHA. On completion, update both its detailed section and status-index row, link test artifacts, and state verified criteria and limitations. Recompute dependent readiness; update NEXT and current-task pointers. Update release checklists, leakage entries, and decision records only when supported by evidence. Keep prompts synchronized if scope changes. Do not manufacture a commit SHA when changes are uncommitted; record “uncommitted” and the eventual reference later. Follow session authorization for committing/deploying.

For L-sized parents, record bounded traceable children before implementation. Do not replace T01–T29 with a competing numbering scheme.

## Blockers and external evidence

Record BLK-NNN under the affected task: observation/date, evidence/path, affected criteria, impact, owner or needed action, and an objective unblock condition. Cross-task blockers are linked here. Record an architectural deviation as DEC-NNN with reason and affected tasks.

T01, T02, T03, T04, and T05 are accepted. T02's initial Docker blocker was resolved and recorded as historical evidence in [TASKS](TASKS.md). Upcoming prerequisites requiring verification:
- T06: archive-aware adoption.
- T14/T16: complete DWDE data and a named manager's acceptance; do not invent missing studio facts.
- T16: authorized deployment/restore evidence; tests never target production.
- T27/T29: independent studio/pilot participation; do not fabricate customer outcomes.

These are known future external inputs, not blanket BLOCKED task statuses.

## Baseline verification and preserved state

Audit: lint/typecheck/build passed; lint had two warnings. Windows Vitest: 241 passed, 15 SQL line-ending failures. All 256 passed after SQL LF normalization in an isolated copy. Python: 24 passed with isolated pinned requirements. Ten production-build route checks returned 200; authenticated flows and live database behavior were not verified.

Three isolated probes reproduced stale executable policy after wording edits, order-sensitive model equality, and accepted shortened candidate intervals. See MASTER_PLAN findings.

At plan creation, existing modifications to next-env.d.ts and tsconfig.json and untracked Python cache directories were preserved. No plans directory existed; no previous planning roadmap was overwritten. Planning creation did not implement T01 or change production data.

## Relationship to existing documentation

Preserve [ADR 0001](../docs/architecture/0001-scheduling-foundation-decisions.md), [historical baseline](../docs/baselines/milestone-1-final-2026-09-01.md), [migration guide](../supabase/migrations/README.md), and [ledger archive](../supabase/production-ledger/README.md). The root README's “future solver/adoption” language is stale; code already implements those paths. Update those descriptions when adjacent task work warrants it, without adding duplicate roadmaps.

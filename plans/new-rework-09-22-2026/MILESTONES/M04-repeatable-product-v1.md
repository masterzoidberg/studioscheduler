# M04 — Repeatable product v1

**Status:** NOT STARTED. **Objective:** Two studios can independently repeat the intake-to-reviewed-export journey next season, retaining trustworthy history and recovery.

## Scope

Archived `CYCLE-01` next-cycle/archive lifecycle and `V1-01` bounded product acceptance. Reuse existing versions, archive primitives, review/certification and canonical commands.

## Out of scope

Holiday/date calendars, attendance, billing, payroll, CRM, public schedule links, custom integrations, autonomous AI policy decisions and a second authority system.

## Current evidence

**Verified:** immutable planning/schedule history and archive-aware command foundations exist in migrations, components and tests. **Planned only:** governed carry-forward/review for a new season and repeated independent acceptance; archived `CYCLE-01`/`V1-01` are not started. Prior M03 evidence has not been established.

## Work required

| ID / status | Goal and relevant systems | Dependencies | Acceptance criteria | Validation |
|---|---|---|---|---|
| **M04-T01 — not started** | Implement safe next-cycle carry-forward, archive/unarchive/review invalidation and historical comparison using existing versions. Inspect `lib/planning-dataset.ts`, `lib/planning-archive-client.ts`, readiness/review code, forward migrations and archived `prompts/CYCLE-01.md`. | M03 accepted pilot. | New cycle requires fresh relevant review/certification; prior schedules remain reproducible; stale candidates and archived entities cannot silently become current; exact tenant/role and no-write failures. | Executed disposable DB lifecycle tests, authenticated browser next-cycle flow, history/solver parity and full quality/build checks. |
| **M04-T02 — not started** | Run bounded `V1-01` qualification with two independent studios, AI disabled, support/recovery and old/new-cycle artifacts. | M04-T01. | Both complete without developer data transformation; operator maintains/upgrades/restores; supported failure paths have help; known limitations visible; no critical/high defect. | Frozen-SHA private acceptance references, full lint/typecheck/unit/build/DB/parity/e2e, role/concurrency and restore evidence. |

## Completion gate

M04-T01/T02 evidence proves two-studio repeatability and next-season integrity at a frozen SHA. Record exact commands, exit codes, migration/deployment context, private artifact references and limitations. Do not infer v1 from a second first-season demo.

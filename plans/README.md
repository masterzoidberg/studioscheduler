# Studio Scheduler — canonical planning entry

Audit baseline: `91204390d8c025789e6af871a5939eb22decd517` on `feat/pre-cami-hardening`, 2026-09-07. R0 rework adoption was completed on 2026-09-09 from audited implementation head `7f5c1287ec838cb6e8cc2e9efc395b13c6e426da`; R1/POL-04 was accepted at implementation SHA `15f5c79` on 2026-09-09. SET-03 was accepted at implementation SHA `d46e68c43ae920e99be40c7bd61e8a7d6c563728` on 2026-09-09. SET-04 was accepted at implementation SHA `c165f4ac0f688ac5f104227052fea45ca09bb682` on 2026-09-09. SET-05 was accepted at implementation SHA `5f2aa78750db57ba602db2827d2f0ee6ceb4199c` on 2026-09-10. POL-03 was accepted at implementation SHA `e1a32d3a910d86b679515572ebc4ae85366bbc93` on 2026-09-10. SET-06 was accepted at implementation SHA `25a92a42842961a3c35e3506350ee97c5f14f872` on 2026-09-10. SET-07 was accepted at implementation SHA `03218ae750166445c1226b5d1b14988a5de822fb` on 2026-09-10. T01–T13 remain accepted foundation history. SAFE-01 was accepted at implementation SHA `51fd92e35eaa3129f237f91c196e4ad603d58547`. SAFE-02 was accepted at implementation SHA `7c2078f85c64ab0bf7b645a18662c7d145cee14f`. VERIFY-01 was accepted at implementation SHA `04727b89c6e053c167af7f9dded51917ccd9489a`. SET-01 was accepted at implementation SHA `2403f6f21e029e43a438eaef731b73967e5d6fc2`. POL-01 was accepted at implementation SHA `7b43a00cdcbf6980e34bb52f79215d66b4e07a08`. SET-02 was accepted at implementation SHA `86a4e8d719b62c9aeab3a11b1b604f628ffe0d24` after PR #55 CI run 432 and Solver CI run 151 passed, including the full disposable DB suite, authenticated browser workflows, CP-SAT/service tests, production solver container build and TypeScript/Python runtime parity.

**Current milestone: A — DWDE Operational. Sole selected next run: R4 / UX-01 — understandable schedule generation and failures. Execution class: STANDARD IMPLEMENTATION.** Read [NEXT](NEXT.md) and [the selected prompt](prompts/UX-01.md). POL-02 through POL-04 and SET-03 through SET-07 are DONE with their criterion-level evidence and limitations recorded in [TASKS](TASKS.md).

The product path is safety → verification harnesses → manager setup/review → typed policy authority → generation/editing/locks/recovery/export → actual DWDE acceptance → independent studio → supported pilot → next-cycle Product v1.

| Canonical file | Sole responsibility |
|---|---|
| [NEXT](NEXT.md) | One selected next task and immediate environment limits |
| [TASKS](TASKS.md) | Status, dependency graph, old-task mapping, blockers and completion records |
| [MASTER_PLAN](MASTER_PLAN.md) | Product scope, capability gap matrix and objective A/B/C/D exits |
| [DECISIONS](DECISIONS.md) | Accepted authority, review, policy-transition and product decisions |
| [CODEX_EXECUTION_RULES](CODEX_EXECUTION_RULES.md) | Stable execution/evidence rules |
| [TEST_STRATEGY](TEST_STRATEGY.md) | Verification commands/environments and evidence requirements |
| [STUDIO_2_ACCEPTANCE](STUDIO_2_ACCEPTANCE.md) | Detailed independent-studio acceptance cases |
| [DWDE_LEAKAGE_REGISTER](DWDE_LEAKAGE_REGISTER.md) | Residual coupling inventory and extraction ownership |
| [Prompt index](prompts/README.md) | Bounded implementation briefs |
| [Audit verification](AUDIT_VERIFICATION.md) | Current audit results and limitations |
| [UX](AUDIT_UX.md), [architecture](AUDIT_ARCHITECTURE.md), [history](AUDIT_HISTORY.md) | Dated evidence appendices; never execution queues |

Do not load the complete archive for ordinary implementation. Files ending _OLD, prompts/archive and plans_OLD.zip are historical, not current instructions. Completed prompts T01–T13, SAFE-01, SAFE-02, VERIFY-01, SET-01, POL-01, SET-02, POL-02, POL-03, POL-04, SET-03, SET-04, SET-05, SET-06 and SET-07 are archived; incomplete T14–T29 are preserved as superseded _OLD prompts.

Read AGENTS → this file → NEXT → assigned prompt. Inspect current code before editing, follow targeted decisions and run required checks. TASKS owns status and dependencies; README/NEXT are derived views. The proposed [plan rework](plan-rework/README.md) was adopted at R0 and is no competing queue. After accepted completion update those views and select one next dependency-satisfied run. No deployment or customer-data mutation follows merely from a roadmap entry.

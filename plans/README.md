# Studio Scheduler — canonical planning entry

Audit baseline: `91204390d8c025789e6af871a5939eb22decd517` on `feat/pre-cami-hardening`, 2026-09-07. T01–T13 remain accepted foundation history. SAFE-01 was accepted at implementation SHA `51fd92e35eaa3129f237f91c196e4ad603d58547`. SAFE-02 was accepted at implementation SHA `7c2078f85c64ab0bf7b645a18662c7d145cee14f`. VERIFY-01 was accepted at implementation SHA `04727b89c6e053c167af7f9dded51917ccd9489a`. SET-01 was accepted at implementation SHA `2403f6f21e029e43a438eaef731b73967e5d6fc2`. POL-01 was accepted at implementation SHA `7b43a00cdcbf6980e34bb52f79215d66b4e07a08` after PR #55 CI run 428 and Solver CI run 147 passed, including the expanded disposable DB suite, authenticated browser workflow, CP-SAT/service tests, production solver container build and TypeScript/Python runtime parity.

**Current milestone: A — DWDE Operational. Exact next task: SET-02 — Create one Studio Setup entry and dashboard. Execution class: STANDARD IMPLEMENTATION.** Read [NEXT](NEXT.md) and [the prompt](prompts/SET-02.md). No owner architecture decision blocks starting.

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

Do not load the complete archive for ordinary implementation. Files ending _OLD, prompts/archive and plans_OLD.zip are historical, not current instructions. Completed prompts T01–T13, SAFE-01, SAFE-02, VERIFY-01, SET-01 and POL-01 are archived; incomplete T14–T29 are preserved as superseded _OLD prompts.

Read AGENTS → this file → NEXT → assigned prompt. Inspect current code before editing, follow targeted decisions and run required checks. TASKS owns status; README/NEXT are derived views. After accepted completion update those views and select one next dependency-satisfied task. No deployment or customer-data mutation follows merely from a roadmap entry.
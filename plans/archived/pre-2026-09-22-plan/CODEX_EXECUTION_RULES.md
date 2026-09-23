# Codex execution rules

Stable operating rules; task state belongs in [TASKS](TASKS.md), selected task in [NEXT](NEXT.md).

1. Read AGENTS, plans/README, NEXT and assigned prompt; inspect current code, applicable local instructions, git status/branch/HEAD and relevant dependency evidence. Task-specific decisions are linked; historical _OLD files and archives are evidence only.
2. Follow the user's authorized scope. Complete coherent reversible work autonomously; no arbitrary session-size or preserve-old-numbering requirement. Do not implement unrelated features, refactor broadly or add unnecessary dependencies.
3. Fetch origin and compare when beginning implementation if network is available. Fast-forward only when correct branch, clean tree and remote strictly ahead. Never reset, clean, auto-stash, force-push or overwrite unknown changes. Record divergence and inspect before reconciliation.
4. Preserve historical migration/production-ledger/bootstrap bytes and fingerprints. Add forward migrations; inspect effective latest function definitions, callers, grants and downstream helpers, not only original definitions.
5. Never test against production or fall back to an external endpoint. Disposable PostgreSQL harness is the existing SQL verification authority; managed auth fidelity needs isolated authenticated evidence separately.
6. Supabase owns canonical policy/planning/model/schedule truth. No second setup/policy/schedule authority. Typed policy changes preserve unsupported HARD fail-closed behavior, provenance, dependency-closed replacement and complete accounting.
7. Authorize exact selected studio/current role at server and transaction boundaries. Missing membership must deny. Serialize authorization with role revocation and keep version/hash/lock checks atomic. Preserve SQL structural/reference defenses.
8. Keep TS runtime/Python solver parity. Every admitted IR family has typed parameters, compiler/binding/runtime/search or explicit proven delegation, boundary fixtures and explanation provenance. Unknown kinds cannot silently pass.
9. Draft incompleteness differs from illegal placement. Adoption/final export require current complete certification and independent validation. Old candidates never get fresh tokens substituted.
10. Human reviews require explicit action and server-derived slice fingerprints. AI is optional, proposes only, never certifies/decides legality or silently writes canonical truth.
11. Use synthetic/deidentified public fixtures; private manager/child data and acceptance recordings stay access-controlled. Record artifact references without credentials or unnecessary personal details.
12. Run task-specific meaningful tests. SQL substring checks do not replace executed transactions; route 200 does not prove authenticated workflow; unit fixtures do not prove manager acceptance, deployment or restore. Report every unavailable/skipped/failed check honestly.
13. If required checks cannot execute, complete independent work and record blocker/action/unblock condition; do not claim DONE. Do not weaken tests or silently change the goal.
14. Update criterion-level completion evidence in TASKS; derive README/NEXT and prompt archive. Preserve completed IDs; newly found defects get traceable corrective tasks. One selected next task.
15. Routine uncertainty is resolved through inspection. Escalate only material conflict with accepted authority, unsupported required semantics, unavoidable historical rewrite or substantial scope expansion. Prepare concrete alternatives and finish independent authorized work first.
16. Roadmap entries do not authorize deploying, paid provisioning, messaging other people, real data deletion, production tests or background automations.

Completion record: task/child; start HEAD; files; criteria → tests/artifacts; exact commands/exit codes; disposable environment; commit/reference or uncommitted; limitations; decision deviations; blockers/unblock evidence; resulting status and one next task. A prompt existing or old tests passing is not completion.

Prompt design follows concise outcome/context/authority/acceptance/escalation contracts and avoids mandatory full-history loading. Current [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model) supports explicit instruction priority, authorized follow-through and proportionate verification. The user-named Promptessor and Elser pages were consulted as secondary framing only; no third-party model/pricing/behavior claims govern this repository. Model choice follows execution class, not a permanently pinned product name.


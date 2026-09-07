from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# plans/README.md
p = Path("plans/README.md")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    "- Current task: **T07 — coherent solver snapshots**.\n- Next task: T08 after T07 acceptance.",
    "- Current task: **T08 — candidate stale-schedule binding**.\n- Next task: T09 after T08 acceptance.",
    "README current task",
)
text = replace_once(
    text,
    "- Implementation progress: T01 through T06 have verified DONE evidence. T06 aligns solver-facing active inventory with transactional adoption, rejects archived class/session/teacher/room identities, preserves historical resolution, and passed the disposable archive/restore lifecycle. T07 is READY; T08 remains NOT_STARTED pending T07.",
    "- Implementation progress: T01 through T07 have verified DONE evidence. T07 now builds feasibility requests from a single coherent database snapshot, reconstructs planning facts from the immutable PlanningDatasetVersion snapshot, excludes historical assignments, and rejects policy/model/schedule/lock drift before or during a solve. T08 is READY; T09 remains NOT_STARTED pending T08.",
    "README progress",
)
text = replace_once(
    text,
    "T01 through T06 are accepted. T02's initial Docker blocker was resolved and recorded as historical evidence in [TASKS](TASKS.md). Upcoming prerequisites requiring verification:\n- T07: coherent solver snapshots.",
    "T01 through T07 are accepted. T02's initial Docker blocker was resolved and recorded as historical evidence in [TASKS](TASKS.md). Upcoming prerequisites requiring verification:\n- T08: candidate stale-schedule binding.",
    "README accepted",
)
p.write_text(text, encoding="utf-8", newline="\n")

# plans/NEXT.md
p = Path("plans/NEXT.md")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "Current Task: T07\nNext Task: T08", "Current Task: T08\nNext Task: T09", "NEXT current")
text = replace_once(
    text,
    "Baseline: `17b3a60`. T06 is DONE. T07 is the next executable task; T08 remains pending T07.",
    "Baseline: `17b3a60`. T07 is DONE. T08 is the next executable task; T09 remains pending T08.",
    "NEXT summary",
)
start = text.index("## T07 — Coherent solver snapshots")
end = text.index("## T08 — Candidate stale-schedule binding", start)
section = text[start:end]
section = replace_once(section, "**Current status:** READY", "**Current status:** DONE", "NEXT T07 status")
section = replace_once(
    section,
    "**Dependency check:** Satisfied: T02, T03, T05, and T06 are verified DONE. T07 is now the first executable unfinished task.",
    "**Dependency check:** Satisfied and accepted: T02, T03, T05, and T06 are DONE; all T07 acceptance criteria are verified.",
    "NEXT T07 deps",
)
for old, new in [
    ("- [ ] Scheduling facts come from the pinned immutable planning snapshot, with compatible historical schema handling.", "- [x] Scheduling facts come from the pinned immutable planning snapshot, with compatible historical schema handling."),
    ("- [ ] Rulebook/model/current schedule and lock references belong to a coherent context; pointer changes cause retry or rejection.", "- [x] Rulebook/model/current schedule and lock references belong to a coherent context; pointer changes cause retry or rejection."),
    ("- [ ] Concurrent planning/policy changes cannot submit a mixed-version request.", "- [x] Concurrent planning/policy changes cannot submit a mixed-version request."),
    ("- [ ] The request excludes unrelated tenant data and unnecessary historical assignments.", "- [x] The request excludes unrelated tenant data and unnecessary historical assignments."),
]:
    section = replace_once(section, old, new, "NEXT T07 criterion")
marker = "### Exact verification commands\n"
section = replace_once(
    section,
    marker,
    "**Verified run:** GitHub Actions run `34085179827` passed Ubuntu and Windows quality gates; Ubuntu also passed the disposable PostgreSQL snapshot/drift integration lifecycle.\n\n" + marker,
    "NEXT T07 verified",
)
text = text[:start] + section + text[end:]
start = text.index("## T08 — Candidate stale-schedule binding")
end = text.index("## T09 — Session-specific solver locks", start)
section = text[start:end]
section = replace_once(section, "**Current status:** NOT_STARTED", "**Current status:** READY", "NEXT T08 status")
section = replace_once(
    section,
    "**Dependency check:** Not satisfied; waiting for verified DONE: T07.",
    "**Dependency check:** Satisfied: T07 is verified DONE. T08 is now the first executable unfinished task.",
    "NEXT T08 deps",
)
text = text[:start] + section + text[end:]
p.write_text(text, encoding="utf-8", newline="\n")

# plans/TASKS.md
p = Path("plans/TASKS.md")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    "| [T07](#t07) | Coherent solver snapshots | READY | A | P0 | T02, T03, T05, T06 | M |",
    "| [T07](#t07) | Coherent solver snapshots | DONE | A | P0 | T02, T03, T05, T06 | M |",
    "TASKS index T07",
)
text = replace_once(
    text,
    "| [T08](#t08) | Candidate stale-schedule binding | NOT_STARTED | A | P0 | T07 | M |",
    "| [T08](#t08) | Candidate stale-schedule binding | READY | A | P0 | T07 | M |",
    "TASKS index T08",
)
start = text.index('<a id="t07"></a>')
end = text.index('<a id="t08"></a>', start)
section = text[start:end]
section = replace_once(section, "| Status | READY |", "| Status | DONE |", "TASKS T07 status")
for old, new in [
    ("- [ ] Scheduling facts come from the pinned immutable planning snapshot, with compatible historical schema handling.", "- [x] Scheduling facts come from the pinned immutable planning snapshot, with compatible historical schema handling."),
    ("- [ ] Rulebook/model/current schedule and lock references belong to a coherent context; pointer changes cause retry or rejection.", "- [x] Rulebook/model/current schedule and lock references belong to a coherent context; pointer changes cause retry or rejection."),
    ("- [ ] Concurrent planning/policy changes cannot submit a mixed-version request.", "- [x] Concurrent planning/policy changes cannot submit a mixed-version request."),
    ("- [ ] The request excludes unrelated tenant data and unnecessary historical assignments.", "- [x] The request excludes unrelated tenant data and unnecessary historical assignments."),
]:
    section = replace_once(section, old, new, "TASKS T07 criterion")
old_evidence = "### Completion evidence\n\nNot yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation."
new_evidence = '''### Completion evidence

Task/child: T07

Starting HEAD: `ac22a8ee775d62d6b844c21573b4b3fee10308c1` on `feat/pre-cami-hardening` (T01–T06 accepted).

Implemented files:
- [supabase/migrations/20260907050000_coherent_solver_snapshot_v43.sql](../supabase/migrations/20260907050000_coherent_solver_snapshot_v43.sql)
- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)
- [tests/coherent-solver-snapshot.test.ts](../tests/coherent-solver-snapshot.test.ts)
- [tests/planning-inventory-lifecycle.test.ts](../tests/planning-inventory-lifecycle.test.ts)
- [tests/archive-aware-adoption.test.ts](../tests/archive-aware-adoption.test.ts)
- [scripts/test-db.mjs](../scripts/test-db.mjs)

Acceptance criterion → evidence:
- Pinned immutable planning facts: V4.3 adds member-authorized `get_solver_snapshot_v43`, and server solver state reconstructs teachers/rooms/students/cohorts/classes/sessions from the current `PlanningDatasetVersion.snapshot` rather than independently querying mutable planning tables. Stored Planning Dataset and Constraint Model hashes are verified. Snapshot schemas 1.0–1.3 are recognized; when an older snapshot lacks immutable names required by the current name-bound DWDE compiler, preparation fails closed with `SOLVER_PLANNING_SNAPSHOT_SCHEMA_UNSUPPORTED` rather than borrowing names from today's mutable rows.
- Coherent policy/model/schedule/locks: the V4.3 context token binds current Rulebook identity/hash, live reviewed-policy content hash, Planning Dataset identity/hash/confirmation, EnforcementVersion, ConstraintModelVersion/hash, current ScheduleVersion and its pinned versions, plus the current-assignment/lock hash. Any difference makes the context stale.
- Concurrent mutation safety: feasibility reloads the whole coherent snapshot after any deterministic model publication and compares the original token with a fresh token immediately before and after the external solver call. Drift returns `SOLVER_CONTEXT_CHANGED_RETRY` instead of submitting/accepting a mixed-context result. The disposable DB test proves both a live policy mutation and a current assignment/lock mutation change the token.
- Tenant/history minimization: the RPC is explicitly studio-scoped and member-authorized. It returns only assignments belonging to the current ScheduleVersion; the disposable fixture contains historical assignments and proves they are excluded. Planning facts are carried by the pinned tenant Planning Dataset snapshot rather than a fan-out over mutable cross-version tables.

Verification evidence: GitHub Actions run `34085179827` completed successfully on Ubuntu and Windows. Ubuntu 24.04 used Node `v22.23.2` with npm pinned to `11.6.0`; the disposable DB harness used the existing pinned PostgreSQL 17.6 image.
- `npm run lint` — 0 on Ubuntu and Windows; two pre-existing warnings remain.
- `npm run typecheck` — 0 on Ubuntu and Windows.
- `npm test` — 0; Ubuntu reported 48 files / 290 tests passed, including 6 dedicated T07 coherent-snapshot tests.
- `npm run build` — 0 on Ubuntu and Windows; Next.js 16.3.3 production build passed.
- `npm run test:db` — 0 on Ubuntu; migrations reconstructed through V4.3 and emitted `T07 PASS: one coherent snapshot uses pinned planning facts/current assignments only; policy and lock/schedule drift invalidate the context token`.

Implementation commit: `5937349f0ad6a8677c5708af1ab1cc8569a39ba5` (`feat: make solver snapshots coherent`). The verification process first exposed test-fixture typing, then two stale T06 structural assertions that expected the retired mutable server loader, and finally a disposable-harness role issue for synthetic drift mutation. Each was corrected without weakening the T07 contract; the final full matrix and database run passed.

Risks/limitations: no production or staging database was read or mutated, and V4.3 remains a forward migration pending separately authorized deployment. T07 prevents mixed context during preparation and the external solve; T08 still owns binding the resulting reviewed candidate to its exact base ScheduleVersion/lock context through later adoption. Historical snapshots that predate immutable names intentionally fail closed while the current static DWDE compiler remains name-bound; T20/T21 later remove that coupling.

Decision deviations: none. No event store, queue, cache, or new infrastructure tier was introduced.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T08. T09 remains NOT_STARTED pending T08.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, `plans/NEXT.md`, and `plans/DWDE_RELEASE_PLAN.md` (A05 partial evidence).'''
section = replace_once(section, old_evidence, new_evidence, "TASKS T07 evidence")
section = replace_once(
    section,
    "### Notes/blockers\n\nDependencies T02, T03, T05, and T06 are verified DONE. T07 is READY and is the first executable unfinished task.",
    "### Notes/blockers\n\nDependencies T02, T03, T05, and T06 are verified DONE. T07 is accepted with no remaining task-specific blocker. T08 is READY and is now first in the numeric execution spine.",
    "TASKS T07 notes",
)
text = text[:start] + section + text[end:]
start = text.index('<a id="t08"></a>')
end = text.index('<a id="t09"></a>', start)
section = text[start:end]
section = replace_once(section, "| Status | NOT_STARTED |", "| Status | READY |", "TASKS T08 status")
section = replace_once(
    section,
    "Waiting for dependency acceptance: T07. This is normal sequencing, not a BLOCKED status.",
    "T07 is verified DONE. T08 is READY and is the first executable unfinished task.",
    "TASKS T08 notes",
)
text = text[:start] + section + text[end:]
p.write_text(text, encoding="utf-8", newline="\n")

# plans/DWDE_RELEASE_PLAN.md
p = Path("plans/DWDE_RELEASE_PLAN.md")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    "| A05 | Solver input is coherent and reviewed candidates bind base schedule/locks | T07, T08 | Concurrent-edit tests and context manifest |",
    "| A05 | Solver input is coherent and reviewed candidates bind base schedule/locks | T07, T08 | T07 coherent-snapshot and in-solve drift tests are verified; gate remains open for T08 reviewed-candidate/base-schedule binding |",
    "release A05",
)
p.write_text(text, encoding="utf-8", newline="\n")

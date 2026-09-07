from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# Canonical navigation.
p = Path("plans/README.md")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "- Current phase: Phase 0 — Verification foundation.", "- Current phase: Correctness — T03–T10.", "README phase")
text = replace_once(text, "- Current task: **T06 — archive-aware adoption**.\n- Next task: T07 after T06 acceptance.", "- Current task: **T07 — coherent solver snapshots**.\n- Next task: T08 after T07 acceptance.", "README current task")
text = replace_once(
    text,
    "- Implementation progress: T01, T02, T03, T04, and T05 have verified DONE evidence. T02's disposable reconstruction and role/RLS/stale-version run passed; T03's canonical comparison and live JSONB publication/read-back run passed; T04's canonical interval gateway and live adoption/rollback run passed; T05's reviewed-policy provenance/content guard and OPS-003 fail-closed regressions passed. T06 is READY and T07 is NOT_STARTED pending T06.",
    "- Implementation progress: T01 through T06 have verified DONE evidence. T06 aligns solver-facing active inventory with transactional adoption, rejects archived class/session/teacher/room identities, preserves historical resolution, and passed the disposable archive/restore lifecycle. T07 is READY; T08 remains NOT_STARTED pending T07.",
    "README progress",
)
text = replace_once(
    text,
    "T01, T02, T03, T04, and T05 are accepted. T02's initial Docker blocker was resolved and recorded as historical evidence in [TASKS](TASKS.md). Upcoming prerequisites requiring verification:\n- T06: archive-aware adoption.",
    "T01 through T06 are accepted. T02's initial Docker blocker was resolved and recorded as historical evidence in [TASKS](TASKS.md). Upcoming prerequisites requiring verification:\n- T07: coherent solver snapshots.",
    "README accepted tasks",
)
p.write_text(text, encoding="utf-8", newline="\n")

# Immediate queue.
p = Path("plans/NEXT.md")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "Current Task: T06\nNext Task: T07", "Current Task: T07\nNext Task: T08", "NEXT current task")
text = replace_once(text, "Baseline: `17b3a60`. T05 is DONE. T06 is the next executable task; T07 remains pending T06.", "Baseline: `17b3a60`. T06 is DONE. T07 is the next executable task; T08 remains pending T07.", "NEXT summary")
start = text.index("## T06 — Archive-aware adoption")
end = text.index("## T07 — Coherent solver snapshots", start)
section = text[start:end]
section = replace_once(section, "**Current status:** READY", "**Current status:** DONE", "NEXT T06 status")
section = replace_once(section, "**Dependency check:** Satisfied: T02 and T04 are DONE. T06 is queued after T05 in the numeric execution spine.", "**Dependency check:** Satisfied and accepted: T02 and T04 are DONE; all T06 acceptance criteria are verified.", "NEXT T06 deps")
for criterion in [
    "Every active session is required exactly once; archived sessions are excluded from current candidate completeness.",
    "Archived teachers/rooms/classes cannot be introduced into a new active candidate.",
    "Archive → confirm → solve → adopt and restore → reconfirm execute successfully in the disposable database.",
    "Historical versions still resolve archived identities; adjacent current-state count/query defects are fixed or explicitly assigned to T11/T12.",
]:
    section = replace_once(section, f"- [ ] {criterion}", f"- [x] {criterion}", f"NEXT T06 criterion {criterion[:20]}")
section = replace_once(section, "### Exact verification commands\n", "**Verified run:** GitHub Actions run `34083389232` passed Ubuntu and Windows quality gates; Ubuntu also passed `npm run test:db` with the T06 archive/restore candidate lifecycle.\n\n### Exact verification commands\n", "NEXT T06 verified run")
text = text[:start] + section + text[end:]
start = text.index("## T07 — Coherent solver snapshots")
end = text.index("## T08 — Candidate stale-schedule binding", start)
section = text[start:end]
section = replace_once(section, "**Current status:** NOT_STARTED", "**Current status:** READY", "NEXT T07 status")
section = replace_once(section, "**Dependency check:** Not satisfied; waiting for verified DONE: T02, T03, T05, T06.", "**Dependency check:** Satisfied: T02, T03, T05, and T06 are verified DONE. T07 is now the first executable unfinished task.", "NEXT T07 deps")
text = text[:start] + section + text[end:]
p.write_text(text, encoding="utf-8", newline="\n")

# Authoritative task ledger.
p = Path("plans/TASKS.md")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "| [T06](#t06) | Archive-aware adoption | READY | A | P0 | T02, T04 | M |", "| [T06](#t06) | Archive-aware adoption | DONE | A | P0 | T02, T04 | M |", "TASKS index T06")
text = replace_once(text, "| [T07](#t07) | Coherent solver snapshots | NOT_STARTED | A | P0 | T02, T03, T05, T06 | M |", "| [T07](#t07) | Coherent solver snapshots | READY | A | P0 | T02, T03, T05, T06 | M |", "TASKS index T07")
start = text.index('<a id="t06"></a>')
end = text.index('<a id="t07"></a>', start)
section = text[start:end]
section = replace_once(section, "| Status | READY |", "| Status | DONE |", "TASKS T06 status")
for criterion in [
    "Every active session is required exactly once; archived sessions are excluded from current candidate completeness.",
    "Archived teachers/rooms/classes cannot be introduced into a new active candidate.",
    "Archive → confirm → solve → adopt and restore → reconfirm execute successfully in the disposable database.",
    "Historical versions still resolve archived identities; adjacent current-state count/query defects are fixed or explicitly assigned to T11/T12.",
]:
    section = replace_once(section, f"- [ ] {criterion}", f"- [x] {criterion}", f"TASKS T06 criterion {criterion[:20]}")
old_evidence = "### Completion evidence\n\nNot yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation."
new_evidence = """### Completion evidence

Task/child: T06

Starting HEAD: `879c7ecebef4156b1d40eddca29a08f1b8772e35` on `feat/pre-cami-hardening` (T01–T05 accepted).

Implemented files:
- [supabase/migrations/20260907030000_archive_aware_solver_adoption_v42.sql](../supabase/migrations/20260907030000_archive_aware_solver_adoption_v42.sql)
- [lib/server-studio-state.ts](../lib/server-studio-state.ts)
- [tests/archive-aware-adoption.test.ts](../tests/archive-aware-adoption.test.ts)
- [scripts/test-db.mjs](../scripts/test-db.mjs)

Acceptance criterion → evidence:
- Active completeness: V4.2 counts only sessions whose session and parent class are both active, requires exact row/distinct-session cardinality, and the disposable lifecycle proves an archived-only active inventory accepts zero assignments while a restored active session is required exactly once; a duplicate-session candidate rejects atomically.
- Archived targets: V4.2 resolves candidate sessions, parent classes, teachers, and rooms only when active and repeats those joins during insert. The live lifecycle restores the class while leaving teacher/room archived and proves candidate adoption rejects without creating a ScheduleVersion.
- Archive/confirm/solve/adopt lifecycle: the test archives the class/session, teacher, and room; confirms Planning Dataset v10; exercises the solver-facing active-session boundary and adopts the resulting empty feasible candidate; restores class/session and confirms v11; rejects archived teacher/room usage; restores teacher and room, confirms v13, and adopts the restored one-session candidate. The CP-SAT implementation itself was unchanged by T06; this task verifies that solver-facing inventory and governed adoption agree on the same active entity set.
- Historical identity: after archive, a historical ScheduleVersion assignment still resolves the archived session, parent class, teacher, and room by preserved IDs. No archive row is deleted or historical schedule rewritten. Broader incremental ASSIGN/UNASSIGN archived-target behavior remains explicitly owned by T11, and archive-aware recovery/rebase behavior remains explicitly owned by T12.

Verification evidence: GitHub Actions run `34083389232` at commit `8aa233241462fab87bfaec9275a08492bd1cd341` completed successfully on Ubuntu and Windows. Ubuntu 24.04 used Node `v22.23.2` with npm pinned to `11.6.0`; the disposable DB harness used the existing pinned PostgreSQL 17.6 image.
- `npm run lint` — 0 on Ubuntu and Windows; two pre-existing warnings remain.
- `npm run typecheck` — 0 on Ubuntu and Windows.
- `npm test` — 0; Ubuntu reported 47 files / 284 tests passed, including 6 T06 regressions.
- `npm run build` — 0 on Ubuntu and Windows; Next.js 16.3.3 production build passed.
- `npm run test:db` — 0 on Ubuntu; migrations reconstructed through V4.2 and emitted `T06 PASS: archive -> confirm -> adopt excludes archived inventory; archived resources reject; historical identities resolve; restore -> reconfirm -> adopt requires each active session exactly once`.

Core implementation commit: `cd1b95f666ccdc07b8b037b288e606a5f436aa53`. Verification-assertion correction: `8aa233241462fab87bfaec9275a08492bd1cd341`. The first verification run exposed only a case-sensitive wording assertion in the new static test; the assertion was corrected without changing scheduling/database behavior or weakening the gate, then the full second run passed.

Risks/limitations: no production database was read or mutated for T06 verification and no application deployment was performed. V4.1/V4.2 remain forward migrations pending a separately authorized release/deployment step. T07 still owns coherent immutable solver snapshot construction, T11 owns broader incremental archived-target commands, and T12 owns archive-aware recovery semantics.

Decision deviations: none. Historical migration SQL and production-ledger fingerprints remain unchanged.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T07. T08 remains NOT_STARTED pending T07.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, `plans/NEXT.md`, and `plans/DWDE_RELEASE_PLAN.md` (A06 partial evidence)."""
section = replace_once(section, old_evidence, new_evidence, "TASKS T06 evidence")
section = replace_once(section, "### Notes/blockers\n\nDependencies T02 and T04 are verified DONE. T06 is READY and queued after T05 in the numeric execution spine.", "### Notes/blockers\n\nDependencies T02 and T04 are verified DONE. T06 is accepted with no remaining task-specific blocker. T07 is READY and is now first in the numeric execution spine.", "TASKS T06 notes")
text = text[:start] + section + text[end:]
start = text.index('<a id="t07"></a>')
end = text.index('<a id="t08"></a>', start)
section = text[start:end]
section = replace_once(section, "| Status | NOT_STARTED |", "| Status | READY |", "TASKS T07 status")
section = replace_once(section, "Waiting for dependency acceptance: T02, T03, T05, T06. This is normal sequencing, not a BLOCKED status.", "Dependencies T02, T03, T05, and T06 are verified DONE. T07 is READY and is the first executable unfinished task.", "TASKS T07 notes")
text = text[:start] + section + text[end:]
p.write_text(text, encoding="utf-8", newline="\n")

# Release gate: T06 slice is verified, but T11/T12 still keep A06 open.
p = Path("plans/DWDE_RELEASE_PLAN.md")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    "| A06 | Every active required session appears once; archived sessions excluded; history preserved | T06, T11, T12 | Archive/restore and exact-session-set transaction tests |",
    "| A06 | Every active required session appears once; archived sessions excluded; history preserved | T06, T11, T12 | T06 archive/restore and exact-session-set transaction tests are verified; gate remains open for T11/T12 incremental/recovery authority |",
    "release A06",
)
p.write_text(text, encoding="utf-8", newline="\n")

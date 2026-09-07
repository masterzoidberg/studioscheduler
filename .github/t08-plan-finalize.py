from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8', newline='\n')


def rep(path, old, new, count=1):
    text = read(path)
    if text.count(old) < count:
        raise SystemExit(f'anchor missing in {path}: {old[:140]!r}')
    write(path, text.replace(old, new, count))

# README current navigation and blocker pointer.
rep('plans/README.md',
'''- Current task: **T08 — candidate stale-schedule binding**.
- Next task: T09 after T08 acceptance.
- Planning baseline: HEAD `17b3a60`, inspected 2026-09-06.
- Implementation progress: T01 through T07 have verified DONE evidence. T07 now builds feasibility requests from a single coherent database snapshot, reconstructs planning facts from the immutable PlanningDatasetVersion snapshot, excludes historical assignments, and rejects policy/model/schedule/lock drift before or during a solve. T08 is READY; T09 remains NOT_STARTED pending T08.''',
'''- Current task: **T09 — session-specific solver locks**.
- Next task: T10 after T09 acceptance.
- Planning baseline: HEAD `17b3a60`, inspected 2026-09-06.
- Implementation progress: T01 through T08 have verified DONE evidence. T08 now binds every reviewed FEASIBLE candidate to the exact coherent base ScheduleVersion and schedule/lock fingerprint, rejects stale/concurrent/double adoption, and preserves the stale reviewed candidate in the UI with regenerate/re-review guidance. T09 is READY; T10 remains NOT_STARTED pending T09.''')
rep('plans/README.md',
'''T01 through T07 are accepted. T02's initial Docker blocker was resolved and recorded as historical evidence in [TASKS](TASKS.md). Upcoming prerequisites requiring verification:
- T08: candidate stale-schedule binding.''',
'''T01 through T08 are accepted. T02's initial Docker blocker was resolved and recorded as historical evidence in [TASKS](TASKS.md). Upcoming prerequisites requiring verification:
- T09: session-specific solver locks.''')

# NEXT navigation and T08/T09 local statuses.
rep('plans/NEXT.md',
'''Current Task: T08
Next Task: T09

Baseline: `17b3a60`. T07 is DONE. T08 is the next executable task; T09 remains pending T08.''',
'''Current Task: T09
Next Task: T10

Baseline: `17b3a60`. T08 is DONE. T09 is the next executable task; T10 remains pending T09.''')
rep('plans/NEXT.md', '**Current status:** READY\n\n**Dependency check:** Satisfied: T07 is verified DONE. T08 is now the first executable unfinished task.',
'''**Current status:** DONE

**Dependency check:** Satisfied and accepted: T07 is DONE; all T08 acceptance criteria are verified.''')
for old in [
'- [ ] Candidate context includes base ScheduleVersion and unambiguous lock identity alongside studio, Rulebook, planning, and compiler/model context.',
'- [ ] An intervening schedule edit or lock change rejects stale adoption even when policy/planning versions are unchanged.',
'- [ ] The UI preserves the reviewed context and explains the need to regenerate/re-review.',
'- [ ] Transactional expected-version checks use submitted reviewed context, not substituted fresh values.'
]:
    rep('plans/NEXT.md', old, old.replace('- [ ]','- [x]'))
rep('plans/NEXT.md', '**Current status:** NOT_STARTED\n\n**Dependency check:** Not satisfied; waiting for verified DONE: T07, T08.',
'''**Current status:** READY

**Dependency check:** Satisfied: T07 and T08 are verified DONE. T09 is now the first executable unfinished task.''')

# TASKS status index and detailed T08/T09 entries.
rep('plans/TASKS.md', '| [T08](#t08) | Candidate stale-schedule binding | READY | A | P0 | T07 | M |',
    '| [T08](#t08) | Candidate stale-schedule binding | DONE | A | P0 | T07 | M |')
rep('plans/TASKS.md', '| [T09](#t09) | Session-specific solver locks | NOT_STARTED | A | P0 | T07, T08 | M |',
    '| [T09](#t09) | Session-specific solver locks | READY | A | P0 | T07, T08 | M |')
# Within T08 section, first READY after anchor becomes DONE.
text = read('plans/TASKS.md')
anchor = '<a id="t08"></a>'
start = text.index(anchor)
end = text.index('<a id="t09"></a>', start)
section = text[start:end]
section = section.replace('| Status | READY |', '| Status | DONE |', 1)
section = section.replace('- [ ] Candidate context includes base ScheduleVersion and unambiguous lock identity alongside studio, Rulebook, planning, and compiler/model context.', '- [x] Candidate context includes base ScheduleVersion and unambiguous lock identity alongside studio, Rulebook, planning, and compiler/model context.')
section = section.replace('- [ ] An intervening schedule edit or lock change rejects stale adoption even when policy/planning versions are unchanged.', '- [x] An intervening schedule edit or lock change rejects stale adoption even when policy/planning versions are unchanged.')
section = section.replace('- [ ] The UI preserves the reviewed context and explains the need to regenerate/re-review.', '- [x] The UI preserves the reviewed context and explains the need to regenerate/re-review.')
section = section.replace('- [ ] Transactional expected-version checks use submitted reviewed context, not substituted fresh values.', '- [x] Transactional expected-version checks use submitted reviewed context, not substituted fresh values.')
old_evidence = '''### Completion evidence

Not yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.

### Notes/blockers

T07 is verified DONE. T08 is READY and is the first executable unfinished task.'''
new_evidence = '''### Completion evidence

Task/child: T08

Starting HEAD: `bcdfa92f8086c089f1e16809fc24ea43e5aa3e98` on `feat/pre-cami-hardening` (T01–T07 accepted).

Implemented files:
- [lib/solver-candidate-context.ts](../lib/solver-candidate-context.ts)
- [app/api/solver/feasibility/route.ts](../app/api/solver/feasibility/route.ts)
- [app/api/solver/adopt/route.ts](../app/api/solver/adopt/route.ts)
- [components/solver-feasibility-card.tsx](../components/solver-feasibility-card.tsx)
- [supabase/migrations/20260907070000_candidate_stale_schedule_binding_v44.sql](../supabase/migrations/20260907070000_candidate_stale_schedule_binding_v44.sql)
- [tests/solver-candidate-context.test.ts](../tests/solver-candidate-context.test.ts)
- [tests/candidate-stale-binding.test.ts](../tests/candidate-stale-binding.test.ts)
- [scripts/test-db.mjs](../scripts/test-db.mjs)

Acceptance criterion → evidence:
- Exact reviewed context: feasibility returns a separate versioned `candidateContext` without changing the CP-SAT service problem contract. It carries the complete T07 coherent token, including base ScheduleVersion ID/version and `scheduleAssignmentsHash`, plus compiler identity; missing/partial context fails closed.
- Stale schedule/lock rejection: adoption compares the submitted reviewed context against the current coherent context before revalidation, and V4.4 repeats the comparison transactionally under the existing scheduling advisory locks. The disposable DB regression changes only the lock bit while Rulebook/Planning remain unchanged and proves stale adoption rejects.
- Review-preserving UI: the candidate card displays reviewed ScheduleVersion and schedule/lock fingerprint. A stale response keeps the reviewed candidate visible, clears approval, disables adoption, and tells the manager to generate a fresh candidate and review it again.
- No fresh-version substitution: the application sends `p_expected_context: reviewedContext` unchanged. V4.4 derives the expected schedule/rulebook/enforcement/planning/model versions from that submitted context before delegating canonical persistence/legacy validation to V3.3. Concurrent-editor and repeated/double adoption regressions prove only the first exact reviewed context can commit.

Verification evidence: GitHub Actions run `34086356692` completed successfully on Ubuntu and Windows. Ubuntu 24.04 used Node `v22.23.2` with npm pinned to `11.6.0`; the disposable DB harness used the existing pinned PostgreSQL 17.6 image.
- `npm run lint` — 0 on Ubuntu and Windows; two pre-existing warnings remain.
- `npm run typecheck` — 0 on Ubuntu and Windows.
- `npm test` — 0; Ubuntu reported 50 files / 297 tests passed, including 3 reviewed-context and 4 stale-binding tests.
- `npm run build` — 0 on Ubuntu and Windows; Next.js 16.3.3 production build passed.
- `npm run test:db` — 0 on Ubuntu; migrations reconstructed through V4.4 and emitted `T08 PASS: exact reviewed context adopts once; same-version lock drift, concurrent editor stale review, and double adoption reject atomically without fresh-version substitution`.

Implementation commit: `0c8456826d22dd4d26c1bed194f6bcdbed481348` (`feat: bind reviewed solver candidates to base schedule`). The first disposable DB run exposed that the synthetic test crossed the intentionally private schema as `service_role`. The correction preserved that boundary: the service-role-only public V4.4 RPC is a narrow security-definer function while broad private-schema access remains ungranted; the final full matrix passed.

Risks/limitations: no production or staging database was read or mutated, and V4.4 remains a forward migration pending separately authorized deployment. T08 binds the currently supported aggregate schedule/lock fingerprint; T09 still owns session-specific multi-session lock semantics throughout prepare/solve/validate/adopt.

Decision deviations: none. The external solver-service wire contract was deliberately unchanged; review/adoption context is a separate versioned wrapper.

New blockers and unblock condition: none.

Resulting task status: DONE.

Newly READY tasks: T09. T10 remains NOT_STARTED pending T09.

Updated plan files: `plans/README.md`, `plans/TASKS.md`, `plans/NEXT.md`, and `plans/DWDE_RELEASE_PLAN.md` (A05 verified evidence).

### Notes/blockers

T07 and T08 are verified DONE. T08 is accepted with no remaining task-specific blocker. T09 is READY and is now first in the numeric execution spine.'''
if old_evidence not in section:
    raise SystemExit('T08 evidence anchor missing')
section = section.replace(old_evidence, new_evidence, 1)
text = text[:start] + section + text[end:]
# T09 READY and dependency note.
start9 = text.index('<a id="t09"></a>')
end9 = text.index('<a id="t10"></a>', start9)
sec9 = text[start9:end9]
sec9 = sec9.replace('| Status | NOT_STARTED |', '| Status | READY |', 1)
sec9 = sec9.replace('Waiting for dependency acceptance: T07, T08. This is normal sequencing, not a BLOCKED status.', 'Dependencies T07 and T08 are verified DONE. T09 is READY and is the first executable unfinished task.', 1)
text = text[:start9] + sec9 + text[end9:]
write('plans/TASKS.md', text)

# Release gate A05 is now fully evidenced by T07+T08, while overall release remains open.
rep('plans/DWDE_RELEASE_PLAN.md',
'| A05 | Solver input is coherent and reviewed candidates bind base schedule/locks | T07, T08 | T07 coherent-snapshot and in-solve drift tests are verified; gate remains open for T08 reviewed-candidate/base-schedule binding |',
'| A05 | Solver input is coherent and reviewed candidates bind base schedule/locks | T07, T08 | Verified: T07 coherent snapshot/in-solve drift tests plus T08 exact reviewed-context, same-version lock drift, concurrent-editor, and double-adoption transaction tests; overall release remains open until all A-gates pass |')

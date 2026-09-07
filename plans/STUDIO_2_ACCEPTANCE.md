# Studio #2 — Formal Acceptance Specification

Owner task: T27. Gate dependencies: T19, T21–T26; exact dependencies in [TASKS](TASKS.md). Initial status: NOT_STARTED. This is a planned test fixture, not an assertion that a customer exists.

## Organization and supported scope

Use **Harbor Music School**, an unrelated synthetic acceptance organization, followed by an actual unrelated pilot using the same flow.

Minimum fixture:
- 4 instructors with opaque IDs; unrelated names and instrument qualifications.
- 4 rooms with distinct capacities/features; every room used in at least one feasible assignment.
- 30 participants assigned to actual rosters.
- 12 activities and 20 weekly sessions (e.g. 8 activities meeting twice plus 4 once).
- Subjects: Piano, Strings, Voice, Ensemble; level labels: Starter, Developing, Ensemble Ready.
- Morning windows on at least two weekdays (e.g. 09:00–13:00).
- 30/45/60-minute durations within the initial 15-minute quantum.
- At least one per-meeting duration override and one multi-session activity with exactly one locked meeting.
- Room requirement (piano equipment), explicit instructor qualifications, restricted availability.
- Sequencing between an ensemble preparation session and an ensemble activity.
- VERY_STRONG, MODERATE, and LIGHT preferences with nontrivial candidate tradeoffs.
- Rule count explicitly different from 178; use opaque rule identity and tenant-local display codes.

No DWDE Rule IDs, names, Ballet/Pointe relationships, or curriculum requirements. Keep fixtures feasible by designing and independently validating a witness schedule before using them as solver benchmarks. Do not rely on guessed fixture feasibility.

Sunday/finer grids are outside this base fixture. If a real pilot needs them, amend T24/scope through a decision and test explicitly; never silently coerce the input.

## Test setup

1. Reconstruct disposable DB via T02, install app/solver at a frozen SHA, record migration head and dependency versions.
2. Provision DWDE golden tenant and Harbor through supported setup; no per-tenant compiler code.
3. Create owner/editor/viewer/nonmember users, plus a dual-membership user with different roles.
4. Import Harbor data using T26 standard CSV/forms, recording all operator actions.
5. Confirm exact planning/policy context and create a known feasible witness.
6. Run production-like app/solver within the documented resource envelope.
7. Preserve privacy: use synthetic data in Git; real participant data stays in approved private storage.

## Acceptance matrix

| ID | Criterion and procedure | Expected result | Tasks | Evidence |
|---|---|---|---|---|
| S201 | Freeze code before onboarding; record every setup action | Zero tenant-specific code changes and zero compiler/solver patches | T21, T25–T27 | Starting/ending SHA, diff, operator action log |
| S202 | Inspect all organization records/UI/exports/context | No DWDE data leakage | T22–T24 | Scoped query results, screenshots, export/context audit |
| S203 | Use rule count different from 178 | Readiness based on actual supported rules succeeds | T21, T25 | Rule count, coverage/binding report |
| S204 | View day/week/mobile schedules | All 4 rooms and their sessions render | T24 | Viewport/device screenshots and room/session counts |
| S205 | Generate/adopt complete schedule | Every active session exactly once, no extras/duplicates | T04, T06, T14, T27 | Session-set comparison and candidate/persisted diff |
| S206 | Independently evaluate result | Zero HARD violations; all preconditions proven | T14, T20 | Runtime validation and delegated proof artifacts |
| S207 | Lock one meeting; solve/adopt/edit | Exact lock preserved; other meetings movable; forbidden move rejected | T09 | Lock context, assignment diff, rejected command |
| S208 | Create controlled impossible variants | Proven impossible model reports INFEASIBLE; missing facts report precondition failure; time exhaustion UNKNOWN, never false success | T14, T15 | Fixture variants, solve statuses, context, diagnostic evidence |
| S209 | Score candidates repeatedly in both layers | Deterministic score components and ranking match | T17–T19 | Score JSON, repeated independent rescore |
| S210 | Edit rule/planning/schedule/lock after generation | Stale adoption rejects atomically with no new canonical version | T08, T13 | Expected/current tokens, rejection, DB counts |
| S211 | Attempt cross-tenant reads/writes directly, not only UI | RLS/RPC/API boundaries deny all unauthorized access | T22 | Auth matrix with commands/statuses and unchanged rows |
| S212 | Dual-membership user switches studio, including unequal roles | Every mutation targets selected tenant; stronger role elsewhere confers no rights here | T22, T23 | Before/after rows in both tenants, audit actor/context |
| S213 | Rename every display name retaining stable IDs | Same legality, bindings, hard verdict, and objective values | T20, T21 | Transformation map, before/after reports, repeated solve validity |
| S214 | Archive optional activity/session and restore | Active solve set changes correctly; historical schedules still resolve old facts | T06, T12 | History/context hashes, archive/restore transaction logs |
| S215 | Independent operator follows runbook | Completes setup through export without source edits or custom SQL | T23–T27 | Observer checklist, assistance log, export artifact |
| S216 | Review two or three diverse candidates | Clear differences and preference tradeoffs; refresh preserves candidates | T19 | Candidate IDs, diversity metric, comparison screenshots |
| S217 | Use same teacher/room display names or ambiguous import aliases | Identity remains ID-based; ambiguous intake requires review | T20, T26 | Duplicate-name fixture and import validation |
| S218 | Try malformed/foreign-reference import and retry valid import | Invalid batch rolls back; retry does not duplicate | T26 | Import counts, audit IDs, DB before/after |

S208 impossible variants should include a qualified teacher unavailable for the only permitted fixed window, two locked overlapping sessions sharing a room, and a room/qualification domain with no compatible placement. Demonstrate infeasibility with controlled deterministic fixtures; do not infer it from timeout. Inject/model a bounded UNKNOWN test separately.

S213 does not require identical arbitrary assignments where several optima exist or unchanged explanation text. It requires unchanged semantics and deterministic rescoring; any canonical binding name dependence is a failure.

## Exact run commands

After predecessor harnesses exist, from the repository root:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:parity
npm run test:e2e
Push-Location solver
python -m pytest -q
Pop-Location
```

Run the S201–S218 operator workflow as well. Automated green tests alone do not prove zero bespoke onboarding.

## Evidence to store

Each run must store:
- run ID/date/environment and explicit nonproduction confirmation;
- frozen app SHA before/after onboarding, clean diff or explained unrelated changes;
- migration head and reconstruction log;
- Node/Python/OR-Tools versions and solver settings/resource budget;
- fixture CSV/JSON hashes, counts, known witness schedule and transformation map;
- tenant/test-user role matrix (no passwords/tokens);
- exact Rulebook/Planning Dataset/Constraint Model/base ScheduleVersion/lock context;
- raw solve status, timings, independent validator/preflight output;
- score breakdowns, candidate differences, persisted assignment reconciliation;
- stale/isolation/import/archive tests and unchanged-state proofs on rejection;
- desktop/mobile room-render evidence and schedule export;
- operator log including every manual assistance action;
- S201–S218 pass/fail with artifact references, unresolved blockers, reviewer conclusion.

Store under an approved evidence root with one run directory. Commit only synthetic/deidentified fixture evidence; private customer artifacts must remain access-controlled and linked by stable reference. No new evidence directory is claimed to exist yet.

## Exit rule

All required criteria pass; no hidden exceptions; zero tenant-specific source changes. If bespoke code was needed, record the unsupported general capability, implement it as a generic task, then restart acceptance at a new frozen SHA. Do not “pass with custom patch.” T27 DONE requires this evidence, not merely a prepared fixture.


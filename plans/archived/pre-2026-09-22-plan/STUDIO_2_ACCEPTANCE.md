# Second-studio acceptance specification

Milestone B, executed by [GEN-05](prompts/GEN-05.md); task status belongs only in [TASKS](TASKS.md). All cases below are required and currently unverified. This is an acceptance checklist, not a parallel roadmap.

Use a consenting independent manager and supported weekly organization, with no DWDE knowledge. Freeze application SHA before onboarding. Keep identifiable data and recordings private; use synthetic/deidentified fixtures for public regression. A renamed DWDE fixture is one metamorphic test, not the independent studio.

| Case | Required pass evidence |
|---|---|
| S201 Empty workspace | Create workspace through normal UI, no DWDE people/rules/source edits; retry creates one workspace |
| S202 Different vocabulary | Teacher/class/room names and IDs differ, duplicate/Unicode display names do not change identity |
| S203 Different structure | Different curriculum/class counts/rosters and rules; no exactly-178 prerequisite |
| S204 Calendar/rooms | Four rooms, morning windows, Sunday and supported 15-minute daytime grid; every session visible/printed |
| S205 Setup independence | Manager completes inventory, qualifications, availability and requirements without developer transformation |
| S206 Review semantics | Unknown vs explicit-none preserved; one capacity edit leaves unrelated availability review intact |
| S207 Policy support | Supported typed policy compiles; unsupported HARD is visible and blocks full safety claims |
| S208 Feasible witness | Complete independently checked witness; solver candidate passes independent current TS validation |
| S209 Impossible case | Deliberate small contradiction proven infeasible; timeout/unknown never mislabeled impossible |
| S210 Manual workflow | Assign/move/unassign via keyboard/tap; server rejection leaves authoritative state unchanged |
| S211 Locks/recovery | Exact session lock, regenerate preserves it, undo/rebase validates current policy |
| S212 Stale candidate | Policy/planning/schedule/lock edit prevents old candidate adoption; no token substitution |
| S213 Tenancy | Opposite roles in two studios, reversed membership order, foreign IDs and version replay all deny |
| S214 Imports | CSV preview rejects bad references/duplicates; stale/replayed batch creates no partial or duplicate facts |
| S215 Archive/history | Archive/unarchive retains history; referenced entity restrictions and prior export remain coherent |
| S216 Outputs | Print/CSV reconciles all placements, names and durations; draft/final labels and privacy correct |
| S217 Reliability/help | Unavailable service/session expiry/failed save gives actionable recovery; AI disabled |
| S218 Independent repeat | Manager repeats setup change→review→generate/edit/export; logs every assistance step; no source patch |

Record frozen SHA, migration head, Node/Python/OR-Tools versions, solver limits, fixture hashes/counts, exact policy/planning/model/base schedule/lock context, role matrix, timings, browser/artifact references, test results and S201–S218 disposition. Never store tokens/passwords.

All cases must pass without studio-specific source edits. If a missing general capability requires code, create a bounded task with accepted semantics, implement/verify it, freeze a new SHA and restart affected acceptance; no “pass with bespoke patch.” Preference optimization/durable comparison is milestone C, so B needs honest feasibility quality disclosure and usable manually finished result, not an unimplemented optimization claim.


import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioState } from "@/lib/domain";
import type { FeasibilitySolverProblem } from "@/lib/solver-problem";
import { validateFeasibleSolverCandidate, type SolverAssignmentCandidate } from "@/lib/solver-gateway";

const parityDescribe = process.env.STUDIO_SCHEDULER_PARITY === "1" ? describe : describe.skip;
const pythonBinary = process.env.PYTHON_BINARY?.trim() || "python";
const fixed = (id: string, className: string, day: string, start: string, end: string, teacherName?: string) => ({ id, kind: "FIXED_ASSIGNMENT", ruleIds: [id], selector: { classNames: [className], ...(teacherName ? { teacherNames: [teacherName] } : {}) }, parameters: { day, start, end }, explanation: id });

function problem(hardConstraints: Array<Record<string, unknown>>): FeasibilitySolverProblem {
  return {
    contractVersion: "1.0", context: { studioId: "pol03-parity", rulebookVersion: 6, planningDatasetVersion: 1, compilerVersion: "dwde-ir-0.6" },
    teachers: [{ id: "teacher-a", name: "Teacher A" }, { id: "teacher-b", name: "Teacher B" }], rooms: [{ id: "room", name: "Room", capacity: 20, features: [] }],
    students: [{ id: "student-a", name: "Participant A", level: "L1", cohortIds: [] }, { id: "student-b", name: "Participant B", level: "L1", cohortIds: [] }],
    classes: [
      { id: "class-a", name: "Class A", subject: "A", level: "L1", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: ["student-a"], companyOnly: false },
      { id: "class-b", name: "Class B", subject: "B", level: "L1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-b"], companyOnly: false },
      { id: "class-c", name: "Class C", subject: "C", level: "L1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-a"], companyOnly: false },
    ],
    sessions: [{ id: "session-a", classId: "class-a", ordinal: 1, durationMinutes: null, locked: false, lockedPlacement: null }, { id: "session-b", classId: "class-b", ordinal: 1, durationMinutes: null, locked: false, lockedPlacement: null }, { id: "session-c", classId: "class-c", ordinal: 1, durationMinutes: null, locked: false, lockedPlacement: null }],
    constraintModel: { schemaVersion: "1.0", compilerVersion: "dwde-ir-0.6", rulebookVersion: 6, planningDatasetVersion: 1, activeRuleCount: hardConstraints.length, hardConstraints: hardConstraints as unknown as FeasibilitySolverProblem["constraintModel"]["hardConstraints"], objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true },
    preflight: { validatedDelegatedConstraintIds: [] },
  };
}

const cases = [
  { id: "participant-group-overlap", expectedSolverStatus: "INFEASIBLE", expectedTsLegal: false, probeCandidate: [{ sessionId: "session-a", day: "Monday", startTime: "16:00", endTime: "16:45", teacherId: "teacher-a", roomId: "room" }, { sessionId: "session-b", day: "Monday", startTime: "16:30", endTime: "17:30", teacherId: "teacher-a", roomId: "room" }, { sessionId: "session-c", day: "Wednesday", startTime: "16:00", endTime: "17:00", teacherId: "teacher-a", roomId: "room" }], problem: problem([{ id: "group", kind: "PARTICIPANT_NO_OVERLAP", ruleIds: ["GROUP"], selector: { participantIds: ["student-a", "student-b"] }, parameters: {}, explanation: "group" }, fixed("fa", "Class A", "Monday", "16:00", "16:45"), fixed("fb", "Class B", "Monday", "16:30", "17:30"), fixed("fc", "Class C", "Wednesday", "16:00", "17:00")]) },
  { id: "maximum-distinct-days", expectedSolverStatus: "INFEASIBLE", expectedTsLegal: false, probeCandidate: [{ sessionId: "session-a", day: "Monday", startTime: "16:00", endTime: "16:45", teacherId: "teacher-a", roomId: "room" }, { sessionId: "session-b", day: "Wednesday", startTime: "16:00", endTime: "17:00", teacherId: "teacher-a", roomId: "room" }, { sessionId: "session-c", day: "Tuesday", startTime: "16:00", endTime: "17:00", teacherId: "teacher-a", roomId: "room" }], problem: problem([{ id: "max", kind: "MAX_ATTENDANCE_DAYS", ruleIds: ["MAX"], selector: { participantIds: ["student-a"] }, parameters: { maxDays: 1 }, explanation: "max" }, fixed("fa", "Class A", "Monday", "16:00", "16:45"), fixed("fb", "Class B", "Wednesday", "16:00", "17:00"), fixed("fc", "Class C", "Tuesday", "16:00", "17:00")]) },
  { id: "direct-after-duration-boundary", expectedSolverStatus: "FEASIBLE", expectedTsLegal: true, problem: problem([{ id: "direct", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ"], selector: { sessionIds: ["session-a", "session-b"] }, parameters: { predecessorSessionId: "session-a", successorSessionId: "session-b" }, explanation: "direct" }, fixed("fa", "Class A", "Monday", "16:00", "16:45"), fixed("fb", "Class B", "Monday", "16:45", "17:45"), fixed("fc", "Class C", "Wednesday", "16:00", "17:00")]) },
  { id: "reversed-direct-relation", expectedSolverStatus: "INFEASIBLE", expectedTsLegal: false, probeCandidate: [{ sessionId: "session-a", day: "Monday", startTime: "16:00", endTime: "16:45", teacherId: "teacher-a", roomId: "room" }, { sessionId: "session-b", day: "Monday", startTime: "16:45", endTime: "17:45", teacherId: "teacher-a", roomId: "room" }, { sessionId: "session-c", day: "Wednesday", startTime: "16:00", endTime: "17:00", teacherId: "teacher-a", roomId: "room" }], problem: problem([{ id: "forward", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-A"], selector: { sessionIds: ["session-a", "session-b"] }, parameters: { predecessorSessionId: "session-a", successorSessionId: "session-b" }, explanation: "forward" }, { id: "reverse", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-B"], selector: { sessionIds: ["session-b", "session-a"] }, parameters: { predecessorSessionId: "session-b", successorSessionId: "session-a" }, explanation: "reverse" }, fixed("fa", "Class A", "Monday", "16:00", "16:45"), fixed("fb", "Class B", "Monday", "16:45", "17:45"), fixed("fc", "Class C", "Wednesday", "16:00", "17:00")]) },
  { id: "linked-arrival-inclusive-boundary", expectedSolverStatus: "FEASIBLE", expectedTsLegal: true, problem: problem([{ id: "arrival", kind: "LINKED_ARRIVAL", ruleIds: ["ARR"], selector: { teacherIds: ["teacher-a"], participantIds: ["student-a"] }, parameters: { teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: -15, maxOffsetMinutes: 30 }, explanation: "arrival" }, fixed("fa", "Class A", "Monday", "16:00", "16:45", "Teacher B"), fixed("fb", "Class B", "Monday", "16:30", "17:30", "Teacher A"), fixed("fc", "Class C", "Wednesday", "16:00", "17:00", "Teacher B")]) },
] as const;

function stateFor(p: FeasibilitySolverProblem): StudioState {
  return { studioId: p.context.studioId, studioName: "Parity", teachers: p.teachers.map((item) => ({ ...item, subjects: [] })), rooms: p.rooms.map((item) => ({ ...item, capacity: item.capacity ?? undefined })), students: p.students.map((item) => ({ ...item })), cohorts: [], classes: p.classes.map((item) => ({ ...item, eligibleTeacherIds: [] })), sessions: p.sessions.map((item) => ({ ...item, durationMinutes: item.durationMinutes ?? undefined })), rules: [], rulebookVersions: [{ id: "rb", version: 6, name: "rb", createdAt: "2026-09-10", actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }], enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [], planningDatasetVersions: [{ id: "pd", version: 1, createdAt: "2026-09-10", actor: "test", reason: "test", snapshotHash: "0".repeat(64), status: "CURRENT", snapshot: { schemaVersion: "1.3", studioId: p.context.studioId, teacherIds: [], rooms: [], students: [], cohorts: [], classes: [], sessions: [] } }] } as StudioState;
}

parityDescribe("POL-03 shared typed runtime parity", () => {
  it("agrees for all four promoted families", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pol03-parity-")); const fixturePath = path.join(directory, "fixture.json");
    try {
      writeFileSync(fixturePath, JSON.stringify({ schemaVersion: "1.0", cases }));
      const result = spawnSync(pythonBinary, [path.resolve("solver/tests/runtime_parity_runner.py"), fixturePath], { encoding: "utf8", windowsHide: true, env: { ...process.env } });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      const python = JSON.parse(result.stdout) as { results: Array<{ id: string; status: string; assignments: SolverAssignmentCandidate[] }> };
      for (const testCase of cases) {
        const py = python.results.find((item) => item.id === testCase.id)!;
        expect(py.status, testCase.id).toBe(testCase.expectedSolverStatus);
        const assignments = "probeCandidate" in testCase ? [...testCase.probeCandidate] : py.assignments;
        const ts = validateFeasibleSolverCandidate(stateFor(testCase.problem), testCase.problem, { serviceVersion: "pol03-parity", context: testCase.problem.context, result: { status: "FEASIBLE", assignments: assignments as SolverAssignmentCandidate[], unsupportedConstraintIds: [], delegatedConstraintIds: [], missingPreconditionConstraintIds: [], blockingConstraintIds: [] } });
        expect(ts.ok, testCase.id).toBe(testCase.expectedTsLegal);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

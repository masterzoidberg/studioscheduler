import { describe, expect, it } from "vitest";
import type { Assignment, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";

function state(): StudioState {
  return {
    studioId: "studio", studioName: "Fixture", teachers: [{ id: "teacher-a", name: "Renamed Teacher", subjects: [] }, { id: "teacher-b", name: "Other", subjects: [] }],
    rooms: [{ id: "room-a", name: "Room", capacity: 20 }],
    students: [{ id: "student-a", name: "Renamed Participant", level: "L1" }, { id: "student-b", name: "B", level: "L1" }], cohorts: [],
    classes: [
      { id: "class-a", name: "A", subject: "A", level: "L1", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: ["student-a"], eligibleTeacherIds: [] },
      { id: "class-b", name: "B", subject: "B", level: "L1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-b"], eligibleTeacherIds: [] },
      { id: "class-c", name: "C", subject: "C", level: "L1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-a"], eligibleTeacherIds: [] },
    ],
    sessions: [{ id: "session-a", classId: "class-a", ordinal: 1 }, { id: "session-b", classId: "class-b", ordinal: 1 }, { id: "session-c", classId: "class-c", ordinal: 1 }],
    rules: [], rulebookVersions: [], enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [], planningDatasetVersions: [],
  };
}

const assignment = (id: string, sessionId: string, day: Assignment["day"], startTime: string, endTime: string): Assignment => ({ id, sessionId, day, startTime, endTime, teacherId: "teacher-a", roomId: "room-a" });
const node = (kind: ConstraintIRNode["kind"], selector: ConstraintIRNode["selector"], parameters: Record<string, unknown>): ConstraintIRNode => ({ id: `typed-${kind.toLowerCase()}`, kind, ruleIds: ["POL03"], selector, parameters, explanation: "fixture" });
const model = (...hardConstraints: ConstraintIRNode[]): ConstraintModelSnapshotV1 => {
  const qualification = node("TEACHER_SUBJECT_DOMAIN", { teacherIds: ["teacher-a", "teacher-b"] }, {});
  return { schemaVersion: "1.0", compilerVersion: "dwde-ir-0.6-test", rulebookVersion: 6, planningDatasetVersion: 1, activeRuleCount: hardConstraints.length + 1, hardConstraints: [...hardConstraints, qualification], objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true };
};

describe("POL-03 typed runtime semantics", () => {
  it("enforces no-overlap across the selected participant group", () => {
    const policy = node("PARTICIPANT_NO_OVERLAP", { participantIds: ["student-a", "student-b"] }, {});
    const placements = [assignment("a", "session-a", "Monday", "16:00", "16:45"), assignment("b", "session-b", "Monday", "16:30", "17:30")];
    expect(validateConstraintModelSchedule(state(), model(policy), placements).violations).toContainEqual(expect.objectContaining({ constraintId: policy.id }));
  });

  it("counts distinct attendance days for the selected participant", () => {
    const policy = node("MAX_ATTENDANCE_DAYS", { participantIds: ["student-a"] }, { maxDays: 1 });
    const placements = [assignment("a", "session-a", "Monday", "16:00", "16:45"), assignment("c", "session-c", "Tuesday", "16:00", "17:00")];
    expect(validateConstraintModelSchedule(state(), model(policy), placements).violations).toContainEqual(expect.objectContaining({ constraintId: policy.id }));
    const onlyOtherParticipant = [assignment("b", "session-b", "Monday", "16:00", "17:00"), assignment("b2", "session-b", "Tuesday", "16:00", "17:00")];
    expect(validateConstraintModelSchedule(state(), model(policy), onlyOtherParticipant).violations).toEqual([]);
  });

  it("uses predecessor endpoint duration and exact equality", () => {
    const policy = node("DIRECTLY_AFTER", { sessionIds: ["session-a", "session-b"] }, { predecessorSessionId: "session-a", successorSessionId: "session-b" });
    const equal = [assignment("a", "session-a", "Monday", "16:00", "16:45"), assignment("b", "session-b", "Monday", "16:45", "17:45")];
    const gap = [equal[0], assignment("b", "session-b", "Monday", "17:00", "18:00")];
    expect(validateConstraintModelSchedule(state(), model(policy), equal).violations).toEqual([]);
    expect(validateConstraintModelSchedule(state(), model(policy), gap).violations).toContainEqual(expect.objectContaining({ constraintId: policy.id }));
    expect(validateConstraintModelSchedule(state(), model(policy), []).violations).toContainEqual(expect.objectContaining({ constraintId: policy.id }));
  });

  it("uses the signed inclusive arrival offset and requires attendance on each teaching day", () => {
    const policy = node("LINKED_ARRIVAL", { teacherIds: ["teacher-a"], participantIds: ["student-a"] }, { teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: -15, maxOffsetMinutes: 30 });
    const participant = { ...assignment("a", "session-a", "Monday", "16:00", "16:45"), teacherId: "teacher-b" };
    expect(validateConstraintModelSchedule(state(), model(policy), [participant, assignment("b", "session-b", "Monday", "16:30", "17:30")]).violations).toEqual([]);
    expect(validateConstraintModelSchedule(state(), model(policy), [participant, assignment("b", "session-b", "Monday", "16:45", "17:45")]).violations).toContainEqual(expect.objectContaining({ constraintId: policy.id }));
    expect(validateConstraintModelSchedule(state(), model(policy), [assignment("b", "session-b", "Tuesday", "16:00", "17:00")]).violations).toContainEqual(expect.objectContaining({ constraintId: policy.id }));
  });
});

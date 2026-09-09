import { describe, expect, it } from "vitest";
import type { Assignment, StudioState } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "Governance Fixture",
    teachers: [{ id: "teacher-a", name: "Teacher A", subjects: [] }],
    rooms: [{ id: "room-a", name: "Room A", capacity: 10, features: [] }],
    students: [],
    cohorts: [],
    classes: [{
      id: "class-a",
      name: "Class A",
      subject: "Ballet",
      level: "Level 1",
      durationMinutes: 60,
      weeklyFrequency: 1,
      rosterStudentIds: [],
      eligibleTeacherIds: [],
    }],
    sessions: [{ id: "session-a", classId: "class-a", ordinal: 1 }],
    rules: [],
    rulebookVersions: [],
    enforcementVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
    planningDatasetVersions: [],
  };
}

const assignment: Assignment = {
  id: "assignment-a",
  sessionId: "session-a",
  day: "Monday",
  startTime: "17:00",
  endTime: "18:00",
  teacherId: "teacher-a",
  roomId: "room-a",
};

function model(defaultDeny: boolean): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "dwde-ir-0.5-test",
    rulebookVersion: 5,
    planningDatasetVersion: 1,
    activeRuleCount: 0,
    hardConstraints: [],
    objectivePrioritySpine: [],
    objectivePolicies: [],
    readinessRuleIds: [],
    governanceAssertions: defaultDeny ? [{
      ruleId: "CUR-007",
      family: "CURRICULUM_INTEGRITY",
      assertion: "Teacher qualification is default-deny.",
    }] : [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

describe("POL-02 qualification default-deny authority", () => {
  it("does not invent default-deny semantics when CUR-007 is absent", () => {
    const result = validateConstraintModelSchedule(state(), model(false), [assignment]);
    expect(result.violations.some((item) => item.constraintId === "teacher-qualification-default-deny")).toBe(false);
  });

  it("preserves default-deny when CUR-007 is an explicit governance assertion", () => {
    const result = validateConstraintModelSchedule(state(), model(true), [assignment]);
    expect(result.violations).toContainEqual(expect.objectContaining({
      constraintId: "teacher-qualification-default-deny",
      affectedEntityIds: expect.arrayContaining(["teacher-a", "class-a"]),
    }));
  });
});

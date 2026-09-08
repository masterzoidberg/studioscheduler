import { describe, expect, it } from "vitest";
import type { Assignment, StudioState } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine";

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [{ id: "teacher-aimee-stable", name: "Aimee Renamed", subjects: [] }],
    rooms: [{ id: "room", name: "Studio A", capacity: 20 }],
    students: [], cohorts: [],
    classes: [{
      id: "class",
      name: "Test Class",
      subject: "Ballet",
      level: "Level 1",
      durationMinutes: 60,
      weeklyFrequency: 1,
      rosterStudentIds: [],
      eligibleTeacherIds: [],
    }],
    sessions: [{ id: "session", classId: "class", ordinal: 1 }],
    rules: [], rulebookVersions: [], enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [],
  };
}

function model(): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "dwde-ir-0.4",
    rulebookVersion: 4,
    planningDatasetVersion: 4,
    activeRuleCount: 178,
    hardConstraints: [{
      id: "typed-aim-003-teacher-day-window",
      kind: "TEACHER_DAY_WINDOW",
      ruleIds: ["AIM-003"],
      selector: { teacherIds: ["teacher-aimee-stable"] },
      parameters: { allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"] },
      explanation: "Aimee is available Monday through Thursday.",
    }],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function assignment(day: Assignment["day"]): Assignment {
  return {
    id: `assignment-${day}`,
    sessionId: "session",
    day,
    startTime: "17:00",
    endTime: "18:00",
    teacherId: "teacher-aimee-stable",
    roomId: "room",
  };
}

describe("POL-01 stable-ID runtime teacher window", () => {
  it("enforces the same typed policy after the teacher display name changes", () => {
    const legal = validateConstraintModelSchedule(state(), model(), [assignment("Monday")]);
    expect(legal.valid).toBe(true);
    expect(legal.violations).toEqual([]);

    const illegal = validateConstraintModelSchedule(state(), model(), [assignment("Friday")]);
    expect(illegal.valid).toBe(false);
    expect(illegal.violations).toContainEqual(expect.objectContaining({
      constraintId: "typed-aim-003-teacher-day-window",
      ruleIds: ["AIM-003"],
      affectedEntityIds: ["teacher-aimee-stable"],
      message: expect.stringContaining("cannot teach on Friday"),
    }));
  });
});

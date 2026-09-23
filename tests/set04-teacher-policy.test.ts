import { describe, expect, it } from "vitest";
import type { Assignment, StudioState } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import {
  buildSetupTypedPolicyPatches,
  generatedTeacherAvailabilityRuleId,
  generatedTeacherQualificationRuleId,
  setupPolicyDraftFromRules,
  TEACHER_AVAILABILITY_RULE_ID,
  TEACHER_QUALIFICATION_RULE_ID,
} from "@/lib/setup-policy";

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "Synthetic Studio",
    teachers: [{ id: "teacher-a", name: "Teacher A", subjects: [], notes: "Tuesday only" }],
    rooms: [{ id: "room-a", name: "Room A", capacity: 20, features: [] }],
    students: [],
    cohorts: [],
    classes: [{ id: "class-a", name: "Ballet", subject: "Ballet", level: "Level 3", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] }],
    sessions: [{ id: "session-a", classId: "class-a", ordinal: 1 }],
    rules: [],
    rulebookVersions: [],
    enforcementVersions: [],
    planningDatasetVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
  };
}

function model(): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "dwde-ir-0.5",
    rulebookVersion: 6,
    planningDatasetVersion: 1,
    activeRuleCount: 2,
    hardConstraints: [{
      id: "typed-teacher-a-availability",
      kind: "TEACHER_DAY_WINDOW",
      ruleIds: [TEACHER_AVAILABILITY_RULE_ID],
      selector: { teacherIds: ["teacher-a"] },
      parameters: {
        windows: [{ day: "Monday", start: "17:00", end: "18:00" }],
        unavailableDays: ["Tuesday"],
      },
      explanation: "Teacher A is available Monday 17:00–18:00 and unavailable Tuesday.",
    }],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function assignment(day: Assignment["day"], startTime: string, endTime: string): Assignment {
  return { id: `${day}-${startTime}`, sessionId: "session-a", day, startTime, endTime, teacherId: "teacher-a", roomId: "room-a", locked: false, status: "NORMAL" };
}

describe("SET-04 teacher setup policy", () => {
  it("builds typed availability and explicit qualification patches without using teacher notes", () => {
    const patches = buildSetupTypedPolicyPatches({
      operatingWindows: [{ day: "Monday", start: "16:00", end: "21:00" }],
      closedDays: [],
      roomUnavailable: null,
      roomRequiredFeatures: null,
      teacherAvailability: [{
        ruleId: TEACHER_AVAILABILITY_RULE_ID,
        teacherId: "teacher-a",
        windows: [{ day: "Monday", start: "17:00", end: "18:00" }],
        unavailableDays: ["Tuesday"],
      }],
      teacherQualifications: [{
        ruleId: TEACHER_QUALIFICATION_RULE_ID,
        teacherId: "teacher-a",
        classIds: ["class-a"],
      }],
    });

    expect(patches).toContainEqual(expect.objectContaining({
      ruleId: TEACHER_AVAILABILITY_RULE_ID,
      policy: expect.objectContaining({ kind: "TEACHER_DAY_WINDOW", teacherId: "teacher-a", windows: [{ day: "Monday", start: "17:00", end: "18:00" }], unavailableDays: ["Tuesday"] }),
    }));
    expect(patches).toContainEqual(expect.objectContaining({
      ruleId: TEACHER_QUALIFICATION_RULE_ID,
      policy: { schemaVersion: "1.0", kind: "TEACHER_QUALIFICATION", teacherId: "teacher-a", classIds: ["class-a"] },
    }));
    expect(JSON.stringify(patches)).not.toContain("Tuesday only");
  });

  it("rejects assignments outside an explicit teacher window or on an unavailable day", () => {
    const result = validateConstraintModelSchedule(state(), model(), [assignment("Tuesday", "17:00", "18:00")]);
    expect(result.violations).toContainEqual(expect.objectContaining({
      constraintId: "typed-teacher-a-availability",
      message: expect.stringContaining("unavailable"),
    }));

    const outsideWindow = validateConstraintModelSchedule(state(), model(), [assignment("Monday", "18:00", "19:00")]);
    expect(outsideWindow.violations).toContainEqual(expect.objectContaining({
      constraintId: "typed-teacher-a-availability",
      message: expect.stringContaining("availability"),
    }));
  });

  it("keeps unknown availability distinct from explicit unrestricted review and defaults qualification to an empty domain", () => {
    const draft = setupPolicyDraftFromRules([], ["teacher-a"]);
    expect(draft.teacherAvailability).toEqual([{
      ruleId: generatedTeacherAvailabilityRuleId("teacher-a"),
      teacherId: "teacher-a",
      unrestricted: true,
    }]);
    expect(draft.teacherQualifications).toEqual([{
      ruleId: generatedTeacherQualificationRuleId("teacher-a"),
      teacherId: "teacher-a",
      classIds: [],
    }]);
    const patches = buildSetupTypedPolicyPatches(draft);
    expect(patches).toContainEqual({ ruleId: generatedTeacherAvailabilityRuleId("teacher-a"), policy: null });
    expect(patches).toContainEqual(expect.objectContaining({
      ruleId: generatedTeacherQualificationRuleId("teacher-a"),
      policy: expect.objectContaining({ kind: "TEACHER_QUALIFICATION", classIds: [] }),
    }));
  });

  it("reports the exact conflicting teacher windows before a mutation", () => {
    expect(() => buildSetupTypedPolicyPatches({
      operatingWindows: [{ day: "Monday", start: "16:00", end: "21:00" }],
      closedDays: [],
      roomUnavailable: null,
      roomRequiredFeatures: null,
      teacherAvailability: [{
        ruleId: generatedTeacherAvailabilityRuleId("teacher-a"),
        teacherId: "teacher-a",
        windows: [
          { day: "Monday", start: "17:00", end: "18:00" },
          { day: "Monday", start: "17:45", end: "19:00" },
        ],
      }],
    })).toThrow(/conflicting availability windows on Monday: 17:00–18:00 and 17:45–19:00/);
  });
});

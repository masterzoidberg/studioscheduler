import { describe, expect, it } from "vitest";
import type { Assignment, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "Fixture Studio",
    teachers: [
      { id: "teacher-a", name: "Teacher Renamed", subjects: [] },
      { id: "teacher-b", name: "Other Teacher", subjects: [] },
    ],
    rooms: [
      { id: "room-a", name: "Room Renamed", capacity: 2, features: ["sprung-floor", "mirrors"] },
      { id: "room-b", name: "Other Room", capacity: 20, features: ["mirrors"] },
    ],
    students: [
      { id: "student-1", name: "One", level: "Level 1", cohortIds: [] },
      { id: "student-2", name: "Two", level: "Level 1", cohortIds: [] },
      { id: "student-3", name: "Three", level: "Level 1", cohortIds: [] },
    ],
    cohorts: [],
    classes: [
      {
        id: "class-a",
        name: "Class Renamed",
        subject: "Ballet",
        level: "Level 1",
        durationMinutes: 60,
        weeklyFrequency: 1,
        rosterStudentIds: ["student-1", "student-2", "student-3"],
        eligibleTeacherIds: [],
      },
      {
        id: "class-b",
        name: "Other Class",
        subject: "Jazz",
        level: "Level 1",
        durationMinutes: 60,
        weeklyFrequency: 1,
        rosterStudentIds: [],
        eligibleTeacherIds: [],
      },
    ],
    sessions: [
      { id: "session-a", classId: "class-a", ordinal: 1 },
      { id: "session-b", classId: "class-b", ordinal: 1 },
    ],
    rules: [], rulebookVersions: [], enforcementVersions: [], enforcementProposals: [],
    ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [], planningDatasetVersions: [],
  };
}

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: "assignment-a",
    sessionId: "session-a",
    day: "Monday",
    startTime: "16:00",
    endTime: "17:00",
    teacherId: "teacher-a",
    roomId: "room-a",
    ...overrides,
  };
}

function node(kind: ConstraintIRNode["kind"], selector: ConstraintIRNode["selector"], parameters: Record<string, unknown>): ConstraintIRNode {
  return { id: `typed-${kind.toLowerCase()}`, kind, ruleIds: ["POL-02"], selector, parameters, explanation: "fixture" };
}

function model(...nodes: ConstraintIRNode[]): ConstraintModelSnapshotV1 {
  const hasQualification = nodes.some((item) => item.kind === "TEACHER_CLASS_DOMAIN");
  const hardConstraints = hasQualification ? nodes : [
    node("TEACHER_CLASS_DOMAIN", { teacherIds: ["teacher-a"] }, { classIds: ["class-a", "class-b"] }),
    ...nodes,
  ];
  return {
    schemaVersion: "1.0",
    compilerVersion: "dwde-ir-0.5-test",
    rulebookVersion: 5,
    planningDatasetVersion: 1,
    activeRuleCount: hardConstraints.length,
    hardConstraints,
    objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,
  };
}

function violationsFor(modelValue: ConstraintModelSnapshotV1, assignments: Assignment[]) {
  return validateConstraintModelSchedule(state(), modelValue, assignments).violations;
}

describe("POL-02 typed runtime semantics", () => {
  it("treats operating windows as half-open containment and separate rules as intersection", () => {
    const first = node("STUDIO_OPERATING_WINDOWS", {}, { windows: [{ day: "Monday", start: "16:00", end: "18:00" }], closedDays: [] });
    const second = node("STUDIO_OPERATING_WINDOWS", {}, { windows: [{ day: "Monday", start: "15:00", end: "17:00" }], closedDays: [] });
    expect(violationsFor(model(first, second), [assignment()])).toEqual([]);
    expect(violationsFor(model(first), [assignment({ startTime: "15:59" })])).toContainEqual(expect.objectContaining({ constraintId: first.id }));
    expect(violationsFor(model(second), [assignment({ endTime: "17:01" })])).toContainEqual(expect.objectContaining({ constraintId: second.id }));
  });

  it("rejects a closed day even when another window would otherwise contain the assignment", () => {
    const operating = node("STUDIO_OPERATING_WINDOWS", {}, { windows: [{ day: "Monday", start: "16:00", end: "18:00" }], closedDays: ["Monday"] });
    expect(violationsFor(model(operating), [assignment()])).toContainEqual(expect.objectContaining({ constraintId: operating.id }));
  });

  it("uses half-open overlap semantics for room unavailability", () => {
    const unavailable = node("ROOM_UNAVAILABLE_WINDOWS", { roomIds: ["room-a"] }, { windows: [{ day: "Monday", start: "17:00", end: "18:00" }] });
    expect(violationsFor(model(unavailable), [assignment({ startTime: "16:00", endTime: "17:00" })])).toEqual([]);
    expect(violationsFor(model(unavailable), [assignment({ startTime: "16:59", endTime: "17:30" })])).toContainEqual(expect.objectContaining({ constraintId: unavailable.id }));
  });

  it("treats an explicit empty teacher qualification domain as qualified for no classes", () => {
    const qualification = node("TEACHER_CLASS_DOMAIN", { teacherIds: ["teacher-a"] }, { classIds: [] });
    const result = validateConstraintModelSchedule(state(), model(qualification), [assignment()]);
    expect(result.violations).toContainEqual(expect.objectContaining({ constraintId: qualification.id }));
    expect(result.violations.some((item) => item.constraintId === "teacher-qualification-default-deny")).toBe(false);
  });

  it("enforces required teacher and room by stable ID after display renames", () => {
    const requiredTeacher = node("REQUIRED_TEACHER", { classIds: ["class-a"], teacherIds: ["teacher-a"] }, { teacherId: "teacher-a" });
    const requiredRoom = node("REQUIRED_ROOM", { classIds: ["class-a"], roomIds: ["room-a"] }, { roomId: "room-a" });
    expect(violationsFor(model(requiredTeacher, requiredRoom), [assignment()])).toEqual([]);
    const violations = violationsFor(model(requiredTeacher, requiredRoom), [assignment({ teacherId: "teacher-b", roomId: "room-b" })]);
    expect(violations).toContainEqual(expect.objectContaining({ constraintId: requiredTeacher.id }));
    expect(violations).toContainEqual(expect.objectContaining({ constraintId: requiredRoom.id }));
  });

  it("reads capacity from planning facts, blocks missing capacity, and honors only explicit class exemptions", () => {
    const capacity = node("ROOM_CAPACITY", { roomIds: ["room-a"] }, { capacitySource: "PLANNING_DATASET", exemptClassIds: [] });
    expect(violationsFor(model(capacity), [assignment()])).toContainEqual(expect.objectContaining({ constraintId: capacity.id }));

    const exempt = node("ROOM_CAPACITY", { roomIds: ["room-a"] }, { capacitySource: "PLANNING_DATASET", exemptClassIds: ["class-a"] });
    expect(violationsFor(model(exempt), [assignment()])).toEqual([]);

    const missingCapacityState = state();
    missingCapacityState.rooms[0].capacity = undefined;
    const result = validateConstraintModelSchedule(missingCapacityState, model(capacity), [assignment()]);
    expect(result.violations).toContainEqual(expect.objectContaining({ constraintId: capacity.id, message: expect.stringContaining("capacity") }));
  });

  it("requires every reviewed room feature by set inclusion", () => {
    const featureRule = node("ROOM_REQUIRED_FEATURES", { classIds: ["class-a"] }, { requiredFeatures: ["mirrors", "sprung-floor"] });
    expect(violationsFor(model(featureRule), [assignment()])).toEqual([]);
    expect(violationsFor(model(featureRule), [assignment({ roomId: "room-b" })])).toContainEqual(expect.objectContaining({ constraintId: featureRule.id }));
  });
});

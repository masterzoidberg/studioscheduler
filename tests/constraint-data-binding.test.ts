import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { StudioState } from "@/lib/domain";
import { validateConstraintModelBindings } from "@/lib/constraint-data-binding";

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [
      { id: "teacher-cami", name: "Cami", subjects: [] },
      { id: "teacher-karly", name: "Karly", subjects: [] },
    ],
    rooms: [{ id: "room-a", name: "Studio A", capacity: 30, features: [] }],
    students: [
      { id: "student-daughter", name: "Karly's daughter", level: "Level 4B", cohortIds: [] },
      { id: "student-kiran", name: "Kiran Landis", level: "Level 5", cohortIds: [] },
    ],
    cohorts: [],
    classes: [
      { id: "class-jazz-3", name: "Jazz 3", subject: "Jazz", level: "Level 3", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
      { id: "class-ballet-3", name: "Ballet 3", subject: "Ballet", level: "Level 3", durationMinutes: 90, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
      { id: "class-pre-pointe", name: "Pre-Pointe", subject: "Pre-Pointe", level: "Level 3", durationMinutes: 30, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
      { id: "class-ballet-2", name: "Ballet 2", subject: "Ballet", level: "Level 2", durationMinutes: 90, weeklyFrequency: 1, rosterStudentIds: ["student-daughter"], eligibleTeacherIds: [] },
    ],
    sessions: [], rules: [], rulebookVersions: [], enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [], planningDatasetVersions: [],
  };
}

function model(): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "test",
    rulebookVersion: 3,
    planningDatasetVersion: 1,
    activeRuleCount: 178,
    hardConstraints: [
      {
        id: "cami-required-jazz-3",
        kind: "REQUIRED_TEACHER",
        ruleIds: ["CAM-008"],
        selector: { classNames: ["Jazz 3"] },
        parameters: { teacherName: "Cami" },
        explanation: "",
      },
      {
        id: "ballet-3-pre-pointe",
        kind: "DIRECTLY_AFTER",
        ruleIds: ["SEQ-001", "SEQ-004"],
        selector: { classNames: ["Ballet 3", "Pre-Pointe"] },
        parameters: { predecessor: "Ballet 3", successor: "Pre-Pointe" },
        explanation: "",
      },
      {
        id: "ballet-room",
        kind: "REQUIRED_ROOM",
        ruleIds: ["ROOM-002"],
        selector: { classNames: ["Ballet 2"] },
        parameters: { roomName: "Studio A" },
        explanation: "",
      },
      {
        id: "karly-daughter-start-alignment",
        kind: "RELATIONSHIP_START_WINDOW",
        ruleIds: ["KAR-008", "KAR-009"],
        selector: { teacherNames: ["Karly"], studentRelation: "Karly's daughter" },
        parameters: { daughterClassNames: ["Ballet 2"] },
        explanation: "",
      },
      {
        id: "lower-level",
        kind: "REQUIRED_LOWER_LEVEL",
        ruleIds: ["ADV-001", "ADV-004"],
        selector: { levels: ["Level 5"] },
        parameters: { exceptions: [{ studentName: "Kiran Landis" }] },
        explanation: "",
      },
    ],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

describe("Constraint IR data binding", () => {
  it("binds concrete named HARD-model references to exactly one planning entity", () => {
    const report = validateConstraintModelBindings(state(), model());
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.checkedReferences).toBeGreaterThan(0);
    expect(report.boundReferences).toBe(report.checkedReferences);
  });

  it("fails closed when a named constraint target is absent", () => {
    const s = state();
    s.classes = s.classes.filter((klass) => klass.name !== "Jazz 3");
    const report = validateConstraintModelBindings(s, model());
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      constraintId: "cami-required-jazz-3",
      entityType: "CLASS",
      expectedName: "Jazz 3",
      status: "MISSING",
    }));
  });

  it("fails closed when canonicalized names are ambiguous", () => {
    const s = state();
    s.teachers.push({ id: "teacher-cami-duplicate", name: "Cami!", subjects: [] });
    const report = validateConstraintModelBindings(s, model());
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      entityType: "TEACHER",
      expectedName: "Cami",
      status: "AMBIGUOUS",
      matchedEntityIds: ["teacher-cami", "teacher-cami-duplicate"],
    }));
  });

  it("binds relationship targets and named lower-level exceptions", () => {
    const s = state();
    s.students = s.students.filter((student) => student.name !== "Kiran Landis");
    const report = validateConstraintModelBindings(s, model());
    expect(report.issues).toContainEqual(expect.objectContaining({
      constraintId: "lower-level",
      entityType: "STUDENT",
      expectedName: "Kiran Landis",
      status: "MISSING",
    }));
    expect(report.references).toContainEqual(expect.objectContaining({
      constraintId: "karly-daughter-start-alignment",
      entityType: "STUDENT",
      expectedName: "Karly's daughter",
      status: "BOUND",
    }));
  });
});

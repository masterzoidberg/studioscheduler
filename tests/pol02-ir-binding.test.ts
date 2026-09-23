import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { StudioState } from "@/lib/domain";
import { validateConstraintModelBindings } from "@/lib/constraint-data-binding";

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [{ id: "teacher-cami", name: "Renamed Teacher", subjects: [] }],
    rooms: [{ id: "room-a", name: "Renamed Room", capacity: 30, features: ["barre"] }],
    students: [],
    cohorts: [],
    classes: [{ id: "class-jazz-4a", name: "Renamed Class", subject: "Jazz", level: "Level 4A", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] }],
    sessions: [], rules: [], rulebookVersions: [], enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [], planningDatasetVersions: [],
  };
}

function model(): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "dwde-ir-0.5",
    rulebookVersion: 5,
    planningDatasetVersion: 1,
    activeRuleCount: 178,
    hardConstraints: [
      {
        id: "typed-required-teacher",
        kind: "REQUIRED_TEACHER",
        ruleIds: ["CAM-007"],
        selector: { classIds: ["class-jazz-4a"], teacherIds: ["teacher-cami"] },
        parameters: {},
        explanation: "",
      },
      {
        id: "typed-required-room",
        kind: "REQUIRED_ROOM",
        ruleIds: ["ROOM-009"],
        selector: { classIds: ["class-jazz-4a"], roomIds: ["room-a"] },
        parameters: {},
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

describe("POL-02 stable-ID Constraint IR binding", () => {
  it("binds class, teacher, and room IDs independently of display-name changes", () => {
    const report = validateConstraintModelBindings(state(), model());
    expect(report.valid).toBe(true);
    expect(report.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "CLASS", expectedId: "class-jazz-4a", status: "BOUND" }),
      expect.objectContaining({ entityType: "TEACHER", expectedId: "teacher-cami", status: "BOUND" }),
      expect.objectContaining({ entityType: "ROOM", expectedId: "room-a", status: "BOUND" }),
    ]));
  });

  it.each([
    ["CLASS", "class-jazz-4a"],
    ["TEACHER", "teacher-cami"],
    ["ROOM", "room-a"],
  ] as const)("fails closed when a typed %s ID is missing", (entityType, expectedId) => {
    const s = state();
    if (entityType === "CLASS") s.classes = [];
    if (entityType === "TEACHER") s.teachers = [];
    if (entityType === "ROOM") s.rooms = [];
    const report = validateConstraintModelBindings(s, model());
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ entityType, expectedId, status: "MISSING" }));
  });

  it("does not allow a matching legacy display name to conceal a missing stable ID", () => {
    const s = state();
    s.teachers = [{ id: "different-id", name: "teacher-cami", subjects: [] }];
    const report = validateConstraintModelBindings(s, model());
    expect(report.issues).toContainEqual(expect.objectContaining({
      entityType: "TEACHER",
      expectedId: "teacher-cami",
      status: "MISSING",
      matchedEntityIds: [],
    }));
  });
});

import { describe, expect, it } from "vitest";
import type { ConstraintIRKind, ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { StudioState } from "@/lib/domain";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";

const ALL_KINDS: ConstraintIRKind[] = [
  "RESOURCE_NO_OVERLAP",
  "TIME_GRID",
  "DAY_TIME_WINDOW",
  "NO_DAY",
  "MAX_GAP",
  "MAX_WORKDAYS",
  "LATEST_FINISH_BY_LEVEL",
  "MAX_ATTENDANCE_DAYS",
  "REQUIRED_ROOM",
  "REQUIRED_TEACHER",
  "REQUIRED_LOWER_LEVEL",
  "TEACHER_SUBJECT_DOMAIN",
  "TEACHER_DAY_WINDOW",
  "DIRECTLY_AFTER",
  "FIXED_ASSIGNMENT",
  "ROOM_CAPACITY",
  "RELATIONSHIP_START_WINDOW",
];

const state: StudioState = {
  studioId: "golden-studio",
  studioName: "Golden fixture",
  teachers: [{ id: "teacher", name: "Teacher", subjects: [] }],
  rooms: [{ id: "room", name: "Studio A", capacity: 20, features: [] }],
  students: [],
  cohorts: [],
  classes: [{ id: "class", name: "Fixture Class", subject: "Ballet", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] }],
  sessions: [{ id: "session", classId: "class", ordinal: 1 }],
  rules: [],
  rulebookVersions: [],
  enforcementVersions: [],
  enforcementProposals: [],
  ruleHistory: [],
  scheduleVersions: [],
  scenarios: [],
  auditEvents: [],
};

function node(kind: ConstraintIRKind): ConstraintIRNode {
  const base: ConstraintIRNode = {
    id: `coverage-${kind.toLowerCase()}`,
    kind,
    ruleIds: ["COVERAGE-001"],
    selector: {},
    parameters: {},
    explanation: `Coverage fixture for ${kind}`,
  };

  switch (kind) {
    case "RESOURCE_NO_OVERLAP": return { ...base, parameters: { resource: "ROOM" } };
    case "TIME_GRID": return { ...base, parameters: { minutes: 15 } };
    case "DAY_TIME_WINDOW": return { ...base, parameters: { days: ["Monday"], earliestStart: "16:45", latestFinish: "21:30" } };
    case "NO_DAY": return { ...base, parameters: { days: ["Friday"] } };
    case "MAX_GAP": return { ...base, parameters: { resource: "TEACHER", minutes: 60 } };
    case "MAX_WORKDAYS": return { ...base, selector: { teacherNames: ["Teacher"] }, parameters: { maxDays: 4 } };
    case "LATEST_FINISH_BY_LEVEL": return { ...base, selector: { levels: ["Level 1"] }, parameters: { latestFinish: "21:00" } };
    case "MAX_ATTENDANCE_DAYS": return { ...base, selector: { levels: ["Level 1"] }, parameters: { maxDays: 3 } };
    case "REQUIRED_ROOM": return { ...base, selector: { classNames: ["Fixture Class"], roomNames: ["Studio A"] }, parameters: { roomName: "Studio A" } };
    case "REQUIRED_TEACHER": return { ...base, selector: { classNames: ["Fixture Class"], teacherNames: ["Teacher"] }, parameters: { teacherName: "Teacher" } };
    case "REQUIRED_LOWER_LEVEL": return { ...base, selector: { levels: ["Level 1"] }, parameters: { subjects: ["Ballet"] } };
    case "TEACHER_SUBJECT_DOMAIN": return { ...base, selector: { teacherNames: ["Teacher"] }, parameters: { allowedSubjects: ["Ballet"] } };
    case "TEACHER_DAY_WINDOW": return { ...base, selector: { teacherNames: ["Teacher"] }, parameters: { allowedDays: ["Monday"] } };
    case "DIRECTLY_AFTER": return { ...base, selector: { classNames: ["Fixture Class"] }, parameters: { predecessor: "Fixture Class", successor: "Fixture Class", gapMinutes: 0 } };
    case "FIXED_ASSIGNMENT": return { ...base, selector: { classNames: ["Fixture Class"] }, parameters: { day: "Monday", start: "16:45", end: "17:45" } };
    case "ROOM_CAPACITY": return { ...base, selector: { roomNames: ["Studio A"] }, parameters: { maxDancers: 20, exemptLevels: [] } };
    case "RELATIONSHIP_START_WINDOW": return { ...base, selector: { teacherNames: ["Teacher"] }, parameters: { daughterClassNames: ["Fixture Class"], maxStartDifferenceMinutes: 30 } };
  }
}

describe("Constraint IR runtime coverage", () => {
  it("accounts for every compiler-visible ConstraintIRKind without silent unsupported semantics", () => {
    const model: ConstraintModelSnapshotV1 = {
      schemaVersion: "1.0",
      compilerVersion: "coverage-test",
      rulebookVersion: 1,
      planningDatasetVersion: 1,
      activeRuleCount: 178,
      hardConstraints: ALL_KINDS.map(node),
      objectivePrioritySpine: [],
      readinessRuleIds: [],
      governanceAssertions: [],
      uncompiledConstraintRuleIds: [],
      completeHardConstraintCompilation: true,
    };

    const result = validateConstraintModelSchedule(state, model, []);
    expect(result.unsupportedConstraintIds).toEqual([]);
    expect(new Set([...result.evaluatedConstraintIds, ...result.delegatedConstraintIds])).toEqual(
      new Set(model.hardConstraints.map((constraint) => constraint.id)),
    );
  });
});

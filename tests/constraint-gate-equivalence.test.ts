import { describe, expect, it } from "vitest";
import type { Assignment, RuleEnforcementMapping, SchedulePatch, StudioRule, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compareConstraintGatesForCommand } from "@/lib/constraint-gate-equivalence";

const now = "2026-09-02T00:00:00Z";

function rule(id: string): StudioRule {
  return {
    id,
    category: "Studio Operations",
    type: null,
    title: id,
    description: id,
    strength: "HARD",
    classificationRaw: "HARD",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    reviewStatus: "VERIFIED",
    review: { verified: true },
    affectedEntityIds: [],
    parameters: {},
    exceptions: [],
    source: { type: "SYSTEM_SEED" },
    versionIntroduced: 1,
    updatedAt: now,
  };
}

function mapping(ruleId: string, type: RuleEnforcementMapping["type"]): RuleEnforcementMapping {
  return { ruleId, type, parameters: {}, affectedEntityIds: [], exceptions: [] };
}

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [
      { id: "aimee", name: "Aimee", subjects: [] },
      { id: "cami", name: "Cami", subjects: [] },
    ],
    rooms: [
      { id: "a", name: "Studio A", capacity: 30, features: [] },
      { id: "b", name: "Studio B", capacity: 30, features: [] },
    ],
    students: [],
    cohorts: [],
    classes: [
      { id: "jazz-a", name: "Jazz 1", subject: "Jazz", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
      { id: "jazz-b", name: "Jazz 2", subject: "Jazz", level: "Level 2", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
      { id: "hiphop", name: "Hip Hop 2", subject: "Hip Hop", level: "Level 2", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
    ],
    sessions: [
      { id: "session-jazz-a", classId: "jazz-a", ordinal: 1 },
      { id: "session-jazz-b", classId: "jazz-b", ordinal: 1 },
      { id: "session-hiphop", classId: "hiphop", ordinal: 1 },
    ],
    rules: [rule("LEG-ROOM"), rule("LEG-GRID")],
    rulebookVersions: [{ id: "rb", version: 1, name: "Rulebook", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [{
      id: "enforcement",
      version: 1,
      rulebookVersion: 1,
      createdAt: now,
      actor: "test",
      reason: "test",
      changedRuleIds: [],
      snapshot: [mapping("LEG-ROOM", "ROOM_NO_OVERLAP"), mapping("LEG-GRID", "TIME_GRID")],
      status: "CURRENT",
    }],
    planningDatasetVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
  };
}

const current: Assignment[] = [
  { id: "a-jazz-a", sessionId: "session-jazz-a", day: "Monday", startTime: "16:45", endTime: "17:45", teacherId: "aimee", roomId: "a", status: "NORMAL" },
  { id: "a-jazz-b", sessionId: "session-jazz-b", day: "Monday", startTime: "16:45", endTime: "17:45", teacherId: "cami", roomId: "b", status: "NORMAL" },
];

const node = (value: Partial<ConstraintIRNode> & Pick<ConstraintIRNode, "id" | "kind">): ConstraintIRNode => ({
  id: value.id,
  kind: value.kind,
  ruleIds: value.ruleIds ?? ["IR-ONLY"],
  selector: value.selector ?? {},
  parameters: value.parameters ?? {},
  explanation: value.explanation ?? value.id,
});

function completeModel(includeRoomOverlap = true): ConstraintModelSnapshotV1 {
  const hardConstraints: ConstraintIRNode[] = [
    node({ id: "grid", kind: "TIME_GRID", ruleIds: ["LEG-GRID"], parameters: { minutes: 15 } }),
    node({ id: "aimee-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["IR-AIMEE"], selector: { teacherNames: ["Aimee"] }, parameters: { allowedSubjects: ["Jazz", "Hip Hop"] } }),
    node({ id: "cami-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["IR-CAMI"], selector: { teacherNames: ["Cami"] }, parameters: { allowedSubjects: ["Jazz"], prohibitedSubjects: ["Hip Hop"] } }),
  ];
  if (includeRoomOverlap) hardConstraints.push(node({ id: "room-overlap", kind: "RESOURCE_NO_OVERLAP", ruleIds: ["LEG-ROOM"], parameters: { resource: "ROOM" } }));
  return {
    schemaVersion: "1.0",
    compilerVersion: "equivalence-test",
    rulebookVersion: 1,
    planningDatasetVersion: 1,
    activeRuleCount: 178,
    hardConstraints,
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [{ ruleId: "CUR-007", family: "CURRICULUM_INTEGRITY", assertion: "Default deny qualifications." }],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function patch(values: Partial<SchedulePatch> & Pick<SchedulePatch, "operation">): SchedulePatch {
  return {
    id: "patch",
    operation: values.operation,
    assignmentId: values.assignmentId ?? "a-jazz-b",
    changes: values.changes ?? {},
    reason: "equivalence fixture",
    proposedBy: "USER",
  };
}

describe("Constraint IR command-gate equivalence", () => {
  it("accepts a valid MOVE in both engines", () => {
    const comparison = compareConstraintGatesForCommand(state(), current, patch({
      operation: "MOVE",
      changes: { startTime: "18:00" },
    }), completeModel());
    expect(comparison.legacy.accepts).toBe(true);
    expect(comparison.constraintIr.accepts).toBe(true);
    expect(comparison.disagreement).toBe("NONE");
    expect(comparison.preservesLegacySafety).toBe(true);
  });

  it("rejects a room-double-booking MOVE in both engines with the legacy Rule ID represented in IR", () => {
    const comparison = compareConstraintGatesForCommand(state(), current, patch({
      operation: "MOVE",
      changes: { roomId: "a" },
    }), completeModel());
    expect(comparison.legacy.accepts).toBe(false);
    expect(comparison.constraintIr.accepts).toBe(false);
    expect(comparison.legacyHardRuleIdsMissingFromIr).toEqual([]);
    expect(comparison.constraintIr.after.violations.some((item) => item.ruleIds.includes("LEG-ROOM"))).toBe(true);
    expect(comparison.preservesLegacySafety).toBe(true);
  });

  it("allows the IR to be stricter when expanded Rulebook coverage catches a teacher-qualification violation", () => {
    const comparison = compareConstraintGatesForCommand(state(), current, patch({
      operation: "ASSIGN",
      assignmentId: "",
      changes: {
        sessionId: "session-hiphop",
        day: "Monday",
        startTime: "18:00",
        teacherId: "cami",
        roomId: "a",
      },
    }), completeModel());
    expect(comparison.legacy.accepts).toBe(true);
    expect(comparison.constraintIr.accepts).toBe(false);
    expect(comparison.disagreement).toBe("IR_STRICTER");
    expect(comparison.preservesLegacySafety).toBe(true);
    expect(comparison.constraintIr.after.violations.some((item) => item.constraintId === "cami-domain")).toBe(true);
  });

  it("flags a release blocker if an incomplete IR model would relax a legacy protection", () => {
    const comparison = compareConstraintGatesForCommand(state(), current, patch({
      operation: "MOVE",
      changes: { roomId: "a" },
    }), completeModel(false));
    expect(comparison.legacy.accepts).toBe(false);
    expect(comparison.constraintIr.accepts).toBe(true);
    expect(comparison.disagreement).toBe("IR_LOOSER");
    expect(comparison.preservesLegacySafety).toBe(false);
    expect(comparison.legacyHardRuleIdsMissingFromIr).toEqual(["LEG-ROOM"]);
  });

  it("compares UNASSIGN using the same repair-mode acceptance policy", () => {
    const comparison = compareConstraintGatesForCommand(state(), current, patch({ operation: "UNASSIGN" }), completeModel());
    expect(comparison.legacy.accepts).toBe(true);
    expect(comparison.constraintIr.accepts).toBe(true);
    expect(comparison.preservesLegacySafety).toBe(true);
  });
});

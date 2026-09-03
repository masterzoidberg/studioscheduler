import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { ClassDefinition, StudioState } from "@/lib/domain";
import { validateDelegatedSolverPreconditions } from "@/lib/delegated-solver-preflight";
import { buildFeasibilityProblemPayload } from "@/lib/solver-problem";

const now = "2026-09-03T00:00:00Z";

function klass(id: string, name: string, subject: string, level: string, rosterStudentIds: string[]): ClassDefinition {
  return { id, name, subject, level, durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds, eligibleTeacherIds: [] };
}

function state(classes: ClassDefinition[], students = [{ id: "s1", name: "Advanced Dancer", level: "Level 4B", cohortIds: [] }]): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [{ id: "teacher-b", name: "B Teacher", subjects: [] }, { id: "teacher-a", name: "A Teacher", subjects: [] }],
    rooms: [{ id: "room-b", name: "Studio B", capacity: 30, features: ["marley", "barre"] }, { id: "room-a", name: "Studio A", capacity: 25, features: [] }],
    students,
    cohorts: [],
    classes,
    sessions: classes.map((item) => ({ id: `session-${item.id}`, classId: item.id, ordinal: 1 })),
    rules: [],
    rulebookVersions: [{ id: "rb3", version: 3, name: "Rulebook v3", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [],
    planningDatasetVersions: [{
      id: "pdv7", version: 7, createdAt: now, actor: "test", reason: "test", snapshotHash: "0".repeat(64), status: "CURRENT",
      snapshot: { schemaVersion: "1.3", studioId: "studio", teacherIds: ["teacher-a", "teacher-b"], rooms: [], students: [], cohorts: [], classes: [], sessions: [] },
    }],
  };
}

function model(): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "dwde-ir-test",
    rulebookVersion: 3,
    planningDatasetVersion: 7,
    activeRuleCount: 178,
    hardConstraints: [{
      id: "required-lower-level-progression",
      kind: "REQUIRED_LOWER_LEVEL",
      ruleIds: ["ADV-001", "ADV-002", "ADV-003", "ADV-004", "CUR-009"],
      selector: { levels: ["Level 4B", "Level 5"], subjects: ["Ballet", "Jazz", "Tap", "Contemporary"] },
      parameters: {
        appliesWhenMarkedRequired: true,
        relationship: "IMMEDIATELY_LOWER_LEVEL_SAME_SUBJECT",
        exceptions: [{
          studentName: "Kiran Landis",
          hardSubjects: ["Tap"],
          excludedHardSubjects: ["Ballet", "Jazz", "Contemporary"],
          softPrioritySubjects: ["Ballet"],
        }],
      },
      explanation: "advanced progression",
    }],
    objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,
  };
}

describe("delegated solver preflight", () => {
  it("fails closed when an enrolled Level 4B dancer has no immediately lower class", () => {
    const report = validateDelegatedSolverPreconditions(state([
      klass("jazz4b", "Jazz 4B", "Jazz", "Level 4B", ["s1"]),
    ]), model());
    expect(report.complete).toBe(false);
    expect(report.issues).toEqual([expect.objectContaining({ code: "LOWER_LEVEL_CLASS_MISSING", constraintId: "required-lower-level-progression" })]);
    expect(report.validatedDelegatedConstraintIds).toEqual([]);
  });

  it("distinguishes a missing lower-level roster enrollment from a missing class", () => {
    const report = validateDelegatedSolverPreconditions(state([
      klass("jazz4b", "Jazz 4B", "Jazz", "Level 4B", ["s1"]),
      klass("jazz4a", "Jazz 4A", "Jazz", "Level 4A", []),
    ]), model());
    expect(report.issues[0]).toMatchObject({ code: "LOWER_LEVEL_ROSTER_MISSING" });
  });

  it("proves the delegated node when lower-level enrollment is represented", () => {
    const report = validateDelegatedSolverPreconditions(state([
      klass("jazz4b", "Jazz 4B", "Jazz", "Level 4B", ["s1"]),
      klass("jazz4a", "Jazz 4A", "Jazz", "Level 4A", ["s1"]),
    ]), model());
    expect(report.complete).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.validatedDelegatedConstraintIds).toEqual(["required-lower-level-progression"]);
  });

  it("applies Kiran's reviewed exception: Tap remains HARD while Jazz is excluded", () => {
    const kiran = [{ id: "student-kiran", name: "Kiran Landis", level: "Level 5", cohortIds: [] }];
    const report = validateDelegatedSolverPreconditions(state([
      klass("jazz5", "Jazz 5", "Jazz", "Level 5", ["student-kiran"]),
      klass("tap5", "Tap 5", "Tap", "Level 5", ["student-kiran"]),
    ], kiran), model());
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ code: "LOWER_LEVEL_CLASS_MISSING" });
    expect(report.issues[0].message).toContain("Tap");
    expect(report.issues[0].message).not.toContain("Jazz");
  });
});

describe("feasibility solver request contract", () => {
  it("serializes deterministic versioned planning facts and delegated proof", () => {
    const s = state([
      klass("jazz4b", "Jazz 4B", "Jazz", "Level 4B", ["s1"]),
      klass("jazz4a", "Jazz 4A", "Jazz", "Level 4A", ["s1"]),
    ]);
    const m = model();
    const preflight = validateDelegatedSolverPreconditions(s, m);
    const problem = buildFeasibilityProblemPayload(s, m, preflight);

    expect(problem).toMatchObject({
      contractVersion: "1.0",
      context: { studioId: "studio", rulebookVersion: 3, planningDatasetVersion: 7, compilerVersion: "dwde-ir-test" },
      preflight: { validatedDelegatedConstraintIds: ["required-lower-level-progression"] },
    });
    expect(problem.teachers.map((item) => item.id)).toEqual(["teacher-a", "teacher-b"]);
    expect(problem.rooms[1].features).toEqual(["barre", "marley"]);
    expect(problem.classes.map((item) => item.id)).toEqual(["jazz4a", "jazz4b"]);
    expect(problem.sessions.map((item) => item.id)).toEqual(["session-jazz4a", "session-jazz4b"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Assignment, StudioRule, StudioState } from "@/lib/domain";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { materializeConstraintIdentityTargets, validateConstraintModelBindings } from "@/lib/constraint-data-binding";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";

const rule = (id: string): StudioRule => ({
  id,
  category: "test",
  type: null,
  title: id,
  description: id,
  strength: "HARD",
  classificationRaw: "HARD",
  status: "ACTIVE",
  verificationStatus: "VERIFIED",
  reviewStatus: "VERIFIED",
  review: { decision: "APPROVED", verified: true },
  affectedEntityIds: [],
  parameters: {},
  exceptions: [],
  source: { type: "IMPORT" },
  sourceRaw: {},
  versionIntroduced: 3,
  updatedAt: "2026-09-11T00:00:00Z",
});

function state(): StudioState {
  const classNames = [
    "Jazz 3", "Studio Class", "Ballet 1", "Ballet 2", "Ballet 3", "Pre-Pointe",
    "Jazz 1", "Lyrical 1", "B/T Combo 1", "Ballet 4A", "Ballet 4A/4B",
    "Ballet 4B/5", "Ballet 5", "Pointe 1", "Pointe 2/3", "Elementary Ballet 1",
    "Elementary Ballet 2", "Jazz 2", "Lyrical 2", "Tap 2", "Hip Hop 2",
    "Pre-Company Technique 1", "Contemporary/Lyrical 3", "Jazz 4A", "Contemporary 4A",
    "B/T Combo 2", "Adult Jazz", "Adult Tap", "Tap 5", "Contemporary/Modern 4B",
    "Jazz 5", "Company Technique 2", "Jazz 4B", "Contemporary 5", "Company Technique 3",
    "Company Technique 3/4", "Company Technique 4",
  ];
  return {
    studioId: "gen01",
    studioName: "GEN-01",
    teachers: [
      { id: "teacher-cami", name: "Cami", subjects: [] },
      { id: "teacher-karly", name: "Karly", subjects: [] },
      { id: "teacher-aimee", name: "Aimee", subjects: [] },
    ],
    rooms: [
      { id: "room-a", name: "Studio A", capacity: 30, features: [] },
      { id: "room-b", name: "Studio B", capacity: 30, features: [] },
      { id: "room-c", name: "Studio C", capacity: 15, features: [] },
    ],
    students: [
      { id: "student-daughter", name: "Karly's daughter", level: "Level 4B", cohortIds: [] },
      { id: "student-kiran", name: "Kiran Landis", level: "Level 5", cohortIds: [] },
    ],
    cohorts: [],
    classes: classNames.map((name, index) => ({
      id: `class-${index + 1}`,
      name,
      subject: name.includes("Jazz") ? "Jazz" : name.includes("Lyrical") ? "Lyrical" : "Ballet",
      level: name.includes("3") ? "Level 3" : name.includes("1") ? "Level 1" : "Level 2",
      durationMinutes: 60,
      weeklyFrequency: 1,
      rosterStudentIds: name === "Ballet 2" ? ["student-daughter"] : [],
      eligibleTeacherIds: [],
    })),
    sessions: classNames.map((_, index) => ({ id: `session-${index + 1}`, classId: `class-${index + 1}`, ordinal: 1 })),
    rules: ["CAM-008", "ROOM-002", "CUR-008", "SEQ-005", "FIX-001", "KAR-008", "KAR-009", "ADV-001", "ADV-002", "ADV-003", "ADV-004", "CUR-009", "AIM-001", "AIM-003"].map(rule),
    rulebookVersions: [{ id: "rulebook-7", version: 7, name: "GEN-01 fixture", createdAt: "2026-09-11", actor: "test", reason: "fixture", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
    planningDatasetVersions: [{
      id: "planning-3", version: 3, createdAt: "2026-09-11", actor: "test", reason: "fixture", snapshotHash: "0".repeat(64), status: "CURRENT",
      snapshot: { schemaVersion: "1.2", studioId: "gen01", sourceManifest: null, teacherIds: [], rooms: [], students: [], cohorts: [], classes: [], sessions: [] },
    }],
  };
}

describe("GEN-01 stable scheduling targets", () => {
  it("compiles the remaining static targets to stable IDs", () => {
    const model = compileConstraintModel(state());
    const requiredTeacher = model.hardConstraints.find((node) => node.id === "cami-required-jazz-3");
    const relationship = model.hardConstraints.find((node) => node.id === "karly-daughter-start-alignment");
    const progression = model.hardConstraints.find((node) => node.id === "required-lower-level-progression");

    expect(requiredTeacher).toMatchObject({
      selector: { classIds: ["class-1"], teacherIds: ["teacher-cami"] },
      parameters: { teacherId: "teacher-cami" },
    });
    expect(relationship).toMatchObject({
      selector: { teacherIds: ["teacher-karly"], participantIds: ["student-daughter"] },
      parameters: { daughterClassIds: expect.arrayContaining(["class-4", "class-18", "class-19", "class-20", "class-21", "class-22"]), participantId: "student-daughter" },
    });
    expect(progression?.parameters.exceptions).toEqual([
      expect.objectContaining({ participantId: "student-kiran" }),
    ]);
    expect(requiredTeacher?.selector.classNames).toBeUndefined();
    expect(relationship?.selector.studentRelation).toBeUndefined();
    expect(model.hardConstraints.some((node) => node.selector.teacherNames || node.selector.roomNames || node.selector.classNames)).toBe(false);
  });

  it("keeps legality after display-name renames and input permutation", () => {
    const original = state();
    const model = compileConstraintModel(original);
    const renamed = structuredClone(original);
    renamed.teachers = renamed.teachers.map((teacher) => ({ ...teacher, name: `Renamed ${teacher.id}` })).reverse();
    renamed.rooms = renamed.rooms.map((room) => ({ ...room, name: `Renamed ${room.id}` })).reverse();
    renamed.classes = renamed.classes.map((klass) => ({ ...klass, name: `Renamed ${klass.id}` })).reverse();
    renamed.students = renamed.students.map((student) => ({ ...student, name: `Renamed ${student.id}` })).reverse();

    expect(validateConstraintModelBindings(renamed, model).valid).toBe(true);
    const assignment: Assignment = { id: "assignment", sessionId: "session-1", day: "Monday", startTime: "17:00", endTime: "18:00", teacherId: "teacher-cami", roomId: "room-a" };
    const qualification = {
      id: "rename-qualification",
      kind: "TEACHER_SUBJECT_DOMAIN" as const,
      ruleIds: ["GEN-01"],
      selector: { teacherIds: ["teacher-cami"] },
      parameters: { allowedSubjects: ["Jazz"] },
      explanation: "rename regression",
    };
    const renamedModel = {
      ...model,
      hardConstraints: [
        model.hardConstraints.find((node) => node.id === "cami-required-jazz-3")!,
        qualification,
      ],
    };
    expect(validateConstraintModelSchedule(renamed, renamedModel, [assignment]).violations).toEqual([]);
  });

  it("fails closed when a static target is missing or Unicode-ambiguous", () => {
    const missing = state();
    missing.teachers = missing.teachers.filter((teacher) => teacher.id !== "teacher-cami");
    const missingModel = compileConstraintModel(missing);
    expect(missingModel.completeHardConstraintCompilation).toBe(false);
    expect(missingModel.uncompiledConstraintRuleIds).toContain("CAM-008");

    const duplicate = state();
    duplicate.teachers.push({ id: "teacher-cami-unicode", name: "Cámí", subjects: [] });
    const duplicateModel = compileConstraintModel(duplicate);
    expect(duplicateModel.completeHardConstraintCompilation).toBe(false);
    expect(duplicateModel.uncompiledConstraintRuleIds).toContain("CAM-008");
  });

  it("fails closed for missing, repeated, and disagreeing stable references", () => {
    const base = state();
    const node = (selector: Record<string, unknown>, parameters: Record<string, unknown>) => ({
      id: "identity-regression",
      kind: "REQUIRED_TEACHER" as const,
      ruleIds: ["GEN-01"],
      selector,
      parameters,
      explanation: "identity regression",
    });

    expect(materializeConstraintIdentityTargets(base, [node({ classIds: ["class-1"], teacherIds: ["missing-teacher"] }, { teacherId: "missing-teacher" })]).invalidRuleIds).toEqual(["GEN-01"]);
    expect(materializeConstraintIdentityTargets(base, [node({ classIds: ["class-1"], teacherIds: ["teacher-cami", "teacher-cami"] }, { teacherId: "teacher-cami" })]).invalidRuleIds).toEqual(["GEN-01"]);
    expect(materializeConstraintIdentityTargets(base, [node({ classIds: ["class-2"], classNames: ["Jazz 3"], teacherIds: ["teacher-cami"] }, { teacherId: "teacher-cami" })]).invalidRuleIds).toEqual(["GEN-01"]);
    expect(materializeConstraintIdentityTargets(base, [node({ classIds: ["class-1"] }, { teacherId: "missing-teacher" })]).invalidRuleIds).toEqual(["GEN-01"]);
  });

  it("treats selector identity arrays as sets when checking legacy name agreement", () => {
    const base = state();
    const result = materializeConstraintIdentityTargets(base, [{
      id: "permuted-selector",
      kind: "REQUIRED_TEACHER",
      ruleIds: ["GEN-01"],
      selector: {
        classIds: ["class-2", "class-1"],
        classNames: ["Jazz 3", "Studio Class"],
        teacherIds: ["teacher-cami"],
      },
      parameters: { teacherId: "teacher-cami" },
      explanation: "permuted selector identity regression",
    }]);

    expect(result.invalidRuleIds).toEqual([]);
    expect(result.nodes[0]?.selector.classIds).toEqual(["class-2", "class-1"]);
  });

  it("keeps a shared rule incomplete when one emitted node loses identity binding", () => {
    const base = state();
    base.rules.push(rule("ROOM-003"));
    base.classes = base.classes.filter((klass) => klass.name !== "Pre-Pointe");

    const model = compileConstraintModel(base);

    expect(model.completeHardConstraintCompilation).toBe(false);
    expect(model.uncompiledConstraintRuleIds).toContain("CUR-008");
  });

  it("fails closed for missing typed parameter ID arrays", () => {
    const qualification = {
      id: "typed-qualification",
      kind: "TEACHER_CLASS_DOMAIN" as const,
      ruleIds: ["GEN-01"],
      selector: { teacherIds: ["teacher-cami"] },
      parameters: { classIds: ["missing-class"] },
      explanation: "typed parameter identity regression",
    };
    const capacity = {
      id: "typed-capacity",
      kind: "ROOM_CAPACITY" as const,
      ruleIds: ["GEN-01"],
      selector: { roomIds: ["room-a"] },
      parameters: { capacitySource: "PLANNING_DATASET", exemptClassIds: ["missing-class"] },
      explanation: "typed parameter identity regression",
    };

    const current = state();
    const result = materializeConstraintIdentityTargets(current, [qualification, capacity]);

    expect(result.invalidRuleIds).toEqual(["GEN-01"]);
    expect(result.nodes).toEqual([]);
    expect(validateConstraintModelBindings(current, {
      schemaVersion: "1.0",
      compilerVersion: "test",
      rulebookVersion: 7,
      planningDatasetVersion: 3,
      activeRuleCount: 1,
      hardConstraints: [qualification, capacity],
      objectivePrioritySpine: [],
      readinessRuleIds: [],
      governanceAssertions: [],
      uncompiledConstraintRuleIds: [],
      completeHardConstraintCompilation: false,
    }).valid).toBe(false);
  });
});

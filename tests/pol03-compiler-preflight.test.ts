import { describe, expect, it } from "vitest";
import type { RulebookVersion, StudioRule, StudioState } from "@/lib/domain";
import { compileConstraintModel, POL03_CONSTRAINT_COMPILER_VERSION } from "@/lib/constraint-compiler-v3";
import { validateDelegatedSolverPreconditions } from "@/lib/delegated-solver-preflight";

function rule(id: string, policy: Record<string, unknown>, strength: StudioRule["strength"] = "HARD"): StudioRule {
  return { id, category: "test", type: null, title: id, description: id, strength, classificationRaw: strength || "", status: "ACTIVE", verificationStatus: "VERIFIED", reviewStatus: "VERIFIED", review: { decision: "APPROVED", verified: true }, affectedEntityIds: [], parameters: { policy }, exceptions: [], source: { type: "IMPORT" }, sourceRaw: {}, versionIntroduced: 2, updatedAt: "2026-09-10" };
}

function state(rules: StudioRule[]): StudioState {
  const bundles = rules.map((item) => ({ ownerRuleId: item.id, consumedRuleIds: [item.id] })).sort((a, b) => a.ownerRuleId.localeCompare(b.ownerRuleId));
  const version: RulebookVersion = { id: "rb", version: 6, name: "Typed", createdAt: "2026-09-10", actor: "test", reason: "test", changedRuleIds: rules.map((item) => item.id).sort(), status: "CURRENT", sourceMetadata: { typedPolicyRuleIds: rules.map((item) => item.id).sort(), introducedTypedPolicyRuleIds: rules.map((item) => item.id).sort(), typedPolicyBundles: bundles } };
  return { studioId: "studio", studioName: "Test", teachers: [{ id: "teacher-a", name: "Teacher", subjects: [] }], rooms: [{ id: "room", name: "Room" }], students: [{ id: "student-a", name: "Participant", level: "L1" }], cohorts: [], classes: [{ id: "class-a", name: "Class", subject: "Test", level: "L1", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: ["student-a"], eligibleTeacherIds: [] }, { id: "class-empty", name: "Missing session", subject: "Test", level: "L1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] }], sessions: [{ id: "session-a", classId: "class-a", ordinal: 1 }, { id: "session-b", classId: "class-empty", ordinal: 1 }], rules, rulebookVersions: [version], enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [], planningDatasetVersions: [] };
}

describe("POL-03 compiler and completeness preflight", () => {
  it("compiles stable-ID nodes through declared bundle ownership", () => {
    const s = state([
      rule("NO", { schemaVersion: "1.0", kind: "PARTICIPANT_NO_OVERLAP", participantIds: ["student-a"] }),
      rule("MAX", { schemaVersion: "1.0", kind: "MAX_ATTENDANCE_DAYS", participantIds: ["student-a"], maxDays: 2 }),
      rule("SEQ", { schemaVersion: "1.0", kind: "DIRECT_AFTER", predecessorSessionId: "session-a", successorSessionId: "session-b" }),
      rule("ARR", { schemaVersion: "1.0", kind: "LINKED_ARRIVAL", teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: -15, maxOffsetMinutes: 30 }),
    ]);
    const model = compileConstraintModel(s);
    expect(model.compilerVersion).toBe(POL03_CONSTRAINT_COMPILER_VERSION);
    expect(model.hardConstraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "PARTICIPANT_NO_OVERLAP", selector: { participantIds: ["student-a"] } }),
      expect.objectContaining({ kind: "MAX_ATTENDANCE_DAYS", selector: { participantIds: ["student-a"] }, parameters: { maxDays: 2 } }),
      expect.objectContaining({ kind: "DIRECTLY_AFTER", parameters: { predecessorSessionId: "session-a", successorSessionId: "session-b" } }),
      expect.objectContaining({ kind: "LINKED_ARRIVAL", parameters: expect.objectContaining({ teacherId: "teacher-a", participantId: "student-a" }) }),
    ]));
  });

  it("rejects reversed edges as a cycle and does not promote optional relationship policy to HARD", () => {
    const s = state([
      rule("A", { schemaVersion: "1.0", kind: "DIRECT_AFTER", predecessorSessionId: "session-a", successorSessionId: "session-b" }),
      rule("B", { schemaVersion: "1.0", kind: "DIRECT_AFTER", predecessorSessionId: "session-b", successorSessionId: "session-a" }),
      rule("OPTIONAL", { schemaVersion: "1.0", kind: "LINKED_ARRIVAL", teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: 0, maxOffsetMinutes: 30 }, "MODERATE"),
    ]);
    const model = compileConstraintModel(s);
    expect(model.hardConstraints.some((item) => item.id.startsWith("typed-a-") || item.id.startsWith("typed-b-") || item.id.startsWith("typed-optional-"))).toBe(false);
    expect(model.uncompiledConstraintRuleIds).toEqual(expect.arrayContaining(["A", "B"]));

    const optionalReverse = compileConstraintModel(state([
      rule("A", { schemaVersion: "1.0", kind: "DIRECT_AFTER", predecessorSessionId: "session-a", successorSessionId: "session-b" }),
      rule("OPTIONAL", { schemaVersion: "1.0", kind: "DIRECT_AFTER", predecessorSessionId: "session-b", successorSessionId: "session-a" }, "MODERATE"),
    ]));
    expect(optionalReverse.hardConstraints).toContainEqual(expect.objectContaining({ id: "typed-a-direct-after" }));
    expect(optionalReverse.hardConstraints.some((item) => item.id === "typed-optional-direct-after")).toBe(false);
  });

  it("reports zero sessions and absent-roster dependencies before solving", () => {
    const s = state([rule("MAX", { schemaVersion: "1.0", kind: "MAX_ATTENDANCE_DAYS", participantIds: ["student-a"], maxDays: 2 })]);
    s.sessions = [];
    expect(validateDelegatedSolverPreconditions(s, compileConstraintModel(s)).issues.map((item) => item.code)).toContain("POLICY_REQUIRED_SESSION_MISSING");
    s.classes[0].rosterStudentIds = [];
    expect(validateDelegatedSolverPreconditions(s, compileConstraintModel(s)).issues.map((item) => item.code)).toContain("POLICY_PARTICIPANT_NOT_ROSTERED");
  });
});

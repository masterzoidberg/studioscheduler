import { describe, expect, it } from "vitest";
import type { Assignment, RulebookVersion, StudioRule, StudioState } from "@/lib/domain";
import { compileConstraintModel, SET06_CONSTRAINT_COMPILER_VERSION } from "@/lib/constraint-compiler-v3";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import {
  buildStudentPolicyPatches,
  DIRECT_AFTER_RULE_ID,
  LINKED_ARRIVAL_RULE_ID,
  NO_OVERLAP_RULE_ID,
  studentLatestFinishRuleId,
  studentMaximumDaysRuleId,
  studentPolicyDraftFromRules,
} from "@/lib/student-setup";

function rule(id: string, policy: Record<string, unknown>): StudioRule {
  return {
    id, category: "STUDENT_POLICY", type: null, title: id, description: id,
    strength: "HARD", classificationRaw: "HARD", status: "ACTIVE",
    verificationStatus: "VERIFIED", reviewStatus: "VERIFIED",
    affectedEntityIds: [], parameters: { policy }, exceptions: [],
    source: { type: "USER_EDIT" }, versionIntroduced: 7, updatedAt: "2026-09-10",
  };
}

function state(rules: StudioRule[]): StudioState {
  const ids = rules.map((item) => item.id).sort();
  const version: RulebookVersion = {
    id: "rb", version: 7, name: "Typed", createdAt: "2026-09-10", actor: "test", reason: "test",
    changedRuleIds: ids, status: "CURRENT",
    sourceMetadata: { typedPolicyRuleIds: ids, introducedTypedPolicyRuleIds: ids, typedPolicyBundles: ids.map((id) => ({ ownerRuleId: id, consumedRuleIds: [id] })) },
  };
  return {
    studioId: "studio", studioName: "Test",
    teachers: [{ id: "teacher-a", name: "Renamed teacher", subjects: [] }],
    rooms: [{ id: "room-a", name: "Room", capacity: 20 }],
    students: [{ id: "student-a", name: "Renamed student", level: "L1", cohortIds: ["family-a"] }, { id: "student-b", name: "Other", level: "L1", cohortIds: ["family-a"] }],
    cohorts: [{ id: "family-a", name: "Household", studentIds: ["student-a", "student-b"] }],
    classes: [
      { id: "class-a", name: "A", subject: "A", level: "L1", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: ["student-a"], eligibleTeacherIds: [] },
      { id: "class-b", name: "B", subject: "B", level: "L1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-b"], eligibleTeacherIds: [] },
    ],
    sessions: [{ id: "session-a", classId: "class-a", ordinal: 1 }, { id: "session-b", classId: "class-b", ordinal: 1 }],
    rules, rulebookVersions: [version], enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [], planningDatasetVersions: [],
  };
}

describe("SET-06 student policy authoring", () => {
  it("builds stable-ID policies and does not infer a HARD rule from cohort membership", () => {
    const draft = studentPolicyDraftFromRules([], ["student-a", "student-b"]);
    expect(draft.noOverlapParticipantIds).toEqual([]);

    draft.latestFinishByStudent["student-a"] = "20:15";
    draft.maxAttendanceDaysByStudent["student-a"] = 3;
    draft.noOverlapParticipantIds = ["student-b", "student-a"];
    draft.directAfter = { predecessorSessionId: "session-a", successorSessionId: "session-b" };
    draft.linkedArrival = { teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: -15, maxOffsetMinutes: 30 };

    expect(buildStudentPolicyPatches(draft)).toEqual(expect.arrayContaining([
      { ruleId: studentLatestFinishRuleId("student-a"), policy: expect.objectContaining({ kind: "PARTICIPANT_LATEST_FINISH", participantIds: ["student-a"], latestFinish: "20:15" }) },
      { ruleId: studentMaximumDaysRuleId("student-a"), policy: expect.objectContaining({ kind: "MAX_ATTENDANCE_DAYS", participantIds: ["student-a"], maxDays: 3 }) },
      { ruleId: NO_OVERLAP_RULE_ID, policy: expect.objectContaining({ kind: "PARTICIPANT_NO_OVERLAP", participantIds: ["student-a", "student-b"] }) },
      { ruleId: DIRECT_AFTER_RULE_ID, policy: expect.objectContaining({ kind: "DIRECT_AFTER", predecessorSessionId: "session-a", successorSessionId: "session-b" }) },
      { ruleId: LINKED_ARRIVAL_RULE_ID, policy: expect.objectContaining({ kind: "LINKED_ARRIVAL", teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: -15, maxOffsetMinutes: 30 }) },
    ]));
  });

  it("compiles participant latest finish by stable ID and rename does not change legality", () => {
    const latest = rule(studentLatestFinishRuleId("student-a"), { schemaVersion: "1.0", kind: "PARTICIPANT_LATEST_FINISH", participantIds: ["student-a"], latestFinish: "20:15" });
    const model = compileConstraintModel(state([latest]));
    expect(model.compilerVersion).toBe(SET06_CONSTRAINT_COMPILER_VERSION);
    expect(model.hardConstraints).toContainEqual(expect.objectContaining({ kind: "LATEST_FINISH_BY_PARTICIPANT", selector: { participantIds: ["student-a"] }, parameters: { latestFinish: "20:15" } }));

    const assignments: Assignment[] = [{ id: "a", sessionId: "session-a", day: "Monday", startTime: "20:00", endTime: "20:45", teacherId: "teacher-a", roomId: "room-a" }];
    expect(validateConstraintModelSchedule(state([latest]), model, assignments).violations).toContainEqual(expect.objectContaining({ affectedEntityIds: ["student-a"] }));
    const renamed = state([latest]);
    renamed.students[0].name = "A completely different display name";
    expect(validateConstraintModelSchedule(renamed, model, assignments).violations).toContainEqual(expect.objectContaining({ affectedEntityIds: ["student-a"] }));
  });

  it("fails closed when a linked participant is removed", () => {
    const latest = rule(studentLatestFinishRuleId("student-a"), { schemaVersion: "1.0", kind: "PARTICIPANT_LATEST_FINISH", participantIds: ["student-a"], latestFinish: "20:15" });
    const missing = state([latest]);
    missing.students = missing.students.filter((student) => student.id !== "student-a");
    const model = compileConstraintModel(missing);
    expect(model.completeHardConstraintCompilation).toBe(false);
    expect(model.uncompiledConstraintRuleIds).toContain(latest.id);
  });
});

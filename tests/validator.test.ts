import { describe, expect, it } from "vitest";
import type { Assignment, RuleEnforcementMapping, StudioRule, StudioState } from "@/lib/domain";
import { validateSchedule } from "@/lib/validator";

const now = "2026-08-30T00:00:00Z";
const assignment = (partial: Partial<Assignment>): Assignment => ({ id: "a", sessionId: "session-a", day: "Monday", startTime: "17:00", endTime: "18:00", teacherId: "teacher-cami", roomId: "room-a", locked: false, status: "NORMAL", ...partial });
const hardRule = (id: string, status: StudioRule["status"] = "ACTIVE"): StudioRule => ({ id, category: "TEST", type: null, title: id, description: id, strength: "HARD", classificationRaw: "HARD", status, verificationStatus: "VERIFIED", reviewStatus: "VERIFIED", affectedEntityIds: [], parameters: {}, exceptions: [], source: { type: "SYSTEM_SEED" }, enforcementStatus: "NOT_IMPLEMENTED", versionIntroduced: 1, updatedAt: now });
const mapping = (ruleId: string, type: RuleEnforcementMapping["type"], parameters: Record<string, unknown> = {}, affectedEntityIds: string[] = []): RuleEnforcementMapping => ({ ruleId, type, parameters, affectedEntityIds, exceptions: [] });

function state(rules: StudioRule[] = [], mappings: RuleEnforcementMapping[] = [], assignments: Assignment[] = [assignment({})]): StudioState {
  return {
    studioId: "s", studioName: "DWDE",
    teachers: [{ id: "teacher-cami", name: "Cami", subjects: [] }, { id: "teacher-aimee", name: "Aimee", subjects: [] }],
    rooms: [{ id: "room-a", name: "Studio A", capacity: 20 }, { id: "room-b", name: "Studio B", capacity: 20 }],
    students: [], cohorts: [],
    classes: [
      { id: "class-a", name: "Jazz 1", subject: "Jazz", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
      { id: "class-b", name: "Ballet 5", subject: "Ballet", level: "Level 5", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
    ],
    sessions: [{ id: "session-a", classId: "class-a", ordinal: 1 }, { id: "session-b", classId: "class-b", ordinal: 1 }],
    rules,
    rulebookVersions: [{ id: "rb", version: 2, name: "Rulebook", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [{ id: "ev", version: 1, rulebookVersion: 2, createdAt: now, actor: "test", reason: "test", changedRuleIds: mappings.map((item) => item.ruleId), snapshot: mappings, status: "CURRENT" }],
    enforcementProposals: [], ruleHistory: [],
    scheduleVersions: [{ id: "sv", version: 1, rulebookVersion: 2, enforcementVersion: 1, createdAt: now, actor: "test", reason: "test", assignments, isCurrent: true }],
    scenarios: [], auditEvents: [],
  };
}

describe("DWDE deterministic validator V2.2", () => {
  it("detects room and teacher double booking only through approved mappings", () => {
    const rules = [hardRule("OPS-008"), hardRule("OPS-009")];
    const maps = [mapping("OPS-008", "ROOM_NO_OVERLAP"), mapping("OPS-009", "TEACHER_NO_OVERLAP")];
    const result = validateSchedule(state(rules, maps, [assignment({ id: "a" }), assignment({ id: "b" })]));
    expect(result.hardViolations).toBe(2);
  });

  it("enforces a required room mapping", () => {
    const result = validateSchedule(state([hardRule("ROOM-002")], [mapping("ROOM-002", "REQUIRED_ROOM", { required_room_id: "room-a" }, ["class-b"])], [assignment({ id: "b", sessionId: "session-b", teacherId: "teacher-aimee", roomId: "room-b" })]));
    expect(result.violations.some((item) => item.constraintId === "ROOM-002")).toBe(true);
  });

  it("enforces Cami maximum workdays", () => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
    const list = days.map((day, index) => assignment({ id: `a${index}`, day }));
    const result = validateSchedule(state([hardRule("CAM-006")], [mapping("CAM-006", "MAX_TEACHER_WORKDAYS", { teacher_id: "teacher-cami", max_days: 4 })], list));
    expect(result.violations.some((item) => item.constraintId === "CAM-006")).toBe(true);
  });

  it("enforces day-scoped latest finish", () => {
    const result = validateSchedule(state([hardRule("OPS-006")], [mapping("OPS-006", "LATEST_FINISH", { time: "15:00", days: ["Saturday"] })], [assignment({ day: "Saturday", startTime: "14:30", endTime: "15:30" })]));
    expect(result.violations.some((item) => item.constraintId === "OPS-006")).toBe(true);
  });

  it("enforces class-scoped no-day mappings", () => {
    const result = validateSchedule(state([hardRule("STU-019")], [mapping("STU-019", "NO_DAY", { days: ["Friday"] }, ["class-b"])], [assignment({ sessionId: "session-b", teacherId: "teacher-aimee", day: "Friday" })]));
    expect(result.violations.some((item) => item.constraintId === "STU-019")).toBe(true);
  });

  it("does not enforce a mapping whose Rulebook rule is disabled", () => {
    const result = validateSchedule(state([hardRule("disabled", "DISABLED")], [mapping("disabled", "NO_DAY", { days: ["Monday"] }, ["class-a"])]));
    expect(result.violations.some((item) => item.constraintId === "disabled")).toBe(false);
  });

  it("enforces weekly class frequency", () => {
    const result = validateSchedule(state([hardRule("CUR-006")], [mapping("CUR-006", "CLASS_FREQUENCY")], []));
    expect(result.violations.filter((item) => item.constraintId === "CUR-006").length).toBe(2);
  });
});

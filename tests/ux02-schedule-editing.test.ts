import { describe, expect, it } from "vitest";
import type { Assignment, StudioState } from "@/lib/domain";
import { assessScheduleEdit, scheduleVersionLabel } from "@/lib/schedule-editing";

const now = "2026-09-10T00:00:00Z";

function state(assignments: Assignment[]): StudioState {
  return {
    studioId: "studio",
    studioName: "Fixture Studio",
    teachers: [{ id: "teacher", name: "Teacher", subjects: ["Ballet"] }],
    rooms: [{ id: "room", name: "Room", capacity: 20, features: [] }],
    students: [],
    cohorts: [],
    classes: [{ id: "class", name: "Ballet", subject: "Ballet", level: "5", durationMinutes: 90, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: ["teacher"] }],
    sessions: [{ id: "session", classId: "class", ordinal: 1, durationMinutes: 105 }],
    rules: [{ id: "duration", category: "SCHEDULE", type: null, title: "Session duration", description: "Session duration", strength: "HARD", classificationRaw: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", reviewStatus: "VERIFIED", review: {}, affectedEntityIds: [], parameters: {}, exceptions: [], source: { type: "IMPORT" }, sourceRaw: {}, enforcementStatus: "IMPLEMENTED", versionIntroduced: 1, updatedAt: now }],
    rulebookVersions: [{ id: "rulebook", version: 1, name: "Fixture", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [{ id: "enforcement", version: 1, rulebookVersion: 1, createdAt: now, actor: "test", reason: "test", changedRuleIds: ["duration"], snapshot: [{ ruleId: "duration", type: "CLASS_DURATION", parameters: {}, affectedEntityIds: [], exceptions: [] }], status: "CURRENT" }],
    planningDatasetVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [{ id: "schedule", version: 4, rulebookVersion: 1, enforcementVersion: 1, createdAt: now, actor: "test", reason: "fixture", assignments, isCurrent: true }],
    scenarios: [],
    auditEvents: [],
  };
}

const assignment: Assignment = { id: "assignment", sessionId: "session", day: "Monday", startTime: "17:00", endTime: "18:45", teacherId: "teacher", roomId: "room", locked: false, status: "NORMAL" };

describe("UX-02 schedule editing assessment", () => {
  it("uses the session duration override when describing a valid edit", () => {
    const result = assessScheduleEdit(state([assignment]), [assignment], { assignment });

    expect(result.status).toBe("VALID");
    expect(result.durationMinutes).toBe(105);
    expect(result.allowed).toBe(true);
  });

  it("labels an unassigned session as an allowed incomplete draft", () => {
    const result = assessScheduleEdit(state([assignment]), []);

    expect(result.status).toBe("INCOMPLETE");
    expect(result.allowed).toBe(true);
    expect(result.completeness.unscheduledSessionIds).toEqual(["session"]);
  });

  it("separates preference warnings, locked assignments, and rejected HARD changes", () => {
    expect(assessScheduleEdit(state([assignment]), [assignment], { preferenceWarnings: ["Prefer an earlier start"] }).status).toBe("PREFERENCE_WARNING");
    expect(assessScheduleEdit(state([assignment]), [assignment], { locked: true, assignment }).status).toBe("LOCKED");
    expect(assessScheduleEdit(state([assignment]), [{ ...assignment, endTime: "18:30" }], { assignment: { ...assignment, endTime: "18:30" } }).status).toBe("REJECTED");
  });

  it("gives version history a manager-facing label", () => {
    expect(scheduleVersionLabel({ ...state([assignment]).scheduleVersions[0], isCurrent: false, reason: "Undo Schedule v4 under current policy" }, 5)).toBe("Restored previous schedule");
    expect(scheduleVersionLabel({ ...state([assignment]).scheduleVersions[0], isCurrent: false, reason: "Dragged Ballet to Tuesday" }, 5)).toBe("Manual schedule change");
  });
});

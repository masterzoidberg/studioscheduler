import { describe, expect, it } from "vitest";
import type { Assignment, SchedulePatch, StudioState } from "@/lib/domain";
import { buildScheduleCommandCandidate } from "@/lib/schedule-command-candidate";

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [{ id: "aimee", name: "Aimee", subjects: [] }],
    rooms: [{ id: "a", name: "Studio A", capacity: 30, features: [] }],
    students: [],
    cohorts: [],
    classes: [
      { id: "ballet", name: "Ballet 3", subject: "Ballet", level: "Level 3", durationMinutes: 90, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
      { id: "prepointe", name: "Pre-Pointe", subject: "Pre-Pointe", level: "Level 3", durationMinutes: 30, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
    ],
    sessions: [
      { id: "session-ballet", classId: "ballet", ordinal: 1 },
      { id: "session-prepointe", classId: "prepointe", ordinal: 1, locked: true },
    ],
    rules: [],
    rulebookVersions: [],
    enforcementVersions: [],
    planningDatasetVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
  };
}

const current: Assignment[] = [{
  id: "assignment-ballet",
  sessionId: "session-ballet",
  day: "Monday",
  startTime: "16:45",
  endTime: "18:15",
  teacherId: "aimee",
  roomId: "a",
  status: "NORMAL",
}];

function patch(values: Partial<SchedulePatch> & Pick<SchedulePatch, "operation">): SchedulePatch {
  return {
    id: "patch",
    operation: values.operation,
    assignmentId: values.assignmentId ?? "assignment-ballet",
    changes: values.changes ?? {},
    reason: values.reason ?? "Golden command test",
    proposedBy: "USER",
  };
}

describe("schedule command candidate", () => {
  it("recalculates MOVE end time from canonical session duration", () => {
    const result = buildScheduleCommandCandidate(state(), current, patch({
      operation: "MOVE",
      changes: { startTime: "18:00", endTime: "18:01" },
    }));
    expect(result.after?.startTime).toBe("18:00");
    expect(result.after?.endTime).toBe("19:30");
    expect(result.assignments[0].endTime).toBe("19:30");
  });

  it("builds ASSIGN from an explicit session and mirrors session lock state", () => {
    const result = buildScheduleCommandCandidate(state(), current, patch({
      operation: "ASSIGN",
      assignmentId: "",
      changes: {
        sessionId: "session-prepointe",
        day: "Monday",
        startTime: "18:15",
        teacherId: "aimee",
        roomId: "a",
      },
    }));
    expect(result.assignmentId).toBe("assignment-session-prepointe");
    expect(result.after).toMatchObject({
      sessionId: "session-prepointe",
      startTime: "18:15",
      endTime: "18:45",
      locked: true,
    });
    expect(result.assignments).toHaveLength(2);
  });

  it("removes an unlocked assignment for UNASSIGN", () => {
    const result = buildScheduleCommandCandidate(state(), current, patch({ operation: "UNASSIGN" }));
    expect(result.before?.id).toBe("assignment-ballet");
    expect(result.after).toBeNull();
    expect(result.assignments).toEqual([]);
  });

  it("rejects MOVE or UNASSIGN for a locked assignment", () => {
    const locked = [{ ...current[0], locked: true }];
    expect(() => buildScheduleCommandCandidate(state(), locked, patch({ operation: "MOVE", changes: { startTime: "18:00" } }))).toThrow("LOCKED_ASSIGNMENT");
    expect(() => buildScheduleCommandCandidate(state(), locked, patch({ operation: "UNASSIGN" }))).toThrow("LOCKED_ASSIGNMENT");
  });

  it("rejects off-grid placement before any validator is consulted", () => {
    expect(() => buildScheduleCommandCandidate(state(), current, patch({ operation: "MOVE", changes: { startTime: "17:07" } }))).toThrow("TIME_GRID");
  });
});

import { describe, expect, it } from "vitest";
import type { Assignment, ClassSession } from "@/lib/domain";
import { assignmentIdForSession, defaultStartTime, placementEndTime, unscheduledSessions } from "@/lib/schedule-builder";

const sessions: ClassSession[] = [
  { id: "session-a", classId: "class-a", ordinal: 1 },
  { id: "session-b", classId: "class-b", ordinal: 1 },
];

const assignments: Assignment[] = [
  {
    id: "assignment-a",
    sessionId: "session-a",
    day: "Monday",
    startTime: "16:15",
    endTime: "17:15",
    teacherId: "teacher-a",
    roomId: "room-a",
  },
];

describe("schedule builder helpers", () => {
  it("finds sessions that are not placed in the current schedule", () => {
    expect(unscheduledSessions(sessions, assignments).map((item) => item.id)).toEqual(["session-b"]);
  });

  it("creates a stable assignment id for a session", () => {
    expect(assignmentIdForSession("session-hiphop-2-1")).toBe("assignment-session-hiphop-2-1");
  });

  it("preserves curriculum duration when computing the end time", () => {
    expect(placementEndTime("16:45", { durationMinutes: 90 })).toBe("18:15");
  });

  it("uses studio opening defaults for weekdays and Saturday", () => {
    expect(defaultStartTime("Monday")).toBe("16:15");
    expect(defaultStartTime("Saturday")).toBe("09:00");
  });
});

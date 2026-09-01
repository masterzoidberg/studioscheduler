import type { Assignment, ClassDefinition, ClassSession } from "@/lib/domain";

export function unscheduledSessions(sessions: ClassSession[], assignments: Assignment[]) {
  const assigned = new Set(assignments.map((assignment) => assignment.sessionId));
  return sessions.filter((session) => !assigned.has(session.id));
}

export function assignmentIdForSession(sessionId: string) {
  return `assignment-${sessionId}`;
}

function toMinutes(value: string) {
  const [hours = "0", minutes = "0"] = value.slice(0, 5).split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function timeFromMinutes(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function placementEndTime(startTime: string, klass: Pick<ClassDefinition, "durationMinutes">) {
  return timeFromMinutes(toMinutes(startTime) + klass.durationMinutes);
}

export function defaultStartTime(day: Assignment["day"]) {
  return day === "Saturday" ? "09:00" : "16:15";
}

import type { Assignment, SchedulePatch, StudioState } from "@/lib/domain";
import { assignmentIdForSession, placementEndTime, sessionDurationMinutes } from "@/lib/schedule-builder";

export interface ScheduleCommandCandidate {
  operation: SchedulePatch["operation"];
  assignmentId: string;
  sessionId: string;
  before: Assignment | null;
  after: Assignment | null;
  assignments: Assignment[];
}

const DAYS: Assignment["day"][] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const minutes = (value: string) => {
  const [hour = "0", minute = "0"] = value.slice(0, 5).split(":");
  return Number(hour) * 60 + Number(minute);
};

function requirePlacement(state: StudioState, assignment: Assignment) {
  if (!DAYS.includes(assignment.day)) throw new Error(`Invalid schedule day: ${assignment.day}`);
  if (minutes(assignment.startTime) % 15 !== 0) throw new Error("TIME_GRID: start time must be on a 15-minute boundary");
  if (!state.teachers.some((teacher) => teacher.id === assignment.teacherId)) throw new Error(`Teacher ${assignment.teacherId} is not part of this studio`);
  if (!state.rooms.some((room) => room.id === assignment.roomId)) throw new Error(`Room ${assignment.roomId} is not part of this studio`);
  if (assignment.status && !["NORMAL", "WARNING", "AI_PROPOSED"].includes(assignment.status)) throw new Error(`Invalid assignment status: ${assignment.status}`);
}

function sessionContext(state: StudioState, sessionId: string) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(`Session ${sessionId} is not part of this studio`);
  const klass = state.classes.find((item) => item.id === session.classId);
  if (!klass) throw new Error(`Session ${sessionId} references missing class ${session.classId}`);
  const duration = sessionDurationMinutes(session, klass);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Session ${sessionId} has no valid duration`);
  return { session, klass, duration };
}

/**
 * Pure mirror of the structural portion of apply_schedule_command_v25.
 *
 * This does not decide Rulebook legality. It creates the exact candidate assignment
 * set that both the legacy validator and Constraint IR runtime can inspect before a
 * write is attempted. Keeping candidate construction pure gives MOVE / ASSIGN /
 * UNASSIGN one testable semantic boundary instead of three UI-specific variants.
 */
export function buildScheduleCommandCandidate(
  state: StudioState,
  assignments: Assignment[],
  patch: SchedulePatch,
): ScheduleCommandCandidate {
  if (!patch.reason.trim()) throw new Error("Reason is required");

  if (patch.operation === "ASSIGN") {
    const sessionId = patch.changes.sessionId?.trim();
    if (!sessionId) throw new Error("Session is required for ASSIGN");
    const { session, duration } = sessionContext(state, sessionId);
    if (assignments.some((assignment) => assignment.sessionId === sessionId)) throw new Error(`SESSION_ALREADY_ASSIGNED: ${sessionId}`);

    const assignmentId = patch.assignmentId.trim() || assignmentIdForSession(sessionId);
    if (assignments.some((assignment) => assignment.id === assignmentId)) throw new Error(`ASSIGNMENT_ID_ALREADY_EXISTS: ${assignmentId}`);
    if (!patch.changes.day) throw new Error("day is required for ASSIGN");
    if (!patch.changes.startTime) throw new Error("startTime is required for ASSIGN");
    if (!patch.changes.teacherId) throw new Error("teacherId is required for ASSIGN");
    if (!patch.changes.roomId) throw new Error("roomId is required for ASSIGN");

    const startTime = patch.changes.startTime;
    const endTime = placementEndTime(startTime, duration);
    if (minutes(endTime) <= minutes(startTime)) throw new Error("Assignment may not cross midnight");
    const after: Assignment = {
      id: assignmentId,
      sessionId,
      day: patch.changes.day,
      startTime,
      endTime,
      teacherId: patch.changes.teacherId,
      roomId: patch.changes.roomId,
      locked: Boolean(session.locked),
      status: patch.changes.status ?? "NORMAL",
    };
    requirePlacement(state, after);
    return { operation: patch.operation, assignmentId, sessionId, before: null, after, assignments: [...assignments, after] };
  }

  const before = assignments.find((assignment) => assignment.id === patch.assignmentId);
  if (!before) throw new Error(`Assignment ${patch.assignmentId} does not exist`);
  const { session, duration } = sessionContext(state, before.sessionId);
  if (before.locked) throw new Error(`LOCKED_ASSIGNMENT: ${before.id} is locked`);
  if (session.locked) throw new Error(`LOCKED_SESSION: ${session.id} is locked`);

  if (patch.operation === "UNASSIGN") {
    return {
      operation: patch.operation,
      assignmentId: before.id,
      sessionId: before.sessionId,
      before,
      after: null,
      assignments: assignments.filter((assignment) => assignment.id !== before.id),
    };
  }

  const startTime = patch.changes.startTime ?? before.startTime;
  const after: Assignment = {
    ...before,
    day: patch.changes.day ?? before.day,
    startTime,
    endTime: placementEndTime(startTime, duration),
    teacherId: patch.changes.teacherId ?? before.teacherId,
    roomId: patch.changes.roomId ?? before.roomId,
    status: patch.changes.status ?? before.status ?? "NORMAL",
  };
  if (minutes(after.endTime) <= minutes(after.startTime)) throw new Error("Assignment may not cross midnight");
  requirePlacement(state, after);

  return {
    operation: patch.operation,
    assignmentId: before.id,
    sessionId: before.sessionId,
    before,
    after,
    assignments: assignments.map((assignment) => assignment.id === before.id ? after : assignment),
  };
}

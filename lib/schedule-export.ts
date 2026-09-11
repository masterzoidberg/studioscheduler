import type {
  Assignment,
  ClassDefinition,
  ClassSession,
  Day,
  Room,
  ScheduleVersion,
  StudioState,
  Teacher,
  ValidationResult,
} from "@/lib/domain";
import { scheduleCompleteness } from "@/lib/schedule-editing";
import type { ScheduleReadinessReport } from "@/lib/schedule-readiness";
import type { SolverSnapshotContextToken } from "@/lib/server-studio-state";

export const SCHEDULE_HORIZON: readonly Day[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type ScheduleExportView = "WEEK" | "TEACHER" | "ROOM";
export type ScheduleExportStatus = "DRAFT" | "STALE" | "REVIEWED_FINAL";
export type ScheduleExportRowType = "SESSION" | "EMPTY" | "UNSCHEDULED";

export interface ScheduleExportRow {
  rowType: ScheduleExportRowType;
  day: Day | null;
  roomId: string | null;
  roomName: string;
  sessionId: string | null;
  className: string | null;
  teacherName: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  locked: boolean;
}

export interface ScheduleExportModel {
  status: ScheduleExportStatus;
  finalReady: boolean;
  finalBlockers: string[];
  studioName: string;
  scheduleVersionId: string | null;
  scheduleVersion: number;
  rulebookVersion: number;
  enforcementVersion: number;
  planningDatasetVersion: number;
  days: readonly Day[];
  rooms: Room[];
  teachers: Teacher[];
  classes: ClassDefinition[];
  sessions: ClassSession[];
  assignments: Assignment[];
  rows: ScheduleExportRow[];
}

export interface ScheduleExportInput {
  state: StudioState;
  assignments: Assignment[];
  currentSchedule: ScheduleVersion | null;
  currentRulebookVersion: number;
  currentEnforcementVersion: number;
  currentPlanningDatasetVersion: number;
  scheduleIsStale: boolean;
  validation: ValidationResult;
  readiness: ScheduleReadinessReport;
  contextToken: SolverSnapshotContextToken | null;
}

const staleReadinessCodes = new Set([
  "PLANNING_CERTIFICATION_CONTEXT_MISSING",
  "PLANNING_CERTIFICATION_STALE",
  "READINESS_REVIEW_STALE",
  "SCHEDULE_PLANNING_DATASET_STALE",
]);

function certificationIsCurrent(input: ScheduleExportInput) {
  const current = input.state.readinessCertification;
  const certification = current?.certification;
  const planning = input.state.planningDatasetVersions?.find((version) => version.status === "CURRENT");
  const schedule = input.currentSchedule;
  const token = input.contextToken;
  if (!current || !certification || !planning || !planning.confirmedForSchedulingAt || !schedule || !token) return false;
  if (token.schemaVersion !== "1.0" || token.studioId !== input.state.studioId) return false;
  if (token.rulebookVersion !== input.currentRulebookVersion || token.enforcementVersion !== input.currentEnforcementVersion || token.planningDatasetVersion !== input.currentPlanningDatasetVersion) return false;
  if (token.scheduleVersion !== schedule.version || token.scheduleId !== schedule.id) return false;
  if (token.scheduleRulebookVersion !== schedule.rulebookVersion || token.scheduleEnforcementVersion !== schedule.enforcementVersion || token.schedulePlanningDatasetVersion !== (schedule.planningDatasetVersion ?? null)) return false;
  if (token.scheduleConstraintModelVersion !== token.constraintModelVersion) return false;
  return certification.planningDatasetVersion === planning.version
    && certification.planningSnapshotHash === planning.snapshotHash
    && certification.rulebookVersion === input.currentRulebookVersion
    && current.currentPlanningDatasetVersion === planning.version
    && current.currentPlanningSnapshotHash === planning.snapshotHash
    && current.currentRulebookVersion === input.currentRulebookVersion
    && certification.constraintModelVersion === token.constraintModelVersion
    && certification.constraintModelSnapshotHash === token.constraintModelSnapshotHash
    && certification.constraintModelVersion === current.currentConstraintModelVersion
    && certification.constraintModelSnapshotHash === current.currentConstraintModelSnapshotHash
    && certification.reviewSetSchemaVersion === current.reviewSetSchemaVersion
    && certification.reviewSetFingerprint === current.reviewSetFingerprint
    && current.currentConstraintModelVersion != null
    && Boolean(current.currentConstraintModelSnapshotHash)
    && Boolean(current.reviewSetFingerprint);
}

function finalBlockers(input: ScheduleExportInput, complete: ReturnType<typeof scheduleCompleteness>, certCurrent: boolean) {
  const blockers: string[] = [];
  if (!input.currentSchedule) blockers.push("There is no current ScheduleVersion to export.");
  if (!complete.complete) {
    const count = complete.unscheduledSessionIds.length;
    blockers.push(`${count} session${count === 1 ? " is" : "s are"} still unplaced; the schedule is incomplete.`);
  }
  if (input.validation.hardViolations > 0) {
    blockers.push(`${input.validation.hardViolations} HARD conflict${input.validation.hardViolations === 1 ? " remains" : "s remain"} in the current schedule.`);
  } else if (!input.validation.valid) {
    blockers.push("The current schedule did not pass validation.");
  }
  if (!input.validation.fullyValidated) blockers.push("Complete HARD validation has not passed for the current schedule.");
  if (input.scheduleIsStale) blockers.push("The current schedule is stale against the latest planning context.");
  if (!input.state.readinessCertification?.certification) {
    blockers.push("A current planning certification is required before a reviewed final export.");
  } else if (!certCurrent) {
    blockers.push("The planning certification no longer matches the current Rulebook, model, review set, or Planning Dataset.");
  }
  if (!input.contextToken) blockers.push("The current scheduling context is not available; refresh before exporting a reviewed final artifact.");
  for (const issue of input.readiness.blockers) {
    if (!blockers.includes(issue.message)) blockers.push(issue.message);
  }
  return blockers;
}

function classNameFor(sessionId: string, sessions: Map<string, ClassSession>, classes: Map<string, ClassDefinition>) {
  const session = sessions.get(sessionId);
  return session ? classes.get(session.classId)?.name || session.classId : null;
}

function durationFor(assignment: Assignment, sessions: Map<string, ClassSession>, classes: Map<string, ClassDefinition>) {
  const session = sessions.get(assignment.sessionId);
  const klass = session ? classes.get(session.classId) : null;
  return session && klass ? session.durationMinutes ?? klass.durationMinutes : null;
}

function sortAssignments(assignments: Assignment[], roomOrder: Map<string, number>) {
  return [...assignments].sort((left, right) =>
    left.startTime.localeCompare(right.startTime)
    || (roomOrder.get(left.roomId) ?? Number.MAX_SAFE_INTEGER) - (roomOrder.get(right.roomId) ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id),
  );
}

export function scheduleExportRows(
  state: Pick<StudioState, "rooms" | "teachers" | "classes" | "sessions">,
  assignments: Assignment[],
): ScheduleExportRow[] {
  const sessions = new Map(state.sessions.map((session) => [session.id, session]));
  const classes = new Map(state.classes.map((klass) => [klass.id, klass]));
  const rooms = new Map(state.rooms.map((room) => [room.id, room]));
  const teachers = new Map(state.teachers.map((teacher) => [teacher.id, teacher]));
  const roomOrder = new Map(state.rooms.map((room, index) => [room.id, index]));
  const rows: ScheduleExportRow[] = [];

  for (const day of SCHEDULE_HORIZON) {
    for (const room of state.rooms) {
      const roomAssignments = sortAssignments(
        assignments.filter((assignment) => assignment.day === day && assignment.roomId === room.id),
        roomOrder,
      );
      if (!roomAssignments.length) {
        rows.push({ rowType: "EMPTY", day, roomId: room.id, roomName: room.name, sessionId: null, className: null, teacherName: null, startTime: null, endTime: null, durationMinutes: null, locked: false });
        continue;
      }
      for (const assignment of roomAssignments) {
        rows.push({
          rowType: "SESSION",
          day,
          roomId: assignment.roomId,
          roomName: rooms.get(assignment.roomId)?.name || assignment.roomId,
          sessionId: assignment.sessionId,
          className: classNameFor(assignment.sessionId, sessions, classes) || assignment.sessionId,
          teacherName: teachers.get(assignment.teacherId)?.name || assignment.teacherId,
          startTime: assignment.startTime,
          endTime: assignment.endTime,
          durationMinutes: durationFor(assignment, sessions, classes),
          locked: Boolean(assignment.locked || sessions.get(assignment.sessionId)?.locked),
        });
      }
    }
  }

  const assignedSessionIds = new Set(assignments.map((assignment) => assignment.sessionId));
  for (const session of state.sessions) {
    if (assignedSessionIds.has(session.id)) continue;
    rows.push({
      rowType: "UNSCHEDULED",
      day: null,
      roomId: null,
      roomName: "Unassigned",
      sessionId: session.id,
      className: classes.get(session.classId)?.name || session.classId,
      teacherName: null,
      startTime: null,
      endTime: null,
      durationMinutes: classes.get(session.classId) ? session.durationMinutes ?? classes.get(session.classId)!.durationMinutes : null,
      locked: Boolean(session.locked),
    });
  }
  return rows;
}

export function buildScheduleExportModel(input: ScheduleExportInput): ScheduleExportModel {
  const complete = scheduleCompleteness(input.state, input.assignments);
  const certCurrent = certificationIsCurrent(input);
  const blockers = finalBlockers(input, complete, certCurrent);
  const finalReady = Boolean(
    input.currentSchedule
    && complete.complete
    && input.validation.valid
    && input.validation.hardViolations === 0
    && input.validation.fullyValidated
    && input.readiness.ready
    && certCurrent
    && !input.scheduleIsStale,
  );
  const stale = input.scheduleIsStale || input.readiness.blockers.some((issue) => staleReadinessCodes.has(issue.code));

  return {
    status: finalReady ? "REVIEWED_FINAL" : stale ? "STALE" : "DRAFT",
    finalReady,
    finalBlockers: blockers,
    studioName: input.state.studioName,
    scheduleVersionId: input.currentSchedule?.id ?? null,
    scheduleVersion: input.currentSchedule?.version ?? 0,
    rulebookVersion: input.currentRulebookVersion,
    enforcementVersion: input.currentEnforcementVersion,
    planningDatasetVersion: input.currentPlanningDatasetVersion,
    days: SCHEDULE_HORIZON,
    rooms: input.state.rooms,
    teachers: input.state.teachers,
    classes: input.state.classes,
    sessions: input.state.sessions,
    assignments: input.assignments,
    rows: scheduleExportRows(input.state, input.assignments),
  };
}

function csvCell(value: string | number | null) {
  const text = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportScheduleCsv(model: ScheduleExportModel, view: ScheduleExportView, reviewedFinal = false) {
  if (reviewedFinal && !model.finalReady) throw new Error("Reviewed final export requires a current complete certification and legal schedule.");
  const status = reviewedFinal ? "REVIEWED_FINAL" : model.status;
  const header = ["export_status", "view", "horizon_day", "row_type", "session_id", "class", "teacher", "room", "start_time", "end_time", "duration_minutes", "lock_state", "student_roster"];
  const lines = [header, ...model.rows.map((row) => [
    status,
    view,
    row.day,
    row.rowType,
    row.sessionId,
    row.className,
    row.teacherName,
    row.roomName,
    row.startTime,
    row.endTime,
    row.durationMinutes,
    row.locked ? "LOCKED" : "UNLOCKED",
    "REDACTED (omitted by default)",
  ])];
  return `${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function scheduleExportStatusLabel(status: ScheduleExportStatus) {
  return status === "REVIEWED_FINAL" ? "REVIEWED FINAL" : status;
}

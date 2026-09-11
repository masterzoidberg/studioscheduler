import type { Assignment, ScheduleVersion, StudioState, ValidationResult } from "@/lib/domain";
import { sessionDurationMinutes } from "@/lib/schedule-builder";
import { validateSchedule } from "@/lib/validator";

export type ScheduleEditStatus = "VALID" | "INCOMPLETE" | "PREFERENCE_WARNING" | "LOCKED" | "REJECTED";

export interface ScheduleCompleteness {
  complete: boolean;
  unscheduledSessionIds: string[];
  duplicateSessionIds: string[];
  unknownAssignmentSessionIds: string[];
}

export interface ScheduleEditAssessment {
  status: ScheduleEditStatus;
  allowed: boolean;
  title: string;
  message: string;
  durationMinutes: number | null;
  hardViolations: number;
  preferenceWarnings: string[];
  completeness: ScheduleCompleteness;
  validation: ValidationResult;
}

export function sessionDurationForAssignment(state: StudioState, assignment: Assignment | null) {
  if (!assignment) return null;
  const session = state.sessions.find((item) => item.id === assignment.sessionId);
  const klass = session ? state.classes.find((item) => item.id === session.classId) : null;
  return session && klass ? sessionDurationMinutes(session, klass) : null;
}

export function scheduleCompleteness(state: StudioState, assignments: Assignment[]): ScheduleCompleteness {
  const activeSessionIds = new Set(state.sessions.map((session) => session.id));
  const counts = new Map<string, number>();
  const unknown = new Set<string>();
  for (const assignment of assignments) {
    if (!activeSessionIds.has(assignment.sessionId)) unknown.add(assignment.sessionId);
    counts.set(assignment.sessionId, (counts.get(assignment.sessionId) || 0) + 1);
  }
  const unscheduledSessionIds = state.sessions
    .filter((session) => (counts.get(session.id) || 0) === 0)
    .map((session) => session.id)
    .sort();
  const duplicateSessionIds = state.sessions
    .filter((session) => (counts.get(session.id) || 0) > 1)
    .map((session) => session.id)
    .sort();
  const unknownAssignmentSessionIds = [...unknown].sort();
  return {
    complete: unscheduledSessionIds.length === 0 && duplicateSessionIds.length === 0 && unknownAssignmentSessionIds.length === 0,
    unscheduledSessionIds,
    duplicateSessionIds,
    unknownAssignmentSessionIds,
  };
}

export function assessScheduleEdit(
  state: StudioState,
  assignments: Assignment[],
  options: { locked?: boolean; assignment?: Assignment | null; preferenceWarnings?: string[] } = {},
): ScheduleEditAssessment {
  const validation = validateSchedule(state, assignments);
  const completeness = scheduleCompleteness(state, assignments);
  const preferenceWarnings = options.preferenceWarnings
    ?? validation.violations.filter((item) => item.severity !== "HARD").map((item) => item.message);
  const durationMinutes = sessionDurationForAssignment(state, options.assignment || (assignments.length === 1 ? assignments[0] : null));

  if (options.locked) {
    return {
      status: "LOCKED",
      allowed: false,
      title: "This placement is locked",
      message: "Locked sessions stay in their current room, teacher, and time until an authorized lock action changes them.",
      durationMinutes,
      hardViolations: validation.hardViolations,
      preferenceWarnings,
      completeness,
      validation,
    };
  }

  if (!completeness.complete) {
    const missing = completeness.unscheduledSessionIds.length;
    const duplicate = completeness.duplicateSessionIds.length;
    const unknown = completeness.unknownAssignmentSessionIds.length;
    const details = [
      missing ? `${missing} session${missing === 1 ? "" : "s"} still need placement` : "",
      duplicate ? `${duplicate} duplicate session${duplicate === 1 ? "" : "s"}` : "",
      unknown ? `${unknown} assignment reference${unknown === 1 ? "" : "s"} are no longer active` : "",
    ].filter(Boolean).join("; ");
    return {
      status: "INCOMPLETE",
      allowed: validation.hardViolations === 0,
      title: validation.hardViolations ? "Draft is incomplete and needs correction" : "Draft is incomplete",
      message: validation.hardViolations
        ? `${details}. Resolve ${validation.hardViolations} HARD conflict${validation.hardViolations === 1 ? "" : "s"} before saving this draft.`
        : `${details}. You can keep this draft, but it is not ready to publish until every session has one placement.`,
      durationMinutes,
      hardViolations: validation.hardViolations,
      preferenceWarnings,
      completeness,
      validation,
    };
  }

  if (validation.hardViolations > 0) {
    return {
      status: "REJECTED",
      allowed: false,
      title: "Change rejected",
      message: `${validation.hardViolations} HARD conflict${validation.hardViolations === 1 ? "" : "s"} would remain or be introduced. Correct the placement before saving.`,
      durationMinutes,
      hardViolations: validation.hardViolations,
      preferenceWarnings,
      completeness,
      validation,
    };
  }

  if (preferenceWarnings.length > 0) {
    return {
      status: "PREFERENCE_WARNING",
      allowed: true,
      title: "Allowed with a preference warning",
      message: `${preferenceWarnings.length} preference${preferenceWarnings.length === 1 ? "" : "s"} is not met. You can still save this legal schedule.`,
      durationMinutes,
      hardViolations: validation.hardViolations,
      preferenceWarnings,
      completeness,
      validation,
    };
  }

  return {
    status: "VALID",
    allowed: true,
    title: "Change is valid",
    message: "No detected HARD conflicts would remain after this change.",
    durationMinutes,
    hardViolations: validation.hardViolations,
    preferenceWarnings,
    completeness,
    validation,
  };
}

export function scheduleVersionLabel(version: Pick<ScheduleVersion, "reason" | "isCurrent">, currentVersion: number, versionNumber?: number) {
  if (version.isCurrent || versionNumber === currentVersion) return "Current schedule";
  const reason = version.reason.trim().toLowerCase();
  if (reason.includes("undo") || reason.includes("restor")) return "Restored previous schedule";
  if (reason.includes("rebase") || reason.includes("revalidat")) return "Revalidated schedule";
  if (reason.includes("assign") || reason.includes("place")) return "Session placed";
  if (reason.includes("unassign") || reason.includes("unscheduled")) return "Session unassigned";
  return "Manual schedule change";
}

import type { Assignment, StudioState, ValidationResult, ValidationViolation } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { ConstraintEngineResult, ConstraintEngineViolation } from "@/lib/constraint-engine";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import { placementEndTime, sessionDurationMinutes } from "@/lib/schedule-builder";
import { validateSchedule } from "@/lib/validator";

export type ScheduleRecoveryOperation = "REBASE" | "UNDO";

export interface ScheduleRecoveryDraftStatus {
  mode: ScheduleRecoveryOperation;
  scheduleComplete: boolean;
  publishable: boolean;
  unscheduledSessionIds: string[];
  duplicateSessionIds: string[];
  unknownAssignmentSessionIds: string[];
  completenessObligationKeys: string[];
  retiredAssignmentIds: string[];
}

export interface ScheduleRecoveryDecision {
  accepted: boolean;
  candidateAssignments: Assignment[];
  irValidation: ConstraintEngineResult;
  legacyValidation: ValidationResult;
  draftStatus: ScheduleRecoveryDraftStatus;
  blocker: null | {
    code: string;
    message: string;
    ruleIds: string[];
    entityIds: string[];
  };
}

type ViolationIdentity = Pick<ValidationViolation, "constraintId" | "assignmentIds" | "affectedEntityIds">;

function violationKey(violation: ViolationIdentity) {
  return JSON.stringify([
    violation.constraintId,
    [...violation.assignmentIds].sort(),
    [...violation.affectedEntityIds].sort(),
  ]);
}

function legacyCompletenessRuleIds(state: StudioState) {
  const enforcement = state.enforcementVersions.find((version) => version.status === "CURRENT")
    ?? state.enforcementVersions[0]
    ?? null;
  return new Set(
    (enforcement?.snapshot || [])
      .filter((mapping) => mapping.type === "CLASS_FREQUENCY")
      .map((mapping) => mapping.ruleId),
  );
}

function isIrCompletenessObligation(violation: ConstraintEngineViolation, model: ConstraintModelSnapshotV1) {
  const node = model.hardConstraints.find((candidate) => candidate.id === violation.constraintId);
  return violation.assignmentIds.length === 0 && Boolean(node);
}

function minutes(value: string) {
  const [hours = "0", mins = "0"] = value.slice(0, 5).split(":");
  return Number(hours) * 60 + Number(mins);
}

function samePlacement(left: Assignment, right: Assignment) {
  return left.day === right.day
    && left.startTime === right.startTime
    && left.teacherId === right.teacherId
    && left.roomId === right.roomId;
}

function completeness(
  state: StudioState,
  assignments: Assignment[],
  completenessObligationKeys: string[],
  retiredAssignmentIds: string[],
  mode: ScheduleRecoveryOperation,
  irValidation: ConstraintEngineResult,
  legacyValidation: ValidationResult,
): ScheduleRecoveryDraftStatus {
  const activeSessionIds = new Set(state.sessions.map((session) => session.id));
  const counts = new Map<string, number>();
  const unknownAssignmentSessionIds = new Set<string>();
  for (const assignment of assignments) {
    if (!activeSessionIds.has(assignment.sessionId)) unknownAssignmentSessionIds.add(assignment.sessionId);
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
  const scheduleComplete = unscheduledSessionIds.length === 0
    && duplicateSessionIds.length === 0
    && unknownAssignmentSessionIds.size === 0
    && completenessObligationKeys.length === 0;
  return {
    mode,
    scheduleComplete,
    publishable: scheduleComplete && irValidation.valid && legacyValidation.valid && legacyValidation.fullyValidated,
    unscheduledSessionIds,
    duplicateSessionIds,
    unknownAssignmentSessionIds: [...unknownAssignmentSessionIds].sort(),
    completenessObligationKeys,
    retiredAssignmentIds: [...new Set(retiredAssignmentIds)].sort(),
  };
}

function rejected(
  code: string,
  message: string,
  ruleIds: string[],
  entityIds: string[],
) {
  return { code, message, ruleIds, entityIds };
}

/**
 * T12 recovery treats historical placements as input, never as authority.
 * The source rows are normalized against the current immutable Planning
 * Dataset and then evaluated by the current complete Constraint IR plus
 * the retained legacy safety floor. Historical rows themselves are never
 * modified.
 */
export function evaluateAuthoritativeScheduleRecovery(
  state: StudioState,
  sourceAssignments: Assignment[],
  operation: ScheduleRecoveryOperation,
  model: ConstraintModelSnapshotV1,
): ScheduleRecoveryDecision {
  const current = state.scheduleVersions.find((version) => version.isCurrent);
  if (!current) throw new Error("No current ScheduleVersion exists.");

  const sessionById = new Map(state.sessions.map((session) => [session.id, session]));
  const classById = new Map(state.classes.map((klass) => [klass.id, klass]));
  const teacherIds = new Set(state.teachers.map((teacher) => teacher.id));
  const roomIds = new Set(state.rooms.map((room) => room.id));
  const candidateAssignments: Assignment[] = [];
  const retiredAssignmentIds: string[] = [];
  let structuralBlocker: ScheduleRecoveryDecision["blocker"] = null;

  const seenAssignmentIds = new Set<string>();
  const seenSessionIds = new Set<string>();
  for (const source of sourceAssignments) {
    const session = sessionById.get(source.sessionId);
    const klass = session ? classById.get(session.classId) : null;
    if (!session || !klass) {
      retiredAssignmentIds.push(source.id);
      continue;
    }

    const resourceMissing = !teacherIds.has(source.teacherId) || !roomIds.has(source.roomId);
    if (resourceMissing) {
      if (operation === "REBASE") {
        retiredAssignmentIds.push(source.id);
        continue;
      }
      structuralBlocker ??= rejected(
        "RECOVERY_SOURCE_RESOURCE_INACTIVE",
        `Undo cannot restore assignment ${source.id} because its teacher or room is no longer active.`,
        [],
        [source.id, source.teacherId, source.roomId],
      );
      continue;
    }

    if (seenAssignmentIds.has(source.id)) {
      structuralBlocker ??= rejected(
        "RECOVERY_SOURCE_DUPLICATE_ASSIGNMENT",
        `Recovery source contains duplicate assignment id ${source.id}.`,
        [],
        [source.id],
      );
      continue;
    }
    if (seenSessionIds.has(source.sessionId)) {
      structuralBlocker ??= rejected(
        "RECOVERY_SOURCE_DUPLICATE_SESSION",
        `Recovery source contains more than one assignment for session ${source.sessionId}.`,
        [],
        [source.sessionId],
      );
      continue;
    }
    seenAssignmentIds.add(source.id);
    seenSessionIds.add(source.sessionId);

    const duration = sessionDurationMinutes(session, klass);
    const start = minutes(source.startTime);
    const end = start + duration;
    if (!Number.isFinite(start) || start < 0 || start >= 24 * 60 || end <= start || end >= 24 * 60) {
      structuralBlocker ??= rejected(
        "RECOVERY_INTERVAL_INVALID",
        `Recovery source assignment ${source.id} cannot be normalized to a same-day canonical interval.`,
        [],
        [source.id, source.sessionId],
      );
      continue;
    }

    candidateAssignments.push({
      ...source,
      endTime: placementEndTime(source.startTime, duration),
      status: source.status || "NORMAL",
    });
  }

  const currentBySession = new Map(current.assignments.map((assignment) => [assignment.sessionId, assignment]));
  const candidateBySession = new Map(candidateAssignments.map((assignment) => [assignment.sessionId, assignment]));
  for (const session of state.sessions) {
    const currentAssignment = currentBySession.get(session.id);
    if (!session.locked && !currentAssignment?.locked) continue;
    if (!currentAssignment) {
      structuralBlocker ??= rejected(
        "LOCKED_SESSION_PLACEMENT_UNRESOLVED",
        `Locked session ${session.id} has no current assignment to preserve during recovery.`,
        [],
        [session.id],
      );
      continue;
    }
    const candidate = candidateBySession.get(session.id);
    if (!candidate || !samePlacement(currentAssignment, candidate)) {
      structuralBlocker ??= rejected(
        "LOCKED_SESSION_PLACEMENT_CHANGED",
        `Recovery would change or remove the effective locked placement for session ${session.id}.`,
        [],
        [session.id, currentAssignment.id],
      );
    }
  }

  const legacyValidation = validateSchedule(state, candidateAssignments);
  const irValidation = validateConstraintModelSchedule(state, model, candidateAssignments);
  const legacyCompleteness = legacyCompletenessRuleIds(state);
  const legacyBlocking = legacyValidation.violations.filter(
    (violation) => violation.severity === "HARD" && !legacyCompleteness.has(violation.constraintId),
  );
  const irBlocking = irValidation.violations.filter((violation) => !isIrCompletenessObligation(violation, model));
  const completenessObligationKeys = [...new Set([
    ...legacyValidation.violations
      .filter((violation) => violation.severity === "HARD" && legacyCompleteness.has(violation.constraintId))
      .map(violationKey),
    ...irValidation.violations.filter((violation) => isIrCompletenessObligation(violation, model)).map(violationKey),
  ])].sort();
  const draftStatus = completeness(
    state,
    candidateAssignments,
    completenessObligationKeys,
    retiredAssignmentIds,
    operation,
    irValidation,
    legacyValidation,
  );

  if (structuralBlocker) {
    return { accepted: false, candidateAssignments, irValidation, legacyValidation, draftStatus, blocker: structuralBlocker };
  }
  if (irValidation.unsupportedConstraintIds.length) {
    return {
      accepted: false,
      candidateAssignments,
      irValidation,
      legacyValidation,
      draftStatus,
      blocker: rejected(
        "RECOVERY_IR_UNSUPPORTED",
        `Recovery failed closed because ${irValidation.unsupportedConstraintIds.length} authoritative HARD constraint node(s) are unsupported.`,
        [],
        irValidation.unsupportedConstraintIds,
      ),
    };
  }
  if (irBlocking.length) {
    const first = irBlocking[0];
    return {
      accepted: false,
      candidateAssignments,
      irValidation,
      legacyValidation,
      draftStatus,
      blocker: rejected(
        "RECOVERY_CURRENT_POLICY_REJECTED",
        first.message || "The source placements are incompatible with the current authoritative Constraint IR.",
        first.ruleIds,
        first.affectedEntityIds,
      ),
    };
  }
  if (legacyBlocking.length) {
    const first = legacyBlocking[0];
    return {
      accepted: false,
      candidateAssignments,
      irValidation,
      legacyValidation,
      draftStatus,
      blocker: rejected(
        "RECOVERY_LEGACY_SAFETY_REJECTED",
        first.message || "The source placements violate the retained production safety floor.",
        first.constraintId === "SYSTEM" ? [] : [first.constraintId],
        first.affectedEntityIds,
      ),
    };
  }

  return { accepted: true, candidateAssignments, irValidation, legacyValidation, draftStatus, blocker: null };
}

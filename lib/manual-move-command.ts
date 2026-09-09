import type { Assignment, SchedulePatch, StudioState } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compareConstraintGatesForCommand, type ConstraintGateComparison } from "@/lib/constraint-gate-equivalence";

export interface ManualMoveDraftStatus {
  mode: "NORMAL" | "REPAIR";
  scheduleComplete: boolean;
  publishable: boolean;
  unscheduledSessionIds: string[];
  duplicateSessionIds: string[];
  unknownAssignmentSessionIds: string[];
  completenessObligationKeys: string[];
}

export interface ManualMoveDecision {
  accepted: boolean;
  comparison: ConstraintGateComparison;
  draftStatus: ManualMoveDraftStatus;
  blocker: null | {
    code: string;
    message: string;
    ruleIds: string[];
    entityIds: string[];
  };
}

function canonicalCompleteness(
  state: StudioState,
  assignments: Assignment[],
  completenessObligationKeys: string[],
) {
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
  return {
    scheduleComplete: unscheduledSessionIds.length === 0
      && duplicateSessionIds.length === 0
      && unknownAssignmentSessionIds.size === 0
      && completenessObligationKeys.length === 0,
    unscheduledSessionIds,
    duplicateSessionIds,
    unknownAssignmentSessionIds: [...unknownAssignmentSessionIds].sort(),
    completenessObligationKeys,
  };
}

function firstIrMessage(comparison: ConstraintGateComparison, operation: SchedulePatch["operation"]) {
  return comparison.constraintIr.after.violations
    .find((violation) => comparison.constraintIr.newBlockingViolationKeys.includes(JSON.stringify([
      violation.constraintId,
      [...violation.assignmentIds].sort(),
      [...violation.affectedEntityIds].sort(),
    ])))?.message
    || `The proposed ${operation} is illegal under the authoritative Constraint IR.`;
}

function blockerPrefix(operation: SchedulePatch["operation"]) {
  return operation === "MOVE" ? "MANUAL_MOVE" : "INCREMENTAL_COMMAND";
}

/**
 * Shared canonical schedule-command decision for MOVE / ASSIGN / UNASSIGN.
 *
 * Placement legality and draft completeness are deliberately separate. A legal
 * incremental command may leave required sessions or sequencing counterparts
 * unplaced, but it may not introduce a new HARD placement violation.
 */
export function evaluateAuthoritativeScheduleCommand(
  state: StudioState,
  patch: SchedulePatch,
  model: ConstraintModelSnapshotV1,
): ManualMoveDecision {
  const current = state.scheduleVersions.find((version) => version.isCurrent);
  if (!current) throw new Error("No current ScheduleVersion exists.");

  const comparison = compareConstraintGatesForCommand(state, current.assignments, patch, model);
  const completenessObligationKeys = [...new Set([
    ...comparison.constraintIr.completenessObligationKeys,
    ...comparison.legacy.completenessObligationKeys,
  ])].sort();
  const completeness = canonicalCompleteness(state, comparison.candidate.assignments, completenessObligationKeys);
  const mode: ManualMoveDraftStatus["mode"] = (
    comparison.constraintIr.beforeBlockingHardViolations > 0 || comparison.legacy.beforeBlockingHardViolations > 0
  ) ? "REPAIR" : "NORMAL";
  const draftStatus: ManualMoveDraftStatus = {
    mode,
    ...completeness,
    publishable: completeness.scheduleComplete
      && comparison.constraintIr.after.valid
      && comparison.legacy.after.valid
      && comparison.legacy.after.fullyValidated,
  };

  const unsupported = [...new Set([
    ...comparison.constraintIr.before.unsupportedConstraintIds,
    ...comparison.constraintIr.after.unsupportedConstraintIds,
  ])].sort();
  if (unsupported.length) {
    return {
      accepted: false,
      comparison,
      draftStatus,
      blocker: {
        code: `${blockerPrefix(patch.operation)}_IR_UNSUPPORTED`,
        message: `${patch.operation} failed closed because ${unsupported.length} authoritative HARD constraint node(s) are unsupported by the IR evaluator.`,
        ruleIds: [],
        entityIds: unsupported,
      },
    };
  }

  if (!comparison.constraintIr.accepts) {
    const violation = comparison.constraintIr.after.violations[0];
    return {
      accepted: false,
      comparison,
      draftStatus,
      blocker: {
        code: `${blockerPrefix(patch.operation)}_IR_REJECTED`,
        message: firstIrMessage(comparison, patch.operation),
        ruleIds: violation?.ruleIds || [],
        entityIds: violation?.affectedEntityIds || [comparison.candidate.sessionId],
      },
    };
  }

  if (!comparison.legacy.accepts || !comparison.preservesLegacySafety) {
    return {
      accepted: false,
      comparison,
      draftStatus,
      blocker: {
        code: `${blockerPrefix(patch.operation)}_LEGACY_SAFETY_REJECTED`,
        message: comparison.legacy.after.violations.find((item) => item.severity === "HARD")?.message
          || "The proposed command does not preserve the existing production safety floor.",
        ruleIds: comparison.legacyHardRuleIdsMissingFromIr,
        entityIds: [comparison.candidate.sessionId],
      },
    };
  }

  return { accepted: true, comparison, draftStatus, blocker: null };
}

/** Backward-compatible T10 entry point. */
export function evaluateAuthoritativeManualMove(
  state: StudioState,
  patch: SchedulePatch,
  model: ConstraintModelSnapshotV1,
): ManualMoveDecision {
  if (patch.operation !== "MOVE") throw new Error("Authoritative manual move evaluation accepts MOVE only.");
  return evaluateAuthoritativeScheduleCommand(state, patch, model);
}

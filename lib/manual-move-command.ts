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

function canonicalCompleteness(state: StudioState, assignments: Assignment[]) {
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
      && unknownAssignmentSessionIds.size === 0,
    unscheduledSessionIds,
    duplicateSessionIds,
    unknownAssignmentSessionIds: [...unknownAssignmentSessionIds].sort(),
  };
}

function firstIrMessage(comparison: ConstraintGateComparison) {
  return comparison.constraintIr.after.violations[0]?.message
    || "The proposed move is illegal under the authoritative Constraint IR.";
}

/**
 * Authoritative manual MOVE decision.
 *
 * The IR is the new placement authority. The legacy validator remains a temporary
 * safety floor until T13 closes superseded write paths, so IR may be stricter but
 * this boundary never permits a move the current legacy gate would reject.
 *
 * Completeness is deliberately orthogonal to MOVE legality: a partially built
 * schedule may be repaired/moved, but it is never reported as publishable.
 */
export function evaluateAuthoritativeManualMove(
  state: StudioState,
  patch: SchedulePatch,
  model: ConstraintModelSnapshotV1,
): ManualMoveDecision {
  if (patch.operation !== "MOVE") throw new Error("Authoritative manual move evaluation accepts MOVE only.");
  const current = state.scheduleVersions.find((version) => version.isCurrent);
  if (!current) throw new Error("No current ScheduleVersion exists.");

  const comparison = compareConstraintGatesForCommand(state, current.assignments, patch, model);
  const completeness = canonicalCompleteness(state, comparison.candidate.assignments);
  const mode: ManualMoveDraftStatus["mode"] = (
    comparison.constraintIr.beforeHardViolations > 0 || comparison.legacy.beforeHardViolations > 0
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
        code: "MANUAL_MOVE_IR_UNSUPPORTED",
        message: `Manual MOVE failed closed because ${unsupported.length} authoritative HARD constraint node(s) are unsupported by the IR evaluator.`,
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
        code: "MANUAL_MOVE_IR_REJECTED",
        message: firstIrMessage(comparison),
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
        code: "MANUAL_MOVE_LEGACY_SAFETY_REJECTED",
        message: comparison.legacy.after.violations.find((item) => item.severity === "HARD")?.message
          || "The proposed move does not preserve the existing production safety floor.",
        ruleIds: comparison.legacyHardRuleIdsMissingFromIr,
        entityIds: [comparison.candidate.sessionId],
      },
    };
  }

  return { accepted: true, comparison, draftStatus, blocker: null };
}

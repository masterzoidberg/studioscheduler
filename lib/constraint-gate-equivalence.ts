import type { Assignment, SchedulePatch, StudioState, ValidationResult, ValidationViolation } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import type { ConstraintEngineResult, ConstraintEngineViolation } from "@/lib/constraint-engine";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import { buildScheduleCommandCandidate, type ScheduleCommandCandidate } from "@/lib/schedule-command-candidate";
import { validateSchedule } from "@/lib/validator";

export interface GateDecision<T> {
  before: T;
  after: T;
  accepts: boolean;
  beforeHardViolations: number;
  afterHardViolations: number;
  beforeBlockingHardViolations: number;
  afterBlockingHardViolations: number;
  newBlockingViolationKeys: string[];
  completenessObligationKeys: string[];
}

export interface ConstraintGateComparison {
  candidate: ScheduleCommandCandidate;
  legacy: GateDecision<ValidationResult>;
  constraintIr: GateDecision<ConstraintEngineResult>;
  /**
   * False means promoting the IR gate would permit a command that today's legacy
   * production gate rejects. That is a release blocker. The reverse disagreement
   * is expected while the IR covers more of the Rulebook.
   */
  preservesLegacySafety: boolean;
  legacyHardRuleIdsMissingFromIr: string[];
  disagreement: "NONE" | "IR_STRICTER" | "IR_LOOSER";
}

type ViolationIdentity = Pick<ValidationViolation, "constraintId" | "assignmentIds" | "affectedEntityIds">;

function violationKey(violation: ViolationIdentity) {
  return JSON.stringify([
    violation.constraintId,
    [...violation.assignmentIds].sort(),
    [...violation.affectedEntityIds].sort(),
  ]);
}

function currentLegacyCompletenessRuleIds(state: StudioState) {
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
  return violation.assignmentIds.length === 0
    && Boolean(node && ["FIXED_ASSIGNMENT", "DIRECTLY_AFTER"].includes(node.kind));
}

function legacyHardViolations(result: ValidationResult) {
  return result.violations.filter((violation) => violation.severity === "HARD");
}

function legacyBlockingViolations(state: StudioState, result: ValidationResult) {
  const completenessRuleIds = currentLegacyCompletenessRuleIds(state);
  return legacyHardViolations(result).filter((violation) => !completenessRuleIds.has(violation.constraintId));
}

function irBlockingViolations(result: ConstraintEngineResult, model: ConstraintModelSnapshotV1) {
  return result.violations.filter((violation) => !isIrCompletenessObligation(violation, model));
}

function newViolationKeys<T extends ViolationIdentity>(before: T[], after: T[]) {
  const beforeKeys = new Set(before.map(violationKey));
  return [...new Set(after.map(violationKey).filter((key) => !beforeKeys.has(key)))].sort();
}

function commandAccepted(
  operation: SchedulePatch["operation"],
  beforeBlocking: number,
  afterBlocking: number,
  newBlocking: string[],
) {
  // A command may never trade one violation for a different violation. That was
  // the aggregate-count hole T11 closes.
  if (newBlocking.length) return false;
  if (operation === "MOVE" && beforeBlocking > 0 && afterBlocking >= beforeBlocking) return false;
  return true;
}

function legacyRuleIds(violations: ValidationViolation[]) {
  return new Set(
    violations
      .filter((violation) => violation.constraintId !== "SYSTEM")
      .map((violation) => violation.constraintId),
  );
}

function irRuleIds(violations: ConstraintEngineViolation[]) {
  return new Set(violations.flatMap((violation) => violation.ruleIds));
}

/**
 * Shadow comparison for the migration from the partial SQL/legacy validator to
 * the complete Constraint IR runtime.
 *
 * T11 distinguishes placement legality from completeness. CLASS_FREQUENCY and
 * missing FIXED_ASSIGNMENT/DIRECTLY_AFTER counterparts remain visible findings,
 * but do not prevent legal incremental construction. All other HARD findings are
 * compared by stable violation identity, never only by aggregate count.
 */
export function compareConstraintGatesForCommand(
  state: StudioState,
  assignments: Assignment[],
  patch: SchedulePatch,
  model: ConstraintModelSnapshotV1 = compileConstraintModel(state),
): ConstraintGateComparison {
  const candidate = buildScheduleCommandCandidate(state, assignments, patch);

  const legacyBefore = validateSchedule(state, assignments);
  const legacyAfter = validateSchedule(state, candidate.assignments);
  const irBefore = validateConstraintModelSchedule(state, model, assignments);
  const irAfter = validateConstraintModelSchedule(state, model, candidate.assignments);

  const legacyBeforeBlocking = legacyBlockingViolations(state, legacyBefore);
  const legacyAfterBlocking = legacyBlockingViolations(state, legacyAfter);
  const irBeforeBlocking = irBlockingViolations(irBefore, model);
  const irAfterBlocking = irBlockingViolations(irAfter, model);
  const legacyNewBlocking = newViolationKeys(legacyBeforeBlocking, legacyAfterBlocking);
  const irNewBlocking = newViolationKeys(irBeforeBlocking, irAfterBlocking);
  const legacyAccepts = commandAccepted(patch.operation, legacyBeforeBlocking.length, legacyAfterBlocking.length, legacyNewBlocking);
  const irAccepts = commandAccepted(patch.operation, irBeforeBlocking.length, irAfterBlocking.length, irNewBlocking);

  const legacyRules = legacyRuleIds(legacyAfterBlocking);
  const irRules = irRuleIds(irAfterBlocking);
  const legacyHardRuleIdsMissingFromIr = [...legacyRules].filter((ruleId) => !irRules.has(ruleId)).sort();
  const preservesLegacySafety = !(irAccepts && !legacyAccepts) && legacyHardRuleIdsMissingFromIr.length === 0;

  const legacyCompleteness = legacyHardViolations(legacyAfter)
    .filter((violation) => currentLegacyCompletenessRuleIds(state).has(violation.constraintId))
    .map(violationKey)
    .sort();
  const irCompleteness = irAfter.violations.filter((violation) => isIrCompletenessObligation(violation, model)).map(violationKey).sort();

  return {
    candidate,
    legacy: {
      before: legacyBefore,
      after: legacyAfter,
      accepts: legacyAccepts,
      beforeHardViolations: legacyBefore.hardViolations,
      afterHardViolations: legacyAfter.hardViolations,
      beforeBlockingHardViolations: legacyBeforeBlocking.length,
      afterBlockingHardViolations: legacyAfterBlocking.length,
      newBlockingViolationKeys: legacyNewBlocking,
      completenessObligationKeys: legacyCompleteness,
    },
    constraintIr: {
      before: irBefore,
      after: irAfter,
      accepts: irAccepts,
      beforeHardViolations: irBefore.hardViolations,
      afterHardViolations: irAfter.hardViolations,
      beforeBlockingHardViolations: irBeforeBlocking.length,
      afterBlockingHardViolations: irAfterBlocking.length,
      newBlockingViolationKeys: irNewBlocking,
      completenessObligationKeys: irCompleteness,
    },
    preservesLegacySafety,
    legacyHardRuleIdsMissingFromIr,
    disagreement: legacyAccepts === irAccepts ? "NONE" : irAccepts ? "IR_LOOSER" : "IR_STRICTER",
  };
}

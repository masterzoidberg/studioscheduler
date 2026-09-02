import type { Assignment, SchedulePatch, StudioState, ValidationResult } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { validateConstraintModelSchedule, type ConstraintEngineResult } from "@/lib/constraint-engine-v2";
import { buildScheduleCommandCandidate, type ScheduleCommandCandidate } from "@/lib/schedule-command-candidate";
import { validateSchedule } from "@/lib/validator";

export interface GateDecision<T> {
  before: T;
  after: T;
  accepts: boolean;
  beforeHardViolations: number;
  afterHardViolations: number;
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

function commandAccepted(operation: SchedulePatch["operation"], beforeHard: number, afterHard: number) {
  if (operation === "MOVE") {
    if (afterHard > 0 && beforeHard === 0) return false;
    if (beforeHard > 0 && afterHard >= beforeHard) return false;
    return true;
  }
  return afterHard <= beforeHard;
}

function legacyRuleIds(result: ValidationResult) {
  return new Set(
    result.violations
      .filter((violation) => violation.severity === "HARD" && violation.constraintId !== "SYSTEM")
      .map((violation) => violation.constraintId),
  );
}

function irRuleIds(result: ConstraintEngineResult) {
  return new Set(result.violations.flatMap((violation) => violation.ruleIds));
}

/**
 * Shadow comparison for the migration from the partial SQL/legacy validator to
 * the complete Constraint IR runtime.
 *
 * Promotion rule: IR may be stricter, but it may not become looser than the
 * production gate we are replacing. This lets expanded Rulebook coverage land
 * safely without requiring the two engines to produce identical finding counts.
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

  const legacyAccepts = commandAccepted(patch.operation, legacyBefore.hardViolations, legacyAfter.hardViolations);
  const irAccepts = commandAccepted(patch.operation, irBefore.hardViolations, irAfter.hardViolations);
  const legacyRules = legacyRuleIds(legacyAfter);
  const irRules = irRuleIds(irAfter);
  const legacyHardRuleIdsMissingFromIr = [...legacyRules].filter((ruleId) => !irRules.has(ruleId)).sort();
  const preservesLegacySafety = !(irAccepts && !legacyAccepts) && legacyHardRuleIdsMissingFromIr.length === 0;

  return {
    candidate,
    legacy: {
      before: legacyBefore,
      after: legacyAfter,
      accepts: legacyAccepts,
      beforeHardViolations: legacyBefore.hardViolations,
      afterHardViolations: legacyAfter.hardViolations,
    },
    constraintIr: {
      before: irBefore,
      after: irAfter,
      accepts: irAccepts,
      beforeHardViolations: irBefore.hardViolations,
      afterHardViolations: irAfter.hardViolations,
    },
    preservesLegacySafety,
    legacyHardRuleIdsMissingFromIr,
    disagreement: legacyAccepts === irAccepts ? "NONE" : irAccepts ? "IR_LOOSER" : "IR_STRICTER",
  };
}

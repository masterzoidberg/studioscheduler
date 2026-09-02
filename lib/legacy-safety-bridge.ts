import type { EnforcementRuleType, RuleEnforcementMapping, StudioState } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { currentEnforcementVersion } from "@/lib/validator";

export type LegacySafetyLayer = "CANDIDATE_BUILDER" | "CONSTRAINT_IR" | "UNACCOUNTED";

export interface LegacySafetyBridgeEntry {
  ruleId: string;
  mappingType: EnforcementRuleType;
  covered: boolean;
  layer: LegacySafetyLayer;
  detail: string;
}

export interface LegacySafetyBridgeReport {
  enforcementVersion: number | null;
  mappingCount: number;
  coveredCount: number;
  complete: boolean;
  entries: LegacySafetyBridgeEntry[];
  uncoveredRuleIds: string[];
}

function structuralBridge(mapping: RuleEnforcementMapping): LegacySafetyBridgeEntry | null {
  // Schedule-command candidate construction always recomputes endTime from the
  // canonical ClassSession/ClassDefinition duration. A browser-supplied end time
  // never controls the candidate, matching the v25 database command boundary.
  if (mapping.type === "CLASS_DURATION") {
    return {
      ruleId: mapping.ruleId,
      mappingType: mapping.type,
      covered: true,
      layer: "CANDIDATE_BUILDER",
      detail: "Canonical command construction derives end time from the effective session duration before validation.",
    };
  }
  return null;
}

/**
 * Accounts for every safety check in the legacy production EnforcementVersion
 * before that validator can be retired.
 *
 * This is intentionally directional. Old protections must have an explicit home
 * in the new architecture. A rule can move into the pure candidate builder when
 * it is structural, otherwise its Rule ID must be represented by Constraint IR.
 */
export function legacySafetyBridgeReport(
  state: StudioState,
  model: ConstraintModelSnapshotV1,
): LegacySafetyBridgeReport {
  const enforcement = currentEnforcementVersion(state);
  const mappings = enforcement?.snapshot ?? [];
  const irRuleIds = new Set(model.hardConstraints.flatMap((constraint) => constraint.ruleIds));

  const entries = mappings.map((mapping): LegacySafetyBridgeEntry => {
    const structural = structuralBridge(mapping);
    if (structural) return structural;
    if (irRuleIds.has(mapping.ruleId)) {
      return {
        ruleId: mapping.ruleId,
        mappingType: mapping.type,
        covered: true,
        layer: "CONSTRAINT_IR",
        detail: `Legacy ${mapping.type} protection is represented by a typed Constraint IR node carrying ${mapping.ruleId}.`,
      };
    }
    return {
      ruleId: mapping.ruleId,
      mappingType: mapping.type,
      covered: false,
      layer: "UNACCOUNTED",
      detail: `Legacy ${mapping.type} protection has no explicit bridge into the current candidate builder or Constraint IR.`,
    };
  });

  const uncoveredRuleIds = entries.filter((entry) => !entry.covered).map((entry) => entry.ruleId).sort();
  return {
    enforcementVersion: enforcement?.version ?? null,
    mappingCount: entries.length,
    coveredCount: entries.length - uncoveredRuleIds.length,
    complete: uncoveredRuleIds.length === 0,
    entries,
    uncoveredRuleIds,
  };
}

import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";

export interface ConstraintModelDefinitionV1 {
  schemaVersion: "1.0";
  compilerVersion: string;
  rulebookVersion: number;
  activeRuleCount: number;
  hardConstraints: ConstraintModelSnapshotV1["hardConstraints"];
  objectivePrioritySpine: ConstraintModelSnapshotV1["objectivePrioritySpine"];
  readinessRuleIds: string[];
  governanceAssertions: ConstraintModelSnapshotV1["governanceAssertions"];
  uncompiledConstraintRuleIds: string[];
  completeHardConstraintCompilation: boolean;
}

export interface ConstraintModelVersion {
  id: string;
  version: number;
  rulebookVersion: number;
  compilerVersion: string;
  createdAt: string;
  actor: string;
  reason: string;
  snapshot: ConstraintModelDefinitionV1;
  snapshotHash: string;
  completeHardConstraintCompilation: boolean;
  status: "CURRENT" | "HISTORICAL";
}

// Planning data is deliberately excluded here. ConstraintModelVersion represents
// the meaning of the Rulebook. PlanningDatasetVersion independently represents
// the mutable facts to which those constraints are applied.
export function constraintModelDefinition(model: ConstraintModelSnapshotV1): ConstraintModelDefinitionV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: model.compilerVersion,
    rulebookVersion: model.rulebookVersion,
    activeRuleCount: model.activeRuleCount,
    hardConstraints: model.hardConstraints,
    objectivePrioritySpine: model.objectivePrioritySpine,
    readinessRuleIds: model.readinessRuleIds,
    governanceAssertions: model.governanceAssertions,
    uncompiledConstraintRuleIds: model.uncompiledConstraintRuleIds,
    completeHardConstraintCompilation: model.completeHardConstraintCompilation,
  };
}

export function canonicalConstraintModelJson(model: ConstraintModelDefinitionV1) {
  return JSON.stringify(model);
}

export function constraintModelDefinitionsMatch(a: ConstraintModelDefinitionV1, b: ConstraintModelDefinitionV1) {
  return canonicalConstraintModelJson(a) === canonicalConstraintModelJson(b);
}

import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import {
  canonicalConstraintModelJson,
  constraintModelDefinition,
  constraintModelDefinitionsMatch,
} from "@/lib/constraint-model-version";

function compiled(planningDatasetVersion: number): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "dwde-ir-0.3",
    rulebookVersion: 3,
    planningDatasetVersion,
    activeRuleCount: 178,
    hardConstraints: [{
      id: "room-no-overlap",
      kind: "RESOURCE_NO_OVERLAP",
      ruleIds: ["OPS-008"],
      selector: {},
      parameters: { resource: "ROOM" },
      explanation: "A studio room may not host two classes at the same time.",
    }],
    objectivePrioritySpine: [],
    readinessRuleIds: ["CUR-001"],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

describe("ConstraintModelVersion semantic snapshot", () => {
  it("excludes PlanningDatasetVersion from the published model definition", () => {
    const definition = constraintModelDefinition(compiled(3));
    expect(definition).not.toHaveProperty("planningDatasetVersion");
    expect(definition).toMatchObject({
      schemaVersion: "1.0",
      compilerVersion: "dwde-ir-0.3",
      rulebookVersion: 3,
      activeRuleCount: 178,
      completeHardConstraintCompilation: true,
    });
  });

  it("is identical for the same Rulebook semantics compiled against different planning data", () => {
    const a = constraintModelDefinition(compiled(3));
    const b = constraintModelDefinition(compiled(99));
    expect(constraintModelDefinitionsMatch(a, b)).toBe(true);
    expect(canonicalConstraintModelJson(a)).toBe(canonicalConstraintModelJson(b));
  });

  it("changes when Rulebook semantics change", () => {
    const a = constraintModelDefinition(compiled(3));
    const changed = compiled(3);
    changed.hardConstraints[0].parameters = { resource: "ROOM", hypotheticalChange: true };
    const b = constraintModelDefinition(changed);
    expect(constraintModelDefinitionsMatch(a, b)).toBe(false);
  });
});

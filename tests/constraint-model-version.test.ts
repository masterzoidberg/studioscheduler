import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import {
  canonicalConstraintModelJson,
  constraintModelDefinition,
  constraintModelDefinitionsMatch,
} from "@/lib/constraint-model-version";
import type { ConstraintModelDefinitionV1 } from "@/lib/constraint-model-version";

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
      ruleIds: ["OPS-008", "OPS-009"],
      selector: { subjects: ["Ballet"], teacherNames: ["Teacher"] },
      parameters: { resource: "ROOM", nested: { z: 1, a: 2 } },
      explanation: "A studio room may not host two classes at the same time.",
    }],
    objectivePrioritySpine: [],
    readinessRuleIds: ["CUR-001"],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function recursivelyReordered<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => recursivelyReordered(item)) as T;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, recursivelyReordered(child)] as const);
    return Object.fromEntries(entries) as T;
  }
  return value;
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

  it("ignores recursively reordered object keys in selectors and parameters", () => {
    const a = constraintModelDefinition(compiled(3));
    const b = recursivelyReordered(a);

    expect(canonicalConstraintModelJson(a)).toBe(canonicalConstraintModelJson(b));
    expect(constraintModelDefinitionsMatch(a, b)).toBe(true);
  });

  it("preserves ordered arrays while canonicalizing their object elements", () => {
    const a = constraintModelDefinition(compiled(3));
    const reorderedArray = constraintModelDefinition(compiled(3));
    reorderedArray.hardConstraints[0].ruleIds = ["OPS-009", "OPS-008"];

    expect(constraintModelDefinitionsMatch(a, reorderedArray)).toBe(false);
  });

  it("does not change the historical semantic definition shape", () => {
    const definition: ConstraintModelDefinitionV1 = constraintModelDefinition(compiled(3));

    expect(Object.keys(definition)).toEqual([
      "schemaVersion",
      "compilerVersion",
      "rulebookVersion",
      "activeRuleCount",
      "hardConstraints",
      "objectivePrioritySpine",
      "readinessRuleIds",
      "governanceAssertions",
      "uncompiledConstraintRuleIds",
      "completeHardConstraintCompilation",
    ]);
  });
});

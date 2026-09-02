import { describe, expect, it } from "vitest";
import type { RuleEnforcementMapping, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { legacySafetyBridgeReport } from "@/lib/legacy-safety-bridge";

const mapping = (ruleId: string, type: RuleEnforcementMapping["type"]): RuleEnforcementMapping => ({
  ruleId,
  type,
  parameters: {},
  affectedEntityIds: [],
  exceptions: [],
});

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [], rooms: [], students: [], cohorts: [], classes: [], sessions: [], rules: [],
    rulebookVersions: [],
    enforcementVersions: [{
      id: "legacy",
      version: 2,
      rulebookVersion: 3,
      createdAt: "2026-09-02T00:00:00Z",
      actor: "test",
      reason: "production compatibility set",
      changedRuleIds: [],
      snapshot: [
        mapping("CUR-005", "CLASS_DURATION"),
        mapping("OPS-008", "ROOM_NO_OVERLAP"),
        mapping("OPS-009", "TEACHER_NO_OVERLAP"),
        mapping("OPS-010", "STUDENT_NO_OVERLAP"),
        mapping("OPS-017", "TIME_GRID"),
      ],
      status: "CURRENT",
    }],
    planningDatasetVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [],
  };
}

const node = (ruleId: string, kind: ConstraintIRNode["kind"]): ConstraintIRNode => ({
  id: `node-${ruleId.toLowerCase()}`,
  kind,
  ruleIds: [ruleId],
  selector: {},
  parameters: kind === "RESOURCE_NO_OVERLAP" ? { resource: "ROOM" } : kind === "TIME_GRID" ? { minutes: 15 } : {},
  explanation: ruleId,
});

function model(omitRuleId?: string): ConstraintModelSnapshotV1 {
  const nodes = [
    node("OPS-008", "RESOURCE_NO_OVERLAP"),
    { ...node("OPS-009", "RESOURCE_NO_OVERLAP"), parameters: { resource: "TEACHER" } },
    { ...node("OPS-010", "RESOURCE_NO_OVERLAP"), parameters: { resource: "STUDENT_ROSTER" } },
    node("OPS-017", "TIME_GRID"),
  ].filter((item) => !omitRuleId || !item.ruleIds.includes(omitRuleId));
  return {
    schemaVersion: "1.0",
    compilerVersion: "bridge-test",
    rulebookVersion: 3,
    planningDatasetVersion: 1,
    activeRuleCount: 178,
    hardConstraints: nodes,
    objectivePrioritySpine: [],
    readinessRuleIds: ["CUR-005"],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

describe("legacy production safety bridge", () => {
  it("accounts for the current five-map production compatibility set", () => {
    const report = legacySafetyBridgeReport(state(), model());
    expect(report.enforcementVersion).toBe(2);
    expect(report.mappingCount).toBe(5);
    expect(report.coveredCount).toBe(5);
    expect(report.complete).toBe(true);
    expect(report.uncoveredRuleIds).toEqual([]);
    expect(report.entries.find((entry) => entry.ruleId === "CUR-005")).toMatchObject({ layer: "CANDIDATE_BUILDER", covered: true });
    expect(report.entries.find((entry) => entry.ruleId === "OPS-008")).toMatchObject({ layer: "CONSTRAINT_IR", covered: true });
  });

  it("fails closed when a legacy protection disappears from the IR", () => {
    const report = legacySafetyBridgeReport(state(), model("OPS-009"));
    expect(report.complete).toBe(false);
    expect(report.uncoveredRuleIds).toEqual(["OPS-009"]);
    expect(report.entries.find((entry) => entry.ruleId === "OPS-009")).toMatchObject({ layer: "UNACCOUNTED", covered: false });
  });
});

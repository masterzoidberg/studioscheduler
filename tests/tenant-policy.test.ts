import { describe, expect, it } from "vitest";
import type { ConstraintIRNode } from "@/lib/constraint-ir";
import type { RulebookVersion, StudioRule } from "@/lib/domain";
import {
  buildTenantPolicyManifest,
  parseTenantPolicyManifest,
  tenantRulebookConversionSummary,
} from "@/lib/tenant-policy";
import { ruleExecutionCoverage } from "@/lib/rule-execution-registry";

function rule(id: string, parameters: Record<string, unknown> = {}): StudioRule {
  return {
    id, category: "TEST", type: null, title: id, description: `${id} policy`, strength: "HARD",
    classificationRaw: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED", reviewStatus: "VERIFIED",
    review: { decision: "APPROVED", verified: true }, affectedEntityIds: [], parameters, exceptions: [],
    source: { type: "IMPORT" }, sourceRaw: { sourceRuleId: id }, versionIntroduced: 1, updatedAt: "2026-09-11T00:00:00Z",
  };
}

const rulebook: RulebookVersion = {
  id: "rulebook-tenant", version: 8, name: "Tenant Rulebook", createdAt: "2026-09-11", actor: "test",
  reason: "conversion", changedRuleIds: [], rulebookId: "tenant-rulebook", status: "CURRENT", sourceHash: "a".repeat(64),
};

const constraint: ConstraintIRNode = {
  id: "tenant-required-room", kind: "REQUIRED_ROOM", ruleIds: ["TENANT-001"], selector: { classIds: ["class-1"], roomIds: ["room-1"] },
  parameters: { roomId: "room-1" }, explanation: "Tenant required room",
};

function converted() {
  const rules = [rule("TENANT-001"), rule("TENANT-002")];
  const precondition = {
    schemaVersion: "1.0" as const, id: "tenant-class-structure", kind: "CLASS_STRUCTURE" as const,
    ruleIds: ["TENANT-002"], classId: "class-1", expectedFrequency: 1, expectedDurations: [60],
  };
  const manifest = buildTenantPolicyManifest({
    rulebook, rules,
    entries: [
      { ruleId: "TENANT-001", disposition: "HARD_CONSTRAINT", family: "ROOM_POLICY", runtimeLayer: "CONSTRAINT_IR", rationale: "Room legality" },
      { ruleId: "TENANT-002", disposition: "HARD_DATA_PRECONDITION", family: "CLASS_STRUCTURE", runtimeLayer: "READY_GATE", rationale: "Class structure" },
    ],
    constraints: [constraint], preconditions: [precondition], readinessRuleIds: ["TENANT-002"],
  });
  const current = { ...rulebook, sourceMetadata: { tenantPolicyManifest: manifest } };
  return { rules, manifest, current };
}

describe("tenant Rulebook policy conversion", () => {
  it("accounts for every active rule with immutable provenance and typed preconditions", () => {
    const value = converted();
    expect(parseTenantPolicyManifest(value.current, value.rules)).toMatchObject({ status: "VALID" });
    expect(ruleExecutionCoverage(value.rules, value.manifest)).toMatchObject({ activeRules: 2, accountedRules: 2, complete: true });
    expect(tenantRulebookConversionSummary(value.manifest)).toMatchObject({ activeRuleCount: 2, accountedRuleCount: 2, typedPreconditionCount: 1 });
  });

  it("rejects lost rule accounting, provenance drift, and hard rules without typed meaning", () => {
    const value = converted();
    const missingRecord = structuredClone(value.manifest);
    missingRecord.records = missingRecord.records.slice(0, 1);
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: missingRecord } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_RECORD_ACCOUNTING_INCOMPLETE" });

    const drifted = structuredClone(value.manifest);
    drifted.records[0].provenance.sourceRulebookVersion = 7;
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: drifted } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_RECORD_INVALID" });

    const unowned = structuredClone(value.manifest);
    unowned.records[0].constraintIds = [];
    expect(parseTenantPolicyManifest({ ...value.current, sourceMetadata: { tenantPolicyManifest: unowned } }, value.rules)).toMatchObject({ status: "INVALID", code: "TENANT_POLICY_HARD_RULE_UNACCOUNTED" });
  });

  it("does not use the legacy fixed registry for a converted tenant rule set", () => {
    const value = converted();
    expect(ruleExecutionCoverage(value.rules, value.manifest).unknownRuleIds).toEqual([]);
    expect(ruleExecutionCoverage(value.rules).complete).toBe(false);
  });
});

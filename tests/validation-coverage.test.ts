import { describe, expect, it } from "vitest";
import type { StudioRule, StudioState } from "@/lib/domain";
import { validateSchedule } from "@/lib/validator";

const now = "2026-08-31T00:00:00Z";

function hardRule(id: string, enforcementStatus: StudioRule["enforcementStatus"]): StudioRule {
  return {
    id,
    category: "Test",
    type: null,
    title: id,
    description: id,
    strength: "HARD",
    classificationRaw: "HARD",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    reviewStatus: "VERIFIED",
    review: { decision: "APPROVED", verified: true },
    affectedEntityIds: [],
    parameters: {},
    exceptions: [],
    source: { type: "IMPORT" },
    sourceRaw: { type: "DWDE_RULEBOOK_REVIEW" },
    enforcementStatus,
    versionIntroduced: 2,
    updatedAt: now,
  };
}

function state(rules: StudioRule[]): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [], rooms: [], students: [], cohorts: [], classes: [], sessions: [], rules,
    rulebookVersions: [{ id: "rb2", version: 2, name: "Rulebook V2", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT", documentType: "DWDE_SITE_RULEBOOK" }],
    ruleHistory: [],
    scheduleVersions: [{ id: "sv2", version: 2, rulebookVersion: 2, createdAt: now, actor: "test", reason: "test", assignments: [], isCurrent: true }],
    scenarios: [], auditEvents: [],
  };
}

describe("deterministic validator coverage semantics", () => {
  it("does not confuse zero detected violations with full HARD validation", () => {
    const result = validateSchedule(state([hardRule("TST-001", "IMPLEMENTED"), hardRule("TST-002", "NOT_IMPLEMENTED")]));
    expect(result.valid).toBe(true);
    expect(result.hardViolations).toBe(0);
    expect(result.fullyValidated).toBe(false);
    expect(result.coverage).toMatchObject({ applicableHardRules: 2, implementedHardRules: 1, notImplementedHardRules: 1 });
    expect(result.coverage.uncoveredHardRuleIds).toEqual(["TST-002"]);
  });

  it("counts PARTIAL rules as uncovered", () => {
    const result = validateSchedule(state([hardRule("TST-003", "PARTIAL")]));
    expect(result.valid).toBe(true);
    expect(result.fullyValidated).toBe(false);
    expect(result.coverage.partialHardRules).toBe(1);
    expect(result.coverage.uncoveredHardRuleIds).toEqual(["TST-003"]);
  });

  it("can be fully validated only when every applicable HARD rule is implemented and no HARD violation is detected", () => {
    const result = validateSchedule(state([hardRule("TST-004", "IMPLEMENTED")]));
    expect(result.valid).toBe(true);
    expect(result.fullyValidated).toBe(true);
    expect(result.coverage.uncoveredHardRuleIds).toEqual([]);
  });
});

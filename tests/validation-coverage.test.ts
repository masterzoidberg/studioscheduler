import { describe, expect, it } from "vitest";
import type { RuleEnforcementMapping, StudioRule, StudioState } from "@/lib/domain";
import { validateSchedule } from "@/lib/validator";

const now = "2026-08-31T00:00:00Z";

function hardRule(id: string): StudioRule {
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
    enforcementStatus: "NOT_IMPLEMENTED",
    versionIntroduced: 2,
    updatedAt: now,
  };
}

function state(rules: StudioRule[], mappings: RuleEnforcementMapping[]): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [], rooms: [], students: [], cohorts: [], classes: [], sessions: [], rules,
    rulebookVersions: [{ id: "rb2", version: 2, name: "Rulebook V2", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT", documentType: "DWDE_SITE_RULEBOOK" }],
    enforcementVersions: [{ id: "ev1", version: 1, rulebookVersion: 2, createdAt: now, actor: "test", reason: "test", changedRuleIds: mappings.map((mapping) => mapping.ruleId), snapshot: mappings, status: "CURRENT" }],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [{ id: "sv2", version: 2, rulebookVersion: 2, enforcementVersion: 1, createdAt: now, actor: "test", reason: "test", assignments: [], isCurrent: true }],
    scenarios: [], auditEvents: [],
  };
}

const map = (ruleId: string): RuleEnforcementMapping => ({ ruleId, type: "TIME_GRID", parameters: {}, affectedEntityIds: [], exceptions: [] });

describe("deterministic validator coverage semantics", () => {
  it("does not confuse zero detected violations with full HARD validation", () => {
    const result = validateSchedule(state([hardRule("TST-001"), hardRule("TST-002")], [map("TST-001")]));
    expect(result.valid).toBe(true);
    expect(result.hardViolations).toBe(0);
    expect(result.fullyValidated).toBe(false);
    expect(result.coverage).toMatchObject({ applicableHardRules: 2, implementedHardRules: 1, notImplementedHardRules: 1 });
    expect(result.coverage.uncoveredHardRuleIds).toEqual(["TST-002"]);
    expect(result.enforcementVersion).toBe(1);
  });

  it("treats a proposal as non-enforcing until it enters the current EnforcementVersion snapshot", () => {
    const s = state([hardRule("TST-003")], []);
    s.enforcementProposals.push({
      id: "proposal", ruleId: "TST-003", baseRulebookVersion: 2, baseEnforcementVersion: 1,
      proposedMapping: map("TST-003"), rationale: "test", proposalSource: "SYSTEM", status: "PROPOSED",
      createdAt: now, updatedAt: now,
    });
    const result = validateSchedule(s);
    expect(result.coverage.implementedHardRules).toBe(0);
    expect(result.coverage.uncoveredHardRuleIds).toEqual(["TST-003"]);
  });

  it("can be fully validated only when every applicable HARD rule has an approved mapping and no HARD violation is detected", () => {
    const result = validateSchedule(state([hardRule("TST-004")], [map("TST-004")]));
    expect(result.valid).toBe(true);
    expect(result.fullyValidated).toBe(true);
    expect(result.coverage.uncoveredHardRuleIds).toEqual([]);
  });
});

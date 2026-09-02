import { describe, expect, it } from "vitest";
import type { StudioRule } from "@/lib/domain";
import {
  RULE_EXECUTION_REGISTRY,
  executionDispositionForRule,
  ruleExecutionCoverage,
} from "@/lib/rule-execution-registry";

const prefixCounts: Record<string, number> = {
  ADV: 4,
  AIM: 9,
  BAL: 14,
  CAM: 19,
  CUR: 9,
  DATA: 8,
  DEN: 5,
  FIX: 4,
  FRI: 3,
  JAE: 3,
  JAL: 3,
  KAR: 14,
  KHY: 3,
  MEL: 3,
  OPS: 17,
  OPT: 9,
  REV: 2,
  ROOM: 14,
  SEQ: 9,
  STU: 22,
  SYD: 4,
};

const expectedRuleIds = Object.entries(prefixCounts)
  .flatMap(([prefix, count]) => Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`))
  .sort();

function rule(id: string): StudioRule {
  return {
    id,
    category: "test",
    type: null,
    title: id,
    description: id,
    strength: null,
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
    versionIntroduced: 2,
    updatedAt: "2026-08-31T03:51:26.980Z",
  };
}

describe("178-rule execution registry", () => {
  it("accounts for the exact canonical Rulebook ID set once each", () => {
    const actual = RULE_EXECUTION_REGISTRY.map((entry) => entry.ruleId).sort();
    expect(actual).toHaveLength(178);
    expect(new Set(actual).size).toBe(178);
    expect(actual).toEqual(expectedRuleIds);
  });

  it("reports complete coverage only for the exact active Rulebook set", () => {
    const complete = ruleExecutionCoverage(expectedRuleIds.map(rule));
    expect(complete).toMatchObject({ activeRules: 178, accountedRules: 178, complete: true });
    expect(complete.missingRuleIds).toEqual([]);
    expect(complete.unknownRuleIds).toEqual([]);

    const missing = ruleExecutionCoverage(expectedRuleIds.slice(1).map(rule));
    expect(missing.complete).toBe(false);
    expect(missing.unknownRuleIds).toEqual(["ADV-001"]);
  });

  it("does not turn reviewed absence statements into invented constraints", () => {
    expect(executionDispositionForRule("STU-001")).toBe("NO_RUNTIME_EFFECT");
    expect(executionDispositionForRule("STU-004")).toBe("NO_RUNTIME_EFFECT");
    expect(executionDispositionForRule("CUR-007")).toBe("NO_RUNTIME_EFFECT");
    expect(executionDispositionForRule("STU-020")).toBe("NO_RUNTIME_EFFECT");
    expect(executionDispositionForRule("STU-021")).toBe("NO_RUNTIME_EFFECT");
  });

  it("keeps the Ballet 2 Friday exception in the soft objective layer", () => {
    expect(executionDispositionForRule("FRI-001")).toBe("SOFT_OBJECTIVE");
    expect(executionDispositionForRule("FRI-002")).toBe("SOFT_OBJECTIVE");
    expect(executionDispositionForRule("FRI-003")).toBe("HARD_CONSTRAINT");
  });

  it("resolves the five raw NEEDS REVIEW labels from their approved semantics", () => {
    expect(executionDispositionForRule("ADV-004")).toBe("EXCEPTION");
    expect(executionDispositionForRule("AIM-009")).toBe("SOFT_OBJECTIVE");
    expect(executionDispositionForRule("REV-001")).toBe("HARD_DATA_PRECONDITION");
    expect(executionDispositionForRule("REV-002")).toBe("INFORMATIONAL");
    expect(executionDispositionForRule("SEQ-004")).toBe("EXCEPTION");
  });
});

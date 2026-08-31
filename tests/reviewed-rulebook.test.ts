import { describe, expect, it } from "vitest";
import type { ReviewedRuleRecord, ReviewedRulebookPackage, StudioRule } from "@/lib/domain";
import {
  DWDE_REVIEWED_V2_RULES_SHA256,
  diffReviewedRules,
  normalizeReviewedClassification,
  reviewedRuleToStudioShape,
  validateReviewedRulebook,
} from "@/lib/reviewed-rulebook";

const reviewedAt = "2026-08-31T03:51:26.980Z";

function makeRule(index: number): ReviewedRuleRecord {
  const edited = index <= 16;
  return {
    id: `TST-${String(index).padStart(3, "0")}`,
    category: "Test",
    classification: index === 178 ? "PRIORITY 1" : "HARD",
    title: `Rule ${index}`,
    text: `Reviewed rule ${index}`,
    status: "ACTIVE",
    review_status: "VERIFIED",
    review: edited
      ? { decision: "EDIT", verified: true, reviewed_at: reviewedAt, original_text: `Original ${index}`, correction_raw: `Correction ${index}` }
      : { decision: "APPROVED", verified: true, reviewed_at: reviewedAt },
    source: { type: "DWDE_RULEBOOK_REVIEW", source_rulebook_version: "draft-review", source_rule_id: `TST-${String(index).padStart(3, "0")}` },
  };
}

function packageV2(): ReviewedRulebookPackage {
  return {
    format_version: "2.0",
    document_type: "DWDE_SITE_RULEBOOK",
    rulebook: {
      id: "dwde-2026-2027-master-rulebook",
      name: "DWDE 2026-2027 Master Rulebook",
      version: 2,
      status: "REVIEWED",
      total_rules: 178,
      reviewed_rules: 178,
      approved_without_edit: 162,
      edited_and_approved: 16,
      rules_sha256: DWDE_REVIEWED_V2_RULES_SHA256,
    },
    rules: Array.from({ length: 178 }, (_, index) => makeRule(index + 1)),
  };
}

function studioRule(sourceType: StudioRule["source"]["type"]): StudioRule {
  return {
    id: "TST-001",
    category: "Test",
    type: null,
    title: "Local edit",
    description: "Locally changed wording",
    strength: "HARD",
    classificationRaw: "HARD",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    reviewStatus: "VERIFIED",
    review: { decision: "EDIT", verified: true },
    affectedEntityIds: [],
    parameters: {},
    exceptions: [],
    source: { type: sourceType },
    sourceRaw: { type: "DWDE_RULEBOOK_REVIEW" },
    enforcementStatus: "NOT_IMPLEMENTED",
    versionIntroduced: 2,
    updatedAt: reviewedAt,
  };
}

describe("reviewed Rulebook V2 contract", () => {
  it("pins the authoritative reviewed rules fingerprint", () => {
    expect(DWDE_REVIEWED_V2_RULES_SHA256).toBe("5ef0a282e68b199fae94976335ede2484e80a966b2b5d2c3fa71355a26d5866b");
    const result = validateReviewedRulebook(packageV2());
    expect(result.valid).toBe(true);
    expect(result.summary).toMatchObject({ rules: 178, reviewed: 178, approved: 162, edited: 16 });
    expect(result.warnings.some((warning) => warning.path === "rules.classification")).toBe(true);
  });

  it("rejects a different V2 rules fingerprint even when it is valid SHA-256 text", () => {
    const pkg = packageV2();
    pkg.rulebook.rules_sha256 = "0".repeat(64);
    const result = validateReviewedRulebook(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path === "rulebook.rules_sha256" && error.message.includes("authoritative"))).toBe(true);
  });

  it("requires edit lineage for all edited reviewed rules", () => {
    const pkg = packageV2();
    delete pkg.rules[0].review.original_text;
    const result = validateReviewedRulebook(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path.endsWith("review.original_text"))).toBe(true);
  });

  it("preserves reviewed classification vocabulary without inventing a legacy strength", () => {
    const incoming = makeRule(178);
    expect(normalizeReviewedClassification(incoming.classification)).toBeNull();
    expect(reviewedRuleToStudioShape(incoming)).toMatchObject({ classificationRaw: "PRIORITY 1", strength: null });
  });

  it("treats post-import human and approved-AI edits as conflicts rather than silently overwriting them", () => {
    const incoming = makeRule(1);
    expect(diffReviewedRules([studioRule("USER_EDIT")], [incoming]).conflicts).toEqual(["TST-001"]);
    expect(diffReviewedRules([studioRule("AI_PROPOSAL_APPROVED")], [incoming]).conflicts).toEqual(["TST-001"]);
  });
});

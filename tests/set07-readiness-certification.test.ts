import { describe, expect, it } from "vitest";
import type { ReadinessCertificationState } from "@/lib/domain";
import {
  readinessCertificationIssues,
  readinessGate,
  reviewFindingIsResolved,
} from "@/lib/readiness-certification";

function context(overrides: Partial<ReadinessCertificationState> = {}): ReadinessCertificationState {
  return {
    schemaVersion: 1,
    reviewSetSchemaVersion: 1,
    reviewSetFingerprint: "a".repeat(64),
    currentRulebookVersion: 7,
    currentPlanningDatasetVersion: 4,
    currentPlanningSnapshotHash: "b".repeat(64),
    currentConstraintModelVersion: 8,
    currentConstraintModelSnapshotHash: "c".repeat(64),
    currentConstraintModelCompilerVersion: "dwde-ir-0.7",
    reviewFindings: [],
    certification: {
      planningDatasetVersion: 4,
      planningSnapshotHash: "b".repeat(64),
      rulebookVersion: 7,
      constraintModelVersion: 8,
      constraintModelSnapshotHash: "c".repeat(64),
      reviewSetSchemaVersion: 1,
      reviewSetFingerprint: "a".repeat(64),
      confirmedAt: "2026-09-10T12:00:00Z",
      confirmedByLabel: "Manager",
    },
    ...overrides,
  };
}

describe("SET-07 readiness certification", () => {
  it("blocks certification, solve, adoption, and final export for an unresolved MUST review", () => {
    const issues = readinessCertificationIssues(context({
      reviewFindings: [{
        code: "READINESS_REVIEW_REQUIRED",
        scopeKind: "ROOM",
        entityId: "room-a",
        aspect: "capacity",
        state: "NEEDS_REVIEW",
        classification: "MUST",
        message: "Room capacity needs review.",
        ruleIds: ["ROOM-001"],
        entityIds: ["room-a"],
        currentFingerprint: "d".repeat(64),
      }],
    }));
    expect(issues[0]).toMatchObject({ code: "READINESS_REVIEW_REQUIRED", severity: "BLOCKER" });
    expect(readinessGate(issues, "AUTOMATIC_SOLVE").ready).toBe(false);
    expect(readinessGate(issues, "CANDIDATE_ADOPTION").ready).toBe(false);
    expect(readinessGate(issues, "FINAL_EXPORT").ready).toBe(false);
  });

  it("keeps an unresolved PREFER finding as a warning", () => {
    const issues = readinessCertificationIssues(context({
      reviewFindings: [{
        code: "READINESS_PREFERENCE_REVIEW",
        scopeKind: "RULE",
        entityId: "PREF-001",
        aspect: "interpretation",
        state: "NEEDS_REVIEW",
        classification: "PREFER",
        message: "Optional preference needs review.",
        ruleIds: ["PREF-001"],
        entityIds: [],
        currentFingerprint: "d".repeat(64),
      }],
    }));
    expect(issues[0]).toMatchObject({ severity: "WARNING", classification: "PREFER" });
    expect(readinessGate(issues, "AUTOMATIC_SOLVE").ready).toBe(true);
  });

  it("invalidates the aggregate certification when the review set changes", () => {
    const issues = readinessCertificationIssues(context({ reviewSetFingerprint: "d".repeat(64) }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "PLANNING_CERTIFICATION_STALE" }));
  });

  it("treats a partial legal draft as a separate resolved review concern", () => {
    expect(reviewFindingIsResolved({
      code: "READINESS_REVIEW_REQUIRED",
      scopeKind: "CLASS",
      entityId: "class-a",
      aspect: "structure",
      state: "REVIEWED",
      classification: "MUST",
      message: "Reviewed class structure.",
      ruleIds: [],
      entityIds: [],
      currentFingerprint: "a".repeat(64),
    })).toBe(true);
  });
});

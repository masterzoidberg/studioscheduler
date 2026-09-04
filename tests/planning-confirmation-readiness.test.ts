import { describe, expect, it } from "vitest";
import type { ScheduleReadinessReport } from "@/lib/schedule-readiness";
import { planningConfirmationBlockers } from "@/lib/planning-confirmation-readiness";

function report(codes: string[]): ScheduleReadinessReport {
  return {
    ready: codes.length === 0,
    blockers: codes.map((code) => ({ code, severity: "BLOCKER" as const, message: code, ruleIds: [], entityIds: [] })),
    warnings: [],
    ruleCoverage: { activeRules: 178, accountedRules: 178, missingRuleIds: [], unknownRuleIds: [], complete: true },
    constraintBinding: { valid: true, issues: [] },
    currentPlanningDatasetVersion: 4,
    schedulePlanningDatasetVersion: 1,
    sourceManifestVersion: null,
    sourceManifestComplete: false,
    planningDatasetConfirmed: false,
  } as ScheduleReadinessReport;
}

describe("planning dataset confirmation policy", () => {
  it("ignores only blockers resolved by confirmation or a future replacement solve", () => {
    expect(planningConfirmationBlockers(report([
      "PLANNING_DATASET_NOT_CONFIRMED",
      "SCHEDULE_PLANNING_DATASET_STALE",
    ]))).toEqual([]);
  });

  it("refuses confirmation while deterministic planning facts are invalid or incomplete", () => {
    const blockers = planningConfirmationBlockers(report([
      "PLANNING_DATASET_NOT_CONFIRMED",
      "MISSING_REQUIRED_CLASS",
      "CLASS_FREQUENCY_MISMATCH",
      "CONSTRAINT_ENTITY_MISSING",
    ]));
    expect(blockers.map((issue) => issue.code)).toEqual([
      "MISSING_REQUIRED_CLASS",
      "CLASS_FREQUENCY_MISMATCH",
      "CONSTRAINT_ENTITY_MISSING",
    ]);
  });
});

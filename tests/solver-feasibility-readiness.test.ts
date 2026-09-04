import { describe, expect, it } from "vitest";
import type { ScheduleReadinessReport } from "@/lib/schedule-readiness";
import { feasibilityReadiness } from "@/lib/solver-problem";

function report(blockerCodes: string[]): ScheduleReadinessReport {
  return {
    ready: blockerCodes.length === 0,
    blockers: blockerCodes.map((code) => ({
      code,
      severity: "BLOCKER" as const,
      message: code,
      ruleIds: [],
      entityIds: [],
    })),
    warnings: [],
    ruleCoverage: {
      activeRules: 178,
      accountedRules: 178,
      missingRuleIds: [],
      unknownRuleIds: [],
      complete: true,
    },
    constraintBinding: { valid: true, issues: [] },
    currentPlanningDatasetVersion: 4,
    schedulePlanningDatasetVersion: 1,
    sourceManifestVersion: null,
    sourceManifestComplete: false,
    planningDatasetConfirmed: true,
  } as ScheduleReadinessReport;
}

describe("feasibility-specific readiness", () => {
  it("keeps stale schedule provenance visible but allows the replacement solve", () => {
    const normalized = feasibilityReadiness(report(["SCHEDULE_PLANNING_DATASET_STALE"]));
    expect(normalized.ready).toBe(true);
    expect(normalized.blockers).toEqual([]);
    expect(normalized.warnings).toContainEqual(expect.objectContaining({
      code: "SCHEDULE_PLANNING_DATASET_STALE",
      severity: "WARNING",
    }));
  });

  it("does not downgrade unrelated readiness blockers", () => {
    const normalized = feasibilityReadiness(report([
      "SCHEDULE_PLANNING_DATASET_STALE",
      "PLANNING_DATASET_NOT_CONFIRMED",
    ]));
    expect(normalized.ready).toBe(false);
    expect(normalized.blockers).toContainEqual(expect.objectContaining({ code: "PLANNING_DATASET_NOT_CONFIRMED" }));
    expect(normalized.blockers.some((issue) => issue.code === "SCHEDULE_PLANNING_DATASET_STALE")).toBe(false);
  });
});

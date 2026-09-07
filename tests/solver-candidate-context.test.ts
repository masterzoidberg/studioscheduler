import { describe, expect, it } from "vitest";
import type { SolverSnapshotContextToken } from "@/lib/server-studio-state";
import {
  parseReviewedSolverCandidateContext,
  reviewedSolverCandidateContextFromSnapshot,
  reviewedSolverCandidateContextsMatch,
} from "@/lib/solver-candidate-context";

function token(): SolverSnapshotContextToken {
  return {
    schemaVersion: "1.0",
    studioId: "studio",
    rulebookVersion: 3,
    rulebookId: "rb",
    rulebookSourceHash: "source",
    rulebookSnapshotHash: "rb-hash",
    rulesHash: "rules-hash",
    planningDatasetVersion: 7,
    planningDatasetId: "pd",
    planningSnapshotHash: "pd-hash",
    planningConfirmedForSchedulingAt: "2026-09-07T00:00:00Z",
    enforcementVersion: 4,
    enforcementId: "ev",
    constraintModelVersion: 5,
    constraintModelId: "cm",
    constraintModelSnapshotHash: "cm-hash",
    scheduleVersion: 12,
    scheduleId: "schedule-12",
    scheduleRulebookVersion: 3,
    scheduleEnforcementVersion: 4,
    schedulePlanningDatasetVersion: 7,
    scheduleConstraintModelVersion: 5,
    scheduleAssignmentsHash: "locks-and-assignments-hash",
  };
}

describe("reviewed solver candidate context", () => {
  it("binds the candidate to the exact coherent ScheduleVersion and schedule/lock fingerprint", () => {
    const context = reviewedSolverCandidateContextFromSnapshot(token(), "dwde-ir-v3");
    expect(context.schemaVersion).toBe("1.0");
    expect(context.compilerVersion).toBe("dwde-ir-v3");
    expect(context.solverContextToken.scheduleVersion).toBe(12);
    expect(context.solverContextToken.scheduleId).toBe("schedule-12");
    expect(context.solverContextToken.scheduleAssignmentsHash).toBe("locks-and-assignments-hash");
  });

  it("rejects missing base schedule/lock identity instead of accepting an older partial wire context", () => {
    const raw = {
      schemaVersion: "1.0",
      compilerVersion: "dwde-ir-v3",
      solverContextToken: { ...token(), scheduleAssignmentsHash: null },
    };
    expect(parseReviewedSolverCandidateContext(raw)).toBeNull();
  });

  it("detects lock-state and ScheduleVersion drift independently of Rulebook/Planning versions", () => {
    const reviewed = reviewedSolverCandidateContextFromSnapshot(token(), "dwde-ir-v3");
    const lockDrift = reviewedSolverCandidateContextFromSnapshot(
      { ...token(), scheduleAssignmentsHash: "changed-lock-hash" },
      "dwde-ir-v3",
    );
    const scheduleDrift = reviewedSolverCandidateContextFromSnapshot(
      { ...token(), scheduleVersion: 13, scheduleId: "schedule-13" },
      "dwde-ir-v3",
    );
    expect(reviewedSolverCandidateContextsMatch(reviewed, lockDrift)).toBe(false);
    expect(reviewedSolverCandidateContextsMatch(reviewed, scheduleDrift)).toBe(false);
    expect(reviewed.solverContextToken.rulebookVersion).toBe(lockDrift.solverContextToken.rulebookVersion);
    expect(reviewed.solverContextToken.planningDatasetVersion).toBe(lockDrift.solverContextToken.planningDatasetVersion);
  });
});

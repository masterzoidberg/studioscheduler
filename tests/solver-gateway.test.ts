import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { StudioState } from "@/lib/domain";
import { constraintModelDefinition } from "@/lib/constraint-model-version";
import type { FeasibilitySolverProblem } from "@/lib/solver-problem";
import {
  constraintModelSyncDecision,
  publishedConstraintModelBlockers,
  validateFeasibleSolverCandidate,
  type PublishedConstraintModelRecord,
  type SolverServicePayload,
} from "@/lib/solver-gateway";

const now = "2026-09-03T00:00:00Z";

function model(): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "dwde-ir-test",
    rulebookVersion: 3,
    planningDatasetVersion: 7,
    activeRuleCount: 178,
    hardConstraints: [
      {
        id: "teacher-domain",
        kind: "TEACHER_SUBJECT_DOMAIN",
        ruleIds: ["CUR-007"],
        selector: { teacherNames: ["Teacher"] },
        parameters: { allowedSubjects: ["Ballet"] },
        explanation: "qualification",
      },
      {
        id: "time-grid",
        kind: "TIME_GRID",
        ruleIds: ["OPS-017"],
        selector: {},
        parameters: { minutes: 15 },
        explanation: "grid",
      },
    ],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [{ id: "teacher", name: "Teacher", subjects: [] }],
    rooms: [{ id: "room", name: "Studio A", capacity: 20, features: [] }],
    students: [],
    cohorts: [],
    classes: [{
      id: "class",
      name: "Ballet 1",
      subject: "Ballet",
      level: "Level 1",
      durationMinutes: 60,
      weeklyFrequency: 1,
      rosterStudentIds: [],
      eligibleTeacherIds: [],
    }],
    sessions: [{ id: "session", classId: "class", ordinal: 1 }],
    rules: [],
    rulebookVersions: [{ id: "rb", version: 3, name: "v3", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [],
    planningDatasetVersions: [{
      id: "pdv", version: 7, createdAt: now, actor: "test", reason: "test", snapshotHash: "0".repeat(64), status: "CURRENT",
      confirmedForSchedulingAt: now,
      snapshot: { schemaVersion: "1.3", studioId: "studio", teacherIds: ["teacher"], rooms: [], students: [], cohorts: [], classes: [], sessions: [] },
    }],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
  };
}

function problem(): FeasibilitySolverProblem {
  const m = model();
  return {
    contractVersion: "1.0",
    context: { studioId: "studio", rulebookVersion: 3, planningDatasetVersion: 7, compilerVersion: "dwde-ir-test" },
    teachers: [{ id: "teacher", name: "Teacher" }],
    rooms: [{ id: "room", name: "Studio A", capacity: 20, features: [] }],
    students: [],
    classes: [{ id: "class", name: "Ballet 1", subject: "Ballet", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], companyOnly: false }],
    sessions: [{ id: "session", classId: "class", ordinal: 1, durationMinutes: null, locked: false }],
    constraintModel: m,
    preflight: { validatedDelegatedConstraintIds: [] },
  };
}

function published(): PublishedConstraintModelRecord {
  const p = problem();
  return {
    version: 4,
    rulebookVersion: p.context.rulebookVersion,
    compilerVersion: p.context.compilerVersion,
    complete: true,
    snapshot: constraintModelDefinition(p.constraintModel),
  };
}

function payload(overrides: Partial<SolverServicePayload> = {}): SolverServicePayload {
  const p = problem();
  return {
    serviceVersion: "1.0",
    context: { ...p.context },
    result: {
      status: "FEASIBLE",
      assignments: [{
        sessionId: "session",
        day: "Monday",
        startTime: "17:00",
        endTime: "18:00",
        teacherId: "teacher",
        roomId: "room",
      }],
      unsupportedConstraintIds: [],
      delegatedConstraintIds: [],
      missingPreconditionConstraintIds: [],
      blockingConstraintIds: [],
    },
    ...overrides,
  };
}

describe("published Constraint Model gateway", () => {
  it("requires the exact tested compiler definition", () => {
    expect(publishedConstraintModelBlockers(problem(), published())).toEqual([]);
    const stale = published();
    stale.snapshot = { ...stale.snapshot, compilerVersion: "other" };
    expect(publishedConstraintModelBlockers(problem(), stale).map((item) => item.code))
      .toContain("PUBLISHED_CONSTRAINT_SNAPSHOT_MISMATCH");
  });

  it("fails closed when no published model exists", () => {
    expect(publishedConstraintModelBlockers(problem(), null)[0].code).toBe("PUBLISHED_CONSTRAINT_MODEL_MISSING");
  });

  it("allows explicit solve preflight to publish a missing deterministic model", () => {
    expect(constraintModelSyncDecision(problem(), null).action).toBe("PUBLISH");
  });

  it("allows deterministic replacement of a plainly stale model identity", () => {
    const stale = published();
    stale.rulebookVersion = 2;
    stale.compilerVersion = "dwde-ir-old";
    expect(constraintModelSyncDecision(problem(), stale).action).toBe("PUBLISH");
  });

  it("allows deterministic replacement of an incomplete current model", () => {
    const incomplete = published();
    incomplete.complete = false;
    expect(constraintModelSyncDecision(problem(), incomplete).action).toBe("PUBLISH");
  });

  it("fails closed on same-identity snapshot drift instead of silently overwriting it", () => {
    const drifted = published();
    drifted.snapshot = { ...drifted.snapshot, activeRuleCount: 177 };
    expect(constraintModelSyncDecision(problem(), drifted).action).toBe("BLOCK");
  });

  it("does nothing when the published artifact exactly matches tested output", () => {
    expect(constraintModelSyncDecision(problem(), published()).action).toBe("CURRENT");
  });
});

describe("returned solver candidate boundary", () => {
  it("accepts an exact-session FEASIBLE candidate only after independent IR validation", () => {
    const result = validateFeasibleSolverCandidate(state(), problem(), payload());
    expect(result.ok).toBe(true);
    expect(result.validation?.valid).toBe(true);
    expect(result.assignments).toEqual([expect.objectContaining({ sessionId: "session", status: "AI_PROPOSED" })]);
  });

  it("rejects a candidate that does not assign every canonical session exactly once", () => {
    const response = payload({ result: { status: "FEASIBLE", assignments: [] } });
    const result = validateFeasibleSolverCandidate(state(), problem(), response);
    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("SOLVER_CANDIDATE_SESSION_SET_MISMATCH");
  });

  it("rejects context drift even when the assignment itself is feasible", () => {
    const response = payload({ context: { studioId: "studio", rulebookVersion: 3, planningDatasetVersion: 8, compilerVersion: "dwde-ir-test" } });
    const result = validateFeasibleSolverCandidate(state(), problem(), response);
    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("SOLVER_RESPONSE_CONTEXT_MISMATCH");
  });

  it("rejects a returned assignment that violates the shared Constraint IR", () => {
    const response = payload({
      result: {
        status: "FEASIBLE",
        assignments: [{ sessionId: "session", day: "Monday", startTime: "17:07", endTime: "18:07", teacherId: "teacher", roomId: "room" }],
      },
    });
    const result = validateFeasibleSolverCandidate(state(), problem(), response);
    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("SOLVER_CANDIDATE_HARD_VALIDATION_FAILED");
  });
});

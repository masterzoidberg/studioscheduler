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
  type SolverAssignmentCandidate,
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
    sessions: [{ id: "session", classId: "class", ordinal: 1, durationMinutes: null, locked: false, lockedPlacement: null }],
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

function payloadFor(p: FeasibilitySolverProblem, overrides: Partial<SolverServicePayload> = {}): SolverServicePayload {
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

function payload(overrides: Partial<SolverServicePayload> = {}): SolverServicePayload {
  return payloadFor(problem(), overrides);
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

  it("does nothing when JSONB read-back only reorders nested object keys", () => {
    const current = published();
    current.snapshot = {
      completeHardConstraintCompilation: true,
      uncompiledConstraintRuleIds: [],
      governanceAssertions: [],
      readinessRuleIds: [],
      objectivePrioritySpine: [],
      hardConstraints: [
        {
          explanation: "qualification",
          parameters: { allowedSubjects: ["Ballet"] },
          selector: { teacherNames: ["Teacher"] },
          ruleIds: ["CUR-007"],
          kind: "TEACHER_SUBJECT_DOMAIN",
          id: "teacher-domain",
        },
        {
          explanation: "grid",
          parameters: { minutes: 15 },
          selector: {},
          ruleIds: ["OPS-017"],
          kind: "TIME_GRID",
          id: "time-grid",
        },
      ],
      activeRuleCount: 178,
      compilerVersion: "dwde-ir-test",
      rulebookVersion: 3,
      schemaVersion: "1.0",
    };

    expect(constraintModelSyncDecision(problem(), current).action).toBe("CURRENT");
  });

  it("still blocks meaningful nested parameter drift after canonicalization", () => {
    const drifted = published();
    drifted.snapshot = {
      ...drifted.snapshot,
      hardConstraints: drifted.snapshot.hardConstraints.map((constraint, index) => index === 0
        ? { ...constraint, parameters: { ...constraint.parameters, allowedSubjects: ["Jazz"] } }
        : constraint),
    };

    expect(constraintModelSyncDecision(problem(), drifted).action).toBe("BLOCK");
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

  it("rejects malformed, nonfinite, cross-midnight, and extra-field assignments", () => {
    const cases = [
      { startTime: "17:0", endTime: "18:00" },
      { startTime: "NaN", endTime: "18:00" },
      { startTime: "23:30", endTime: "01:00" },
      { startTime: "17:00", endTime: "18:00", extra: "not-canonical" },
    ];

    for (const changes of cases) {
      const response = payload({
        result: {
          status: "FEASIBLE",
          assignments: [{
            sessionId: "session",
            day: "Monday",
            teacherId: "teacher",
            roomId: "room",
            ...changes,
          } as unknown as SolverAssignmentCandidate],
        },
      });
      const result = validateFeasibleSolverCandidate(state(), problem(), response);

      expect(result.ok).toBe(false);
      expect(result.blockers.map((item) => item.code)).toContain("SOLVER_CANDIDATE_ASSIGNMENT_SHAPE_INVALID");
    }
  });

  it("rejects an unknown teacher before independent legality evaluation", () => {
    const response = payload({
      result: {
        status: "FEASIBLE",
        assignments: [{
          sessionId: "session",
          day: "Monday",
          startTime: "17:00",
          endTime: "18:00",
          teacherId: "missing-teacher",
          roomId: "room",
        }],
      },
    });
    const result = validateFeasibleSolverCandidate(state(), problem(), response);

    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("SOLVER_CANDIDATE_UNKNOWN_TEACHER");
  });

  it("rejects duplicate session assignments before independent legality evaluation", () => {
    const assignment = {
      sessionId: "session",
      day: "Monday" as const,
      startTime: "17:00",
      endTime: "18:00",
      teacherId: "teacher",
      roomId: "room",
    };
    const response = payload({
      result: { status: "FEASIBLE", assignments: [assignment, { ...assignment }] },
    });
    const result = validateFeasibleSolverCandidate(state(), problem(), response);

    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("SOLVER_CANDIDATE_SESSION_SET_MISMATCH");
  });

  it("does not let a shortened interval evade a teacher availability window", () => {
    const boundedProblem = problem();
    boundedProblem.constraintModel.hardConstraints.push({
      id: "teacher-window",
      kind: "TEACHER_DAY_WINDOW",
      ruleIds: ["TEST-TEACHER-WINDOW"],
      selector: { teacherNames: ["Teacher"] },
      parameters: { end: "17:30" },
      explanation: "Teacher is unavailable after 17:30.",
    });
    const response = payloadFor(boundedProblem, {
      result: {
        status: "FEASIBLE",
        assignments: [{
          sessionId: "session",
          day: "Monday",
          startTime: "17:00",
          endTime: "17:15",
          teacherId: "teacher",
          roomId: "room",
        }],
      },
    });

    const result = validateFeasibleSolverCandidate(state(), boundedProblem, response);

    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("SOLVER_CANDIDATE_INTERVAL_MISMATCH");
  });

  it("derives the interval from a pinned per-session duration override", () => {
    const overriddenProblem = problem();
    overriddenProblem.sessions[0].durationMinutes = 90;
    const validResponse = payloadFor(overriddenProblem, {
      result: {
        status: "FEASIBLE",
        assignments: [{
          sessionId: "session",
          day: "Monday",
          startTime: "17:00",
          endTime: "18:30",
          teacherId: "teacher",
          roomId: "room",
        }],
      },
    });
    const valid = validateFeasibleSolverCandidate(state(), overriddenProblem, validResponse);
    expect(valid.ok).toBe(true);
    expect(valid.assignments[0].endTime).toBe("18:30");

    const inconsistentResponse = payloadFor(overriddenProblem, {
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
      },
    });
    const inconsistent = validateFeasibleSolverCandidate(state(), overriddenProblem, inconsistentResponse);
    expect(inconsistent.ok).toBe(false);
    expect(inconsistent.blockers.map((item) => item.code)).toContain("SOLVER_CANDIDATE_INTERVAL_MISMATCH");
  });

  it("rejects context drift even when the assignment itself is feasible", () => {
    const response = payload({ context: { studioId: "studio", rulebookVersion: 3, planningDatasetVersion: 8, compilerVersion: "dwde-ir-test" } });
    const result = validateFeasibleSolverCandidate(state(), problem(), response);
    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("SOLVER_RESPONSE_CONTEXT_MISMATCH");
  });

  it("rejects a returned assignment that violates the shared Constraint IR", () => {
    const irProblem = problem();
    irProblem.constraintModel.hardConstraints.push({
      id: "teacher-window",
      kind: "TEACHER_DAY_WINDOW",
      ruleIds: ["TEST-TEACHER-WINDOW"],
      selector: { teacherNames: ["Teacher"] },
      parameters: { end: "17:30" },
      explanation: "Teacher is unavailable after 17:30.",
    });
    const response = payloadFor(irProblem, {
      result: {
        status: "FEASIBLE",
        assignments: [{ sessionId: "session", day: "Monday", startTime: "17:00", endTime: "18:00", teacherId: "teacher", roomId: "room" }],
      },
    });
    const result = validateFeasibleSolverCandidate(state(), irProblem, response);
    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("SOLVER_CANDIDATE_HARD_VALIDATION_FAILED");
  });

  it("independently rejects a candidate that moves a locked placement", () => {
    const lockedProblem = problem();
    lockedProblem.sessions[0] = {
      ...lockedProblem.sessions[0],
      locked: true,
      lockedPlacement: {
        day: "Monday",
        startTime: "18:30",
        teacherId: "teacher",
        roomId: "room",
      },
    };
    const result = validateFeasibleSolverCandidate(state(), lockedProblem, payload());
    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("SOLVER_CANDIDATE_LOCKED_PLACEMENT_CHANGED");
  });

  it("preserves the locked marker when the returned placement matches", () => {
    const lockedProblem = problem();
    lockedProblem.sessions[0] = {
      ...lockedProblem.sessions[0],
      locked: true,
      lockedPlacement: {
        day: "Monday",
        startTime: "17:00",
        teacherId: "teacher",
        roomId: "room",
      },
    };
    const result = validateFeasibleSolverCandidate(state(), lockedProblem, payload());
    expect(result.ok).toBe(true);
    expect(result.assignments[0].locked).toBe(true);
  });
});

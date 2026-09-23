import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { Assignment, ClassDefinition, ClassSession, StudioState } from "@/lib/domain";
import { validateDelegatedSolverPreconditions } from "@/lib/delegated-solver-preflight";
import { buildFeasibilityProblemPayload, runtimeLockBlockers } from "@/lib/solver-problem";
import { validateFeasibleSolverCandidate, type SolverServicePayload } from "@/lib/solver-gateway";

const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "session-lock-semantics.json"), "utf8")) as {
  class: Omit<ClassDefinition, "eligibleTeacherIds" | "companyOnly"> & { companyOnly: boolean };
  teachers: Array<{ id: string; name: string }>;
  rooms: Array<{ id: string; name: string; capacity: number; features: string[] }>;
  planningSessions: Array<{ id: string; classId: string; ordinal: number; durationMinutes: number | null; locked: boolean }>;
  currentAssignments: Assignment[];
  effectiveSolverSessions: Array<Record<string, unknown>>;
  expectedLockedAssignment: Record<string, string>;
};

const now = "2026-09-07T00:00:00Z";

function state(): StudioState {
  const klass: ClassDefinition = { ...fixture.class, eligibleTeacherIds: [] };
  const sessions: ClassSession[] = fixture.planningSessions.map((session) => ({
    id: session.id,
    classId: session.classId,
    ordinal: session.ordinal,
    durationMinutes: session.durationMinutes ?? undefined,
    locked: session.locked,
  }));
  return {
    studioId: "studio",
    studioName: "Fixture Studio",
    teachers: fixture.teachers.map((teacher) => ({ ...teacher, subjects: [] })),
    rooms: fixture.rooms,
    students: [],
    cohorts: [],
    classes: [klass],
    sessions,
    rules: [],
    rulebookVersions: [{ id: "rb", version: 3, name: "v3", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [],
    planningDatasetVersions: [{
      id: "pd", version: 7, createdAt: now, actor: "test", reason: "test", snapshotHash: "0".repeat(64), status: "CURRENT",
      confirmedForSchedulingAt: now,
      snapshot: {
        schemaVersion: "1.3", studioId: "studio", teacherIds: fixture.teachers.map((teacher) => teacher.id),
        teachers: fixture.teachers, rooms: fixture.rooms, students: [], cohorts: [], classes: [{ ...fixture.class }],
        sessions: fixture.planningSessions.map((session) => ({ ...session })),
      },
    }],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [{
      id: "schedule", version: 4, rulebookVersion: 3, enforcementVersion: 3, planningDatasetVersion: 7,
      createdAt: now, actor: "test", reason: "fixture", assignments: fixture.currentAssignments.map((assignment) => ({ ...assignment })), isCurrent: true,
    }],
    scenarios: [],
    auditEvents: [],
  };
}

function model(): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "session-lock-fixture",
    rulebookVersion: 3,
    planningDatasetVersion: 7,
    activeRuleCount: 0,
    hardConstraints: [{
      id: "fixture-teacher-domain",
      kind: "TEACHER_SUBJECT_DOMAIN",
      ruleIds: ["CUR-007"],
      selector: { teacherNames: ["Teacher A"] },
      parameters: { allowedSubjects: ["Ballet"] },
      explanation: "Fixture qualification domain.",
    }],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function problemFor(s: StudioState) {
  const m = model();
  return buildFeasibilityProblemPayload(s, m, validateDelegatedSolverPreconditions(s, m));
}

describe("T09 session-specific runtime locks", () => {
  it("uses assignment OR session lock precedence and serializes the shared stable-session fixture", () => {
    const s = state();
    expect(s.sessions[0].locked).toBe(false);
    expect(s.scheduleVersions[0].assignments[0].locked).toBe(true);
    expect(runtimeLockBlockers(s)).toEqual([]);

    const problem = problemFor(s);
    expect(problem.sessions).toEqual(fixture.effectiveSolverSessions);
    expect(problem.sessions[0].id).toBe("multi-session-1");
    expect(problem.sessions[1].locked).toBe(false);
  });

  it("does not let an assignment false cancel a planning-session lock", () => {
    const s = state();
    s.sessions[0].locked = true;
    s.scheduleVersions[0].assignments[0].locked = false;
    const problem = problemFor(s);
    expect(problem.sessions[0]).toMatchObject({ locked: true, lockedPlacement: fixture.effectiveSolverSessions[0].lockedPlacement });
  });

  it("fails missing, stale, and duration-inconsistent runtime locks with stable explanations", () => {
    const missing = state();
    missing.sessions[0].locked = true;
    missing.scheduleVersions[0].assignments = [];
    expect(runtimeLockBlockers(missing)).toEqual([expect.objectContaining({ code: "LOCKED_SESSION_PLACEMENT_UNRESOLVED", entityIds: ["multi-session-1"] })]);

    const stale = state();
    stale.scheduleVersions[0].assignments[0].teacherId = "archived-teacher";
    expect(runtimeLockBlockers(stale)).toEqual([expect.objectContaining({ code: "LOCKED_SESSION_PLACEMENT_STALE" })]);

    const duration = state();
    duration.scheduleVersions[0].assignments[0].endTime = "19:30";
    expect(runtimeLockBlockers(duration)).toEqual([expect.objectContaining({ code: "LOCKED_SESSION_DURATION_MISMATCH" })]);
  });

  it("candidate validation preserves only the exact locked meeting and rejects moving it", () => {
    const s = state();
    const problem = problemFor(s);
    const sibling = {
      sessionId: "multi-session-2",
      day: "Tuesday" as const,
      startTime: "18:30",
      endTime: "19:30",
      teacherId: "teacher-a",
      roomId: "room-a",
    };
    const payload: SolverServicePayload = {
      serviceVersion: "fixture",
      context: { ...problem.context },
      result: { status: "FEASIBLE", assignments: [fixture.expectedLockedAssignment as never, sibling] },
    };
    const accepted = validateFeasibleSolverCandidate(s, problem, payload);
    expect(accepted.ok).toBe(true);
    expect(accepted.assignments.find((assignment) => assignment.sessionId === "multi-session-1")?.locked).toBe(true);
    expect(accepted.assignments.find((assignment) => assignment.sessionId === "multi-session-2")?.locked).toBe(false);

    const moved: SolverServicePayload = {
      ...payload,
      result: {
        status: "FEASIBLE",
        assignments: [{ ...fixture.expectedLockedAssignment, day: "Wednesday" } as never, sibling],
      },
    };
    const rejected = validateFeasibleSolverCandidate(s, problem, moved);
    expect(rejected.ok).toBe(false);
    expect(rejected.blockers.map((blocker) => blocker.code)).toContain("SOLVER_CANDIDATE_LOCKED_PLACEMENT_CHANGED");
  });
});

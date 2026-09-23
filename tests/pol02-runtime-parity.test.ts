import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { StudioState } from "@/lib/domain";
import type { FeasibilitySolverProblem } from "@/lib/solver-problem";
import {
  validateFeasibleSolverCandidate,
  type SolverAssignmentCandidate,
  type SolverServicePayload,
} from "@/lib/solver-gateway";

const parityDescribe = process.env.STUDIO_SCHEDULER_PARITY === "1" ? describe : describe.skip;
const fixturePath = path.resolve("tests/fixtures/pol02-runtime-parity.json");
const runnerPath = path.resolve("solver/tests/runtime_parity_runner.py");
const pythonBinary = process.env.PYTHON_BINARY?.trim() || "python";

type ParityCase = {
  id: string;
  expectedSolverStatus: string;
  expectedTsLegal: boolean;
  expectedTsBlocker?: string;
  expectedAssignment?: Partial<SolverAssignmentCandidate>;
  probeCandidate?: SolverAssignmentCandidate[];
  problem: FeasibilitySolverProblem;
};

type Fixture = { schemaVersion: "1.0"; cases: ParityCase[] };
type PythonResult = {
  id: string;
  status: string;
  assignments: SolverAssignmentCandidate[];
  unsupportedConstraintIds: string[];
  missingPreconditionConstraintIds: string[];
};
type PythonPayload = { schemaVersion: "1.0"; results: PythonResult[] };

function fixture(): Fixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
}

function runPython(): PythonPayload {
  const result = spawnSync(pythonBinary, [runnerPath, fixturePath], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Python POL-02 parity runner could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Python POL-02 parity runner failed:\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
  }
  return JSON.parse(result.stdout) as PythonPayload;
}

function stateFor(problem: FeasibilitySolverProblem): StudioState {
  const now = "2026-09-09T00:00:00Z";
  return {
    studioId: problem.context.studioId,
    studioName: "POL-02 Parity Studio",
    teachers: problem.teachers.map((teacher) => ({ id: teacher.id, name: teacher.name, subjects: [] })),
    rooms: problem.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      capacity: room.capacity ?? undefined,
      features: [...room.features],
    })),
    students: problem.students.map((student) => ({
      id: student.id,
      name: student.name,
      level: student.level,
      cohortIds: [...student.cohortIds],
    })),
    cohorts: [],
    classes: problem.classes.map((klass) => ({
      id: klass.id,
      name: klass.name,
      subject: klass.subject,
      level: klass.level,
      durationMinutes: klass.durationMinutes,
      weeklyFrequency: klass.weeklyFrequency,
      rosterStudentIds: [...klass.rosterStudentIds],
      eligibleTeacherIds: [],
      companyOnly: klass.companyOnly,
    })),
    sessions: problem.sessions.map((session) => ({
      id: session.id,
      classId: session.classId,
      ordinal: session.ordinal,
      durationMinutes: session.durationMinutes ?? undefined,
      locked: session.locked,
    })),
    rules: [],
    rulebookVersions: [{
      id: "pol02-parity-rulebook",
      version: problem.context.rulebookVersion,
      name: "POL-02 Parity Rulebook",
      createdAt: now,
      actor: "parity",
      reason: "shared POL-02 runtime parity fixture",
      changedRuleIds: [],
      status: "CURRENT",
    }],
    enforcementVersions: [],
    planningDatasetVersions: [{
      id: "pol02-parity-planning",
      version: problem.context.planningDatasetVersion,
      createdAt: now,
      actor: "parity",
      reason: "shared POL-02 runtime parity fixture",
      snapshotHash: "0".repeat(64),
      status: "CURRENT",
      confirmedForSchedulingAt: now,
      snapshot: {
        schemaVersion: "1.3",
        studioId: problem.context.studioId,
        teacherIds: problem.teachers.map((teacher) => teacher.id),
        rooms: [],
        students: [],
        cohorts: [],
        classes: [],
        sessions: [],
      },
    }],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
  } as StudioState;
}

function candidatePayload(testCase: ParityCase, python: PythonResult): SolverServicePayload {
  const assignments = testCase.probeCandidate
    ? testCase.probeCandidate.map((assignment) => ({ ...assignment }))
    : python.assignments.map((assignment) => ({ ...assignment }));
  return {
    serviceVersion: "pol02-parity",
    context: { ...testCase.problem.context },
    result: {
      status: "FEASIBLE",
      assignments,
      unsupportedConstraintIds: [],
      delegatedConstraintIds: [],
      missingPreconditionConstraintIds: [],
      blockingConstraintIds: [],
    },
  };
}

parityDescribe("POL-02 shared typed solver/runtime parity", () => {
  it("agrees on studio windows, room closures, qualification, stable requirements, capacity and features", () => {
    const shared = fixture();
    const python = runPython();
    expect(shared.schemaVersion).toBe("1.0");
    expect(python.schemaVersion).toBe("1.0");
    const byId = new Map(python.results.map((result) => [result.id, result]));

    for (const testCase of shared.cases) {
      const pythonResult = byId.get(testCase.id);
      expect(pythonResult, `missing Python result for ${testCase.id}`).toBeDefined();
      expect(pythonResult!.status, testCase.id).toBe(testCase.expectedSolverStatus);
      expect(pythonResult!.unsupportedConstraintIds, testCase.id).toEqual([]);
      expect(pythonResult!.missingPreconditionConstraintIds, testCase.id).toEqual([]);

      if (testCase.expectedAssignment && pythonResult!.assignments[0]) {
        expect(pythonResult!.assignments[0], testCase.id).toMatchObject(testCase.expectedAssignment);
      }

      const ts = validateFeasibleSolverCandidate(
        stateFor(testCase.problem),
        testCase.problem,
        candidatePayload(testCase, pythonResult!),
      );
      expect(ts.ok, testCase.id).toBe(testCase.expectedTsLegal);
      if (testCase.expectedTsBlocker) {
        expect(ts.blockers.map((blocker) => blocker.code), testCase.id).toContain(testCase.expectedTsBlocker);
      }

      if (!testCase.probeCandidate) {
        const pythonLegal = pythonResult!.status === "FEASIBLE";
        if (pythonLegal !== ts.ok) {
          throw new Error(`POL-02 runtime legality mismatch for ${testCase.id}: Python=${pythonLegal}, TypeScript=${ts.ok}`);
        }
      }
    }
  });
});

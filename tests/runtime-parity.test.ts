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
const fixturePath = path.resolve("tests/fixtures/solver-runtime-parity.json");
const runnerPath = path.resolve("solver/tests/runtime_parity_runner.py");
const pythonBinary = process.env.PYTHON_BINARY?.trim() || "python";

type ParityCase = {
  id: string;
  expectedSolverStatus: string;
  expectedTsLegal: boolean;
  expectedTsBlocker?: string;
  probeCandidate?: SolverAssignmentCandidate[];
  tamper?: { kind: "END_TIME"; value: string } | { kind: "CONTEXT_RULEBOOK_VERSION"; value: number };
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
  if (result.error) throw new Error(`Python parity runner could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Python parity runner failed:\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
  }
  return JSON.parse(result.stdout) as PythonPayload;
}

function stateFor(problem: FeasibilitySolverProblem): StudioState {
  const now = "2026-09-08T00:00:00Z";
  return {
    studioId: problem.context.studioId,
    studioName: "Parity Studio",
    teachers: problem.teachers.map((teacher) => ({ id: teacher.id, name: teacher.name, subjects: [] })),
    rooms: problem.rooms.map((room) => ({ id: room.id, name: room.name, capacity: room.capacity ?? undefined, features: [...room.features] })),
    students: problem.students.map((student) => ({ id: student.id, name: student.name, level: student.level, cohortIds: [...student.cohortIds] })),
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
      id: "parity-rulebook",
      version: problem.context.rulebookVersion,
      name: "Parity Rulebook",
      createdAt: now,
      actor: "parity",
      reason: "shared runtime parity fixture",
      changedRuleIds: [],
      status: "CURRENT",
    }],
    enforcementVersions: [],
    planningDatasetVersions: [{
      id: "parity-planning",
      version: problem.context.planningDatasetVersion,
      createdAt: now,
      actor: "parity",
      reason: "shared runtime parity fixture",
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
  const context = { ...testCase.problem.context };

  if (testCase.tamper?.kind === "END_TIME" && assignments[0]) {
    assignments[0].endTime = testCase.tamper.value;
  }
  if (testCase.tamper?.kind === "CONTEXT_RULEBOOK_VERSION") {
    context.rulebookVersion = testCase.tamper.value;
  }

  return {
    serviceVersion: "parity",
    context,
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

function assertRuntimeParity(caseId: string, pythonLegal: boolean, tsLegal: boolean) {
  if (pythonLegal !== tsLegal) {
    throw new Error(`Runtime legality mismatch for ${caseId}: Python=${pythonLegal}, TypeScript=${tsLegal}`);
  }
}

parityDescribe("VERIFY-01 shared solver/runtime parity", () => {
  it("runs serialized cases through Python solving and TypeScript candidate validation", () => {
    const shared = fixture();
    expect(shared.schemaVersion).toBe("1.0");
    const python = runPython();
    expect(python.schemaVersion).toBe("1.0");
    const byId = new Map(python.results.map((result) => [result.id, result]));

    for (const testCase of shared.cases) {
      const pythonResult = byId.get(testCase.id);
      expect(pythonResult, `missing Python result for ${testCase.id}`).toBeDefined();
      expect(pythonResult!.status, testCase.id).toBe(testCase.expectedSolverStatus);
      expect(pythonResult!.unsupportedConstraintIds, testCase.id).toEqual([]);
      expect(pythonResult!.missingPreconditionConstraintIds, testCase.id).toEqual([]);

      const ts = validateFeasibleSolverCandidate(
        stateFor(testCase.problem),
        testCase.problem,
        candidatePayload(testCase, pythonResult!),
      );
      expect(ts.ok, testCase.id).toBe(testCase.expectedTsLegal);
      if (testCase.expectedTsBlocker) {
        expect(ts.blockers.map((blocker) => blocker.code), testCase.id).toContain(testCase.expectedTsBlocker);
      }

      if (!testCase.tamper) {
        assertRuntimeParity(testCase.id, pythonResult!.status === "FEASIBLE", ts.ok);
      }
    }
  });

  it("fails closed when the two runtimes deliberately disagree on legality", () => {
    expect(() => assertRuntimeParity("deliberate-mismatch-witness", true, false))
      .toThrow(/Runtime legality mismatch/);
  });
});

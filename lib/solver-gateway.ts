import type { Assignment, StudioState } from "@/lib/domain";
import type { ConstraintEngineResult } from "@/lib/constraint-engine";
import type { ConstraintModelDefinitionV1 } from "@/lib/constraint-model-version";
import { constraintModelDefinition, constraintModelDefinitionsMatch } from "@/lib/constraint-model-version";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import type { FeasibilitySolverProblem } from "@/lib/solver-problem";

export interface SolverGatewayBlocker {
  code: string;
  message: string;
  entityIds: string[];
}

export interface PublishedConstraintModelRecord {
  version: number;
  rulebookVersion: number;
  compilerVersion: string;
  complete: boolean;
  snapshot: ConstraintModelDefinitionV1;
}

export interface SolverAssignmentCandidate {
  sessionId: string;
  day: Assignment["day"];
  startTime: string;
  endTime: string;
  teacherId: string;
  roomId: string;
}

export interface SolverServicePayload {
  serviceVersion?: string;
  context?: {
    studioId?: string;
    rulebookVersion?: number;
    planningDatasetVersion?: number;
    compilerVersion?: string;
  };
  result?: {
    status?: string;
    assignments?: SolverAssignmentCandidate[];
    unsupportedConstraintIds?: string[];
    delegatedConstraintIds?: string[];
    missingPreconditionConstraintIds?: string[];
    blockingConstraintIds?: string[];
    wallTimeSeconds?: number;
    branches?: number;
    conflicts?: number;
  };
}

export function publishedConstraintModelBlockers(
  problem: FeasibilitySolverProblem,
  published: PublishedConstraintModelRecord | null,
): SolverGatewayBlocker[] {
  if (!published) {
    return [{
      code: "PUBLISHED_CONSTRAINT_MODEL_MISSING",
      message: "No current published Constraint Model exists. The server will not solve from an unpublished compiler artifact.",
      entityIds: [],
    }];
  }

  const blockers: SolverGatewayBlocker[] = [];
  if (!published.complete) {
    blockers.push({
      code: "PUBLISHED_CONSTRAINT_MODEL_INCOMPLETE",
      message: `Published Constraint Model v${published.version} is not marked complete for HARD constraints.`,
      entityIds: [],
    });
  }
  if (published.rulebookVersion !== problem.context.rulebookVersion) {
    blockers.push({
      code: "PUBLISHED_CONSTRAINT_RULEBOOK_MISMATCH",
      message: `Published Constraint Model v${published.version} targets Rulebook v${published.rulebookVersion}, while the canonical solver request targets Rulebook v${problem.context.rulebookVersion}.`,
      entityIds: [],
    });
  }
  if (published.compilerVersion !== problem.context.compilerVersion) {
    blockers.push({
      code: "PUBLISHED_CONSTRAINT_COMPILER_MISMATCH",
      message: `Published Constraint Model v${published.version} uses ${published.compilerVersion}, while the canonical solver request uses ${problem.context.compilerVersion}.`,
      entityIds: [],
    });
  }

  const expectedDefinition = constraintModelDefinition(problem.constraintModel);
  if (!constraintModelDefinitionsMatch(expectedDefinition, published.snapshot)) {
    blockers.push({
      code: "PUBLISHED_CONSTRAINT_SNAPSHOT_MISMATCH",
      message: "The current published Constraint Model snapshot is not byte-for-byte equivalent to the tested compiler output for the canonical Rulebook.",
      entityIds: [],
    });
  }
  return blockers;
}

function contextMatches(problem: FeasibilitySolverProblem, payload: SolverServicePayload) {
  const actual = payload.context;
  return Boolean(actual
    && actual.studioId === problem.context.studioId
    && Number(actual.rulebookVersion) === problem.context.rulebookVersion
    && Number(actual.planningDatasetVersion) === problem.context.planningDatasetVersion
    && actual.compilerVersion === problem.context.compilerVersion);
}

export function validateFeasibleSolverCandidate(
  state: StudioState,
  problem: FeasibilitySolverProblem,
  payload: SolverServicePayload,
): {
  ok: boolean;
  assignments: Assignment[];
  validation: ConstraintEngineResult | null;
  blockers: SolverGatewayBlocker[];
} {
  const blockers: SolverGatewayBlocker[] = [];
  if (!contextMatches(problem, payload)) {
    blockers.push({
      code: "SOLVER_RESPONSE_CONTEXT_MISMATCH",
      message: "The solver response did not echo the exact Rulebook, Planning Dataset, compiler, and studio context that the server submitted.",
      entityIds: [],
    });
  }

  const result = payload.result;
  if (result?.status !== "FEASIBLE") {
    blockers.push({
      code: "SOLVER_RESPONSE_NOT_FEASIBLE",
      message: `Candidate validation requires a FEASIBLE solver result; received ${result?.status || "missing status"}.`,
      entityIds: [],
    });
    return { ok: false, assignments: [], validation: null, blockers };
  }

  const rawAssignments = Array.isArray(result.assignments) ? result.assignments : [];
  const expectedSessionIds = [...state.sessions.map((session) => session.id)].sort();
  const candidateSessionIds = [...rawAssignments.map((assignment) => assignment.sessionId)].sort();
  const duplicateSessionIds = candidateSessionIds.filter((id, index) => index > 0 && id === candidateSessionIds[index - 1]);
  const exactSessionSet = expectedSessionIds.length === candidateSessionIds.length
    && expectedSessionIds.every((id, index) => id === candidateSessionIds[index]);

  if (!exactSessionSet || duplicateSessionIds.length) {
    const candidateSet = new Set(candidateSessionIds);
    const expectedSet = new Set(expectedSessionIds);
    const missing = expectedSessionIds.filter((id) => !candidateSet.has(id));
    const unknown = candidateSessionIds.filter((id) => !expectedSet.has(id));
    blockers.push({
      code: "SOLVER_CANDIDATE_SESSION_SET_MISMATCH",
      message: `Solver candidate must assign every canonical session exactly once. Missing ${missing.length}, unknown ${unknown.length}, duplicate ${new Set(duplicateSessionIds).size}.`,
      entityIds: [...new Set([...missing, ...unknown, ...duplicateSessionIds])],
    });
  }

  const rawBySession = new Map(rawAssignments.map((assignment) => [assignment.sessionId, assignment]));
  const movedLockedSessionIds = problem.sessions
    .filter((session) => session.locked && session.lockedPlacement)
    .filter((session) => {
      const candidate = rawBySession.get(session.id);
      const placement = session.lockedPlacement!;
      return !candidate
        || candidate.day !== placement.day
        || candidate.startTime.slice(0, 5) !== placement.startTime.slice(0, 5)
        || candidate.teacherId !== placement.teacherId
        || candidate.roomId !== placement.roomId;
    })
    .map((session) => session.id)
    .sort();
  if (movedLockedSessionIds.length) {
    blockers.push({
      code: "SOLVER_CANDIDATE_LOCKED_PLACEMENT_CHANGED",
      message: `Solver candidate changed ${movedLockedSessionIds.length} locked session placement(s).`,
      entityIds: movedLockedSessionIds,
    });
  }

  const lockedSessionIds = new Set(problem.sessions.filter((session) => session.locked).map((session) => session.id));
  const assignments: Assignment[] = rawAssignments.map((assignment) => ({
    id: `solver:${assignment.sessionId}`,
    sessionId: assignment.sessionId,
    day: assignment.day,
    startTime: assignment.startTime.slice(0, 5),
    endTime: assignment.endTime.slice(0, 5),
    teacherId: assignment.teacherId,
    roomId: assignment.roomId,
    locked: lockedSessionIds.has(assignment.sessionId),
    status: "AI_PROPOSED",
  }));

  const validation = validateConstraintModelSchedule(state, problem.constraintModel, assignments);
  if (validation.unsupportedConstraintIds.length) {
    blockers.push({
      code: "CANDIDATE_VALIDATOR_UNSUPPORTED_CONSTRAINTS",
      message: `Independent Constraint IR validation cannot evaluate ${validation.unsupportedConstraintIds.length} solver-enforced constraint node(s).`,
      entityIds: validation.unsupportedConstraintIds,
    });
  }
  if (validation.hardViolations > 0) {
    blockers.push({
      code: "SOLVER_CANDIDATE_HARD_VALIDATION_FAILED",
      message: `Independent Constraint IR validation found ${validation.hardViolations} HARD violation(s) in the returned candidate.`,
      entityIds: validation.violations.flatMap((violation) => violation.affectedEntityIds),
    });
  }

  return {
    ok: blockers.length === 0 && validation.valid,
    assignments,
    validation,
    blockers,
  };
}

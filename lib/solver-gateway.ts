import type { Assignment, StudioState } from "@/lib/domain";
import type { ConstraintEngineResult } from "@/lib/constraint-engine";
import type { ConstraintModelDefinitionV1 } from "@/lib/constraint-model-version";
import { constraintModelDefinition, constraintModelDefinitionsMatch } from "@/lib/constraint-model-version";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import { sessionDurationMinutes, timeFromMinutes } from "@/lib/schedule-builder";
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

const CANONICAL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const CANONICAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CANONICAL_ASSIGNMENT_KEYS = ["sessionId", "day", "startTime", "endTime", "teacherId", "roomId"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function minutesFromCanonicalTime(value: unknown) {
  if (typeof value !== "string" || !CANONICAL_TIME.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function candidateBlocker(code: string, message: string, entityIds: string[] = []): SolverGatewayBlocker {
  return { code, message, entityIds };
}

function canonicalizeSolverAssignment(
  raw: unknown,
  problem: FeasibilitySolverProblem,
): { assignment: SolverAssignmentCandidate | null; blockers: SolverGatewayBlocker[] } {
  if (!isRecord(raw)
    || Object.keys(raw).length !== CANONICAL_ASSIGNMENT_KEYS.length
    || Object.keys(raw).some((key) => !CANONICAL_ASSIGNMENT_KEYS.includes(key as typeof CANONICAL_ASSIGNMENT_KEYS[number]))) {
    return {
      assignment: null,
      blockers: [candidateBlocker(
        "SOLVER_CANDIDATE_ASSIGNMENT_SHAPE_INVALID",
        "Each solver assignment must contain exactly sessionId, day, startTime, endTime, teacherId, and roomId.",
      )],
    };
  }

  const values = CANONICAL_ASSIGNMENT_KEYS.map((key) => raw[key]);
  if (values.some((value) => typeof value !== "string" || value.length === 0)) {
    return {
      assignment: null,
      blockers: [candidateBlocker(
        "SOLVER_CANDIDATE_ASSIGNMENT_SHAPE_INVALID",
        "Solver assignment identifiers, day, and interval values must be non-empty strings.",
      )],
    };
  }

  const sessionId = raw.sessionId as string;
  const day = raw.day as string;
  const startTime = raw.startTime as string;
  const endTime = raw.endTime as string;
  const teacherId = raw.teacherId as string;
  const roomId = raw.roomId as string;
  const session = problem.sessions.find((item) => item.id === sessionId);
  const klass = session ? problem.classes.find((item) => item.id === session.classId) : undefined;
  const blockers: SolverGatewayBlocker[] = [];

  if (!session) blockers.push(candidateBlocker("SOLVER_CANDIDATE_UNKNOWN_SESSION", `Solver candidate references unknown session ${sessionId}.`, [sessionId]));
  if (!klass && session) blockers.push(candidateBlocker("SOLVER_CANDIDATE_SESSION_CLASS_MISSING", `Solver session ${sessionId} references a missing class.`, [sessionId]));
  if (!problem.teachers.some((teacher) => teacher.id === teacherId)) {
    blockers.push(candidateBlocker("SOLVER_CANDIDATE_UNKNOWN_TEACHER", `Solver candidate references unknown teacher ${teacherId}.`, [teacherId]));
  }
  if (!problem.rooms.some((room) => room.id === roomId)) {
    blockers.push(candidateBlocker("SOLVER_CANDIDATE_UNKNOWN_ROOM", `Solver candidate references unknown room ${roomId}.`, [roomId]));
  }

  const startMinutes = minutesFromCanonicalTime(startTime);
  const endMinutes = minutesFromCanonicalTime(endTime);
  if (!CANONICAL_DAYS.includes(day as typeof CANONICAL_DAYS[number])
    || startMinutes === null
    || endMinutes === null
    || startMinutes % 15 !== 0
    || endMinutes % 15 !== 0
    || endMinutes <= startMinutes) {
    blockers.push(candidateBlocker(
      "SOLVER_CANDIDATE_ASSIGNMENT_SHAPE_INVALID",
      `Solver candidate ${sessionId} must use a valid non-cross-midnight HH:MM interval on the 15-minute grid.`,
      [sessionId],
    ));
  }

  if (!session || !klass || startMinutes === null || endMinutes === null || blockers.length > 0) {
    return { assignment: null, blockers };
  }

  const duration = sessionDurationMinutes({ durationMinutes: session.durationMinutes ?? undefined }, klass);
  if (!Number.isFinite(duration) || !Number.isSafeInteger(duration) || duration <= 0) {
    return {
      assignment: null,
      blockers: [candidateBlocker(
        "SOLVER_CANDIDATE_DURATION_INVALID",
        `Session ${sessionId} has no valid positive integer duration in the pinned solver context.`,
        [sessionId],
      )],
    };
  }

  const expectedEndMinutes = startMinutes + duration;
  if (expectedEndMinutes >= 24 * 60) {
    return {
      assignment: null,
      blockers: [candidateBlocker(
        "SOLVER_CANDIDATE_ASSIGNMENT_SHAPE_INVALID",
        `Solver candidate ${sessionId} would cross midnight at its pinned duration.`,
        [sessionId],
      )],
    };
  }

  const expectedEndTime = timeFromMinutes(expectedEndMinutes);
  if (endTime !== expectedEndTime) {
    return {
      assignment: null,
      blockers: [candidateBlocker(
        "SOLVER_CANDIDATE_INTERVAL_MISMATCH",
        `Solver candidate ${sessionId} supplied ${startTime}-${endTime}, but its pinned duration requires ${startTime}-${expectedEndTime}.`,
        [sessionId],
      )],
    };
  }

  return {
    assignment: { sessionId, day: day as SolverAssignmentCandidate["day"], startTime, endTime: expectedEndTime, teacherId, roomId },
    blockers,
  };
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

export type ConstraintModelSyncDecision =
  | { action: "CURRENT"; reason: string }
  | { action: "PUBLISH"; reason: string }
  | { action: "BLOCK"; reason: string };

/**
 * Decide whether an explicit editor solve may repair the published model boundary.
 *
 * Missing or plainly stale artifacts can be deterministically regenerated from
 * the tested compiler. A same-Rulebook/same-compiler snapshot mismatch is more
 * suspicious: silently replacing it would hide drift, so that case fails closed.
 */
export function constraintModelSyncDecision(
  problem: FeasibilitySolverProblem,
  published: PublishedConstraintModelRecord | null,
): ConstraintModelSyncDecision {
  const expected = constraintModelDefinition(problem.constraintModel);
  if (!published) {
    return { action: "PUBLISH", reason: "No current published Constraint Model exists." };
  }

  const staleIdentity = published.rulebookVersion !== problem.context.rulebookVersion
    || published.compilerVersion !== problem.context.compilerVersion;
  if (staleIdentity) {
    return {
      action: "PUBLISH",
      reason: `Published Constraint Model v${published.version} is stale for the current Rulebook/compiler identity.`,
    };
  }

  if (!published.complete) {
    return {
      action: "PUBLISH",
      reason: `Published Constraint Model v${published.version} is not marked complete for HARD constraints.`,
    };
  }

  if (!constraintModelDefinitionsMatch(expected, published.snapshot)) {
    return {
      action: "BLOCK",
      reason: "Published Constraint Model has the current Rulebook/compiler identity but its snapshot differs from tested compiler output.",
    };
  }

  return { action: "CURRENT", reason: `Published Constraint Model v${published.version} matches tested compiler output.` };
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
  const canonicalized = rawAssignments.map((assignment) => canonicalizeSolverAssignment(assignment, problem));
  const structuralBlockers = canonicalized.flatMap((item) => item.blockers);
  if (structuralBlockers.length > 0) {
    return { ok: false, assignments: [], validation: null, blockers: [...blockers, ...structuralBlockers] };
  }

  const canonicalCandidates = canonicalized.map((item) => item.assignment!);
  const expectedSessionIds = [...state.sessions.map((session) => session.id)].sort();
  const candidateSessionIds = [...canonicalCandidates.map((assignment) => assignment.sessionId)].sort();
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
    return { ok: false, assignments: [], validation: null, blockers };
  }

  const rawBySession = new Map(canonicalCandidates.map((assignment) => [assignment.sessionId, assignment]));
  const movedLockedSessionIds = problem.sessions
    .filter((session) => session.locked && session.lockedPlacement)
    .filter((session) => {
      const candidate = rawBySession.get(session.id);
      const placement = session.lockedPlacement!;
      return !candidate
        || candidate.day !== placement.day
        || candidate.startTime !== placement.startTime.slice(0, 5)
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
  const assignments: Assignment[] = canonicalCandidates.map((assignment) => ({
    id: `solver:${assignment.sessionId}`,
    sessionId: assignment.sessionId,
    day: assignment.day,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
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

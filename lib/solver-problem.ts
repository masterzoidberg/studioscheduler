import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { Assignment, StudioState } from "@/lib/domain";
import { placementEndTime, sessionDurationMinutes } from "@/lib/schedule-builder";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { validateDelegatedSolverPreconditions, type DelegatedSolverPreflightReport } from "@/lib/delegated-solver-preflight";
import { evaluateScheduleReadiness, type ScheduleReadinessReport } from "@/lib/schedule-readiness";

export interface FeasibilitySolverProblem {
  contractVersion: "1.0";
  context: {
    studioId: string;
    rulebookVersion: number;
    planningDatasetVersion: number;
    compilerVersion: string;
  };
  teachers: Array<{ id: string; name: string }>;
  rooms: Array<{ id: string; name: string; capacity: number | null; features: string[] }>;
  students: Array<{ id: string; name: string; level: string; cohortIds: string[] }>;
  classes: Array<{
    id: string;
    name: string;
    subject: string;
    level: string;
    durationMinutes: number;
    weeklyFrequency: number;
    rosterStudentIds: string[];
    companyOnly: boolean;
  }>;
  sessions: Array<{
    id: string;
    classId: string;
    ordinal: number;
    durationMinutes: number | null;
    locked: boolean;
    lockedPlacement: {
      day: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday";
      startTime: string;
      teacherId: string;
      roomId: string;
    } | null;
  }>;
  constraintModel: ConstraintModelSnapshotV1;
  preflight: {
    validatedDelegatedConstraintIds: string[];
  };
}

export interface FeasibilityPreparationFailure {
  ok: false;
  blockers: Array<{ code: string; message: string; ruleIds: string[]; entityIds: string[] }>;
  readiness: ScheduleReadinessReport;
  delegatedPreflight: DelegatedSolverPreflightReport;
}

export interface FeasibilityPreparationSuccess {
  ok: true;
  problem: FeasibilitySolverProblem;
  readiness: ScheduleReadinessReport;
  delegatedPreflight: DelegatedSolverPreflightReport;
}

export type FeasibilityPreparation = FeasibilityPreparationFailure | FeasibilityPreparationSuccess;

const compareCanonicalStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortStrings = (values: string[] | undefined) => [...(values || [])].sort(compareCanonicalStrings);
const SOLVE_REMEDIABLE_READINESS_CODES = new Set(["SCHEDULE_PLANNING_DATASET_STALE"]);

const CANONICAL_LOCK_DAYS = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const CANONICAL_LOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type RuntimeLockState = {
  locked: boolean;
  sessionLocked: boolean;
  assignmentLocked: boolean;
  assignment: Assignment | null;
  assignmentCount: number;
};

/**
 * Runtime lock precedence is intentionally conservative: either the immutable
 * planning-session lock OR the current ScheduleVersion assignment lock protects
 * the exact current placement. An explicit false on one representation never
 * cancels a true lock on the other representation.
 *
 * Assignments for sessions outside the active pinned Planning Dataset are
 * historical and do not become current solver locks.
 */
function runtimeLockStateBySession(state: StudioState): Map<string, RuntimeLockState> {
  const currentSchedule = state.scheduleVersions.find((version) => version.isCurrent);
  const assignmentsBySession = new Map<string, Assignment[]>();
  for (const assignment of currentSchedule?.assignments || []) {
    const values = assignmentsBySession.get(assignment.sessionId) || [];
    values.push(assignment);
    assignmentsBySession.set(assignment.sessionId, values);
  }

  return new Map(state.sessions.map((session) => {
    const assignments = assignmentsBySession.get(session.id) || [];
    const sessionLocked = Boolean(session.locked);
    const assignmentLocked = assignments.some((assignment) => Boolean(assignment.locked));
    return [session.id, {
      locked: sessionLocked || assignmentLocked,
      sessionLocked,
      assignmentLocked,
      assignment: assignments.length === 1 ? assignments[0] : null,
      assignmentCount: assignments.length,
    }];
  }));
}

export function runtimeLockBlockers(state: StudioState): FeasibilityPreparationFailure["blockers"] {
  const blockers: FeasibilityPreparationFailure["blockers"] = [];
  const lockState = runtimeLockStateBySession(state);
  const teacherIds = new Set(state.teachers.map((teacher) => teacher.id));
  const roomIds = new Set(state.rooms.map((room) => room.id));
  const classById = new Map(state.classes.map((klass) => [klass.id, klass]));

  for (const session of [...state.sessions].sort((a, b) => compareCanonicalStrings(a.id, b.id))) {
    const lock = lockState.get(session.id);
    if (!lock?.locked) continue;

    if (lock.assignmentCount !== 1 || !lock.assignment) {
      blockers.push({
        code: "LOCKED_SESSION_PLACEMENT_UNRESOLVED",
        message: `Locked session ${session.id} must have exactly one current assignment to preserve; found ${lock.assignmentCount}.`,
        ruleIds: [],
        entityIds: [session.id],
      });
      continue;
    }

    const assignment = lock.assignment;
    const staleIds = [
      ...(!teacherIds.has(assignment.teacherId) ? [assignment.teacherId] : []),
      ...(!roomIds.has(assignment.roomId) ? [assignment.roomId] : []),
    ];
    const canonicalPlacement = CANONICAL_LOCK_DAYS.has(assignment.day)
      && CANONICAL_LOCK_TIME.test(assignment.startTime.slice(0, 5))
      && CANONICAL_LOCK_TIME.test(assignment.endTime.slice(0, 5));
    if (!canonicalPlacement || staleIds.length > 0) {
      blockers.push({
        code: "LOCKED_SESSION_PLACEMENT_STALE",
        message: `Locked session ${session.id} references a placement that is no longer canonical in the pinned active solver inventory.`,
        ruleIds: [],
        entityIds: [session.id, ...staleIds],
      });
      continue;
    }

    const klass = classById.get(session.classId);
    if (!klass) {
      blockers.push({
        code: "LOCKED_SESSION_PLACEMENT_STALE",
        message: `Locked session ${session.id} references missing class ${session.classId}.`,
        ruleIds: [],
        entityIds: [session.id, session.classId],
      });
      continue;
    }

    const duration = sessionDurationMinutes(session, klass);
    const expectedEnd = Number.isFinite(duration) && Number.isSafeInteger(duration) && duration > 0
      ? placementEndTime(assignment.startTime, duration)
      : null;
    if (!expectedEnd || expectedEnd !== assignment.endTime.slice(0, 5)) {
      blockers.push({
        code: "LOCKED_SESSION_DURATION_MISMATCH",
        message: `Locked session ${session.id} must preserve its canonical ${duration}-minute duration; current placement ${assignment.startTime.slice(0, 5)}-${assignment.endTime.slice(0, 5)} is inconsistent.`,
        ruleIds: [],
        entityIds: [session.id],
      });
    }
  }

  return blockers;
}

/**
 * A stale current schedule is evidence that the displayed schedule no longer
 * represents current planning truth, but it is not a safe reason to prohibit a
 * fresh feasibility solve. The solver is built from current planning facts and
 * the canonical Constraint Model. Existing schedule assignments are consulted
 * only when a current session is explicitly locked, so its pinned placement can
 * be preserved in the replacement solve.
 */
export function feasibilityReadiness(report: ScheduleReadinessReport): ScheduleReadinessReport {
  const remediable = report.blockers.filter((issue) => SOLVE_REMEDIABLE_READINESS_CODES.has(issue.code));
  const blockers = report.blockers.filter((issue) => !SOLVE_REMEDIABLE_READINESS_CODES.has(issue.code));
  const remediableWarnings = remediable.map((issue) => ({ ...issue, severity: "WARNING" as const }));
  return {
    ...report,
    ready: blockers.length === 0,
    blockers,
    warnings: [...report.warnings, ...remediableWarnings],
  };
}

export function buildFeasibilityProblemPayload(
  state: StudioState,
  model: ConstraintModelSnapshotV1,
  delegatedPreflight: DelegatedSolverPreflightReport,
): FeasibilitySolverProblem {
  const rulebookVersion = state.rulebookVersions.find((version) => version.status === "CURRENT")?.version ?? model.rulebookVersion;
  const planningDatasetVersion = state.planningDatasetVersions?.find((version) => version.status === "CURRENT")?.version ?? model.planningDatasetVersion ?? 0;
  const runtimeLocks = runtimeLockStateBySession(state);

  return {
    contractVersion: "1.0",
    context: {
      studioId: state.studioId,
      rulebookVersion,
      planningDatasetVersion,
      compilerVersion: model.compilerVersion,
    },
    teachers: state.teachers
      .map((teacher) => ({ id: teacher.id, name: teacher.name }))
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
    rooms: state.rooms
      .map((room) => ({ id: room.id, name: room.name, capacity: room.capacity ?? null, features: sortStrings(room.features) }))
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
    students: state.students
      .map((student) => ({ id: student.id, name: student.name, level: student.level, cohortIds: sortStrings(student.cohortIds) }))
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
    classes: state.classes
      .map((klass) => ({
        id: klass.id,
        name: klass.name,
        subject: klass.subject,
        level: klass.level,
        durationMinutes: klass.durationMinutes,
        weeklyFrequency: klass.weeklyFrequency,
        rosterStudentIds: sortStrings(klass.rosterStudentIds),
        companyOnly: Boolean(klass.companyOnly),
      }))
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
    sessions: state.sessions
      .map((session) => {
        const runtimeLock = runtimeLocks.get(session.id);
        const assignment = runtimeLock?.assignment;
        return {
          id: session.id,
          classId: session.classId,
          ordinal: session.ordinal,
          durationMinutes: session.durationMinutes ?? null,
          locked: Boolean(runtimeLock?.locked),
          lockedPlacement: runtimeLock?.locked && assignment ? {
            day: assignment.day,
            startTime: assignment.startTime.slice(0, 5),
            teacherId: assignment.teacherId,
            roomId: assignment.roomId,
          } : null,
        };
      })
      .sort((a, b) => compareCanonicalStrings(a.id, b.id)),
    constraintModel: model,
    preflight: {
      validatedDelegatedConstraintIds: [...delegatedPreflight.validatedDelegatedConstraintIds].sort(compareCanonicalStrings),
    },
  };
}

export function prepareFeasibilitySolve(state: StudioState): FeasibilityPreparation {
  const model = compileConstraintModel(state);
  const readiness = feasibilityReadiness(evaluateScheduleReadiness(state));
  const delegatedPreflight = validateDelegatedSolverPreconditions(state, model);
  const blockers: FeasibilityPreparationFailure["blockers"] = readiness.blockers.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ruleIds: issue.ruleIds,
    entityIds: issue.entityIds,
  }));

  if (!model.completeHardConstraintCompilation) {
    blockers.push({
      code: "CONSTRAINT_MODEL_INCOMPLETE",
      message: `Constraint compiler still has ${model.uncompiledConstraintRuleIds.length} uncompiled HARD/exception rule(s).`,
      ruleIds: model.uncompiledConstraintRuleIds,
      entityIds: [],
    });
  }

  const currentRulebook = state.rulebookVersions.find((version) => version.status === "CURRENT")?.version ?? 0;
  const currentPlanning = state.planningDatasetVersions?.find((version) => version.status === "CURRENT")?.version ?? 0;
  if (model.rulebookVersion !== currentRulebook) {
    blockers.push({
      code: "SOLVER_RULEBOOK_VERSION_MISMATCH",
      message: `Compiled Constraint Model targets Rulebook v${model.rulebookVersion}, while Rulebook v${currentRulebook} is current.`,
      ruleIds: [],
      entityIds: [],
    });
  }
  if (model.planningDatasetVersion !== currentPlanning) {
    blockers.push({
      code: "SOLVER_PLANNING_VERSION_MISMATCH",
      message: `Compiled solver input targets Planning Dataset v${model.planningDatasetVersion ?? "unversioned"}, while Planning Dataset v${currentPlanning} is current.`,
      ruleIds: [],
      entityIds: [],
    });
  }

  blockers.push(...runtimeLockBlockers(state));

  for (const issue of delegatedPreflight.issues) {
    blockers.push({ code: issue.code, message: issue.message, ruleIds: issue.ruleIds, entityIds: issue.entityIds });
  }

  if (blockers.length > 0 || !readiness.ready || !delegatedPreflight.complete) {
    return { ok: false, blockers, readiness, delegatedPreflight };
  }

  return {
    ok: true,
    problem: buildFeasibilityProblemPayload(state, model, delegatedPreflight),
    readiness,
    delegatedPreflight,
  };
}

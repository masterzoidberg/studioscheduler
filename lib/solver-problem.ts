import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { StudioState } from "@/lib/domain";
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
  const currentSchedule = state.scheduleVersions.find((version) => version.isCurrent);
  const currentAssignmentBySession = new Map((currentSchedule?.assignments || []).map((assignment) => [assignment.sessionId, assignment]));

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
        const assignment = currentAssignmentBySession.get(session.id);
        return {
          id: session.id,
          classId: session.classId,
          ordinal: session.ordinal,
          durationMinutes: session.durationMinutes ?? null,
          locked: Boolean(session.locked),
          lockedPlacement: session.locked && assignment ? {
            day: assignment.day,
            startTime: assignment.startTime,
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

  const currentSchedule = state.scheduleVersions.find((version) => version.isCurrent);
  const assignmentCountBySession = new Map<string, number>();
  for (const assignment of currentSchedule?.assignments || []) {
    assignmentCountBySession.set(assignment.sessionId, (assignmentCountBySession.get(assignment.sessionId) || 0) + 1);
  }
  const unresolvedLockedSessionIds = state.sessions
    .filter((session) => session.locked && assignmentCountBySession.get(session.id) !== 1)
    .map((session) => session.id)
    .sort(compareCanonicalStrings);
  if (unresolvedLockedSessionIds.length) {
    blockers.push({
      code: "LOCKED_SESSION_PLACEMENT_UNRESOLVED",
      message: `${unresolvedLockedSessionIds.length} locked session(s) do not have exactly one current assignment to preserve in a replacement solve.`,
      ruleIds: [],
      entityIds: unresolvedLockedSessionIds,
    });
  }

  const sessionCountByClass = new Map<string, number>();
  for (const session of state.sessions) {
    sessionCountByClass.set(session.classId, (sessionCountByClass.get(session.classId) || 0) + 1);
  }
  const ambiguousLockedSessionIds = state.sessions
    .filter((session) => session.locked && (sessionCountByClass.get(session.classId) || 0) !== 1)
    .map((session) => session.id)
    .sort(compareCanonicalStrings);
  if (ambiguousLockedSessionIds.length) {
    blockers.push({
      code: "LOCKED_MULTI_SESSION_CLASS_UNSUPPORTED",
      message: `${ambiguousLockedSessionIds.length} locked session(s) belong to multi-session classes. Ordinal-specific runtime locks must be implemented before those sessions can be solved safely.`,
      ruleIds: [],
      entityIds: ambiguousLockedSessionIds,
    });
  }

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

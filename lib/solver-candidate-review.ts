import type { Assignment } from "@/lib/domain";
import {
  parseReviewedSolverCandidateContext,
  reviewedSolverCandidateContextsMatch,
  type ReviewedSolverCandidateContextV1,
} from "@/lib/solver-candidate-context";
import type { SolverSnapshotContextToken } from "@/lib/server-studio-state";
import type { ScheduleQualityReport, ScheduleQualityComponent } from "@/lib/schedule-quality";

export type SolverCandidateOptimizationStatus =
  | "FEASIBILITY_ONLY"
  | "OPTIMAL"
  | "FEASIBLE_INCUMBENT"
  | "NO_FEASIBLE_SOLUTION"
  | "INFEASIBLE";

export interface SolverCandidateReview {
  id: string;
  studioId: string;
  name: string;
  createdAt: string;
  createdByLabel: string;
  candidateContext: ReviewedSolverCandidateContextV1;
  assignments: Assignment[];
  quality: ScheduleQualityReport;
  optimizationStatus: SolverCandidateOptimizationStatus;
  provenOptimal: boolean;
  serviceVersion: string | null;
}

export interface SolverCandidateSessionChange {
  sessionId: string;
  left: Assignment | null;
  right: Assignment | null;
  changedFields: string[];
}

export interface SolverCandidateQualityChange {
  key: string;
  metric: ScheduleQualityComponent["metric"];
  unit: ScheduleQualityComponent["unit"];
  direction: ScheduleQualityComponent["direction"];
  leftValue: number | null;
  rightValue: number | null;
  delta: number | null;
}

export interface SolverCandidateComparison {
  leftCandidateId: string;
  rightCandidateId: string;
  changedSessions: SolverCandidateSessionChange[];
  qualityComponents: SolverCandidateQualityChange[];
}

const OPTIMIZATION_STATUSES: readonly SolverCandidateOptimizationStatus[] = [
  "FEASIBILITY_ONLY",
  "OPTIMAL",
  "FEASIBLE_INCUMBENT",
  "NO_FEASIBLE_SOLUTION",
  "INFEASIBLE",
];
const ASSIGNMENT_KEYS = [
  "id",
  "sessionId",
  "day",
  "startTime",
  "endTime",
  "teacherId",
  "roomId",
  "locked",
  "status",
] as const;
const ASSIGNMENT_COMPARISON_KEYS: readonly (keyof Assignment)[] = [
  "day",
  "startTime",
  "endTime",
  "teacherId",
  "roomId",
  "locked",
  "status",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseAssignment(value: unknown): Assignment | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  const expected = [...ASSIGNMENT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  if (ASSIGNMENT_KEYS.some((key) => key !== "locked" && key !== "status" && !nonEmptyString(value[key]))) return null;
  if (typeof value.locked !== "boolean") return null;
  if (value.status !== "NORMAL" && value.status !== "WARNING" && value.status !== "AI_PROPOSED") return null;
  return value as unknown as Assignment;
}

function parseQuality(value: unknown): ScheduleQualityReport | null {
  if (!isRecord(value) || (value.status !== "FEASIBLE" && value.status !== "INFEASIBLE") || typeof value.comparable !== "boolean") return null;
  if (!isRecord(value.breakdown) || !Array.isArray(value.metrics) || !Array.isArray(value.tiers)) return null;
  if (!Number.isSafeInteger(value.hardViolations) || !Array.isArray(value.unsupportedConstraintIds)) return null;
  if (!Array.isArray(value.explanations) || !Array.isArray(value.warnings)) return null;
  return value as unknown as ScheduleQualityReport;
}

export function parseSolverCandidateReview(raw: unknown): SolverCandidateReview | null {
  if (!isRecord(raw)
    || !nonEmptyString(raw.id)
    || !nonEmptyString(raw.studioId)
    || !nonEmptyString(raw.name)
    || !nonEmptyString(raw.createdAt)
    || !nonEmptyString(raw.createdByLabel)) return null;
  const candidateContext = parseReviewedSolverCandidateContext(raw.candidateContext);
  if (!candidateContext || candidateContext.solverContextToken.studioId !== raw.studioId) return null;
  if (!Array.isArray(raw.assignments)) return null;
  const assignments = raw.assignments.map(parseAssignment);
  if (assignments.some((assignment): assignment is null => assignment === null)) return null;
  const quality = parseQuality(raw.quality);
  if (!quality || !OPTIMIZATION_STATUSES.includes(raw.optimizationStatus as SolverCandidateOptimizationStatus)) return null;
  if (typeof raw.provenOptimal !== "boolean") return null;
  if (raw.serviceVersion !== null && !nonEmptyString(raw.serviceVersion)) return null;
  return {
    id: raw.id,
    studioId: raw.studioId,
    name: raw.name,
    createdAt: raw.createdAt,
    createdByLabel: raw.createdByLabel,
    candidateContext,
    assignments: assignments as Assignment[],
    quality,
    optimizationStatus: raw.optimizationStatus as SolverCandidateOptimizationStatus,
    provenOptimal: raw.provenOptimal,
    serviceVersion: raw.serviceVersion as string | null,
  };
}

function assignmentMap(assignments: Assignment[]) {
  return new Map(assignments.map((assignment) => [assignment.sessionId, assignment]));
}

function qualityKey(component: ScheduleQualityComponent) {
  return component.ruleId || component.entityIds.length > 0
    ? [component.metric, component.ruleId || "", ...component.entityIds].join("|")
    : component.metric;
}

function qualityMap(components: ScheduleQualityComponent[]) {
  return new Map(components.map((component) => [qualityKey(component), component]));
}

export function compareSolverCandidateReviews(
  left: SolverCandidateReview,
  right: SolverCandidateReview,
): SolverCandidateComparison {
  const leftAssignments = assignmentMap(left.assignments);
  const rightAssignments = assignmentMap(right.assignments);
  const sessionIds = [...new Set([...leftAssignments.keys(), ...rightAssignments.keys()])].sort();
  const changedSessions = sessionIds.flatMap((sessionId) => {
    const leftAssignment = leftAssignments.get(sessionId) || null;
    const rightAssignment = rightAssignments.get(sessionId) || null;
    const changedFields = ASSIGNMENT_COMPARISON_KEYS.filter((key) => leftAssignment?.[key] !== rightAssignment?.[key]);
    return changedFields.length || !leftAssignment || !rightAssignment
      ? [{ sessionId, left: leftAssignment, right: rightAssignment, changedFields: !leftAssignment || !rightAssignment ? ["assignment"] : changedFields }]
      : [];
  });

  const leftQuality = qualityMap(left.quality.metrics);
  const rightQuality = qualityMap(right.quality.metrics);
  const qualityKeys = [...new Set([...leftQuality.keys(), ...rightQuality.keys()])].sort();
  const qualityComponents = qualityKeys.flatMap((key) => {
    const leftComponent = leftQuality.get(key);
    const rightComponent = rightQuality.get(key);
    const leftValue = leftComponent?.value ?? null;
    const rightValue = rightComponent?.value ?? null;
    if (leftValue === rightValue) return [];
    const component = rightComponent || leftComponent!;
    return [{
      key,
      metric: component.metric,
      unit: component.unit,
      direction: component.direction,
      leftValue,
      rightValue,
      delta: leftValue === null || rightValue === null ? null : rightValue - leftValue,
    }];
  });

  return {
    leftCandidateId: left.id,
    rightCandidateId: right.id,
    changedSessions,
    qualityComponents,
  };
}

export function solverCandidateReviewIsStale(
  candidate: SolverCandidateReview,
  currentToken: SolverSnapshotContextToken,
) {
  const currentContext: ReviewedSolverCandidateContextV1 = {
    schemaVersion: "1.0",
    compilerVersion: candidate.candidateContext.compilerVersion,
    solverContextToken: currentToken,
  };
  return !reviewedSolverCandidateContextsMatch(candidate.candidateContext, currentContext);
}

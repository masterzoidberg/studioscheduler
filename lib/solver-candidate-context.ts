import type { FeasibilitySolverProblem } from "@/lib/solver-problem";
import {
  solverSnapshotContextTokensMatch,
  type SolverSnapshotContextToken,
} from "@/lib/server-studio-state";

export interface ReviewedSolverCandidateContextV1 {
  schemaVersion: "1.0";
  compilerVersion: string;
  solverContextToken: SolverSnapshotContextToken;
}

const TOP_LEVEL_KEYS = ["schemaVersion", "compilerVersion", "solverContextToken"] as const;
const REQUIRED_NUMBER_TOKEN_KEYS = [
  "rulebookVersion",
  "planningDatasetVersion",
  "enforcementVersion",
  "constraintModelVersion",
  "scheduleVersion",
] as const;
const REQUIRED_STRING_TOKEN_KEYS = [
  "studioId",
  "scheduleId",
  "scheduleAssignmentsHash",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function parseReviewedSolverCandidateContext(raw: unknown): ReviewedSolverCandidateContextV1 | null {
  if (!isRecord(raw) || !exactKeys(raw, TOP_LEVEL_KEYS)) return null;
  if (raw.schemaVersion !== "1.0" || typeof raw.compilerVersion !== "string" || !raw.compilerVersion.trim()) return null;
  if (!isRecord(raw.solverContextToken)) return null;

  const token = raw.solverContextToken;
  if (token.schemaVersion !== "1.0") return null;
  for (const key of REQUIRED_NUMBER_TOKEN_KEYS) {
    if (typeof token[key] !== "number" || !Number.isSafeInteger(token[key])) return null;
  }
  for (const key of REQUIRED_STRING_TOKEN_KEYS) {
    if (typeof token[key] !== "string" || !token[key].trim()) return null;
  }

  return raw as unknown as ReviewedSolverCandidateContextV1;
}

export function reviewedSolverCandidateContextFromSnapshot(
  token: SolverSnapshotContextToken,
  compilerVersion: string,
): ReviewedSolverCandidateContextV1 {
  const parsed = parseReviewedSolverCandidateContext({
    schemaVersion: "1.0",
    compilerVersion,
    solverContextToken: token,
  });
  if (!parsed) {
    throw new Error(
      "SOLVER_CANDIDATE_CONTEXT_INCOMPLETE: A reviewed candidate requires current Rulebook, Planning Dataset, EnforcementVersion, ConstraintModelVersion, ScheduleVersion, schedule identity, and schedule/lock fingerprint.",
    );
  }
  return parsed;
}

export function buildReviewedSolverCandidateContext(
  problem: FeasibilitySolverProblem,
  token: SolverSnapshotContextToken,
): ReviewedSolverCandidateContextV1 {
  const context = reviewedSolverCandidateContextFromSnapshot(token, problem.context.compilerVersion);
  if (token.studioId !== problem.context.studioId
      || token.rulebookVersion !== problem.context.rulebookVersion
      || token.planningDatasetVersion !== problem.context.planningDatasetVersion) {
    throw new Error("SOLVER_CANDIDATE_CONTEXT_MISMATCH: Prepared solver problem and coherent snapshot token disagree.");
  }
  return context;
}

export function reviewedSolverCandidateContextsMatch(
  left: ReviewedSolverCandidateContextV1,
  right: ReviewedSolverCandidateContextV1,
) {
  return left.schemaVersion === right.schemaVersion
    && left.compilerVersion === right.compilerVersion
    && solverSnapshotContextTokensMatch(left.solverContextToken, right.solverContextToken);
}

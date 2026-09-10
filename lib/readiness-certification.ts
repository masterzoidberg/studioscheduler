import type {
  ReadinessCertificationState,
  ReadinessReviewClassification,
  ReadinessReviewFinding,
} from "@/lib/domain";
import type { ScheduleReadinessIssue } from "@/lib/schedule-readiness";

export type ReadinessOperation =
  | "CERTIFICATION"
  | "AUTOMATIC_SOLVE"
  | "CANDIDATE_ADOPTION"
  | "FINAL_EXPORT";

export const CERTIFICATION_REVIEW_SCHEMA_VERSION = 1;
const REVIEWED_STATES = new Set([
  "REVIEWED",
  "REVIEWED_VALUE",
  "REVIEWED_NO_ADDITIONAL_RESTRICTION",
]);

const blockedOperations: ReadinessOperation[] = [
  "CERTIFICATION",
  "AUTOMATIC_SOLVE",
  "CANDIDATE_ADOPTION",
  "FINAL_EXPORT",
];

function mismatch(left: unknown, right: unknown) {
  return left !== right;
}

export function reviewFindingIsResolved(finding: ReadinessReviewFinding) {
  return REVIEWED_STATES.has(finding.state);
}

export function readinessCertificationIssues(
  certification: ReadinessCertificationState,
): ScheduleReadinessIssue[] {
  const issues: ScheduleReadinessIssue[] = [];

  for (const finding of certification.reviewFindings) {
    if (reviewFindingIsResolved(finding)) continue;
    const required = finding.classification === "MUST";
    const code = finding.state === "CHANGED_SINCE_REVIEW"
      ? "READINESS_REVIEW_STALE"
      : finding.state === "BLOCKED"
        ? "READINESS_REVIEW_BLOCKED"
        : "READINESS_REVIEW_REQUIRED";
    issues.push({
      code,
      severity: required ? "BLOCKER" : "WARNING",
      message: finding.message,
      ruleIds: finding.ruleIds,
      entityIds: finding.entityIds,
      classification: finding.classification,
      requiredAction: required ? "Open Setup and review this current slice." : "Record the preference or continue with a known quality limitation.",
      deepLink: required ? "/setup" : "/readiness",
      operationsBlocked: required ? blockedOperations : [],
    });
  }

  const current = certification.certification;
  if (current && (
    mismatch(current.planningDatasetVersion, certification.currentPlanningDatasetVersion)
    || mismatch(current.planningSnapshotHash, certification.currentPlanningSnapshotHash)
    || mismatch(current.rulebookVersion, certification.currentRulebookVersion)
    || mismatch(current.constraintModelVersion, certification.currentConstraintModelVersion)
    || mismatch(current.constraintModelSnapshotHash, certification.currentConstraintModelSnapshotHash)
    || mismatch(current.reviewSetSchemaVersion, certification.reviewSetSchemaVersion)
    || mismatch(current.reviewSetFingerprint, certification.reviewSetFingerprint)
  )) {
    issues.push({
      code: "PLANNING_CERTIFICATION_STALE",
      severity: "BLOCKER",
      message: "Planning, Rulebook, Constraint Model, or reviewed setup context changed after certification. Confirm the current context again.",
      ruleIds: [],
      entityIds: [],
      classification: "MUST",
      requiredAction: "Reconfirm the current setup context.",
      deepLink: "/setup",
      operationsBlocked: blockedOperations,
    });
  }

  return issues;
}

export function readinessGate(
  issues: ScheduleReadinessIssue[],
  operation: ReadinessOperation,
) {
  const blockers = issues.filter((issue) => issue.severity === "BLOCKER" && (issue.operationsBlocked?.includes(operation) ?? true));
  const warnings = issues.filter((issue) => issue.severity === "WARNING");
  return { ready: blockers.length === 0, blockers, warnings };
}

export function classifyReviewFinding(
  classification: ReadinessReviewClassification,
  state: ReadinessReviewFinding["state"],
  detail: string,
): ReadinessReviewFinding {
  return {
    code: classification === "MUST" ? "READINESS_REVIEW_REQUIRED" : "READINESS_PREFERENCE_REVIEW",
    scopeKind: "UNKNOWN",
    entityId: null,
    aspect: "unknown",
    state,
    classification,
    message: detail,
    ruleIds: [],
    entityIds: [],
    currentFingerprint: null,
  };
}

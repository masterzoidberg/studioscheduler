import type { ScheduleReadinessIssue, ScheduleReadinessReport } from "@/lib/schedule-readiness";

const CONFIRMATION_REMEDIABLE_CODES = new Set([
  "PLANNING_DATASET_NOT_CONFIRMED",
  "SCHEDULE_PLANNING_DATASET_STALE",
]);

/**
 * Confirmation is the editor's assertion that the current immutable planning
 * facts are suitable to become scheduling authority. The confirmation itself
 * resolves PLANNING_DATASET_NOT_CONFIRMED, and a fresh solve can replace a
 * stale prior schedule. Every other deterministic readiness blocker must be
 * repaired before the UI permits confirmation.
 */
export function planningConfirmationBlockers(report: ScheduleReadinessReport): ScheduleReadinessIssue[] {
  return report.blockers.filter((issue) => !CONFIRMATION_REMEDIABLE_CODES.has(issue.code));
}

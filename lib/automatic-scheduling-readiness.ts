import type { StudioState } from "@/lib/domain";
import {
  evaluateScheduleReadiness,
  type ScheduleReadinessIssue,
  type ScheduleReadinessReport,
} from "@/lib/schedule-readiness";

const REQUIRED_KARLY_DAUGHTER_CLASSES = [
  "Ballet 2",
  "Jazz 2",
  "Lyrical 2",
  "Tap 2",
  "Hip Hop 2",
  "Pre-Company Technique 1",
] as const;

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

export interface AutomaticSchedulingReadinessReport extends ScheduleReadinessReport {
  basePlanningReady: boolean;
}

function blocker(code: string, message: string, ruleIds: string[], entityIds: string[] = []): ScheduleReadinessIssue {
  return { code, severity: "BLOCKER", message, ruleIds, entityIds };
}

function checkKarlyDaughterEnrollment(state: StudioState): ScheduleReadinessIssue[] {
  const issues: ScheduleReadinessIssue[] = [];
  const daughterMatches = state.students.filter((student) => normalizeName(student.name) === normalizeName("Karly's daughter"));

  if (daughterMatches.length !== 1) {
    issues.push(blocker(
      daughterMatches.length === 0 ? "KARLY_DAUGHTER_STUDENT_MISSING" : "KARLY_DAUGHTER_STUDENT_AMBIGUOUS",
      daughterMatches.length === 0
        ? "KAR-008 identifies Karly's daughter as a scheduling fact, but that student cannot be resolved in the current Planning Dataset."
        : `KAR-008 identifies one Karly's daughter relationship, but ${daughterMatches.length} matching student records exist in the current Planning Dataset.`,
      ["KAR-008", "KAR-009"],
      daughterMatches.map((student) => student.id),
    ));
    return issues;
  }

  const daughter = daughterMatches[0];
  for (const requiredName of REQUIRED_KARLY_DAUGHTER_CLASSES) {
    const classes = state.classes.filter((klass) => normalizeName(klass.name) === normalizeName(requiredName));
    if (classes.length === 0) {
      issues.push(blocker(
        "KARLY_DAUGHTER_CLASS_MISSING",
        `KAR-008 says Karly's daughter takes ${requiredName}, but that class is absent from the current Planning Dataset.`,
        ["KAR-008"],
        [daughter.id],
      ));
      continue;
    }
    if (classes.length > 1) {
      issues.push(blocker(
        "KARLY_DAUGHTER_CLASS_AMBIGUOUS",
        `KAR-008 says Karly's daughter takes ${requiredName}, but ${classes.length} planning classes resolve to that canonical name.`,
        ["KAR-008"],
        [daughter.id, ...classes.map((klass) => klass.id)],
      ));
      continue;
    }
    const klass = classes[0];
    if (!klass.rosterStudentIds.includes(daughter.id)) {
      issues.push(blocker(
        "KARLY_DAUGHTER_ROSTER_MISSING",
        `KAR-008 says Karly's daughter takes ${requiredName}, but she is not on that class's current roster.`,
        ["KAR-008", "STU-002"],
        [daughter.id, klass.id],
      ));
    }
  }

  return issues;
}

/**
 * Solver release gate layered on top of ordinary planning-data integrity.
 *
 * Manual planning may remain useful while source provenance is incomplete. An
 * automatic solver has a stricter burden: the authoritative-enrollment rule must
 * have a complete pinned baseline, and named HARD data facts must be represented
 * by the current Planning Dataset before optimization is allowed to start.
 */
export function evaluateAutomaticSchedulingReadiness(state: StudioState): AutomaticSchedulingReadinessReport {
  const base = evaluateScheduleReadiness(state);
  const provenanceBlockerCodes = new Set([
    "SOURCE_MANIFEST_NOT_PINNED",
    "SOURCE_MANIFEST_INCOMPLETE",
    "SOURCE_MANIFEST_SCHEMA_UNSUPPORTED",
  ]);
  const promoted = base.warnings
    .filter((issue) => provenanceBlockerCodes.has(issue.code))
    .map((issue) => ({ ...issue, severity: "BLOCKER" as const }));
  const retainedWarnings = base.warnings.filter((issue) => !provenanceBlockerCodes.has(issue.code));
  const dataFactIssues = checkKarlyDaughterEnrollment(state);
  const blockers = [...base.blockers, ...promoted, ...dataFactIssues];

  return {
    ...base,
    ready: blockers.length === 0,
    basePlanningReady: base.ready,
    blockers,
    warnings: retainedWarnings,
  };
}

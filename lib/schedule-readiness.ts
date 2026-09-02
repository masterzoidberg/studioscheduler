import type { ClassDefinition, ClassSession, PlanningDatasetVersion, StudioState } from "@/lib/domain";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { validateConstraintModelBindings, type ConstraintDataBindingReport } from "@/lib/constraint-data-binding";
import { ruleExecutionCoverage } from "@/lib/rule-execution-registry";
import { sessionDurationMinutes } from "@/lib/schedule-builder";

export type ScheduleReadinessSeverity = "BLOCKER" | "WARNING";

export interface ScheduleReadinessIssue {
  code: string;
  severity: ScheduleReadinessSeverity;
  message: string;
  ruleIds: string[];
  entityIds: string[];
}

export interface ScheduleReadinessReport {
  ready: boolean;
  blockers: ScheduleReadinessIssue[];
  warnings: ScheduleReadinessIssue[];
  ruleCoverage: ReturnType<typeof ruleExecutionCoverage>;
  constraintBinding: ConstraintDataBindingReport;
  currentPlanningDatasetVersion: number | null;
  schedulePlanningDatasetVersion: number | null;
  sourceManifestVersion: number | null;
  sourceManifestComplete: boolean;
}

type StructureRequirement = {
  ruleIds: string[];
  className: string;
  frequency: number;
  durations?: number[];
};

export const BALLET_STRUCTURE_REQUIREMENTS: StructureRequirement[] = [
  { ruleIds: ["BAL-001"], className: "Elementary Ballet 1", frequency: 1, durations: [60] },
  { ruleIds: ["BAL-002"], className: "Elementary Ballet 2", frequency: 2, durations: [75, 75] },
  { ruleIds: ["BAL-003"], className: "Ballet 1", frequency: 2, durations: [90, 90] },
  { ruleIds: ["BAL-004"], className: "Ballet 2", frequency: 2, durations: [90, 90] },
  { ruleIds: ["BAL-005"], className: "Ballet 3", frequency: 2, durations: [90, 90] },
  { ruleIds: ["BAL-006"], className: "Ballet 4A", frequency: 1 },
  { ruleIds: ["BAL-006", "BAL-007", "BAL-010"], className: "Ballet 4A/4B", frequency: 1, durations: [90] },
  { ruleIds: ["BAL-007", "BAL-008", "BAL-009"], className: "Ballet 4B/5", frequency: 2, durations: [90, 105] },
  { ruleIds: ["BAL-008", "BAL-011"], className: "Ballet 5", frequency: 1, durations: [90] },
  { ruleIds: ["BAL-012"], className: "Pre-Pointe", frequency: 1, durations: [30] },
  { ruleIds: ["BAL-013"], className: "Pointe 1", frequency: 1, durations: [30] },
  { ruleIds: ["BAL-014"], className: "Pointe 2/3", frequency: 1, durations: [60] },
];

const SOURCE_MANIFEST_RULE_IDS = ["CUR-001", "CUR-002", "CUR-003", "CUR-004", "CUR-005", "CUR-006", "STU-002"];
const KARLY_DAUGHTER_CLASS_NAMES = [
  "Ballet 2",
  "Jazz 2",
  "Lyrical 2",
  "Tap 2",
  "Hip Hop 2",
  "Pre-Company Technique 1",
] as const;
const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const sortedStrings = (values: string[]) => [...values].sort();
const sameStrings = (a: string[], b: string[]) => {
  const left = sortedStrings(a);
  const right = sortedStrings(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

function add(
  issues: ScheduleReadinessIssue[],
  code: string,
  message: string,
  ruleIds: string[] = [],
  entityIds: string[] = [],
  severity: ScheduleReadinessSeverity = "BLOCKER",
) {
  issues.push({ code, severity, message, ruleIds, entityIds });
}

function findClass(state: StudioState, className: string) {
  const target = normalizeName(className);
  return state.classes.find((klass) => normalizeName(klass.name) === target) ?? null;
}

function findClasses(state: StudioState, className: string) {
  const target = normalizeName(className);
  return state.classes.filter((klass) => normalizeName(klass.name) === target);
}

function sessionsFor(state: StudioState, klass: ClassDefinition) {
  return state.sessions.filter((session) => session.classId === klass.id).sort((a, b) => a.ordinal - b.ordinal);
}

function effectiveDurations(klass: ClassDefinition, sessions: ClassSession[]) {
  return sorted(sessions.map((session) => sessionDurationMinutes(session, klass)));
}

// A source manifest is optional for ordinary editing, but automatic solving has a
// stronger provenance burden. STU-002 says the uploaded rosters are authoritative,
// so the solver must be able to prove the baseline enrollment set it started from.
function checkSourceManifest(state: StudioState, currentPlanning: PlanningDatasetVersion | null, issues: ScheduleReadinessIssue[]) {
  const pin = currentPlanning?.snapshot.sourceManifest ?? null;
  if (!pin) {
    add(
      issues,
      "SOURCE_MANIFEST_NOT_PINNED",
      "No complete roster/source baseline is pinned. Manual planning can continue, but automatic solving is blocked because the authoritative 2026-27 enrollment baseline cannot be reproduced.",
      SOURCE_MANIFEST_RULE_IDS,
    );
    return;
  }

  if (!pin.complete) {
    add(
      issues,
      "SOURCE_MANIFEST_INCOMPLETE",
      `Planning Source Manifest v${pin.version} is incomplete. Automatic solving requires a complete authoritative roster/source baseline before it may generate a schedule.`,
      SOURCE_MANIFEST_RULE_IDS,
    );
  }

  if (pin.snapshot.schemaVersion !== "1.0") {
    add(
      issues,
      "SOURCE_MANIFEST_SCHEMA_UNSUPPORTED",
      `Planning Source Manifest v${pin.version} uses unsupported schema ${pin.snapshot.schemaVersion}; automatic solving cannot verify the baseline against current planning data.`,
      SOURCE_MANIFEST_RULE_IDS,
    );
    return;
  }

  const manifestIds = pin.snapshot.classes.map((item) => item.id);
  const liveIds = state.classes.map((item) => item.id);
  if (!sameStrings(manifestIds, liveIds)) {
    const manifestSet = new Set(manifestIds);
    const liveSet = new Set(liveIds);
    const missing = manifestIds.filter((id) => !liveSet.has(id));
    const extra = liveIds.filter((id) => !manifestSet.has(id));
    add(
      issues,
      "SOURCE_MANIFEST_CLASS_SET_MISMATCH",
      `Current planning inventory differs from Source Manifest v${pin.version}: ${missing.length} former class${missing.length === 1 ? "" : "es"} absent and ${extra.length} newer class${extra.length === 1 ? "" : "es"} present. This is recorded drift, not automatic illegality after the baseline has been established.`,
      ["CUR-001", "CUR-002", "CUR-003", "CUR-004"],
      [...missing, ...extra],
      "WARNING",
    );
  }

  const liveById = new Map(state.classes.map((klass) => [klass.id, klass]));
  for (const expected of pin.snapshot.classes) {
    const klass = liveById.get(expected.id);
    if (!klass) continue;
    const sessions = sessionsFor(state, klass);
    if (klass.weeklyFrequency !== expected.weeklyFrequency || sessions.length !== expected.weeklyFrequency) {
      add(
        issues,
        "SOURCE_MANIFEST_FREQUENCY_MISMATCH",
        `${klass.name} differs from Source Manifest v${pin.version}: baseline ${expected.weeklyFrequency} weekly session(s), current planning frequency ${klass.weeklyFrequency} with ${sessions.length} session row(s).`,
        ["CUR-001", "CUR-006"],
        [klass.id, ...sessions.map((session) => session.id)],
        "WARNING",
      );
    }

    const actualDurations = effectiveDurations(klass, sessions);
    const expectedDurations = sorted(expected.sessionDurations);
    if (actualDurations.length !== expectedDurations.length || actualDurations.some((value, index) => value !== expectedDurations[index])) {
      add(
        issues,
        "SOURCE_MANIFEST_DURATION_MISMATCH",
        `${klass.name} duration data differs from Source Manifest v${pin.version}: baseline ${expectedDurations.join("/")} minutes, current planning ${actualDurations.join("/") || "none"}.`,
        ["CUR-005"],
        [klass.id, ...sessions.map((session) => session.id)],
        "WARNING",
      );
    }

    if (!sameStrings(klass.rosterStudentIds, expected.rosterStudentIds)) {
      add(
        issues,
        "SOURCE_MANIFEST_ROSTER_MISMATCH",
        `${klass.name}'s current roster differs from Source Manifest v${pin.version}. Current Planning Dataset enrollment is authoritative after the baseline was established.`,
        ["STU-002"],
        [klass.id, ...new Set([...klass.rosterStudentIds, ...expected.rosterStudentIds])],
        "WARNING",
      );
    }
  }
}

function checkStructure(state: StudioState, issues: ScheduleReadinessIssue[]) {
  for (const requirement of BALLET_STRUCTURE_REQUIREMENTS) {
    const klass = findClass(state, requirement.className);
    if (!klass) {
      add(issues, "MISSING_REQUIRED_CLASS", `${requirement.className} is required by the reviewed Rulebook but is not represented in planning data.`, requirement.ruleIds);
      continue;
    }

    const sessions = sessionsFor(state, klass);
    if (klass.weeklyFrequency !== requirement.frequency || sessions.length !== requirement.frequency) {
      add(
        issues,
        "CLASS_FREQUENCY_MISMATCH",
        `${klass.name} must have ${requirement.frequency} weekly session${requirement.frequency === 1 ? "" : "s"}; planning data currently says frequency ${klass.weeklyFrequency} with ${sessions.length} session row${sessions.length === 1 ? "" : "s"}.`,
        [...new Set([...requirement.ruleIds, "CUR-006"])],
        [klass.id, ...sessions.map((session) => session.id)],
      );
    }

    if (requirement.durations && sessions.length === requirement.durations.length) {
      const actual = effectiveDurations(klass, sessions);
      const expected = sorted(requirement.durations);
      if (actual.length !== expected.length || actual.some((duration, index) => duration !== expected[index])) {
        add(
          issues,
          "CLASS_DURATION_MISMATCH",
          `${klass.name} requires weekly session duration${expected.length === 1 ? "" : "s"} of ${expected.join(" and ")} minutes; planning data currently resolves to ${actual.join(" and ")} minutes.`,
          [...new Set([...requirement.ruleIds, "CUR-005"])],
          [klass.id, ...sessions.map((session) => session.id)],
        );
      }
    }
  }
}

function checkAdvancedBalletParticipation(state: StudioState, issues: ScheduleReadinessIssue[]) {
  const requirements = [
    { level: "Level 4A", classNames: ["Ballet 4A", "Ballet 4A/4B"], ruleId: "BAL-006" },
    { level: "Level 4B", classNames: ["Ballet 4A/4B", "Ballet 4B/5"], ruleId: "BAL-007" },
    { level: "Level 5", classNames: ["Ballet 4B/5", "Ballet 5"], ruleId: "BAL-008" },
  ];

  for (const requirement of requirements) {
    const dancers = state.students.filter((student) => student.level === requirement.level);
    if (dancers.length === 0) continue;
    for (const className of requirement.classNames) {
      const klass = findClass(state, className);
      if (!klass) continue;
      const missing = dancers.filter((student) => !klass.rosterStudentIds.includes(student.id));
      if (missing.length) {
        add(
          issues,
          "ADVANCED_BALLET_ROSTER_MISMATCH",
          `${missing.length} ${requirement.level} dancer${missing.length === 1 ? " is" : "s are"} missing from ${klass.name}'s working roster despite the reviewed advanced-Ballet participation rule.`,
          [requirement.ruleId, "STU-002"],
          [klass.id, ...missing.map((student) => student.id)],
        );
      }
    }
  }
}

function checkKarlyDaughterEnrollment(state: StudioState, issues: ScheduleReadinessIssue[]) {
  const daughterMatches = state.students.filter((student) => normalizeName(student.name) === normalizeName("Karly's daughter"));
  if (daughterMatches.length !== 1) {
    add(
      issues,
      daughterMatches.length === 0 ? "KARLY_DAUGHTER_STUDENT_MISSING" : "KARLY_DAUGHTER_STUDENT_AMBIGUOUS",
      daughterMatches.length === 0
        ? "KAR-008 identifies Karly's daughter as a current scheduling fact, but that student cannot be resolved in planning data."
        : `KAR-008 identifies one Karly's daughter relationship, but ${daughterMatches.length} matching student records exist.`,
      ["KAR-008", "KAR-009"],
      daughterMatches.map((student) => student.id),
    );
    return;
  }

  const daughter = daughterMatches[0];
  for (const className of KARLY_DAUGHTER_CLASS_NAMES) {
    const matches = findClasses(state, className);
    if (matches.length === 0) {
      add(
        issues,
        "KARLY_DAUGHTER_CLASS_MISSING",
        `KAR-008 says Karly's daughter takes ${className}, but that class is absent from the current Planning Dataset.`,
        ["KAR-008"],
        [daughter.id],
      );
      continue;
    }
    if (matches.length > 1) {
      add(
        issues,
        "KARLY_DAUGHTER_CLASS_AMBIGUOUS",
        `KAR-008 says Karly's daughter takes ${className}, but ${matches.length} classes resolve to that canonical name.`,
        ["KAR-008"],
        [daughter.id, ...matches.map((klass) => klass.id)],
      );
      continue;
    }
    const klass = matches[0];
    if (!klass.rosterStudentIds.includes(daughter.id)) {
      add(
        issues,
        "KARLY_DAUGHTER_ROSTER_MISSING",
        `KAR-008 says Karly's daughter takes ${className}, but she is not on that class's current roster.`,
        ["KAR-008", "STU-002"],
        [daughter.id, klass.id],
      );
    }
  }
}

function checkGenericPlanningIntegrity(state: StudioState, issues: ScheduleReadinessIssue[]) {
  const classIds = new Set(state.classes.map((klass) => klass.id));
  const studentIds = new Set(state.students.map((student) => student.id));

  for (const session of state.sessions) {
    if (!classIds.has(session.classId)) {
      add(issues, "SESSION_CLASS_MISSING", `${session.id} references missing class ${session.classId}.`, ["CUR-001"], [session.id, session.classId]);
    }
  }

  for (const klass of state.classes) {
    const sessions = sessionsFor(state, klass);
    const ordinals = new Set<number>();
    for (const session of sessions) {
      if (ordinals.has(session.ordinal)) {
        add(issues, "DUPLICATE_SESSION_ORDINAL", `${klass.name} has duplicate session ordinal ${session.ordinal}.`, ["CUR-001", "CUR-006"], [klass.id, session.id]);
      }
      ordinals.add(session.ordinal);
      if (sessionDurationMinutes(session, klass) <= 0) {
        add(issues, "INVALID_SESSION_DURATION", `${klass.name} session ${session.ordinal} has no valid duration.`, ["CUR-005"], [klass.id, session.id]);
      }
    }

    if (sessions.length !== klass.weeklyFrequency) {
      add(
        issues,
        "SESSION_COUNT_MISMATCH",
        `${klass.name} declares weekly frequency ${klass.weeklyFrequency} but has ${sessions.length} session row${sessions.length === 1 ? "" : "s"}.`,
        ["CUR-006"],
        [klass.id, ...sessions.map((session) => session.id)],
      );
    }

    const missingRosterIds = [...new Set(klass.rosterStudentIds.filter((id) => !studentIds.has(id)))];
    if (missingRosterIds.length) {
      add(
        issues,
        "ROSTER_STUDENT_MISSING",
        `${klass.name} contains ${missingRosterIds.length} roster student reference${missingRosterIds.length === 1 ? "" : "s"} that do not exist in planning data.`,
        ["STU-002"],
        [klass.id, ...missingRosterIds],
      );
    }
  }

  const tap1 = findClass(state, "Tap 1");
  if (tap1?.companyOnly) {
    add(issues, "TAP_1_COMPANY_ONLY_ERROR", "Tap 1 is incorrectly marked Company Only in planning data.", ["REV-001"], [tap1.id]);
  }
}

function checkConstraintBindings(state: StudioState, issues: ScheduleReadinessIssue[]) {
  const model = compileConstraintModel(state);
  const binding = validateConstraintModelBindings(state, model);
  for (const issue of binding.issues) {
    add(
      issues,
      issue.status === "MISSING" ? "CONSTRAINT_ENTITY_MISSING" : "CONSTRAINT_ENTITY_AMBIGUOUS",
      issue.status === "MISSING"
        ? `${issue.constraintId} expects ${issue.entityType.toLowerCase()} “${issue.expectedName}”, but no current planning entity resolves to that name.`
        : `${issue.constraintId} expects one ${issue.entityType.toLowerCase()} “${issue.expectedName}”, but ${issue.matchedEntityIds.length} current planning entities resolve to that name.`,
      issue.ruleIds,
      issue.matchedEntityIds,
    );
  }
  return binding;
}

export function evaluateScheduleReadiness(state: StudioState): ScheduleReadinessReport {
  const issues: ScheduleReadinessIssue[] = [];
  const ruleCoverage = ruleExecutionCoverage(state.rules);
  if (!ruleCoverage.complete || ruleCoverage.activeRules !== 178) {
    add(
      issues,
      "RULE_EXECUTION_REGISTRY_INCOMPLETE",
      `Execution Registry accounts for ${ruleCoverage.accountedRules} of ${ruleCoverage.activeRules} active Rulebook rules; automatic scheduling requires exact 178/178 accounting.`,
      [...ruleCoverage.missingRuleIds, ...ruleCoverage.unknownRuleIds],
    );
  }

  const currentPlanning = state.planningDatasetVersions?.find((version) => version.status === "CURRENT") ?? null;
  const currentSchedule = state.scheduleVersions.find((version) => version.isCurrent) ?? null;
  const schedulePlanningVersion = currentSchedule?.planningDatasetVersion ?? null;

  if (!currentPlanning) {
    add(issues, "PLANNING_DATASET_VERSION_MISSING", "No current PlanningDatasetVersion is loaded. Automatic scheduling cannot prove which mutable facts it is using.");
  } else if (schedulePlanningVersion !== currentPlanning.version) {
    add(
      issues,
      "SCHEDULE_PLANNING_DATASET_STALE",
      `Current Schedule v${currentSchedule?.version ?? "?"} is pinned to Planning Dataset v${schedulePlanningVersion ?? "unversioned"}, while Planning Dataset v${currentPlanning.version} is current.`,
      [],
      currentSchedule ? [currentSchedule.id] : [],
    );
  }

  checkGenericPlanningIntegrity(state, issues);
  checkStructure(state, issues);
  checkAdvancedBalletParticipation(state, issues);
  checkKarlyDaughterEnrollment(state, issues);
  checkSourceManifest(state, currentPlanning, issues);
  const constraintBinding = checkConstraintBindings(state, issues);

  const blockers = issues.filter((issue) => issue.severity === "BLOCKER");
  const warnings = issues.filter((issue) => issue.severity === "WARNING");
  const sourceManifest = currentPlanning?.snapshot.sourceManifest ?? null;
  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    ruleCoverage,
    constraintBinding,
    currentPlanningDatasetVersion: currentPlanning?.version ?? null,
    schedulePlanningDatasetVersion: schedulePlanningVersion,
    sourceManifestVersion: sourceManifest?.version ?? null,
    sourceManifestComplete: Boolean(sourceManifest?.complete),
  };
}

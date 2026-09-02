import type { ClassDefinition, ClassSession, StudioState } from "@/lib/domain";
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
  currentPlanningDatasetVersion: number | null;
  schedulePlanningDatasetVersion: number | null;
}

type StructureRequirement = {
  ruleIds: string[];
  className: string;
  frequency: number;
  durations?: number[];
};

// These are deterministic engineering interpretations of the reviewed BAL-001..BAL-014
// class-structure facts. They are intentionally declarative so the same facts can later
// feed the Constraint IR rather than being rewritten separately in validator and solver code.
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

const SOURCE_MANIFEST_RULE_IDS = ["CUR-001", "CUR-002", "CUR-003", "CUR-004", "STU-002"];

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

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

function sessionsFor(state: StudioState, klass: ClassDefinition) {
  return state.sessions.filter((session) => session.classId === klass.id).sort((a, b) => a.ordinal - b.ordinal);
}

function effectiveDurations(klass: ClassDefinition, sessions: ClassSession[]) {
  return sorted(sessions.map((session) => sessionDurationMinutes(session, klass)));
}

function checkStructure(state: StudioState, issues: ScheduleReadinessIssue[]) {
  for (const requirement of BALLET_STRUCTURE_REQUIREMENTS) {
    const klass = findClass(state, requirement.className);
    if (!klass) {
      add(
        issues,
        "MISSING_REQUIRED_CLASS",
        `${requirement.className} is required by the reviewed Rulebook but is not represented in planning data.`,
        requirement.ruleIds,
      );
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
          `${missing.length} ${requirement.level} dancer${missing.length === 1 ? " is" : "s are"} missing from ${klass.name}'s authoritative roster.`,
          [requirement.ruleId, "STU-002"],
          [klass.id, ...missing.map((student) => student.id)],
        );
      }
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

  // The current application has no immutable source-inventory/roster manifest yet. Without
  // that source-side manifest CUR-001..004 and STU-002 cannot be proven merely by checking
  // that today's mutable tables are internally consistent.
  add(
    issues,
    "SOURCE_MANIFEST_NOT_PINNED",
    "The authoritative class-inventory and roster source manifest is not yet pinned to the Planning Dataset, so the system cannot prove that classes or enrollments were not silently omitted, added, merged, or split.",
    SOURCE_MANIFEST_RULE_IDS,
  );

  const blockers = issues.filter((issue) => issue.severity === "BLOCKER");
  const warnings = issues.filter((issue) => issue.severity === "WARNING");
  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    ruleCoverage,
    currentPlanningDatasetVersion: currentPlanning?.version ?? null,
    schedulePlanningDatasetVersion: schedulePlanningVersion,
  };
}

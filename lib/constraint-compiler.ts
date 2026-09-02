import type { StudioRule, StudioState } from "@/lib/domain";
import type { ConstraintIRKind, ConstraintIRNode, ConstraintModelSnapshotV1, ConstraintSelectorIR } from "@/lib/constraint-ir";
import { RULE_EXECUTION_REGISTRY } from "@/lib/rule-execution-registry";

export const CONSTRAINT_COMPILER_VERSION = "dwde-ir-0.1";
const compareCanonicalStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface MechanicalConstraintSpec {
  id: string;
  kind: ConstraintIRKind;
  ruleIds: string[];
  selector?: ConstraintSelectorIR;
  parameters?: Record<string, unknown>;
}

const MECHANICAL_CONSTRAINTS: MechanicalConstraintSpec[] = [
  { id: "room-no-overlap", kind: "RESOURCE_NO_OVERLAP", ruleIds: ["OPS-008"], parameters: { resource: "ROOM" } },
  { id: "teacher-no-overlap", kind: "RESOURCE_NO_OVERLAP", ruleIds: ["OPS-009"], parameters: { resource: "TEACHER" } },
  { id: "student-no-overlap", kind: "RESOURCE_NO_OVERLAP", ruleIds: ["OPS-010", "STU-003"], parameters: { resource: "STUDENT_ROSTER" } },
  { id: "fifteen-minute-grid", kind: "TIME_GRID", ruleIds: ["OPS-017"], parameters: { minutes: 15 } },
  { id: "weekday-normal-latest-finish", kind: "DAY_TIME_WINDOW", ruleIds: ["OPS-003"], parameters: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], latestFinish: "21:30" } },
  { id: "level-5-latest-finish-exception", kind: "DAY_TIME_WINDOW", ruleIds: ["OPS-004"], selector: { levels: ["Level 5"] }, parameters: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], latestFinish: "21:45", overrides: "weekday-normal-latest-finish" } },
  { id: "saturday-earliest-start", kind: "DAY_TIME_WINDOW", ruleIds: ["OPS-005"], parameters: { days: ["Saturday"], earliestStart: "09:00" } },
  { id: "saturday-hard-close", kind: "DAY_TIME_WINDOW", ruleIds: ["OPS-006"], parameters: { days: ["Saturday"], latestFinish: "15:00" } },
  { id: "no-sunday-regular-classes", kind: "NO_DAY", ruleIds: ["OPS-007"], parameters: { days: ["Sunday"] } },
  { id: "teacher-max-gap", kind: "MAX_GAP", ruleIds: ["OPS-013"], parameters: { resource: "TEACHER", minutes: 60 } },
  { id: "student-max-gap", kind: "MAX_GAP", ruleIds: ["OPS-014"], parameters: { resource: "STUDENT_ROSTER", minutes: 60 } },

  { id: "cami-max-workdays", kind: "MAX_WORKDAYS", ruleIds: ["CAM-006"], selector: { teacherNames: ["Cami"] }, parameters: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], maxDays: 4 } },
  { id: "aimee-days", kind: "TEACHER_DAY_WINDOW", ruleIds: ["AIM-003"], selector: { teacherNames: ["Aimee"] }, parameters: { allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"] } },
  { id: "jae-window", kind: "TEACHER_DAY_WINDOW", ruleIds: ["JAE-002"], selector: { teacherNames: ["Jae"] }, parameters: { day: "Saturday", start: "09:00", end: "12:00" } },
  { id: "jalyn-window", kind: "TEACHER_DAY_WINDOW", ruleIds: ["JAL-002"], selector: { teacherNames: ["Jalyn"] }, parameters: { day: "Thursday", start: "18:00", end: "20:00" } },
  { id: "khyre-window", kind: "TEACHER_DAY_WINDOW", ruleIds: ["KHY-002"], selector: { teacherNames: ["Khyre"] }, parameters: { day: "Saturday", start: "11:00", end: "14:00" } },

  { id: "aimee-subject-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["AIM-001"], selector: { teacherNames: ["Aimee"] }, parameters: { allowedSubjects: ["Ballet", "Pre-Pointe", "Pointe"], balletLevels: "ALL" } },
  { id: "cami-subject-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["CAM-001", "CAM-002", "CAM-003"], selector: { teacherNames: ["Cami"] }, parameters: { allowedSubjects: ["Jazz", "Tap", "Contemporary", "Lyrical"], prohibitedSubjects: ["Hip Hop"], prohibitedLevels: ["Elementary 1"] } },
  { id: "denise-subject-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["DEN-001"], selector: { teacherNames: ["Denise"] }, parameters: { allowedSubjects: ["Jazz", "Tap", "Contemporary", "Modern", "Company Technique"] } },
  { id: "jae-subject-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["JAE-001"], selector: { teacherNames: ["Jae"] }, parameters: { allowedSubjects: ["Hip Hop"] } },
  { id: "jalyn-subject-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["JAL-001", "JAL-003"], selector: { teacherNames: ["Jalyn"] }, parameters: { allowedSubjects: ["Hip Hop"], levels: "ALL" } },
  { id: "karly-subject-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["KAR-001", "KAR-002", "KAR-003", "KAR-004"], selector: { teacherNames: ["Karly"] }, parameters: { allowedSubjects: ["Ballet", "Jazz", "Contemporary", "Lyrical"], allowedLevels: ["Elementary 1", "Elementary 2", "Level 1", "Level 2", "Level 3", "Level 4A", "Level 4B", "Level 5"], exceptionClasses: ["Elementary Tap 1"], prohibitedSubjects: ["Hip Hop"] } },
  { id: "khyre-subject-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["KHY-001", "KHY-003"], selector: { teacherNames: ["Khyre"] }, parameters: { allowedSubjects: ["Hip Hop"], levels: "ALL" } },
  { id: "melina-subject-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["MEL-001"], selector: { teacherNames: ["Melina"] }, parameters: { allowedSubjects: ["Tap", "Jazz", "Hip Hop", "Ballet"], levels: "ALL" } },
  { id: "sydni-subject-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["SYD-001", "SYD-002"], selector: { teacherNames: ["Sydni"] }, parameters: { allowedSubjects: ["Combo", "Ballet", "Jazz", "Lyrical", "Elementary Tap", "Elementary Hip Hop 1"], balletJazzLyricalLevels: "ALL" } },

  { id: "cami-required-jazz-4a", kind: "REQUIRED_TEACHER", ruleIds: ["CAM-007"], selector: { classNames: ["Jazz 4A"] }, parameters: { teacherName: "Cami" } },
  { id: "cami-required-jazz-3", kind: "REQUIRED_TEACHER", ruleIds: ["CAM-008"], selector: { classNames: ["Jazz 3"] }, parameters: { teacherName: "Cami" } },
  { id: "cami-required-jazz-2", kind: "REQUIRED_TEACHER", ruleIds: ["CAM-009"], selector: { classNames: ["Jazz 2"] }, parameters: { teacherName: "Cami" } },
  { id: "cami-required-adult-jazz", kind: "REQUIRED_TEACHER", ruleIds: ["CAM-010"], selector: { classNames: ["Adult Jazz"] }, parameters: { teacherName: "Cami" } },
  { id: "cami-required-adult-tap", kind: "REQUIRED_TEACHER", ruleIds: ["CAM-011"], selector: { classNames: ["Adult Tap"] }, parameters: { teacherName: "Cami" } },

  { id: "ballet-levels-studio-a", kind: "REQUIRED_ROOM", ruleIds: ["ROOM-002", "CUR-008"], selector: { classNames: ["Ballet 1", "Ballet 2", "Ballet 3", "Ballet 4A", "Ballet 4A/4B", "Ballet 4B/5", "Ballet 5"] }, parameters: { roomName: "Studio A" } },
  { id: "pointe-studio-a", kind: "REQUIRED_ROOM", ruleIds: ["ROOM-003", "CUR-008"], selector: { classNames: ["Pre-Pointe", "Pointe 1", "Pointe 2/3"] }, parameters: { roomName: "Studio A" } },
  { id: "elementary-ballet-studio-c", kind: "REQUIRED_ROOM", ruleIds: ["ROOM-009"], selector: { classNames: ["Elementary Ballet 1", "Elementary Ballet 2"] }, parameters: { roomName: "Studio C" } },
  { id: "studio-c-capacity", kind: "ROOM_CAPACITY", ruleIds: ["ROOM-007", "ROOM-008"], selector: { roomNames: ["Studio C"] }, parameters: { maxDancers: 15, exemptLevels: ["Elementary 1", "Elementary 2"], hardCapInterpretation: true } },

  { id: "elementary-1-finish", kind: "LATEST_FINISH_BY_LEVEL", ruleIds: ["STU-005"], selector: { levels: ["Elementary 1"] }, parameters: { latestFinish: "19:00" } },
  { id: "elementary-2-finish", kind: "LATEST_FINISH_BY_LEVEL", ruleIds: ["STU-006"], selector: { levels: ["Elementary 2"] }, parameters: { latestFinish: "20:15" } },
  { id: "level-1-finish", kind: "LATEST_FINISH_BY_LEVEL", ruleIds: ["STU-007"], selector: { levels: ["Level 1"] }, parameters: { latestFinish: "20:30" } },
  { id: "level-2-finish", kind: "LATEST_FINISH_BY_LEVEL", ruleIds: ["STU-008", "FRI-003"], selector: { levels: ["Level 2"] }, parameters: { latestFinish: "20:30" } },
  { id: "level-3-finish", kind: "LATEST_FINISH_BY_LEVEL", ruleIds: ["STU-009"], selector: { levels: ["Level 3"] }, parameters: { latestFinish: "21:30" } },
  { id: "level-4a-finish", kind: "LATEST_FINISH_BY_LEVEL", ruleIds: ["STU-010"], selector: { levels: ["Level 4A"] }, parameters: { latestFinish: "21:30" } },
  { id: "level-4b-finish", kind: "LATEST_FINISH_BY_LEVEL", ruleIds: ["STU-011"], selector: { levels: ["Level 4B"] }, parameters: { latestFinish: "21:30" } },
  { id: "level-5-finish", kind: "LATEST_FINISH_BY_LEVEL", ruleIds: ["STU-012"], selector: { levels: ["Level 5"] }, parameters: { latestFinish: "21:45" } },

  { id: "combo-max-attendance-days", kind: "MAX_ATTENDANCE_DAYS", ruleIds: ["STU-013"], selector: { levels: ["Combo"] }, parameters: { maxDays: 2 } },
  { id: "elementary-1-max-attendance-days", kind: "MAX_ATTENDANCE_DAYS", ruleIds: ["STU-014"], selector: { levels: ["Elementary 1"] }, parameters: { maxDays: 2 } },
  { id: "elementary-2-max-attendance-days", kind: "MAX_ATTENDANCE_DAYS", ruleIds: ["STU-015"], selector: { levels: ["Elementary 2"] }, parameters: { maxDays: 3 } },
  { id: "level-1-max-attendance-days", kind: "MAX_ATTENDANCE_DAYS", ruleIds: ["STU-016"], selector: { levels: ["Level 1"] }, parameters: { maxDays: 3 } },
  { id: "levels-2-3-4a-max-attendance-days", kind: "MAX_ATTENDANCE_DAYS", ruleIds: ["STU-017"], selector: { levels: ["Level 2", "Level 3", "Level 4A"] }, parameters: { maxDays: 4 } },
  { id: "levels-4b-5-no-friday", kind: "NO_DAY", ruleIds: ["STU-019"], selector: { levels: ["Level 4B", "Level 5"] }, parameters: { days: ["Friday"] } },

  { id: "ballet-3-pre-pointe", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-001"], selector: { classNames: ["Ballet 3", "Pre-Pointe"] }, parameters: { predecessor: "Ballet 3", successor: "Pre-Pointe", designatedWeeklyMeeting: true, gapMinutes: 0 } },
  { id: "ballet-4a-pointe-1", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-002"], selector: { classNames: ["Ballet 4A", "Pointe 1"] }, parameters: { predecessor: "Ballet 4A", successor: "Pointe 1", designatedWeeklyMeeting: true, gapMinutes: 0 } },
  { id: "ballet-4b5-pointe-23", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-003"], selector: { classNames: ["Ballet 4B/5", "Pointe 2/3"] }, parameters: { predecessor: "Ballet 4B/5", successor: "Pointe 2/3", designatedWeeklyMeeting: true, gapMinutes: 0 } },
  { id: "jazz-1-lyrical-1", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-005"], selector: { classNames: ["Jazz 1", "Lyrical 1"] }, parameters: { predecessor: "Jazz 1", successor: "Lyrical 1", gapMinutes: 0 } },
  { id: "jazz-2-lyrical-2", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-006"], selector: { classNames: ["Jazz 2", "Lyrical 2"] }, parameters: { predecessor: "Jazz 2", successor: "Lyrical 2", gapMinutes: 0 } },
  { id: "jazz-3-contemporary-lyrical-3", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-007"], selector: { classNames: ["Jazz 3", "Contemporary/Lyrical 3"] }, parameters: { predecessor: "Jazz 3", successor: "Contemporary/Lyrical 3", gapMinutes: 0 } },
  { id: "jazz-4a-contemporary-4a", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-008"], selector: { classNames: ["Jazz 4A", "Contemporary 4A"] }, parameters: { predecessor: "Jazz 4A", successor: "Contemporary 4A", gapMinutes: 0 } },

  { id: "combo-1-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["FIX-001"], selector: { classNames: ["B/T Combo 1"] }, parameters: { day: "Saturday", start: "09:00", end: "10:00", lockType: "POLICY_FIXED" } },
  { id: "combo-2-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["FIX-002"], selector: { classNames: ["B/T Combo 2"] }, parameters: { day: "Saturday", start: "10:00", end: "11:00", lockType: "POLICY_FIXED" } },

  { id: "denise-tap-5-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["DEN-002", "DEN-003", "FIX-004"], selector: { classNames: ["Tap 5"], teacherNames: ["Denise"], roomNames: ["Studio B"] }, parameters: { day: "Tuesday", start: "16:45", end: "18:15", lockType: "POLICY_FIXED" } },
  { id: "denise-contemporary-modern-4b-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["DEN-002", "DEN-003", "FIX-004"], selector: { classNames: ["Contemporary/Modern 4B"], teacherNames: ["Denise"], roomNames: ["Studio B"] }, parameters: { day: "Tuesday", start: "18:15", end: "20:30", lockType: "POLICY_FIXED" } },
  { id: "denise-jazz-5-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["DEN-002", "DEN-003", "FIX-004"], selector: { classNames: ["Jazz 5"], teacherNames: ["Denise"], roomNames: ["Studio B"] }, parameters: { day: "Tuesday", start: "20:30", end: "21:45", lockType: "POLICY_FIXED" } },
  { id: "denise-company-tech-2-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["DEN-002", "DEN-004", "FIX-004"], selector: { classNames: ["Company Technique 2"], teacherNames: ["Denise"], roomNames: ["Studio B"] }, parameters: { day: "Wednesday", start: "16:45", end: "18:30", lockType: "POLICY_FIXED" } },
  { id: "denise-jazz-4b-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["DEN-002", "DEN-004", "FIX-004"], selector: { classNames: ["Jazz 4B"], teacherNames: ["Denise"], roomNames: ["Studio B"] }, parameters: { day: "Wednesday", start: "18:30", end: "20:30", lockType: "POLICY_FIXED" } },
  { id: "denise-contemporary-5-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["DEN-002", "DEN-004", "FIX-004"], selector: { classNames: ["Contemporary 5"], teacherNames: ["Denise"], roomNames: ["Studio B"] }, parameters: { day: "Wednesday", start: "20:30", end: "21:30", lockType: "POLICY_FIXED" } },
  { id: "denise-company-tech-3-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["DEN-002", "DEN-005", "FIX-004"], selector: { classNames: ["Company Technique 3"], teacherNames: ["Denise"], roomNames: ["Studio B"] }, parameters: { day: "Thursday", start: "16:45", end: "18:30", lockType: "POLICY_FIXED" } },
  { id: "denise-company-tech-34-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["DEN-002", "DEN-005", "FIX-004"], selector: { classNames: ["Company Technique 3/4"], teacherNames: ["Denise"], roomNames: ["Studio B"] }, parameters: { day: "Thursday", start: "18:30", end: "20:15", lockType: "POLICY_FIXED" } },
  { id: "denise-company-tech-4-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["DEN-002", "DEN-005", "FIX-004"], selector: { classNames: ["Company Technique 4"], teacherNames: ["Denise"], roomNames: ["Studio B"] }, parameters: { day: "Thursday", start: "20:15", end: "21:30", lockType: "POLICY_FIXED" } },

  { id: "karly-daughter-start-alignment", kind: "RELATIONSHIP_START_WINDOW", ruleIds: ["KAR-008", "KAR-009"], selector: { teacherNames: ["Karly"], studentRelation: "Karly's daughter" }, parameters: { daughterClassNames: ["Ballet 2", "Jazz 2", "Lyrical 2", "Tap 2", "Hip Hop 2", "Pre-Company Technique 1"], maxStartDifferenceMinutes: 30, appliesEachKarlyWorkingDay: true } },
];

function explanationFor(ruleMap: Map<string, StudioRule>, ruleIds: string[]) {
  return ruleIds.map((id) => ruleMap.get(id)?.description).filter(Boolean).join(" ");
}

export function compileConstraintModel(state: StudioState): ConstraintModelSnapshotV1 {
  const activeRules = state.rules.filter((rule) => rule.status === "ACTIVE");
  const ruleMap = new Map(activeRules.map((rule) => [rule.id, rule]));
  const currentRulebook = state.rulebookVersions.find((version) => version.status === "CURRENT") ?? state.rulebookVersions[0] ?? null;
  const currentPlanning = state.planningDatasetVersions?.find((version) => version.status === "CURRENT") ?? null;

  const hardConstraints = MECHANICAL_CONSTRAINTS
    .filter((spec) => spec.ruleIds.every((ruleId) => ruleMap.has(ruleId)))
    .map<ConstraintIRNode>((spec) => ({
      id: spec.id,
      kind: spec.kind,
      ruleIds: [...spec.ruleIds].sort(compareCanonicalStrings),
      selector: spec.selector ?? {},
      parameters: spec.parameters ?? {},
      explanation: explanationFor(ruleMap, spec.ruleIds),
    }))
    .sort((a, b) => compareCanonicalStrings(a.id, b.id));

  const representedRuleIds = new Set(hardConstraints.flatMap((node) => node.ruleIds));
  const constraintRuleIds = RULE_EXECUTION_REGISTRY
    .filter((entry) => entry.runtimeLayer === "CONSTRAINT_IR")
    .map((entry) => entry.ruleId)
    .filter((ruleId) => ruleMap.has(ruleId));
  const uncompiledConstraintRuleIds = constraintRuleIds.filter((ruleId) => !representedRuleIds.has(ruleId)).sort(compareCanonicalStrings);

  const objectivePrioritySpine = activeRules
    .filter((rule) => /^OPT-00[1-9]$/.test(rule.id))
    .map((rule) => ({
      ruleId: rule.id,
      rank: Number(rule.id.slice(-1)),
      title: rule.title,
      description: rule.description,
    }))
    .sort((a, b) => a.rank - b.rank);

  const readinessRuleIds = RULE_EXECUTION_REGISTRY
    .filter((entry) => entry.runtimeLayer === "READY_GATE" && ruleMap.has(entry.ruleId))
    .map((entry) => entry.ruleId)
    .sort(compareCanonicalStrings);

  const governanceAssertions = RULE_EXECUTION_REGISTRY
    .filter((entry) => entry.disposition === "NO_RUNTIME_EFFECT" && ruleMap.has(entry.ruleId))
    .map((entry) => ({ ruleId: entry.ruleId, family: entry.family, assertion: ruleMap.get(entry.ruleId)?.description ?? "" }))
    .sort((a, b) => compareCanonicalStrings(a.ruleId, b.ruleId));

  return {
    schemaVersion: "1.0",
    compilerVersion: CONSTRAINT_COMPILER_VERSION,
    rulebookVersion: currentRulebook?.version ?? 0,
    planningDatasetVersion: currentPlanning?.version ?? null,
    activeRuleCount: activeRules.length,
    hardConstraints,
    objectivePrioritySpine,
    readinessRuleIds,
    governanceAssertions,
    uncompiledConstraintRuleIds,
    completeHardConstraintCompilation: uncompiledConstraintRuleIds.length === 0,
  };
}

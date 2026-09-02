import type { StudioRule, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compileConstraintModel as compileV01 } from "@/lib/constraint-compiler";

export const CONSTRAINT_COMPILER_VERSION = "dwde-ir-0.3";
const compareCanonicalStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function explanationFor(ruleMap: Map<string, StudioRule>, ruleIds: string[]) {
  return ruleIds.map((id) => ruleMap.get(id)?.description).filter(Boolean).join(" ");
}

function withSequencingInterpretation(node: ConstraintIRNode, ruleMap: Map<string, StudioRule>): ConstraintIRNode {
  const pointeAdjacencyIds = new Set([
    "ballet-3-pre-pointe",
    "ballet-4a-pointe-1",
    "ballet-4b5-pointe-23",
  ]);
  if (!pointeAdjacencyIds.has(node.id) || !ruleMap.has("SEQ-004")) return node;

  const ruleIds = [...new Set([...node.ruleIds, "SEQ-004"])].sort(compareCanonicalStrings);
  return {
    ...node,
    ruleIds,
    parameters: {
      ...node.parameters,
      designatedWeeklyMeeting: true,
      appliesToEveryMatchingBalletMeeting: false,
    },
    explanation: explanationFor(ruleMap, ruleIds),
  };
}

function v3Constraints(ruleMap: Map<string, StudioRule>): ConstraintIRNode[] {
  const specs: ConstraintIRNode[] = [];

  if (ruleMap.has("OPS-001") && ruleMap.has("OPS-002")) {
    specs.push({
      id: "weekday-earliest-start",
      kind: "DAY_TIME_WINDOW",
      ruleIds: ["OPS-001", "OPS-002"],
      selector: {},
      parameters: {
        days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        normalEarliestStart: "16:45",
        exceptionEarliestStart: "16:30",
        exceptionLevels: ["Elementary 1", "Elementary 2", "Level 4B", "Level 4B/5", "Level 5"],
        preferredNormalStart: "16:45",
        displayOnlyEarlierTime: "16:15",
      },
      explanation: explanationFor(ruleMap, ["OPS-001", "OPS-002"]),
    });
  }

  if (ruleMap.has("AIM-006")) {
    specs.push({
      id: "aimee-no-operating-hours-extension",
      kind: "TEACHER_DAY_WINDOW",
      ruleIds: ["AIM-006"],
      selector: { teacherNames: ["Aimee"] },
      parameters: {
        inheritStudioOperatingWindows: true,
        mayExtendOperatingHours: false,
      },
      explanation: explanationFor(ruleMap, ["AIM-006"]),
    });
  }

  const progressionRuleIds = ["ADV-001", "ADV-002", "ADV-003", "ADV-004", "CUR-009"];
  if (progressionRuleIds.every((ruleId) => ruleMap.has(ruleId))) {
    specs.push({
      id: "required-lower-level-progression",
      kind: "REQUIRED_LOWER_LEVEL",
      ruleIds: progressionRuleIds,
      selector: { levels: ["Level 4B", "Level 5"], subjects: ["Ballet", "Jazz", "Tap", "Contemporary"] },
      parameters: {
        appliesWhenMarkedRequired: true,
        requirementSource: "AUTHORITATIVE_ROSTER_OR_SOURCE_MANIFEST",
        relationship: "IMMEDIATELY_LOWER_LEVEL_SAME_SUBJECT",
        sameDayRequired: false,
        exceptions: [
          {
            studentName: "Kiran Landis",
            hardSubjects: ["Tap"],
            excludedHardSubjects: ["Ballet", "Jazz", "Contemporary"],
            softPrioritySubjects: ["Ballet"],
            explanation: "Kiran's extra/lower-level Tap remains HARD; Jazz and Contemporary lower-level requirements are removed; Ballet remains a priority rather than a HARD lower-level requirement.",
          },
        ],
      },
      explanation: explanationFor(ruleMap, progressionRuleIds),
    });
  }

  return specs.sort((a, b) => compareCanonicalStrings(a.id, b.id));
}

export function compileConstraintModelV3(state: StudioState): ConstraintModelSnapshotV1 {
  const base = compileV01(state);
  const activeRules = state.rules.filter((rule) => rule.status === "ACTIVE");
  const ruleMap = new Map(activeRules.map((rule) => [rule.id, rule]));
  const baseHardConstraints = base.hardConstraints.map((node) => withSequencingInterpretation(node, ruleMap));
  const additions = v3Constraints(ruleMap);
  const hardConstraints = [...baseHardConstraints, ...additions]
    .sort((a, b) => compareCanonicalStrings(a.id, b.id));
  const representedRuleIds = new Set(hardConstraints.flatMap((node) => node.ruleIds));
  const uncompiledConstraintRuleIds = base.uncompiledConstraintRuleIds
    .filter((ruleId) => !representedRuleIds.has(ruleId))
    .sort(compareCanonicalStrings);

  return {
    ...base,
    compilerVersion: CONSTRAINT_COMPILER_VERSION,
    hardConstraints,
    uncompiledConstraintRuleIds,
    completeHardConstraintCompilation: uncompiledConstraintRuleIds.length === 0,
  };
}

// Canonical compiler entry point for Rulebook V3+ consumers.
export const compileConstraintModel = compileConstraintModelV3;

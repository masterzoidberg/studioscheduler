import type { StudioRule, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compileConstraintModel as compileV01 } from "@/lib/constraint-compiler";
import { reviewedDwdePolicySupport, POL01_TYPED_RULE_IDS } from "@/lib/dwde-policy-transition";
import { RULE_EXECUTION_BY_ID } from "@/lib/rule-execution-registry";
import { parseTypedPolicy, teacherDayWindowPolicyParameters } from "@/lib/typed-policy";

export const CONSTRAINT_COMPILER_VERSION = "dwde-ir-0.4";
const compareCanonicalStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const POL01_TYPED_RULE_ID_SET = new Set<string>(POL01_TYPED_RULE_IDS);

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

function compileTypedPolicies(state: StudioState, ruleMap: Map<string, StudioRule>) {
  const typedRuleIds = new Set<string>();
  const invalidHardRuleIds = new Set<string>();
  const nodes: ConstraintIRNode[] = [];
  const currentTeacherIds = new Set(state.teachers.map((teacher) => teacher.id));

  for (const rule of ruleMap.values()) {
    const parsed = parseTypedPolicy(rule);
    if (parsed.status === "NONE") continue;

    // Presence of a policy envelope claims machine authority. Suppress the
    // corresponding legacy node even when malformed so bad typed policy cannot
    // fall back to old name-bound semantics.
    typedRuleIds.add(rule.id);
    const execution = RULE_EXECUTION_BY_ID.get(rule.id);
    const hard = execution?.disposition === "HARD_CONSTRAINT" || rule.strength === "HARD";

    if (parsed.status !== "VALID") {
      if (hard) invalidHardRuleIds.add(rule.id);
      continue;
    }
    if (!POL01_TYPED_RULE_ID_SET.has(rule.id) || execution?.disposition !== "HARD_CONSTRAINT") {
      if (hard) invalidHardRuleIds.add(rule.id);
      continue;
    }
    if (!currentTeacherIds.has(parsed.policy.teacherId)) {
      invalidHardRuleIds.add(rule.id);
      continue;
    }

    nodes.push({
      id: `typed-${rule.id.toLowerCase()}-teacher-day-window`,
      kind: "TEACHER_DAY_WINDOW",
      ruleIds: [rule.id],
      selector: { teacherIds: [parsed.policy.teacherId] },
      parameters: teacherDayWindowPolicyParameters(parsed.policy),
      explanation: rule.description,
    });
  }

  return {
    typedRuleIds,
    invalidHardRuleIds,
    nodes: nodes.sort((a, b) => compareCanonicalStrings(a.id, b.id)),
  };
}

export function compileConstraintModelV3(state: StudioState): ConstraintModelSnapshotV1 {
  const base = compileV01(state);
  const currentRulebook = state.rulebookVersions.find((version) => version.status === "CURRENT") ?? null;
  const policySupport = reviewedDwdePolicySupport(currentRulebook, state.rules, state.rulebookVersions);
  const activeRules = state.rules.filter((rule) => rule.status === "ACTIVE");
  const ruleMap = new Map(activeRules.map((rule) => [rule.id, rule]));
  const typed = compileTypedPolicies(state, ruleMap);
  const baseHardConstraints = base.hardConstraints
    .filter((node) => node.ruleIds.every((ruleId) => !typed.typedRuleIds.has(ruleId)))
    .map((node) => withSequencingInterpretation(node, ruleMap));
  const additions = v3Constraints(ruleMap)
    .filter((node) => node.ruleIds.every((ruleId) => !typed.typedRuleIds.has(ruleId)));
  const candidateHardConstraints = [...baseHardConstraints, ...additions, ...typed.nodes];
  const candidateRuleIds = [...new Set(candidateHardConstraints.flatMap((node) => node.ruleIds))];
  const unsupportedRuleIds = policySupport.supported
    ? []
    : policySupport.ruleIds.length > 0 ? policySupport.ruleIds : candidateRuleIds;
  const unsupportedRuleIdSet = new Set(unsupportedRuleIds);
  const hardConstraints = candidateHardConstraints
    .filter((node) => policySupport.supported || node.ruleIds.every((ruleId) => !unsupportedRuleIdSet.has(ruleId)))
    .sort((a, b) => compareCanonicalStrings(a.id, b.id));
  const representedRuleIds = new Set(hardConstraints.flatMap((node) => node.ruleIds));
  const uncompiledConstraintRuleIds = [...new Set([
    ...base.uncompiledConstraintRuleIds,
    ...unsupportedRuleIds,
    ...typed.invalidHardRuleIds,
  ])]
    .filter((ruleId) => !representedRuleIds.has(ruleId))
    .sort(compareCanonicalStrings);

  return {
    ...base,
    compilerVersion: CONSTRAINT_COMPILER_VERSION,
    hardConstraints,
    uncompiledConstraintRuleIds,
    completeHardConstraintCompilation: policySupport.supported && uncompiledConstraintRuleIds.length === 0,
  };
}

// Canonical compiler entry point for Rulebook V3+ consumers.
export const compileConstraintModel = compileConstraintModelV3;

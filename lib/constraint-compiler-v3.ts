import type { StudioRule, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compileConstraintModel as compileV01 } from "@/lib/constraint-compiler";
import {
  reviewedDwdePolicySupport,
  typedPolicyBundleManifest,
  DWDE_TYPED_POLICY_BUNDLE_VERSION,
  POL01_TYPED_RULE_IDS,
} from "@/lib/dwde-policy-transition";
import { RULE_EXECUTION_BY_ID } from "@/lib/rule-execution-registry";
import {
  isTeacherDayWindowPolicy,
  parseTypedPolicy,
  teacherDayWindowPolicyParameters,
  type TypedPolicyV1,
} from "@/lib/typed-policy";

export const LEGACY_CONSTRAINT_COMPILER_VERSION = "dwde-ir-0.3";
export const CONSTRAINT_COMPILER_VERSION = "dwde-ir-0.4";
export const POL02_CONSTRAINT_COMPILER_VERSION = "dwde-ir-0.5";
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

function compileV4TypedPolicies(state: StudioState, ruleMap: Map<string, StudioRule>) {
  const typedRuleIds = new Set<string>();
  const invalidHardRuleIds = new Set<string>();
  const nodes: ConstraintIRNode[] = [];
  const currentTeacherIds = new Set(state.teachers.map((teacher) => teacher.id));

  for (const rule of ruleMap.values()) {
    const parsed = parseTypedPolicy(rule);
    if (parsed.status === "NONE") continue;

    typedRuleIds.add(rule.id);
    const execution = RULE_EXECUTION_BY_ID.get(rule.id);
    const hard = execution?.disposition === "HARD_CONSTRAINT" || rule.strength === "HARD";

    if (parsed.status !== "VALID") {
      if (hard) invalidHardRuleIds.add(rule.id);
      continue;
    }
    if (!POL01_TYPED_RULE_ID_SET.has(rule.id) || execution?.disposition !== "HARD_CONSTRAINT" || !isTeacherDayWindowPolicy(parsed.policy)) {
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

function hardPolicyStableIdsExist(state: StudioState, policy: TypedPolicyV1) {
  const teacherIds = new Set(state.teachers.map((teacher) => teacher.id));
  const roomIds = new Set(state.rooms.map((room) => room.id));
  const classIds = new Set(state.classes.map((klass) => klass.id));
  const allClassesExist = (ids: string[]) => ids.every((id) => classIds.has(id));

  switch (policy.kind) {
    case "TEACHER_DAY_WINDOW": return teacherIds.has(policy.teacherId);
    case "STUDIO_OPERATING_WINDOWS": return true;
    case "ROOM_UNAVAILABLE_WINDOWS": return roomIds.has(policy.roomId);
    case "TEACHER_QUALIFICATION": return teacherIds.has(policy.teacherId) && allClassesExist(policy.classIds);
    case "REQUIRED_TEACHER": return teacherIds.has(policy.teacherId) && allClassesExist(policy.classIds);
    case "REQUIRED_ROOM": return roomIds.has(policy.roomId) && allClassesExist(policy.classIds);
    case "ROOM_CAPACITY_POLICY": return roomIds.has(policy.roomId) && allClassesExist(policy.exemptClassIds || []);
    case "ROOM_REQUIRED_FEATURES": return allClassesExist(policy.classIds);
    case "PREFERRED_TEACHER":
    case "PREFERRED_ROOM":
    case "PREFERRED_DAY":
    case "AVOID_DAY":
      return true;
  }
}

function v5HardNode(rule: StudioRule, policy: TypedPolicyV1, ruleIds: string[]): ConstraintIRNode | null {
  const common = { ruleIds, explanation: rule.description };
  switch (policy.kind) {
    case "TEACHER_DAY_WINDOW":
      return {
        ...common,
        id: `typed-${rule.id.toLowerCase()}-teacher-day-window`,
        kind: "TEACHER_DAY_WINDOW",
        selector: { teacherIds: [policy.teacherId] },
        parameters: teacherDayWindowPolicyParameters(policy),
      };
    case "STUDIO_OPERATING_WINDOWS":
      return {
        ...common,
        id: `typed-${rule.id.toLowerCase()}-studio-operating-windows`,
        kind: "STUDIO_OPERATING_WINDOWS",
        selector: {},
        parameters: { windows: policy.windows, closedDays: policy.closedDays || [] },
      };
    case "ROOM_UNAVAILABLE_WINDOWS":
      return {
        ...common,
        id: `typed-${rule.id.toLowerCase()}-room-unavailable-windows`,
        kind: "ROOM_UNAVAILABLE_WINDOWS",
        selector: { roomIds: [policy.roomId] },
        parameters: { windows: policy.windows },
      };
    case "TEACHER_QUALIFICATION":
      return {
        ...common,
        id: `typed-${rule.id.toLowerCase()}-teacher-class-domain`,
        kind: "TEACHER_CLASS_DOMAIN",
        selector: { teacherIds: [policy.teacherId] },
        parameters: { classIds: policy.classIds },
      };
    case "REQUIRED_TEACHER":
      return {
        ...common,
        id: `typed-${rule.id.toLowerCase()}-required-teacher`,
        kind: "REQUIRED_TEACHER",
        selector: { classIds: policy.classIds, teacherIds: [policy.teacherId] },
        parameters: { teacherId: policy.teacherId },
      };
    case "REQUIRED_ROOM":
      return {
        ...common,
        id: `typed-${rule.id.toLowerCase()}-required-room`,
        kind: "REQUIRED_ROOM",
        selector: { classIds: policy.classIds, roomIds: [policy.roomId] },
        parameters: { roomId: policy.roomId },
      };
    case "ROOM_CAPACITY_POLICY":
      return {
        ...common,
        id: `typed-${rule.id.toLowerCase()}-room-capacity`,
        kind: "ROOM_CAPACITY",
        selector: { roomIds: [policy.roomId] },
        parameters: { capacitySource: "PLANNING_DATASET", exemptClassIds: policy.exemptClassIds || [] },
      };
    case "ROOM_REQUIRED_FEATURES":
      return {
        ...common,
        id: `typed-${rule.id.toLowerCase()}-room-required-features`,
        kind: "ROOM_REQUIRED_FEATURES",
        selector: { classIds: policy.classIds },
        parameters: { requiredFeatures: policy.requiredFeatures },
      };
    case "PREFERRED_TEACHER":
    case "PREFERRED_ROOM":
    case "PREFERRED_DAY":
    case "AVOID_DAY":
      return null;
  }
}

function compileV5TypedPolicies(
  state: StudioState,
  ruleMap: Map<string, StudioRule>,
  legacyNodes: ConstraintIRNode[],
) {
  const currentRulebook = state.rulebookVersions.find((version) => version.status === "CURRENT") ?? null;
  const manifest = typedPolicyBundleManifest(currentRulebook);
  const consumedRuleIds = new Set(manifest?.consumedRuleIds || []);
  const invalidHardRuleIds = new Set<string>();
  const closureBlockedRuleIds = new Set<string>();
  const suppressedLegacyNodeIds = new Set<string>();
  const nodes: ConstraintIRNode[] = [];

  for (const node of legacyNodes) {
    const consumedOnNode = node.ruleIds.filter((ruleId) => consumedRuleIds.has(ruleId));
    if (!consumedOnNode.length) continue;
    suppressedLegacyNodeIds.add(node.id);
    if (consumedOnNode.length !== node.ruleIds.length) {
      for (const ruleId of node.ruleIds) closureBlockedRuleIds.add(ruleId);
    }
  }

  if (!manifest) {
    for (const rule of ruleMap.values()) {
      if (parseTypedPolicy(rule).status !== "NONE") invalidHardRuleIds.add(rule.id);
    }
    return { consumedRuleIds, invalidHardRuleIds, closureBlockedRuleIds, suppressedLegacyNodeIds, nodes };
  }

  for (const bundle of manifest.bundles) {
    const rule = ruleMap.get(bundle.ownerRuleId);
    if (!rule) {
      for (const ruleId of bundle.consumedRuleIds) invalidHardRuleIds.add(ruleId);
      continue;
    }
    const execution = RULE_EXECUTION_BY_ID.get(rule.id);
    const hard = execution?.disposition === "HARD_CONSTRAINT" || execution?.disposition === "EXCEPTION" || rule.strength === "HARD";
    const parsed = parseTypedPolicy(rule);
    if (parsed.status !== "VALID") {
      if (hard) for (const ruleId of bundle.consumedRuleIds) invalidHardRuleIds.add(ruleId);
      continue;
    }
    if (!hard) continue;
    if (bundle.consumedRuleIds.some((ruleId) => closureBlockedRuleIds.has(ruleId)) || !hardPolicyStableIdsExist(state, parsed.policy)) {
      for (const ruleId of bundle.consumedRuleIds) invalidHardRuleIds.add(ruleId);
      continue;
    }
    const compiled = v5HardNode(rule, parsed.policy, bundle.consumedRuleIds);
    if (!compiled) {
      for (const ruleId of bundle.consumedRuleIds) invalidHardRuleIds.add(ruleId);
      continue;
    }
    nodes.push(compiled);
  }

  return {
    consumedRuleIds,
    invalidHardRuleIds,
    closureBlockedRuleIds,
    suppressedLegacyNodeIds,
    nodes: nodes.sort((a, b) => compareCanonicalStrings(a.id, b.id)),
  };
}

export function compileConstraintModelV3(state: StudioState): ConstraintModelSnapshotV1 {
  const base = compileV01(state);
  const currentRulebook = state.rulebookVersions.find((version) => version.status === "CURRENT") ?? null;
  const policySupport = reviewedDwdePolicySupport(currentRulebook, state.rules, state.rulebookVersions);
  const activeRules = state.rules.filter((rule) => rule.status === "ACTIVE");
  const ruleMap = new Map(activeRules.map((rule) => [rule.id, rule]));

  const legacyBase = base.hardConstraints.map((node) => withSequencingInterpretation(node, ruleMap));
  const legacyAdditions = v3Constraints(ruleMap);
  const legacyCandidates = [...legacyBase, ...legacyAdditions];

  if (currentRulebook?.version === DWDE_TYPED_POLICY_BUNDLE_VERSION) {
    const typed = compileV5TypedPolicies(state, ruleMap, legacyCandidates);
    const candidateHardConstraints = [
      ...legacyCandidates.filter((node) => !typed.suppressedLegacyNodeIds.has(node.id)),
      ...typed.nodes,
    ];
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
      ...typed.closureBlockedRuleIds,
    ])]
      .filter((ruleId) => !representedRuleIds.has(ruleId))
      .sort(compareCanonicalStrings);

    return {
      ...base,
      compilerVersion: POL02_CONSTRAINT_COMPILER_VERSION,
      hardConstraints,
      uncompiledConstraintRuleIds,
      completeHardConstraintCompilation: policySupport.supported && uncompiledConstraintRuleIds.length === 0,
    };
  }

  const typed = compileV4TypedPolicies(state, ruleMap);
  const baseHardConstraints = legacyBase
    .filter((node) => node.ruleIds.every((ruleId) => !typed.typedRuleIds.has(ruleId)));
  const additions = legacyAdditions
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
  const compilerVersion = currentRulebook?.version === 4
    ? CONSTRAINT_COMPILER_VERSION
    : LEGACY_CONSTRAINT_COMPILER_VERSION;

  return {
    ...base,
    compilerVersion,
    hardConstraints,
    uncompiledConstraintRuleIds,
    completeHardConstraintCompilation: policySupport.supported && uncompiledConstraintRuleIds.length === 0,
  };
}

// Canonical compiler entry point for Rulebook V3+ consumers.
export const compileConstraintModel = compileConstraintModelV3;

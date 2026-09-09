import { describe, expect, it } from "vitest";
import type { RulebookVersion, StudioRule, StudioState } from "@/lib/domain";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { validateConstraintModelBindings } from "@/lib/constraint-data-binding";
import { reviewedDwdePolicySupport } from "@/lib/dwde-policy-transition";

const V3_HASH = "7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b";
const prefixCounts: Record<string, number> = {
  ADV: 4, AIM: 9, BAL: 14, CAM: 19, CUR: 9, DATA: 8, DEN: 5, FIX: 4, FRI: 3,
  JAE: 3, JAL: 3, KAR: 14, KHY: 3, MEL: 3, OPS: 17, OPT: 9, REV: 2, ROOM: 14,
  SEQ: 9, STU: 22, SYD: 4,
};
const ruleIds = Object.entries(prefixCounts)
  .flatMap(([prefix, count]) => Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`));

function rule(id: string): StudioRule {
  return {
    id,
    category: id.startsWith("OPT-") ? "Optimization Priorities" : "test",
    type: null,
    title: id,
    description: id === "AIM-003" ? "Aimee is available Monday through Thursday." : `${id} policy`,
    strength: null,
    classificationRaw: id.startsWith("OPT-") ? `PRIORITY ${Number(id.slice(-1))}` : "HARD",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    reviewStatus: "VERIFIED",
    review: { decision: "APPROVED", verified: true },
    affectedEntityIds: [],
    parameters: {},
    exceptions: [],
    source: { type: "IMPORT" },
    sourceRaw: { type: "DWDE_RULEBOOK_REVIEW" },
    versionIntroduced: 2,
    updatedAt: "2026-09-02T00:00:00Z",
  };
}

function historicalV3(rules: StudioRule[]): RulebookVersion {
  return {
    id: "rb3",
    version: 3,
    name: "Rulebook V3",
    createdAt: "2026-09-02",
    actor: "test",
    reason: "reviewed baseline",
    changedRuleIds: ["ADV-004", "OPS-002"],
    rulebookId: "dwde-2026-2027-master-rulebook",
    status: "HISTORICAL",
    sourceHash: V3_HASH,
    ruleCount: 178,
    parentVersion: 2,
    formatVersion: "2.1",
    documentType: "DWDE_SITE_RULEBOOK",
    sourceMetadata: { provenance: "POST_REVIEW_CAMI_CONFIRMATION" },
    snapshot: structuredClone(rules),
  };
}

function typedV4State(): StudioState {
  const baselineRules = ruleIds.map(rule);
  const liveRules = structuredClone(baselineRules);
  const teacherId = "teacher-aimee-stable";
  const aimee = liveRules.find((item) => item.id === "AIM-003")!;
  aimee.parameters = {
    policy: {
      schemaVersion: "1.0",
      kind: "TEACHER_DAY_WINDOW",
      teacherId,
      allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"],
    },
  };
  aimee.affectedEntityIds = [teacherId];

  const v3 = historicalV3(baselineRules);
  const v4: RulebookVersion = {
    id: "rb4",
    version: 4,
    name: "Rulebook V4 typed policy transition",
    createdAt: "2026-09-08",
    actor: "POL-01",
    reason: "Replace AIM-003 machine target with stable teacher ID",
    changedRuleIds: ["AIM-003"],
    rulebookId: "dwde-2026-2027-master-rulebook",
    status: "CURRENT",
    sourceHash: "4".repeat(64),
    ruleCount: 178,
    parentVersion: 3,
    formatVersion: "2.2",
    documentType: "DWDE_SITE_RULEBOOK",
    sourceMetadata: {
      provenance: "TYPED_POLICY_MIGRATION",
      residualBaselineSourceHash: V3_HASH,
      typedPolicyRuleIds: ["AIM-003"],
    },
    snapshot: structuredClone(liveRules),
  };

  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [{ id: teacherId, name: "Aimee", subjects: [] }],
    rooms: [],
    students: [],
    cohorts: [],
    classes: [],
    sessions: [],
    rules: liveRules,
    rulebookVersions: [v3, v4],
    enforcementVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
    planningDatasetVersions: [{
      id: "pdv4",
      version: 4,
      createdAt: "2026-09-08",
      actor: "test",
      reason: "typed policy fixture",
      snapshotHash: "0".repeat(64),
      status: "CURRENT",
      snapshot: {
        schemaVersion: "1.3",
        studioId: "studio",
        sourceManifest: null,
        teacherIds: [teacherId],
        teachers: [{ id: teacherId, name: "Aimee" }],
        rooms: [], students: [], cohorts: [], classes: [], sessions: [],
      },
    }],
  };
}

function aimNodes(state: StudioState) {
  return compileConstraintModel(state).hardConstraints.filter((node) => node.ruleIds.includes("AIM-003"));
}

describe("POL-01 bounded typed teacher policy transition", () => {
  it("accepts V4 only as a pinned residual-V3 transition and emits exactly one ID-bound AIM-003 source", () => {
    const state = typedV4State();
    const support = reviewedDwdePolicySupport(
      state.rulebookVersions.find((version) => version.status === "CURRENT")!,
      state.rules,
      state.rulebookVersions,
    );
    expect(support.supported).toBe(true);

    const model = compileConstraintModel(state);
    expect(model.compilerVersion).toBe("dwde-ir-0.4");
    expect(model.completeHardConstraintCompilation).toBe(true);
    expect(aimNodes(state)).toHaveLength(1);
    expect(aimNodes(state)[0]).toMatchObject({
      id: "typed-aim-003-teacher-day-window",
      kind: "TEACHER_DAY_WINDOW",
      ruleIds: ["AIM-003"],
      selector: { teacherIds: ["teacher-aimee-stable"] },
      parameters: { allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"] },
    });
    expect(aimNodes(state)[0].selector.teacherNames).toBeUndefined();
    expect(model.hardConstraints.some((node) => node.id === "aimee-days")).toBe(false);
  });

  it("keeps AIM-003 machine meaning invariant when the teacher display name changes", () => {
    const before = typedV4State();
    const beforeNode = structuredClone(aimNodes(before)[0]);
    const after = typedV4State();
    after.teachers[0].name = "Aimee Renamed";
    after.planningDatasetVersions![0].snapshot.teachers![0].name = "Aimee Renamed";

    expect(aimNodes(after)[0]).toEqual(beforeNode);
    expect(validateConstraintModelBindings(after, compileConstraintModel(after))).toMatchObject({ valid: false });
    const aimReference = validateConstraintModelBindings(after, compileConstraintModel(after)).references
      .find((reference) => reference.constraintId === "typed-aim-003-teacher-day-window");
    expect(aimReference).toMatchObject({
      entityType: "TEACHER",
      expectedId: "teacher-aimee-stable",
      status: "BOUND",
      matchedEntityIds: ["teacher-aimee-stable"],
    });
  });

  it("fails closed for a missing stable teacher ID and never restores the legacy AIM-003 node", () => {
    const state = typedV4State();
    state.teachers = [];
    const model = compileConstraintModel(state);

    expect(model.completeHardConstraintCompilation).toBe(false);
    expect(model.uncompiledConstraintRuleIds).toContain("AIM-003");
    expect(model.hardConstraints.some((node) => node.ruleIds.includes("AIM-003"))).toBe(false);
    expect(model.hardConstraints.some((node) => node.id === "aimee-days")).toBe(false);
  });

  it("fails closed for a malformed typed envelope without falling back to name-bound semantics", () => {
    const state = typedV4State();
    const aim = state.rules.find((item) => item.id === "AIM-003")!;
    aim.parameters = {
      policy: {
        schemaVersion: "1.0",
        kind: "UNKNOWN_HARD_KIND",
        teacherId: "teacher-aimee-stable",
        allowedDays: ["Monday"],
      },
    };
    const current = state.rulebookVersions.find((version) => version.status === "CURRENT")!;
    current.snapshot = structuredClone(state.rules);

    const model = compileConstraintModel(state);
    expect(model.completeHardConstraintCompilation).toBe(false);
    expect(model.uncompiledConstraintRuleIds).toContain("AIM-003");
    expect(model.hardConstraints.some((node) => node.ruleIds.includes("AIM-003"))).toBe(false);
    expect(model.hardConstraints.some((node) => node.id === "aimee-days")).toBe(false);
  });

  it("rejects a changed residual HARD rule even when AIM-003 itself remains a valid typed policy", () => {
    const state = typedV4State();
    state.rules.find((item) => item.id === "OPS-003")!.description = "Changed residual close policy.";
    const current = state.rulebookVersions.find((version) => version.status === "CURRENT")!;
    current.snapshot = structuredClone(state.rules);

    const support = reviewedDwdePolicySupport(current, state.rules, state.rulebookVersions);
    expect(support.supported).toBe(false);
    expect(support.ruleIds).toContain("OPS-003");
    const model = compileConstraintModel(state);
    expect(model.completeHardConstraintCompilation).toBe(false);
    expect(model.uncompiledConstraintRuleIds).toContain("OPS-003");
  });

  it("requires the stable ID binding even when a matching display name exists", () => {
    const state = typedV4State();
    const model = compileConstraintModel(state);
    model.hardConstraints = model.hardConstraints.map((node) => node.id === "typed-aim-003-teacher-day-window"
      ? { ...node, selector: { teacherIds: ["missing-teacher"], teacherNames: ["Aimee"] } }
      : node);

    const report = validateConstraintModelBindings(state, model);
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      constraintId: "typed-aim-003-teacher-day-window",
      expectedId: "missing-teacher",
      status: "MISSING",
    }));
  });
});

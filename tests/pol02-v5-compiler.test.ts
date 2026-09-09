import { describe, expect, it } from "vitest";
import type { RulebookVersion, StudioRule, StudioState } from "@/lib/domain";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";

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
    description: `${id} reviewed policy`,
    strength: null,
    classificationRaw: id.startsWith("OPT-") ? `PRIORITY ${Number(id.slice(-1))}` : id === "ROOM-008" ? "EXCEPTION" : "HARD",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    reviewStatus: "VERIFIED",
    review: { decision: "APPROVED", verified: true },
    affectedEntityIds: [], parameters: {}, exceptions: [], source: { type: "IMPORT" },
    sourceRaw: { type: "DWDE_RULEBOOK_REVIEW" }, versionIntroduced: 2, updatedAt: "2026-09-02T00:00:00Z",
  };
}

function fixture(): StudioState {
  const baseline = ruleIds.map(rule);
  const v4Rules = structuredClone(baseline);
  const aimeeDay = v4Rules.find((item) => item.id === "AIM-003")!;
  aimeeDay.parameters = { policy: { schemaVersion: "1.0", kind: "TEACHER_DAY_WINDOW", teacherId: "teacher-aimee", allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"] } };
  aimeeDay.affectedEntityIds = ["teacher-aimee"];

  const v3: RulebookVersion = {
    id: "rb3", version: 3, name: "Rulebook V3", createdAt: "2026-09-02", actor: "test", reason: "reviewed baseline",
    changedRuleIds: ["ADV-004", "OPS-002"], rulebookId: "dwde-2026-2027-master-rulebook", status: "HISTORICAL",
    sourceHash: V3_HASH, ruleCount: 178, parentVersion: 2, formatVersion: "2.1", documentType: "DWDE_SITE_RULEBOOK",
    sourceMetadata: { provenance: "POST_REVIEW_CAMI_CONFIRMATION" }, snapshot: structuredClone(baseline),
  };
  const v4: RulebookVersion = {
    id: "rb4", version: 4, name: "Rulebook V4", createdAt: "2026-09-08", actor: "POL-01", reason: "typed teacher transition",
    changedRuleIds: ["AIM-003"], rulebookId: "dwde-2026-2027-master-rulebook", status: "HISTORICAL", sourceHash: "4".repeat(64),
    ruleCount: 178, parentVersion: 3, formatVersion: "2.2", documentType: "DWDE_SITE_RULEBOOK",
    sourceMetadata: { provenance: "TYPED_POLICY_MIGRATION", residualBaselineSourceHash: V3_HASH, typedPolicyRuleIds: ["AIM-003"] },
    snapshot: structuredClone(v4Rules),
  };

  const live = structuredClone(v4Rules);
  const qualification = live.find((item) => item.id === "AIM-001")!;
  qualification.parameters = { policy: { schemaVersion: "1.0", kind: "TEACHER_QUALIFICATION", teacherId: "teacher-aimee", classIds: ["class-ballet", "class-pointe"] } };
  qualification.affectedEntityIds = ["class-ballet", "class-pointe", "teacher-aimee"];
  const capacity = live.find((item) => item.id === "ROOM-007")!;
  capacity.parameters = { policy: { schemaVersion: "1.0", kind: "ROOM_CAPACITY_POLICY", roomId: "room-c", exemptClassIds: ["class-elementary"] } };
  capacity.affectedEntityIds = ["class-elementary", "room-c"];

  const v5: RulebookVersion = {
    id: "rb5", version: 5, name: "Rulebook V5", createdAt: "2026-09-09", actor: "POL-02", reason: "typed bundle transition",
    changedRuleIds: ["AIM-001", "ROOM-007"], rulebookId: "dwde-2026-2027-master-rulebook", status: "CURRENT", sourceHash: "5".repeat(64),
    ruleCount: 178, parentVersion: 4, formatVersion: "2.3", documentType: "DWDE_SITE_RULEBOOK",
    sourceMetadata: {
      provenance: "TYPED_POLICY_BUNDLE_MIGRATION", residualBaselineSourceHash: V3_HASH, previousTypedPolicyVersion: 4,
      typedPolicyRuleIds: ["AIM-001", "AIM-003", "ROOM-007"], introducedTypedPolicyRuleIds: ["AIM-001", "ROOM-007"],
      typedPolicyBundles: [
        { ownerRuleId: "AIM-001", consumedRuleIds: ["AIM-001"] },
        { ownerRuleId: "AIM-003", consumedRuleIds: ["AIM-003"] },
        { ownerRuleId: "ROOM-007", consumedRuleIds: ["ROOM-007", "ROOM-008"] },
      ],
    }, snapshot: structuredClone(live),
  };

  return {
    studioId: "studio", studioName: "DWDE",
    teachers: [{ id: "teacher-aimee", name: "Aimee Renamed", subjects: [] }],
    rooms: [{ id: "room-c", name: "Studio C Renamed", capacity: 15, features: [] }],
    students: [], cohorts: [],
    classes: [
      { id: "class-ballet", name: "Ballet Renamed", subject: "Ballet", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
      { id: "class-pointe", name: "Pointe Renamed", subject: "Pointe", level: "Level 3", durationMinutes: 30, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
      { id: "class-elementary", name: "Elementary Renamed", subject: "Ballet", level: "Elementary 1", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] },
    ],
    sessions: [], rules: live, rulebookVersions: [v3, v4, v5], enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [],
    planningDatasetVersions: [{
      id: "pdv", version: 5, createdAt: "2026-09-09", actor: "test", reason: "fixture", snapshotHash: "0".repeat(64), status: "CURRENT",
      snapshot: {
        schemaVersion: "1.3", studioId: "studio", sourceManifest: null, teacherIds: ["teacher-aimee"], teachers: [{ id: "teacher-aimee", name: "Aimee Renamed" }],
        rooms: [{ id: "room-c", name: "Studio C Renamed", capacity: 15, features: [] }], students: [], cohorts: [],
        classes: [
          { id: "class-ballet", name: "Ballet Renamed", subject: "Ballet", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], companyOnly: false },
          { id: "class-pointe", name: "Pointe Renamed", subject: "Pointe", level: "Level 3", durationMinutes: 30, weeklyFrequency: 1, rosterStudentIds: [], companyOnly: false },
          { id: "class-elementary", name: "Elementary Renamed", subject: "Ballet", level: "Elementary 1", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: [], companyOnly: false },
        ], sessions: [],
      },
    }],
  };
}

describe("POL-02 V5 bundle-aware compiler", () => {
  it("emits one stable-ID typed source per owner and consumes complete legacy bundles", () => {
    const model = compileConstraintModel(fixture());
    expect(model.compilerVersion).toBe("dwde-ir-0.5");
    expect(model.completeHardConstraintCompilation).toBe(true);

    expect(model.hardConstraints).toContainEqual(expect.objectContaining({
      id: "typed-aim-001-teacher-class-domain", kind: "TEACHER_CLASS_DOMAIN", ruleIds: ["AIM-001"],
      selector: { teacherIds: ["teacher-aimee"] }, parameters: { classIds: ["class-ballet", "class-pointe"] },
    }));
    expect(model.hardConstraints).toContainEqual(expect.objectContaining({
      id: "typed-aim-003-teacher-day-window", kind: "TEACHER_DAY_WINDOW", ruleIds: ["AIM-003"],
      selector: { teacherIds: ["teacher-aimee"] },
    }));
    expect(model.hardConstraints).toContainEqual(expect.objectContaining({
      id: "typed-room-007-room-capacity", kind: "ROOM_CAPACITY", ruleIds: ["ROOM-007", "ROOM-008"],
      selector: { roomIds: ["room-c"] }, parameters: { capacitySource: "PLANNING_DATASET", exemptClassIds: ["class-elementary"] },
    }));

    expect(model.hardConstraints.some((node) => node.id === "aimee-subject-domain")).toBe(false);
    expect(model.hardConstraints.some((node) => node.id === "studio-c-capacity")).toBe(false);
    expect(model.hardConstraints.filter((node) => node.ruleIds.includes("ROOM-008"))).toHaveLength(1);
  });

  it("keeps typed machine meaning stable across display-name changes", () => {
    const before = fixture();
    const after = fixture();
    after.teachers[0].name = "Completely Different Teacher Label";
    after.rooms[0].name = "Completely Different Room Label";
    after.classes[0].name = "Completely Different Class Label";
    const typed = (state: StudioState) => compileConstraintModel(state).hardConstraints.filter((node) => node.id.startsWith("typed-")).map((node) => ({ ...node, explanation: "" }));
    expect(typed(after)).toEqual(typed(before));
  });

  it("fails closed when a typed stable entity ID is missing", () => {
    const value = fixture();
    value.rooms = [];
    value.planningDatasetVersions![0].snapshot.rooms = [];
    const model = compileConstraintModel(value);
    expect(model.completeHardConstraintCompilation).toBe(false);
    expect(model.uncompiledConstraintRuleIds).toContain("ROOM-007");
    expect(model.hardConstraints.some((node) => node.id === "studio-c-capacity")).toBe(false);
  });

  it("rejects partial bundle replacement when a legacy node has unconsumed dependencies", () => {
    const value = fixture();
    const current = value.rulebookVersions.find((version) => version.status === "CURRENT")!;
    const bundles = current.sourceMetadata!.typedPolicyBundles as Array<{ ownerRuleId: string; consumedRuleIds: string[] }>;
    bundles[2] = { ownerRuleId: "ROOM-007", consumedRuleIds: ["ROOM-007"] };
    const model = compileConstraintModel(value);
    expect(model.completeHardConstraintCompilation).toBe(false);
    expect(model.uncompiledConstraintRuleIds).toEqual(expect.arrayContaining(["ROOM-007", "ROOM-008"]));
    expect(model.hardConstraints.some((node) => node.id === "studio-c-capacity")).toBe(false);
    expect(model.hardConstraints.some((node) => node.id === "typed-room-007-room-capacity")).toBe(false);
  });
});

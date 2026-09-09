import { describe, expect, it } from "vitest";
import type { RulebookVersion, StudioRule } from "@/lib/domain";
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
    category: id.startsWith("ROOM-") ? "Room" : id.startsWith("AIM-") ? "Teacher" : "test",
    type: null,
    title: id,
    description: `${id} reviewed policy`,
    strength: id === "ROOM-008" ? null : "HARD",
    classificationRaw: id === "ROOM-008" ? "EXCEPTION" : "HARD",
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

function v3(baseline: StudioRule[]): RulebookVersion {
  return {
    id: "rb3", version: 3, name: "Rulebook V3", createdAt: "2026-09-02", actor: "test",
    reason: "reviewed baseline", changedRuleIds: ["ADV-004", "OPS-002"],
    rulebookId: "dwde-2026-2027-master-rulebook", status: "HISTORICAL", sourceHash: V3_HASH,
    ruleCount: 178, parentVersion: 2, formatVersion: "2.1", documentType: "DWDE_SITE_RULEBOOK",
    sourceMetadata: { provenance: "POST_REVIEW_CAMI_CONFIRMATION" }, snapshot: structuredClone(baseline),
  };
}

function fixture() {
  const baseline = ruleIds.map(rule);
  const v4Rules = structuredClone(baseline);
  const aim003 = v4Rules.find((item) => item.id === "AIM-003")!;
  aim003.parameters = {
    policy: {
      schemaVersion: "1.0", kind: "TEACHER_DAY_WINDOW", teacherId: "teacher-aimee",
      allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"],
    },
  };
  aim003.affectedEntityIds = ["teacher-aimee"];

  const historicalV4: RulebookVersion = {
    id: "rb4", version: 4, name: "Rulebook V4", createdAt: "2026-09-08", actor: "POL-01",
    reason: "typed teacher transition", changedRuleIds: ["AIM-003"],
    rulebookId: "dwde-2026-2027-master-rulebook", status: "HISTORICAL", sourceHash: "4".repeat(64),
    ruleCount: 178, parentVersion: 3, formatVersion: "2.2", documentType: "DWDE_SITE_RULEBOOK",
    sourceMetadata: {
      provenance: "TYPED_POLICY_MIGRATION", residualBaselineSourceHash: V3_HASH,
      typedPolicyRuleIds: ["AIM-003"],
    },
    snapshot: structuredClone(v4Rules),
  };

  const live = structuredClone(v4Rules);
  const aim001 = live.find((item) => item.id === "AIM-001")!;
  aim001.parameters = {
    policy: {
      schemaVersion: "1.0", kind: "TEACHER_QUALIFICATION", teacherId: "teacher-aimee",
      classIds: ["class-ballet", "class-pointe"],
    },
  };
  aim001.affectedEntityIds = ["class-ballet", "class-pointe", "teacher-aimee"];

  const room007 = live.find((item) => item.id === "ROOM-007")!;
  room007.parameters = {
    policy: {
      schemaVersion: "1.0", kind: "ROOM_CAPACITY_POLICY", roomId: "room-studio-c",
      exemptClassIds: ["class-elementary-ballet"],
    },
  };
  room007.affectedEntityIds = ["class-elementary-ballet", "room-studio-c"];

  const current: RulebookVersion = {
    id: "rb5", version: 5, name: "Rulebook V5", createdAt: "2026-09-09", actor: "POL-02",
    reason: "typed bundle transition", changedRuleIds: ["AIM-001", "ROOM-007"],
    rulebookId: "dwde-2026-2027-master-rulebook", status: "CURRENT", sourceHash: "5".repeat(64),
    ruleCount: 178, parentVersion: 4, formatVersion: "2.3", documentType: "DWDE_SITE_RULEBOOK",
    sourceMetadata: {
      provenance: "TYPED_POLICY_BUNDLE_MIGRATION",
      residualBaselineSourceHash: V3_HASH,
      previousTypedPolicyVersion: 4,
      typedPolicyRuleIds: ["AIM-001", "AIM-003", "ROOM-007"],
      introducedTypedPolicyRuleIds: ["AIM-001", "ROOM-007"],
      typedPolicyBundles: [
        { ownerRuleId: "AIM-001", consumedRuleIds: ["AIM-001"] },
        { ownerRuleId: "AIM-003", consumedRuleIds: ["AIM-003"] },
        { ownerRuleId: "ROOM-007", consumedRuleIds: ["ROOM-007", "ROOM-008"] },
      ],
    },
    snapshot: structuredClone(live),
  };

  return { baseline, live, versions: [v3(baseline), historicalV4, current], current };
}

function supportOf(value = fixture()) {
  return reviewedDwdePolicySupport(value.current, value.live, value.versions);
}

describe("POL-02 V5 typed bundle transition", () => {
  it("accepts canonical bundle ownership with one owner for every consumed baseline rule", () => {
    expect(supportOf()).toMatchObject({ recognized: true, supported: true, ruleIds: [] });
  });

  it("rejects duplicate semantic ownership across bundles", () => {
    const value = fixture();
    const bundles = value.current.sourceMetadata!.typedPolicyBundles as Array<{ ownerRuleId: string; consumedRuleIds: string[] }>;
    bundles[1] = { ownerRuleId: "AIM-003", consumedRuleIds: ["AIM-003", "ROOM-008"] };
    expect(supportOf(value)).toMatchObject({ supported: false });
    expect(supportOf(value).message).toContain("exactly one");
  });

  it("rejects a bundle whose owner does not consume itself", () => {
    const value = fixture();
    const bundles = value.current.sourceMetadata!.typedPolicyBundles as Array<{ ownerRuleId: string; consumedRuleIds: string[] }>;
    bundles[2] = { ownerRuleId: "ROOM-007", consumedRuleIds: ["ROOM-008"] };
    expect(supportOf(value)).toMatchObject({ supported: false });
    expect(supportOf(value).message).toContain("owner");
  });

  it("rejects typed policy on a rule that is not declared as an owner", () => {
    const value = fixture();
    const undeclared = value.live.find((item) => item.id === "CAM-007")!;
    undeclared.parameters = {
      policy: {
        schemaVersion: "1.0", kind: "REQUIRED_TEACHER", teacherId: "teacher-cami", classIds: ["class-jazz-4a"],
      },
    };
    const snapshot = value.current.snapshot as StudioRule[];
    snapshot.find((item) => item.id === "CAM-007")!.parameters = structuredClone(undeclared.parameters);
    expect(supportOf(value)).toMatchObject({ supported: false });
    expect(supportOf(value).ruleIds).toContain("CAM-007");
  });

  it("rejects residual reviewed-policy drift outside consumed bundles", () => {
    const value = fixture();
    value.live.find((item) => item.id === "OPS-003")!.description = "drifted residual policy";
    const snapshot = value.current.snapshot as StudioRule[];
    snapshot.find((item) => item.id === "OPS-003")!.description = "drifted residual policy";
    expect(supportOf(value)).toMatchObject({ supported: false });
    expect(supportOf(value).ruleIds).toContain("OPS-003");
  });

  it("rejects human-policy drift on a typed owner even when its machine envelope is valid", () => {
    const value = fixture();
    value.live.find((item) => item.id === "AIM-001")!.description = "changed human policy";
    const snapshot = value.current.snapshot as StudioRule[];
    snapshot.find((item) => item.id === "AIM-001")!.description = "changed human policy";
    expect(supportOf(value)).toMatchObject({ supported: false });
    expect(supportOf(value).ruleIds).toContain("AIM-001");
  });

  it("rejects machine drift on a consumed non-owner rule", () => {
    const value = fixture();
    value.live.find((item) => item.id === "ROOM-008")!.parameters = { unexpected: true };
    const snapshot = value.current.snapshot as StudioRule[];
    snapshot.find((item) => item.id === "ROOM-008")!.parameters = { unexpected: true };
    expect(supportOf(value)).toMatchObject({ supported: false });
    expect(supportOf(value).ruleIds).toContain("ROOM-008");
  });

  it("requires affectedEntityIds to include all stable IDs owned by the typed envelope", () => {
    const value = fixture();
    const aim001 = value.live.find((item) => item.id === "AIM-001")!;
    aim001.affectedEntityIds = ["teacher-aimee"];
    const snapshot = value.current.snapshot as StudioRule[];
    snapshot.find((item) => item.id === "AIM-001")!.affectedEntityIds = ["teacher-aimee"];
    expect(supportOf(value)).toMatchObject({ supported: false });
    expect(supportOf(value).ruleIds).toContain("AIM-001");
  });
});

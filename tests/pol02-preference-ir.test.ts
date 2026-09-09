import { describe, expect, it } from "vitest";
import type { StudioRule } from "@/lib/domain";
import { compileTypedPreferenceIR } from "@/lib/typed-preference-ir";
import type { TypedPolicyV1 } from "@/lib/typed-policy";

function rule(id = "ROOM-010"): StudioRule {
  return {
    id, category: "Preference", type: null, title: "Reviewed preference", description: "Reviewed preference text.",
    strength: "MODERATE", classificationRaw: "MODERATE", status: "ACTIVE", verificationStatus: "VERIFIED", reviewStatus: "VERIFIED",
    review: { decision: "APPROVED", verified: true }, affectedEntityIds: [], parameters: {}, exceptions: [], source: { type: "IMPORT" },
    sourceRaw: {}, versionIntroduced: 2, updatedAt: "2026-09-09T00:00:00Z",
  };
}

describe("POL-02 typed preference Objective IR", () => {
  it.each([
    [
      "preferred teacher",
      { schemaVersion: "1.0", kind: "PREFERRED_TEACHER", teacherId: "teacher-a", classIds: ["class-a"] } as TypedPolicyV1,
      { kind: "PREFERRED_TEACHER", selector: { classIds: ["class-a"], teacherIds: ["teacher-a"] }, parameters: { teacherId: "teacher-a" } },
    ],
    [
      "preferred room",
      { schemaVersion: "1.0", kind: "PREFERRED_ROOM", roomId: "room-a", classIds: ["class-a"] } as TypedPolicyV1,
      { kind: "PREFERRED_ROOM", selector: { classIds: ["class-a"], roomIds: ["room-a"] }, parameters: { roomId: "room-a" } },
    ],
    [
      "preferred day",
      { schemaVersion: "1.0", kind: "PREFERRED_DAY", classIds: ["class-a"], days: ["Monday", "Thursday"] } as TypedPolicyV1,
      { kind: "PREFERRED_DAY", selector: { classIds: ["class-a"] }, parameters: { days: ["Monday", "Thursday"] } },
    ],
    [
      "avoid day",
      { schemaVersion: "1.0", kind: "AVOID_DAY", classIds: ["class-a"], days: ["Friday"] } as TypedPolicyV1,
      { kind: "AVOID_DAY", selector: { classIds: ["class-a"] }, parameters: { days: ["Friday"] } },
    ],
  ])("records %s deterministically without enabling scoring", (_name, policy, expected) => {
    expect(compileTypedPreferenceIR(rule(), policy, ["ROOM-010", "ROOM-011"], 1001)).toMatchObject({
      ruleId: "ROOM-010",
      ruleIds: ["ROOM-010", "ROOM-011"],
      rank: 1001,
      title: "Reviewed preference",
      description: "Reviewed preference text.",
      scoringEnabled: false,
      ...expected,
    });
  });

  it("does not turn HARD policy into an objective record", () => {
    const hard: TypedPolicyV1 = {
      schemaVersion: "1.0", kind: "REQUIRED_ROOM", roomId: "room-a", classIds: ["class-a"],
    };
    expect(compileTypedPreferenceIR(rule(), hard, ["ROOM-009"], 1001)).toBeNull();
  });
});

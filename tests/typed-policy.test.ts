import { describe, expect, it } from "vitest";
import type { StudioRule } from "@/lib/domain";
import { parseTypedPolicy, teacherDayWindowPolicyParameters } from "@/lib/typed-policy";

function rule(parameters: Record<string, unknown>): StudioRule {
  return {
    id: "AIM-003",
    category: "Teacher",
    type: null,
    title: "Aimee availability",
    description: "Aimee is available Monday through Thursday.",
    strength: "HARD",
    classificationRaw: "HARD",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    reviewStatus: "VERIFIED",
    review: { decision: "APPROVED", verified: true },
    affectedEntityIds: [],
    parameters,
    exceptions: [],
    source: { type: "IMPORT" },
    sourceRaw: {},
    versionIntroduced: 2,
    updatedAt: "2026-09-08T00:00:00Z",
  };
}

describe("typed teacher availability policy envelope", () => {
  it("roundtrips a stable-ID allowed-days policy into Constraint IR parameters", () => {
    const parsed = parseTypedPolicy(rule({
      policy: {
        schemaVersion: "1.0",
        kind: "TEACHER_DAY_WINDOW",
        teacherId: "teacher-aimee-stable",
        allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"],
      },
    }));

    expect(parsed).toEqual({
      status: "VALID",
      policy: {
        schemaVersion: "1.0",
        kind: "TEACHER_DAY_WINDOW",
        teacherId: "teacher-aimee-stable",
        allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"],
      },
    });
    if (parsed.status !== "VALID") throw new Error("expected valid policy");
    expect(teacherDayWindowPolicyParameters(parsed.policy)).toEqual({
      allowedDays: ["Monday", "Tuesday", "Wednesday", "Thursday"],
    });
  });

  it("treats absent policy envelopes as legacy rather than silently inventing typed meaning", () => {
    expect(parseTypedPolicy(rule({ allowedDays: ["Monday"] }))).toEqual({ status: "NONE" });
  });

  it.each([
    ["unknown schema", { schemaVersion: "2.0", kind: "TEACHER_DAY_WINDOW", teacherId: "t", allowedDays: ["Monday"] }, "TYPED_POLICY_SCHEMA_UNSUPPORTED"],
    ["unknown kind", { schemaVersion: "1.0", kind: "SOMETHING_ELSE", teacherId: "t", allowedDays: ["Monday"] }, "TYPED_POLICY_KIND_UNSUPPORTED"],
    ["missing teacher", { schemaVersion: "1.0", kind: "TEACHER_DAY_WINDOW", allowedDays: ["Monday"] }, "TYPED_POLICY_TEACHER_ID_REQUIRED"],
    ["unknown field", { schemaVersion: "1.0", kind: "TEACHER_DAY_WINDOW", teacherId: "t", allowedDays: ["Monday"], prose: "trust me" }, "TYPED_POLICY_UNKNOWN_FIELD"],
    ["duplicate day", { schemaVersion: "1.0", kind: "TEACHER_DAY_WINDOW", teacherId: "t", allowedDays: ["Monday", "Monday"] }, "TYPED_POLICY_ALLOWED_DAYS_INVALID"],
    ["ambiguous shapes", { schemaVersion: "1.0", kind: "TEACHER_DAY_WINDOW", teacherId: "t", allowedDays: ["Monday"], day: "Thursday" }, "TYPED_POLICY_WINDOW_AMBIGUOUS"],
    ["time without day", { schemaVersion: "1.0", kind: "TEACHER_DAY_WINDOW", teacherId: "t", start: "18:00", end: "20:00" }, "TYPED_POLICY_DAY_REQUIRED_FOR_TIME"],
    ["backwards window", { schemaVersion: "1.0", kind: "TEACHER_DAY_WINDOW", teacherId: "t", day: "Thursday", start: "20:00", end: "18:00" }, "TYPED_POLICY_WINDOW_INVALID"],
  ])("rejects %s fail-closed", (_name, policy, code) => {
    expect(parseTypedPolicy(rule({ policy }))).toMatchObject({ status: "INVALID", code });
  });
});

import { describe, expect, it } from "vitest";
import type { StudioRule } from "@/lib/domain";
import { parseTypedPolicy } from "@/lib/typed-policy";

function rule(id: string, policy: Record<string, unknown>): StudioRule {
  return {
    id,
    category: "test",
    type: null,
    title: id,
    description: `${id} policy`,
    strength: "HARD",
    classificationRaw: "HARD",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    reviewStatus: "VERIFIED",
    review: { decision: "APPROVED", verified: true },
    affectedEntityIds: [],
    parameters: { policy },
    exceptions: [],
    source: { type: "IMPORT" },
    sourceRaw: {},
    versionIntroduced: 2,
    updatedAt: "2026-09-08T00:00:00Z",
  };
}

function valid(id: string, policy: Record<string, unknown>) {
  const parsed = parseTypedPolicy(rule(id, policy));
  expect(parsed.status).toBe("VALID");
  if (parsed.status !== "VALID") throw new Error(parsed.message);
  return parsed.policy;
}

describe("POL-02 typed policy schemas", () => {
  it("canonicalizes studio operating windows as half-open same-day intervals and closed days", () => {
    expect(valid("OPS-001", {
      schemaVersion: "1.0",
      kind: "STUDIO_OPERATING_WINDOWS",
      windows: [
        { day: "Tuesday", start: "16:45", end: "21:30" },
        { day: "Monday", start: "16:45", end: "21:30" },
        { day: "Monday", start: "16:45", end: "21:30" },
      ],
      closedDays: ["Saturday", "Friday", "Friday"],
    })).toEqual({
      schemaVersion: "1.0",
      kind: "STUDIO_OPERATING_WINDOWS",
      windows: [
        { day: "Monday", start: "16:45", end: "21:30" },
        { day: "Tuesday", start: "16:45", end: "21:30" },
      ],
      closedDays: ["Friday", "Saturday"],
    });
  });

  it("canonicalizes room-unavailable windows without copying room facts into policy", () => {
    expect(valid("ROOM-020", {
      schemaVersion: "1.0",
      kind: "ROOM_UNAVAILABLE_WINDOWS",
      roomId: "room-c",
      windows: [{ day: "Thursday", start: "18:00", end: "19:15" }],
    })).toEqual({
      schemaVersion: "1.0",
      kind: "ROOM_UNAVAILABLE_WINDOWS",
      roomId: "room-c",
      windows: [{ day: "Thursday", start: "18:00", end: "19:15" }],
    });
  });

  it("treats an explicit empty qualification domain as no qualified classes", () => {
    expect(valid("CUR-020", {
      schemaVersion: "1.0",
      kind: "TEACHER_QUALIFICATION",
      teacherId: "teacher-cami",
      classIds: [],
    })).toEqual({
      schemaVersion: "1.0",
      kind: "TEACHER_QUALIFICATION",
      teacherId: "teacher-cami",
      classIds: [],
    });
  });

  it("deduplicates and sorts stable class IDs for qualifications and required assignments", () => {
    expect(valid("CUR-021", {
      schemaVersion: "1.0",
      kind: "TEACHER_QUALIFICATION",
      teacherId: "teacher-cami",
      classIds: ["class-jazz-3", "class-jazz-2", "class-jazz-3"],
    })).toMatchObject({ classIds: ["class-jazz-2", "class-jazz-3"] });

    expect(valid("CAM-007", {
      schemaVersion: "1.0",
      kind: "REQUIRED_TEACHER",
      teacherId: "teacher-cami",
      classIds: ["class-jazz-4a", "class-jazz-4a"],
    })).toMatchObject({ classIds: ["class-jazz-4a"] });

    expect(valid("ROOM-002", {
      schemaVersion: "1.0",
      kind: "REQUIRED_ROOM",
      roomId: "room-a",
      classIds: ["class-ballet-2", "class-ballet-1"],
    })).toMatchObject({ classIds: ["class-ballet-1", "class-ballet-2"] });
  });

  it("keeps room capacity enforcement separate from the PlanningDataset capacity value", () => {
    expect(valid("ROOM-007", {
      schemaVersion: "1.0",
      kind: "ROOM_CAPACITY_POLICY",
      roomId: "room-c",
      exemptClassIds: ["class-elementary-2", "class-elementary-1", "class-elementary-1"],
    })).toEqual({
      schemaVersion: "1.0",
      kind: "ROOM_CAPACITY_POLICY",
      roomId: "room-c",
      exemptClassIds: ["class-elementary-1", "class-elementary-2"],
    });
  });

  it("canonicalizes required feature and basic preference records", () => {
    expect(valid("ROOM-021", {
      schemaVersion: "1.0",
      kind: "ROOM_REQUIRED_FEATURES",
      classIds: ["class-pointe-1"],
      requiredFeatures: ["sprung-floor", "barre", "barre"],
    })).toMatchObject({ requiredFeatures: ["barre", "sprung-floor"] });

    expect(valid("CAM-020", {
      schemaVersion: "1.0",
      kind: "PREFERRED_TEACHER",
      teacherId: "teacher-cami",
      classIds: ["class-jazz-3"],
    })).toMatchObject({ kind: "PREFERRED_TEACHER", teacherId: "teacher-cami" });

    expect(valid("ROOM-022", {
      schemaVersion: "1.0",
      kind: "PREFERRED_ROOM",
      roomId: "room-b",
      classIds: ["class-tap-3"],
    })).toMatchObject({ kind: "PREFERRED_ROOM", roomId: "room-b" });

    expect(valid("OPT-020", {
      schemaVersion: "1.0",
      kind: "PREFERRED_DAY",
      classIds: ["class-jazz-3"],
      days: ["Thursday", "Monday", "Thursday"],
    })).toMatchObject({ days: ["Monday", "Thursday"] });

    expect(valid("OPT-021", {
      schemaVersion: "1.0",
      kind: "AVOID_DAY",
      classIds: ["class-jazz-3"],
      days: ["Friday"],
    })).toMatchObject({ days: ["Friday"] });
  });

  it.each([
    ["zero interval", "OPS-001", { schemaVersion: "1.0", kind: "STUDIO_OPERATING_WINDOWS", windows: [{ day: "Monday", start: "18:00", end: "18:00" }] }, "TYPED_POLICY_WINDOWS_INVALID"],
    ["backwards interval", "OPS-001", { schemaVersion: "1.0", kind: "STUDIO_OPERATING_WINDOWS", windows: [{ day: "Monday", start: "19:00", end: "18:00" }] }, "TYPED_POLICY_WINDOWS_INVALID"],
    ["overnight-shaped interval", "OPS-001", { schemaVersion: "1.0", kind: "STUDIO_OPERATING_WINDOWS", windows: [{ day: "Monday", start: "23:00", end: "01:00" }] }, "TYPED_POLICY_WINDOWS_INVALID"],
    ["window on closed day", "OPS-001", { schemaVersion: "1.0", kind: "STUDIO_OPERATING_WINDOWS", windows: [{ day: "Friday", start: "16:45", end: "21:30" }], closedDays: ["Friday"] }, "TYPED_POLICY_WINDOW_CLOSED_DAY_CONFLICT"],
    ["missing room id", "ROOM-020", { schemaVersion: "1.0", kind: "ROOM_UNAVAILABLE_WINDOWS", windows: [{ day: "Monday", start: "18:00", end: "19:00" }] }, "TYPED_POLICY_ROOM_ID_REQUIRED"],
    ["missing qualification class array", "CUR-020", { schemaVersion: "1.0", kind: "TEACHER_QUALIFICATION", teacherId: "teacher-cami" }, "TYPED_POLICY_CLASS_IDS_INVALID"],
    ["empty required teacher target", "CAM-007", { schemaVersion: "1.0", kind: "REQUIRED_TEACHER", teacherId: "teacher-cami", classIds: [] }, "TYPED_POLICY_CLASS_IDS_INVALID"],
    ["capacity number duplicated in policy", "ROOM-007", { schemaVersion: "1.0", kind: "ROOM_CAPACITY_POLICY", roomId: "room-c", capacity: 15 }, "TYPED_POLICY_UNKNOWN_FIELD"],
    ["empty required features", "ROOM-021", { schemaVersion: "1.0", kind: "ROOM_REQUIRED_FEATURES", classIds: ["class-pointe"], requiredFeatures: [] }, "TYPED_POLICY_FEATURES_INVALID"],
    ["unknown family", "X-001", { schemaVersion: "1.0", kind: "RELATIONSHIP_MAGIC", classIds: ["class-a"] }, "TYPED_POLICY_KIND_UNSUPPORTED"],
  ])("rejects %s fail-closed", (_name, id, policy, code) => {
    expect(parseTypedPolicy(rule(id, policy as Record<string, unknown>))).toMatchObject({ status: "INVALID", code });
  });
});

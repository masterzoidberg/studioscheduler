import { describe, expect, it } from "vitest";
import type { StudioRule } from "@/lib/domain";
import { parseTypedPolicy } from "@/lib/typed-policy";

function rule(policy: Record<string, unknown>): StudioRule {
  return {
    id: "POL03", category: "test", type: null, title: "POL03", description: "fixture",
    strength: "HARD", classificationRaw: "HARD", status: "ACTIVE", verificationStatus: "VERIFIED",
    reviewStatus: "VERIFIED", review: { decision: "APPROVED", verified: true }, affectedEntityIds: [],
    parameters: { policy }, exceptions: [], source: { type: "IMPORT" }, sourceRaw: {}, versionIntroduced: 2,
    updatedAt: "2026-09-10T00:00:00Z",
  };
}

describe("POL-03 typed policy schemas", () => {
  it.each([
    [{ schemaVersion: "1.0", kind: "PARTICIPANT_NO_OVERLAP", participantIds: ["student-b", "student-a", "student-a"] }, { kind: "PARTICIPANT_NO_OVERLAP", participantIds: ["student-a", "student-b"] }],
    [{ schemaVersion: "1.0", kind: "MAX_ATTENDANCE_DAYS", participantIds: ["student-a"], maxDays: 3 }, { kind: "MAX_ATTENDANCE_DAYS", participantIds: ["student-a"], maxDays: 3 }],
    [{ schemaVersion: "1.0", kind: "DIRECT_AFTER", predecessorSessionId: "session-a", successorSessionId: "session-b" }, { kind: "DIRECT_AFTER", predecessorSessionId: "session-a", successorSessionId: "session-b" }],
    [{ schemaVersion: "1.0", kind: "LINKED_ARRIVAL", teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: -30, maxOffsetMinutes: 15 }, { kind: "LINKED_ARRIVAL", teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: -30, maxOffsetMinutes: 15 }],
  ])("accepts and canonicalizes %j", (policy, expected) => {
    expect(parseTypedPolicy(rule(policy))).toMatchObject({ status: "VALID", policy: expected });
  });

  it.each([
    [{ schemaVersion: "1.0", kind: "PARTICIPANT_NO_OVERLAP", participantIds: [] }, "TYPED_POLICY_PARTICIPANT_IDS_INVALID"],
    [{ schemaVersion: "1.0", kind: "MAX_ATTENDANCE_DAYS", participantIds: ["student-a"], maxDays: 0 }, "TYPED_POLICY_MAX_DAYS_INVALID"],
    [{ schemaVersion: "1.0", kind: "DIRECT_AFTER", predecessorSessionId: "session-a", successorSessionId: "session-a" }, "TYPED_POLICY_SELF_EDGE"],
    [{ schemaVersion: "1.0", kind: "LINKED_ARRIVAL", teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: 30, maxOffsetMinutes: -30 }, "TYPED_POLICY_OFFSET_INTERVAL_INVALID"],
    [{ schemaVersion: "1.0", kind: "MIN_ATTENDANCE_DAYS", participantIds: ["student-a"], minDays: 2 }, "TYPED_POLICY_KIND_UNSUPPORTED"],
    [{ schemaVersion: "1.0", kind: "LINKED_ARRIVAL", teacherId: "teacher-a", participantId: "student-a", minOffsetMinutes: 0, maxOffsetMinutes: 30, requireFullPresence: true }, "TYPED_POLICY_UNKNOWN_FIELD"],
  ])("rejects unsupported or ambiguous relationship input", (policy, code) => {
    expect(parseTypedPolicy(rule(policy as Record<string, unknown>))).toMatchObject({ status: "INVALID", code });
  });
});

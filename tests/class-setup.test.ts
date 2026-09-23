import { describe, expect, it } from "vitest";
import {
  classAssignmentPolicyDraftFromRules,
  classEligibleTeacherIds,
  classPolicyRuleId,
} from "@/lib/class-setup";

describe("class setup policy derivation", () => {
  it("derives eligibility only from typed qualification policy", () => {
    const rules = [
      { id: "qual-a", parameters: { policy: { schemaVersion: "1.0", kind: "TEACHER_QUALIFICATION", teacherId: "teacher-a", classIds: ["class-a"] } } },
      { id: "legacy", parameters: {} },
    ];

    expect(classEligibleTeacherIds("class-a", rules)).toEqual(["teacher-a"]);
    expect(classEligibleTeacherIds("class-b", rules)).toEqual([]);
  });

  it("round-trips class-scoped required and preferred teacher and room selections", () => {
    const rules = [
      { id: classPolicyRuleId("REQUIRED_TEACHER", "class-a"), parameters: { policy: { schemaVersion: "1.0", kind: "REQUIRED_TEACHER", teacherId: "teacher-a", classIds: ["class-a"] } } },
      { id: classPolicyRuleId("PREFERRED_TEACHER", "class-a"), parameters: { policy: { schemaVersion: "1.0", kind: "PREFERRED_TEACHER", teacherId: "teacher-b", classIds: ["class-a"] } } },
      { id: classPolicyRuleId("REQUIRED_ROOM", "class-a"), parameters: { policy: { schemaVersion: "1.0", kind: "REQUIRED_ROOM", roomId: "room-a", classIds: ["class-a"] } } },
      { id: classPolicyRuleId("PREFERRED_ROOM", "class-a"), parameters: { policy: { schemaVersion: "1.0", kind: "PREFERRED_ROOM", roomId: "room-b", classIds: ["class-a"] } } },
    ];

    expect(classAssignmentPolicyDraftFromRules("class-a", rules)).toEqual({
      requiredTeacherId: "teacher-a",
      preferredTeacherId: "teacher-b",
      requiredRoomId: "room-a",
      preferredRoomId: "room-b",
    });
  });

  it("ignores policies that do not explicitly target the class", () => {
    const rules = [{
      id: classPolicyRuleId("REQUIRED_TEACHER", "class-a"),
      parameters: { policy: { schemaVersion: "1.0", kind: "REQUIRED_TEACHER", teacherId: "teacher-a", classIds: ["class-b"] } },
    }];

    expect(classAssignmentPolicyDraftFromRules("class-a", rules).requiredTeacherId).toBe("");
  });
});

import type { StudioRule } from "@/lib/domain";
import type { ObjectivePriorityIR } from "@/lib/constraint-ir";
import type { TypedPolicyV1 } from "@/lib/typed-policy";

export function compileTypedPreferenceIR(
  rule: StudioRule,
  policy: TypedPolicyV1,
  ruleIds: string[],
  rank: number,
): ObjectivePriorityIR | null {
  const common = {
    ruleId: rule.id,
    ruleIds,
    rank,
    title: rule.title,
    description: rule.description,
    scoringEnabled: false,
  } as const;

  switch (policy.kind) {
    case "PREFERRED_TEACHER":
      return {
        ...common,
        kind: policy.kind,
        selector: { classIds: policy.classIds, teacherIds: [policy.teacherId] },
        parameters: { teacherId: policy.teacherId },
      };
    case "PREFERRED_ROOM":
      return {
        ...common,
        kind: policy.kind,
        selector: { classIds: policy.classIds, roomIds: [policy.roomId] },
        parameters: { roomId: policy.roomId },
      };
    case "PREFERRED_DAY":
    case "AVOID_DAY":
      return {
        ...common,
        kind: policy.kind,
        selector: { classIds: policy.classIds },
        parameters: { days: policy.days },
      };
    case "TEACHER_DAY_WINDOW":
    case "STUDIO_OPERATING_WINDOWS":
    case "ROOM_UNAVAILABLE_WINDOWS":
    case "TEACHER_QUALIFICATION":
    case "REQUIRED_TEACHER":
    case "REQUIRED_ROOM":
    case "ROOM_CAPACITY_POLICY":
    case "ROOM_REQUIRED_FEATURES":
      return null;
  }
}

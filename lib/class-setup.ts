import { parseTypedPolicy } from "@/lib/typed-policy";

export type ClassAssignmentPolicyKind =
  | "REQUIRED_TEACHER"
  | "PREFERRED_TEACHER"
  | "REQUIRED_ROOM"
  | "PREFERRED_ROOM";

export interface ClassAssignmentPolicyDraft {
  requiredTeacherId: string;
  preferredTeacherId: string;
  requiredRoomId: string;
  preferredRoomId: string;
}

type RuleLike = { id: string; parameters: Record<string, unknown> };

const PREFIX: Record<ClassAssignmentPolicyKind, string> = {
  REQUIRED_TEACHER: "SET05-CLASS-REQUIRED-TEACHER-",
  PREFERRED_TEACHER: "SET05-CLASS-PREFERRED-TEACHER-",
  REQUIRED_ROOM: "SET05-CLASS-REQUIRED-ROOM-",
  PREFERRED_ROOM: "SET05-CLASS-PREFERRED-ROOM-",
};

export function classPolicyRuleId(kind: ClassAssignmentPolicyKind, classId: string) {
  return `${PREFIX[kind]}${classId}`;
}

export function classEligibleTeacherIds(classId: string, rules: RuleLike[]) {
  return rules.flatMap((rule) => {
    const parsed = parseTypedPolicy(rule);
    return parsed.status === "VALID"
      && parsed.policy.kind === "TEACHER_QUALIFICATION"
      && parsed.policy.classIds.includes(classId)
      ? [parsed.policy.teacherId]
      : [];
  }).sort((a, b) => a.localeCompare(b));
}

export function classAssignmentPolicyDraftFromRules(classId: string, rules: RuleLike[]): ClassAssignmentPolicyDraft {
  const draft: ClassAssignmentPolicyDraft = {
    requiredTeacherId: "",
    preferredTeacherId: "",
    requiredRoomId: "",
    preferredRoomId: "",
  };
  for (const rule of rules) {
    const parsed = parseTypedPolicy(rule);
    if (parsed.status !== "VALID") continue;
    if (parsed.policy.kind === "REQUIRED_TEACHER" && parsed.policy.classIds.includes(classId)) draft.requiredTeacherId = parsed.policy.teacherId;
    if (parsed.policy.kind === "PREFERRED_TEACHER" && parsed.policy.classIds.includes(classId)) draft.preferredTeacherId = parsed.policy.teacherId;
    if (parsed.policy.kind === "REQUIRED_ROOM" && parsed.policy.classIds.includes(classId)) draft.requiredRoomId = parsed.policy.roomId;
    if (parsed.policy.kind === "PREFERRED_ROOM" && parsed.policy.classIds.includes(classId)) draft.preferredRoomId = parsed.policy.roomId;
  }
  return draft;
}

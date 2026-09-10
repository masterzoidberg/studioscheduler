import { parseTypedPolicy, type TypedPolicyV1 } from "@/lib/typed-policy";
import type { SetupTypedPolicyPatch } from "@/lib/setup-policy";

export const SET06_LATEST_FINISH_PREFIX = "SET06-STUDENT-LATEST-FINISH-" as const;
export const SET06_MAXIMUM_DAYS_PREFIX = "SET06-STUDENT-MAX-DAYS-" as const;
export const NO_OVERLAP_RULE_ID = "SET06-PARTICIPANT-NO-OVERLAP" as const;
export const DIRECT_AFTER_RULE_ID = "SET06-DIRECT-AFTER" as const;
export const LINKED_ARRIVAL_RULE_ID = "SET06-LINKED-ARRIVAL" as const;

export interface DirectAfterDraft {
  predecessorSessionId: string;
  successorSessionId: string;
}

export interface LinkedArrivalDraft {
  teacherId: string;
  participantId: string;
  minOffsetMinutes: number;
  maxOffsetMinutes: number;
}

export interface StudentPolicyDraft {
  latestFinishByStudent: Record<string, string>;
  maxAttendanceDaysByStudent: Record<string, number | "">;
  noOverlapParticipantIds: string[];
  directAfter: DirectAfterDraft | null;
  linkedArrival: LinkedArrivalDraft | null;
}

type RuleLike = { id?: string; parameters: Record<string, unknown> };

export function studentLatestFinishRuleId(studentId: string) {
  return `${SET06_LATEST_FINISH_PREFIX}${studentId}`;
}

export function studentMaximumDaysRuleId(studentId: string) {
  return `${SET06_MAXIMUM_DAYS_PREFIX}${studentId}`;
}

function parse(ruleId: string, policy: Record<string, unknown>): TypedPolicyV1 {
  const parsed = parseTypedPolicy({ id: ruleId, parameters: { policy } });
  if (parsed.status !== "VALID") throw new Error(parsed.status === "INVALID" ? parsed.message : `${ruleId} requires a typed policy.`);
  return parsed.policy;
}

export function studentPolicyDraftFromRules(rules: RuleLike[], studentIds: string[]): StudentPolicyDraft {
  const latestFinishByStudent = Object.fromEntries(studentIds.map((id) => [id, ""]));
  const maxAttendanceDaysByStudent: Record<string, number | ""> = Object.fromEntries(studentIds.map((id) => [id, ""]));
  let noOverlapParticipantIds: string[] = [];
  let directAfter: DirectAfterDraft | null = null;
  let linkedArrival: LinkedArrivalDraft | null = null;

  for (const rule of rules) {
    if (!rule.id) continue;
    const parsed = parseTypedPolicy({ id: rule.id, parameters: rule.parameters });
    if (parsed.status !== "VALID") continue;
    const policy = parsed.policy;
    if (policy.kind === "PARTICIPANT_LATEST_FINISH" && policy.participantIds.length === 1) latestFinishByStudent[policy.participantIds[0]] = policy.latestFinish;
    if (policy.kind === "MAX_ATTENDANCE_DAYS" && policy.participantIds.length === 1) maxAttendanceDaysByStudent[policy.participantIds[0]] = policy.maxDays;
    if (rule.id === NO_OVERLAP_RULE_ID && policy.kind === "PARTICIPANT_NO_OVERLAP") noOverlapParticipantIds = [...policy.participantIds];
    if (rule.id === DIRECT_AFTER_RULE_ID && policy.kind === "DIRECT_AFTER") directAfter = { predecessorSessionId: policy.predecessorSessionId, successorSessionId: policy.successorSessionId };
    if (rule.id === LINKED_ARRIVAL_RULE_ID && policy.kind === "LINKED_ARRIVAL") linkedArrival = { teacherId: policy.teacherId, participantId: policy.participantId, minOffsetMinutes: policy.minOffsetMinutes, maxOffsetMinutes: policy.maxOffsetMinutes };
  }

  return { latestFinishByStudent, maxAttendanceDaysByStudent, noOverlapParticipantIds, directAfter, linkedArrival };
}

export function buildStudentPolicyPatches(draft: StudentPolicyDraft): SetupTypedPolicyPatch[] {
  const patches: SetupTypedPolicyPatch[] = [];
  for (const studentId of Object.keys(draft.latestFinishByStudent).sort()) {
    const latestFinish = draft.latestFinishByStudent[studentId];
    patches.push({
      ruleId: studentLatestFinishRuleId(studentId),
      policy: latestFinish ? parse(studentLatestFinishRuleId(studentId), { schemaVersion: "1.0", kind: "PARTICIPANT_LATEST_FINISH", participantIds: [studentId], latestFinish }) : null,
    });
  }
  for (const studentId of Object.keys(draft.maxAttendanceDaysByStudent).sort()) {
    const maxDays = draft.maxAttendanceDaysByStudent[studentId];
    patches.push({
      ruleId: studentMaximumDaysRuleId(studentId),
      policy: maxDays === "" ? null : parse(studentMaximumDaysRuleId(studentId), { schemaVersion: "1.0", kind: "MAX_ATTENDANCE_DAYS", participantIds: [studentId], maxDays }),
    });
  }
  patches.push({
    ruleId: NO_OVERLAP_RULE_ID,
    policy: draft.noOverlapParticipantIds.length
      ? parse(NO_OVERLAP_RULE_ID, { schemaVersion: "1.0", kind: "PARTICIPANT_NO_OVERLAP", participantIds: draft.noOverlapParticipantIds })
      : null,
  });
  patches.push({
    ruleId: DIRECT_AFTER_RULE_ID,
    policy: draft.directAfter
      ? parse(DIRECT_AFTER_RULE_ID, { schemaVersion: "1.0", kind: "DIRECT_AFTER", ...draft.directAfter })
      : null,
  });
  patches.push({
    ruleId: LINKED_ARRIVAL_RULE_ID,
    policy: draft.linkedArrival
      ? parse(LINKED_ARRIVAL_RULE_ID, { schemaVersion: "1.0", kind: "LINKED_ARRIVAL", ...draft.linkedArrival })
      : null,
  });
  return patches;
}

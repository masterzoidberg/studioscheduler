import type { Day } from "@/lib/domain";
import {
  parseTypedPolicy,
  ROOM_REQUIRED_FEATURES_POLICY_KIND,
  ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND,
  STUDIO_OPERATING_WINDOWS_POLICY_KIND,
  TEACHER_DAY_WINDOW_POLICY_KIND,
  TEACHER_QUALIFICATION_POLICY_KIND,
  type PolicyTimeWindowV1,
  type TypedPolicyV1,
} from "@/lib/typed-policy";

export const STUDIO_OPERATING_WINDOWS_RULE_ID = "OPS-001" as const;
export const ROOM_UNAVAILABLE_WINDOWS_RULE_ID = "ROOM-002" as const;
export const ROOM_REQUIRED_FEATURES_RULE_ID = "ROOM-009" as const;
export const TEACHER_AVAILABILITY_RULE_ID = "AIM-003" as const;
export const TEACHER_QUALIFICATION_RULE_ID = "AIM-001" as const;
export const SET04_TEACHER_AVAILABILITY_PREFIX = "SET04-TEACHER-AVAILABILITY-" as const;
export const SET04_TEACHER_QUALIFICATION_PREFIX = "SET04-TEACHER-QUALIFICATION-" as const;

export const SETUP_DAYS: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const DEFAULT_STUDIO_OPERATING_WINDOWS: PolicyTimeWindowV1[] = [
  ...SETUP_DAYS.slice(0, 5).map((day) => ({ day, start: "16:45", end: "21:30" })),
  { day: "Saturday", start: "09:00", end: "15:00" },
];

export interface SetupPolicyDraft {
  operatingWindows: PolicyTimeWindowV1[];
  closedDays: Day[];
  roomUnavailable: { roomId: string; windows: PolicyTimeWindowV1[] } | null;
  roomRequiredFeatures: { classIds: string[]; requiredFeatures: string[] } | null;
  teacherAvailability?: TeacherAvailabilityDraft[];
  teacherQualifications?: TeacherQualificationDraft[];
}

export interface TeacherAvailabilityDraft {
  ruleId: string;
  teacherId: string;
  allowedDays?: Day[];
  windows?: PolicyTimeWindowV1[];
  unavailableDays?: Day[];
  day?: Day;
  start?: string;
  end?: string;
  unrestricted?: boolean;
}

export interface TeacherQualificationDraft {
  ruleId: string;
  teacherId: string;
  classIds: string[];
}

export function generatedTeacherAvailabilityRuleId(teacherId: string) {
  return `${SET04_TEACHER_AVAILABILITY_PREFIX}${teacherId}`;
}

export function generatedTeacherQualificationRuleId(teacherId: string) {
  return `${SET04_TEACHER_QUALIFICATION_PREFIX}${teacherId}`;
}

export interface SetupTypedPolicyPatch {
  ruleId: string;
  policy: TypedPolicyV1 | null;
}

export interface SetupTypedPolicyMutationResult {
  ok: boolean;
  error?: string;
  rulebookVersion?: number;
  enforcementVersion?: number;
  details?: Record<string, unknown>;
}

function parse(ruleId: string, policy: Record<string, unknown>): TypedPolicyV1 {
  const result = parseTypedPolicy({
    id: ruleId,
    parameters: { policy },
  });
  if (result.status !== "VALID") throw new Error(result.status === "INVALID" ? result.message : "A typed setup policy is required.");
  return result.policy;
}

function assertQuarterHour(windows: PolicyTimeWindowV1[]) {
  for (const window of windows) {
    for (const value of [window.start, window.end]) {
      const minute = Number(value.slice(3));
      if (minute % 15 !== 0) throw new Error(`Setup time ${value} must use the supported 15-minute grid.`);
    }
  }
}

function assertNoConflictingTeacherWindows(teacher: TeacherAvailabilityDraft, windows: PolicyTimeWindowV1[]) {
  const sorted = [...windows].sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous.day === current.day && current.start < previous.end) {
      throw new Error(`Teacher ${teacher.teacherId} has conflicting availability windows on ${current.day}: ${previous.start}–${previous.end} and ${current.start}–${current.end}. Adjust or remove one of these windows.`);
    }
  }
}

export function buildSetupTypedPolicyPatches(draft: SetupPolicyDraft): SetupTypedPolicyPatch[] {
  const operating = parse(STUDIO_OPERATING_WINDOWS_RULE_ID, {
    schemaVersion: "1.0",
    kind: STUDIO_OPERATING_WINDOWS_POLICY_KIND,
    windows: draft.operatingWindows,
    closedDays: draft.closedDays,
  });
  if (operating.kind !== STUDIO_OPERATING_WINDOWS_POLICY_KIND) throw new Error("Operating setup policy has the wrong kind.");
  assertQuarterHour(operating.windows);

  const patches: SetupTypedPolicyPatch[] = [{ ruleId: STUDIO_OPERATING_WINDOWS_RULE_ID, policy: operating }];

  if (draft.roomUnavailable) {
    const policy = parse(ROOM_UNAVAILABLE_WINDOWS_RULE_ID, {
      schemaVersion: "1.0",
      kind: ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND,
      roomId: draft.roomUnavailable.roomId,
      windows: draft.roomUnavailable.windows,
    });
    if (policy.kind !== ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND) throw new Error("Room availability setup policy has the wrong kind.");
    assertQuarterHour(policy.windows);
    patches.push({ ruleId: ROOM_UNAVAILABLE_WINDOWS_RULE_ID, policy });
  }

  if (draft.roomRequiredFeatures) {
    const policy = parse(ROOM_REQUIRED_FEATURES_RULE_ID, {
      schemaVersion: "1.0",
      kind: ROOM_REQUIRED_FEATURES_POLICY_KIND,
      classIds: draft.roomRequiredFeatures.classIds,
      requiredFeatures: draft.roomRequiredFeatures.requiredFeatures,
    });
    if (policy.kind !== ROOM_REQUIRED_FEATURES_POLICY_KIND) throw new Error("Room feature setup policy has the wrong kind.");
    patches.push({ ruleId: ROOM_REQUIRED_FEATURES_RULE_ID, policy });
  }

  for (const teacher of draft.teacherAvailability || []) {
    if (teacher.unrestricted) {
      patches.push({ ruleId: teacher.ruleId, policy: null });
      continue;
    }
    const teacherWindows = teacher.windows || [];
    if (teacherWindows.length) {
      assertNoConflictingTeacherWindows(teacher, teacherWindows);
      assertQuarterHour(teacherWindows);
    }
    const policy = parse(teacher.ruleId, {
      schemaVersion: "1.0",
      kind: TEACHER_DAY_WINDOW_POLICY_KIND,
      teacherId: teacher.teacherId,
      ...(teacher.allowedDays ? { allowedDays: teacher.allowedDays } : {}),
      ...(teacherWindows.length ? { windows: teacherWindows } : {}),
      ...(teacher.unavailableDays ? { unavailableDays: teacher.unavailableDays } : {}),
      ...(teacher.day ? { day: teacher.day } : {}),
      ...(teacher.start ? { start: teacher.start } : {}),
      ...(teacher.end ? { end: teacher.end } : {}),
    });
    if (policy.kind !== TEACHER_DAY_WINDOW_POLICY_KIND) throw new Error("Teacher availability setup policy has the wrong kind.");
    patches.push({ ruleId: teacher.ruleId, policy });
  }

  for (const teacher of draft.teacherQualifications || []) {
    const policy = parse(teacher.ruleId, {
      schemaVersion: "1.0",
      kind: TEACHER_QUALIFICATION_POLICY_KIND,
      teacherId: teacher.teacherId,
      classIds: teacher.classIds,
    });
    if (policy.kind !== TEACHER_QUALIFICATION_POLICY_KIND) throw new Error("Teacher qualification setup policy has the wrong kind.");
    patches.push({ ruleId: teacher.ruleId, policy });
  }

  return patches;
}

export function setupPolicyDraftFromRules(
  rules: Array<{ id?: string; parameters: Record<string, unknown> }>,
  teacherIds: string[] = [],
): SetupPolicyDraft {
  const policies = rules.flatMap((rule) => {
    const policy = rule.parameters.policy;
    return policy && typeof policy === "object" && !Array.isArray(policy) ? [policy as Record<string, unknown>] : [];
  });
  const operating = policies.find((policy) => policy.kind === STUDIO_OPERATING_WINDOWS_POLICY_KIND);
  const unavailable = policies.find((policy) => policy.kind === ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND);
  const features = policies.find((policy) => policy.kind === ROOM_REQUIRED_FEATURES_POLICY_KIND);
  const teacherAvailability: TeacherAvailabilityDraft[] = [];
  const teacherQualifications: TeacherQualificationDraft[] = [];
  for (const rule of rules) {
    if (!rule.id) continue;
    const policy = rule.parameters.policy;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) continue;
    const kind = (policy as Record<string, unknown>).kind;
    if (kind === TEACHER_DAY_WINDOW_POLICY_KIND && typeof (policy as Record<string, unknown>).teacherId === "string") {
      const item = policy as Record<string, unknown>;
      teacherAvailability.push({
        ruleId: rule.id,
        teacherId: item.teacherId as string,
        allowedDays: Array.isArray(item.allowedDays) ? item.allowedDays as Day[] : undefined,
        windows: Array.isArray(item.windows) ? item.windows as PolicyTimeWindowV1[] : undefined,
        unavailableDays: Array.isArray(item.unavailableDays) ? item.unavailableDays as Day[] : undefined,
        day: typeof item.day === "string" ? item.day as Day : undefined,
        start: typeof item.start === "string" ? item.start : undefined,
        end: typeof item.end === "string" ? item.end : undefined,
      });
    }
    if (kind === TEACHER_QUALIFICATION_POLICY_KIND && typeof (policy as Record<string, unknown>).teacherId === "string" && Array.isArray((policy as Record<string, unknown>).classIds)) {
      teacherQualifications.push({ ruleId: rule.id, teacherId: (policy as Record<string, unknown>).teacherId as string, classIds: (policy as Record<string, unknown>).classIds as string[] });
    }
  }
  for (const teacherId of teacherIds) {
    if (!teacherAvailability.some((item) => item.teacherId === teacherId)) {
      teacherAvailability.push({ ruleId: generatedTeacherAvailabilityRuleId(teacherId), teacherId, unrestricted: true });
    }
    if (!teacherQualifications.some((item) => item.teacherId === teacherId)) {
      teacherQualifications.push({ ruleId: generatedTeacherQualificationRuleId(teacherId), teacherId, classIds: [] });
    }
  }
  return {
    operatingWindows: operating && Array.isArray(operating.windows) ? operating.windows as PolicyTimeWindowV1[] : DEFAULT_STUDIO_OPERATING_WINDOWS.map((window) => ({ ...window })),
    closedDays: operating && Array.isArray(operating.closedDays) ? operating.closedDays as Day[] : [],
    roomUnavailable: unavailable && typeof unavailable.roomId === "string" && Array.isArray(unavailable.windows)
      ? { roomId: unavailable.roomId, windows: unavailable.windows as PolicyTimeWindowV1[] }
      : null,
    roomRequiredFeatures: features && Array.isArray(features.classIds) && Array.isArray(features.requiredFeatures)
      ? { classIds: features.classIds as string[], requiredFeatures: features.requiredFeatures as string[] }
      : null,
    teacherAvailability,
    teacherQualifications,
  };
}

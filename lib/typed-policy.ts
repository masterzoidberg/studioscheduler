import type { Day, StudioRule } from "@/lib/domain";

export const TYPED_POLICY_ENVELOPE_KEY = "policy";
export const TYPED_POLICY_SCHEMA_VERSION = "1.0" as const;
export const TEACHER_DAY_WINDOW_POLICY_SCHEMA_VERSION = TYPED_POLICY_SCHEMA_VERSION;

export const TEACHER_DAY_WINDOW_POLICY_KIND = "TEACHER_DAY_WINDOW" as const;
export const STUDIO_OPERATING_WINDOWS_POLICY_KIND = "STUDIO_OPERATING_WINDOWS" as const;
export const ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND = "ROOM_UNAVAILABLE_WINDOWS" as const;
export const TEACHER_QUALIFICATION_POLICY_KIND = "TEACHER_QUALIFICATION" as const;
export const REQUIRED_TEACHER_POLICY_KIND = "REQUIRED_TEACHER" as const;
export const REQUIRED_ROOM_POLICY_KIND = "REQUIRED_ROOM" as const;
export const ROOM_CAPACITY_POLICY_KIND = "ROOM_CAPACITY_POLICY" as const;
export const ROOM_REQUIRED_FEATURES_POLICY_KIND = "ROOM_REQUIRED_FEATURES" as const;
export const PREFERRED_TEACHER_POLICY_KIND = "PREFERRED_TEACHER" as const;
export const PREFERRED_ROOM_POLICY_KIND = "PREFERRED_ROOM" as const;
export const PREFERRED_DAY_POLICY_KIND = "PREFERRED_DAY" as const;
export const AVOID_DAY_POLICY_KIND = "AVOID_DAY" as const;

const DAYS: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SET = new Set<string>(DAYS);
const DAY_ORDER = new Map(DAYS.map((day, index) => [day, index]));
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

interface TypedPolicyBaseV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: string;
}

export interface PolicyTimeWindowV1 { day: Day; start: string; end: string }
export interface TeacherDayWindowPolicyV1 extends TypedPolicyBaseV1 { kind: typeof TEACHER_DAY_WINDOW_POLICY_KIND; teacherId: string; allowedDays?: Day[]; day?: Day; start?: string; end?: string }
export interface StudioOperatingWindowsPolicyV1 extends TypedPolicyBaseV1 { kind: typeof STUDIO_OPERATING_WINDOWS_POLICY_KIND; windows: PolicyTimeWindowV1[]; closedDays?: Day[] }
export interface RoomUnavailableWindowsPolicyV1 extends TypedPolicyBaseV1 { kind: typeof ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND; roomId: string; windows: PolicyTimeWindowV1[] }
export interface TeacherQualificationPolicyV1 extends TypedPolicyBaseV1 { kind: typeof TEACHER_QUALIFICATION_POLICY_KIND; teacherId: string; classIds: string[] }
export interface RequiredTeacherPolicyV1 extends TypedPolicyBaseV1 { kind: typeof REQUIRED_TEACHER_POLICY_KIND; teacherId: string; classIds: string[] }
export interface RequiredRoomPolicyV1 extends TypedPolicyBaseV1 { kind: typeof REQUIRED_ROOM_POLICY_KIND; roomId: string; classIds: string[] }
export interface RoomCapacityPolicyV1 extends TypedPolicyBaseV1 { kind: typeof ROOM_CAPACITY_POLICY_KIND; roomId: string; exemptClassIds?: string[] }
export interface RoomRequiredFeaturesPolicyV1 extends TypedPolicyBaseV1 { kind: typeof ROOM_REQUIRED_FEATURES_POLICY_KIND; classIds: string[]; requiredFeatures: string[] }
export interface PreferredTeacherPolicyV1 extends TypedPolicyBaseV1 { kind: typeof PREFERRED_TEACHER_POLICY_KIND; teacherId: string; classIds: string[] }
export interface PreferredRoomPolicyV1 extends TypedPolicyBaseV1 { kind: typeof PREFERRED_ROOM_POLICY_KIND; roomId: string; classIds: string[] }
export interface PreferredDayPolicyV1 extends TypedPolicyBaseV1 { kind: typeof PREFERRED_DAY_POLICY_KIND; classIds: string[]; days: Day[] }
export interface AvoidDayPolicyV1 extends TypedPolicyBaseV1 { kind: typeof AVOID_DAY_POLICY_KIND; classIds: string[]; days: Day[] }

export type TypedPolicyV1 =
  | TeacherDayWindowPolicyV1 | StudioOperatingWindowsPolicyV1 | RoomUnavailableWindowsPolicyV1
  | TeacherQualificationPolicyV1 | RequiredTeacherPolicyV1 | RequiredRoomPolicyV1 | RoomCapacityPolicyV1
  | RoomRequiredFeaturesPolicyV1 | PreferredTeacherPolicyV1 | PreferredRoomPolicyV1 | PreferredDayPolicyV1 | AvoidDayPolicyV1;

export type TypedPolicyParseResult = { status: "NONE" } | { status: "VALID"; policy: TypedPolicyV1 } | { status: "INVALID"; code: string; message: string };

const asObject = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const bad = (id: string, code: string, message: string): TypedPolicyParseResult => ({ status: "INVALID", code, message: `${id} ${message}` });
const day = (value: unknown): Day | null => typeof value === "string" && DAY_SET.has(value) ? value as Day : null;

function strings(value: unknown, allowEmpty = false): string[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return null;
  const parsed = value.map(text);
  if (parsed.some((item) => item === null)) return null;
  return [...new Set(parsed as string[])].sort();
}

function days(value: unknown, allowEmpty = false): Day[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return null;
  const parsed = value.map(day);
  if (parsed.some((item) => item === null)) return null;
  return [...new Set(parsed as Day[])].sort((a, b) => (DAY_ORDER.get(a) ?? 99) - (DAY_ORDER.get(b) ?? 99));
}

function windows(value: unknown): PolicyTimeWindowV1[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed: PolicyTimeWindowV1[] = [];
  for (const raw of value) {
    const item = asObject(raw);
    if (!item || Object.keys(item).some((key) => !["day", "start", "end"].includes(key))) return null;
    const d = day(item.day); const start = text(item.start); const end = text(item.end);
    if (!d || !start || !end || !TIME.test(start) || !TIME.test(end) || start >= end) return null;
    parsed.push({ day: d, start, end });
  }
  const unique = new Map(parsed.map((item) => [`${item.day}|${item.start}|${item.end}`, item]));
  return [...unique.values()].sort((a, b) => (DAY_ORDER.get(a.day)! - DAY_ORDER.get(b.day)!) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

function keys(id: string, envelope: Record<string, unknown>, allowed: string[]) {
  const set = new Set(allowed);
  const unknown = Object.keys(envelope).filter((key) => !set.has(key)).sort();
  return unknown.length ? bad(id, "TYPED_POLICY_UNKNOWN_FIELD", `typed policy contains unsupported field(s): ${unknown.join(", ")}.`) : null;
}

function stableId(id: string, envelope: Record<string, unknown>, key: "teacherId" | "roomId"): string | TypedPolicyParseResult {
  return text(envelope[key]) || bad(id, `TYPED_POLICY_${key === "teacherId" ? "TEACHER" : "ROOM"}_ID_REQUIRED`, `typed policy requires a stable ${key}.`);
}

export function parseTypedPolicy(rule: Pick<StudioRule, "id" | "parameters">): TypedPolicyParseResult {
  if (!Object.prototype.hasOwnProperty.call(rule.parameters, TYPED_POLICY_ENVELOPE_KEY)) return { status: "NONE" };
  const envelope = asObject(rule.parameters[TYPED_POLICY_ENVELOPE_KEY]);
  if (!envelope) return bad(rule.id, "TYPED_POLICY_ENVELOPE_INVALID", "parameters.policy must be an object.");
  if (envelope.schemaVersion !== TYPED_POLICY_SCHEMA_VERSION) return bad(rule.id, "TYPED_POLICY_SCHEMA_UNSUPPORTED", `typed policy schemaVersion must be ${TYPED_POLICY_SCHEMA_VERSION}.`);
  const kind = text(envelope.kind);
  if (!kind) return bad(rule.id, "TYPED_POLICY_KIND_UNSUPPORTED", "typed policy kind missing is unsupported.");

  if (kind === TEACHER_DAY_WINDOW_POLICY_KIND) {
    const e = keys(rule.id, envelope, ["schemaVersion", "kind", "teacherId", "allowedDays", "day", "start", "end"]); if (e) return e;
    const teacherId = stableId(rule.id, envelope, "teacherId"); if (typeof teacherId !== "string") return teacherId;
    const allowedDays = envelope.allowedDays === undefined ? [] : days(envelope.allowedDays);
    if (allowedDays === null || (Array.isArray(envelope.allowedDays) && allowedDays.length !== envelope.allowedDays.length)) return bad(rule.id, "TYPED_POLICY_ALLOWED_DAYS_INVALID", "allowedDays must be a non-empty, duplicate-free list of supported studio days.");
    const exactDay = envelope.day === undefined ? null : day(envelope.day);
    if (envelope.day !== undefined && !exactDay) return bad(rule.id, "TYPED_POLICY_DAY_INVALID", "day must be a supported studio day.");
    if (allowedDays.length && exactDay) return bad(rule.id, "TYPED_POLICY_WINDOW_AMBIGUOUS", "typed teacher window must use either allowedDays or one day/time window, not both.");
    const start = envelope.start === undefined ? null : text(envelope.start); const end = envelope.end === undefined ? null : text(envelope.end);
    if ((start && !TIME.test(start)) || (end && !TIME.test(end))) return bad(rule.id, "TYPED_POLICY_TIME_INVALID", "start/end must use canonical HH:MM 24-hour time.");
    if ((start || end) && !exactDay) return bad(rule.id, "TYPED_POLICY_DAY_REQUIRED_FOR_TIME", "start/end require a specific day.");
    if (start && end && start >= end) return bad(rule.id, "TYPED_POLICY_WINDOW_INVALID", "typed teacher window start must be earlier than end.");
    if (!allowedDays.length && !exactDay) return bad(rule.id, "TYPED_POLICY_WINDOW_REQUIRED", "typed teacher availability policy requires allowedDays or a specific day window.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, teacherId, ...(allowedDays.length ? { allowedDays } : {}), ...(exactDay ? { day: exactDay } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) } };
  }

  if (kind === STUDIO_OPERATING_WINDOWS_POLICY_KIND) {
    const e = keys(rule.id, envelope, ["schemaVersion", "kind", "windows", "closedDays"]); if (e) return e;
    const parsedWindows = windows(envelope.windows); if (!parsedWindows) return bad(rule.id, "TYPED_POLICY_WINDOWS_INVALID", "operating windows must be non-empty half-open same-day intervals with start earlier than end.");
    const closedDays = envelope.closedDays === undefined ? [] : days(envelope.closedDays, true); if (closedDays === null) return bad(rule.id, "TYPED_POLICY_CLOSED_DAYS_INVALID", "closedDays must contain supported studio days.");
    const conflict = parsedWindows.find((item) => closedDays.includes(item.day)); if (conflict) return bad(rule.id, "TYPED_POLICY_WINDOW_CLOSED_DAY_CONFLICT", `cannot define an operating window on closed day ${conflict.day}.`);
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, windows: parsedWindows, ...(closedDays.length ? { closedDays } : {}) } };
  }

  if (kind === ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND) {
    const e = keys(rule.id, envelope, ["schemaVersion", "kind", "roomId", "windows"]); if (e) return e;
    const roomId = stableId(rule.id, envelope, "roomId"); if (typeof roomId !== "string") return roomId;
    const parsedWindows = windows(envelope.windows); if (!parsedWindows) return bad(rule.id, "TYPED_POLICY_WINDOWS_INVALID", "room unavailable windows must be non-empty half-open same-day intervals with start earlier than end.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, roomId, windows: parsedWindows } };
  }

  if (kind === TEACHER_QUALIFICATION_POLICY_KIND) {
    const e = keys(rule.id, envelope, ["schemaVersion", "kind", "teacherId", "classIds"]); if (e) return e;
    const teacherId = stableId(rule.id, envelope, "teacherId"); if (typeof teacherId !== "string") return teacherId;
    const classIds = strings(envelope.classIds, true); if (classIds === null) return bad(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", "qualification classIds must be an array of stable class IDs; an explicit empty array means no classes are qualified.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, teacherId, classIds } };
  }

  if (kind === REQUIRED_TEACHER_POLICY_KIND || kind === PREFERRED_TEACHER_POLICY_KIND) {
    const e = keys(rule.id, envelope, ["schemaVersion", "kind", "teacherId", "classIds"]); if (e) return e;
    const teacherId = stableId(rule.id, envelope, "teacherId"); if (typeof teacherId !== "string") return teacherId;
    const classIds = strings(envelope.classIds); if (!classIds) return bad(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", `${kind} classIds must be a non-empty array of stable class IDs.`);
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, teacherId, classIds } };
  }

  if (kind === REQUIRED_ROOM_POLICY_KIND || kind === PREFERRED_ROOM_POLICY_KIND) {
    const e = keys(rule.id, envelope, ["schemaVersion", "kind", "roomId", "classIds"]); if (e) return e;
    const roomId = stableId(rule.id, envelope, "roomId"); if (typeof roomId !== "string") return roomId;
    const classIds = strings(envelope.classIds); if (!classIds) return bad(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", `${kind} classIds must be a non-empty array of stable class IDs.`);
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, roomId, classIds } };
  }

  if (kind === ROOM_CAPACITY_POLICY_KIND) {
    const e = keys(rule.id, envelope, ["schemaVersion", "kind", "roomId", "exemptClassIds"]); if (e) return e;
    const roomId = stableId(rule.id, envelope, "roomId"); if (typeof roomId !== "string") return roomId;
    const exemptClassIds = envelope.exemptClassIds === undefined ? [] : strings(envelope.exemptClassIds, true); if (exemptClassIds === null) return bad(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", "exemptClassIds must contain stable class IDs.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, roomId, ...(exemptClassIds.length ? { exemptClassIds } : {}) } };
  }

  if (kind === ROOM_REQUIRED_FEATURES_POLICY_KIND) {
    const e = keys(rule.id, envelope, ["schemaVersion", "kind", "classIds", "requiredFeatures"]); if (e) return e;
    const classIds = strings(envelope.classIds); const requiredFeatures = strings(envelope.requiredFeatures);
    if (!classIds) return bad(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", "required-feature classIds must be a non-empty array of stable class IDs.");
    if (!requiredFeatures) return bad(rule.id, "TYPED_POLICY_FEATURES_INVALID", "requiredFeatures must be a non-empty list of canonical room feature names.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, classIds, requiredFeatures } };
  }

  if (kind === PREFERRED_DAY_POLICY_KIND || kind === AVOID_DAY_POLICY_KIND) {
    const e = keys(rule.id, envelope, ["schemaVersion", "kind", "classIds", "days"]); if (e) return e;
    const classIds = strings(envelope.classIds); const preferredDays = days(envelope.days);
    if (!classIds) return bad(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", `${kind} classIds must be a non-empty array of stable class IDs.`);
    if (!preferredDays) return bad(rule.id, "TYPED_POLICY_DAYS_INVALID", `${kind} days must be a non-empty list of supported studio days.`);
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, classIds, days: preferredDays } };
  }

  return bad(rule.id, "TYPED_POLICY_KIND_UNSUPPORTED", `typed policy kind ${kind} is unsupported.`);
}

export function isTeacherDayWindowPolicy(policy: TypedPolicyV1): policy is TeacherDayWindowPolicyV1 {
  return policy.kind === TEACHER_DAY_WINDOW_POLICY_KIND;
}

export function teacherDayWindowPolicyParameters(policy: TeacherDayWindowPolicyV1): Record<string, unknown> {
  return {
    ...(policy.allowedDays ? { allowedDays: [...policy.allowedDays] } : {}),
    ...(policy.day ? { day: policy.day } : {}),
    ...(policy.start ? { start: policy.start } : {}),
    ...(policy.end ? { end: policy.end } : {}),
  };
}

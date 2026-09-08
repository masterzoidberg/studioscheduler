import type { Day, StudioRule } from "@/lib/domain";

export const TYPED_POLICY_ENVELOPE_KEY = "policy";
export const TYPED_POLICY_SCHEMA_VERSION = "1.0" as const;

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

// Backwards-compatible POL-01 export.
export const TEACHER_DAY_WINDOW_POLICY_SCHEMA_VERSION = TYPED_POLICY_SCHEMA_VERSION;

const DAYS: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SET = new Set<string>(DAYS);
const DAY_ORDER = new Map(DAYS.map((day, index) => [day, index]));
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface PolicyTimeWindowV1 {
  day: Day;
  start: string;
  end: string;
}

export interface TeacherDayWindowPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof TEACHER_DAY_WINDOW_POLICY_KIND;
  teacherId: string;
  allowedDays?: Day[];
  day?: Day;
  start?: string;
  end?: string;
}

export interface StudioOperatingWindowsPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof STUDIO_OPERATING_WINDOWS_POLICY_KIND;
  windows: PolicyTimeWindowV1[];
  closedDays?: Day[];
}

export interface RoomUnavailableWindowsPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND;
  roomId: string;
  windows: PolicyTimeWindowV1[];
}

export interface TeacherQualificationPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof TEACHER_QUALIFICATION_POLICY_KIND;
  teacherId: string;
  classIds: string[];
}

export interface RequiredTeacherPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof REQUIRED_TEACHER_POLICY_KIND;
  teacherId: string;
  classIds: string[];
}

export interface RequiredRoomPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof REQUIRED_ROOM_POLICY_KIND;
  roomId: string;
  classIds: string[];
}

export interface RoomCapacityPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof ROOM_CAPACITY_POLICY_KIND;
  roomId: string;
  exemptClassIds?: string[];
}

export interface RoomRequiredFeaturesPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof ROOM_REQUIRED_FEATURES_POLICY_KIND;
  classIds: string[];
  requiredFeatures: string[];
}

export interface PreferredTeacherPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof PREFERRED_TEACHER_POLICY_KIND;
  teacherId: string;
  classIds: string[];
}

export interface PreferredRoomPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof PREFERRED_ROOM_POLICY_KIND;
  roomId: string;
  classIds: string[];
}

export interface PreferredDayPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof PREFERRED_DAY_POLICY_KIND;
  classIds: string[];
  days: Day[];
}

export interface AvoidDayPolicyV1 {
  schemaVersion: typeof TYPED_POLICY_SCHEMA_VERSION;
  kind: typeof AVOID_DAY_POLICY_KIND;
  classIds: string[];
  days: Day[];
}

export type TypedPolicyV1 =
  | TeacherDayWindowPolicyV1
  | StudioOperatingWindowsPolicyV1
  | RoomUnavailableWindowsPolicyV1
  | TeacherQualificationPolicyV1
  | RequiredTeacherPolicyV1
  | RequiredRoomPolicyV1
  | RoomCapacityPolicyV1
  | RoomRequiredFeaturesPolicyV1
  | PreferredTeacherPolicyV1
  | PreferredRoomPolicyV1
  | PreferredDayPolicyV1
  | AvoidDayPolicyV1;

export type TypedPolicyParseResult =
  | { status: "NONE" }
  | { status: "VALID"; policy: TypedPolicyV1 }
  | { status: "INVALID"; code: string; message: string };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function invalid(ruleId: string, code: string, message: string): TypedPolicyParseResult {
  return { status: "INVALID", code, message: `${ruleId} ${message}` };
}

function parseDay(value: unknown): Day | null {
  return typeof value === "string" && DAY_SET.has(value) ? value as Day : null;
}

function canonicalDays(value: unknown, allowEmpty = false): Day[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return null;
  const parsed = value.map(parseDay);
  if (parsed.some((day) => day === null)) return null;
  return [...new Set(parsed as Day[])].sort((a, b) => (DAY_ORDER.get(a) ?? 99) - (DAY_ORDER.get(b) ?? 99));
}

function canonicalStrings(value: unknown, allowEmpty = false): string[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return null;
  const parsed = value.map(nonEmptyString);
  if (parsed.some((item) => item === null)) return null;
  return [...new Set(parsed as string[])].sort();
}

function parseWindows(value: unknown): PolicyTimeWindowV1[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const windows: PolicyTimeWindowV1[] = [];
  for (const raw of value) {
    const item = object(raw);
    if (!item) return null;
    const unknown = Object.keys(item).filter((key) => !new Set(["day", "start", "end"]).has(key));
    if (unknown.length) return null;
    const day = parseDay(item.day);
    const start = nonEmptyString(item.start);
    const end = nonEmptyString(item.end);
    if (!day || !start || !end || !TIME.test(start) || !TIME.test(end) || start >= end) return null;
    windows.push({ day, start, end });
  }
  const unique = new Map(windows.map((window) => [`${window.day}|${window.start}|${window.end}`, window]));
  return [...unique.values()].sort((a, b) => {
    const day = (DAY_ORDER.get(a.day) ?? 99) - (DAY_ORDER.get(b.day) ?? 99);
    if (day) return day;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    return a.end < b.end ? -1 : a.end > b.end ? 1 : 0;
  });
}

function ensureKeys(ruleId: string, envelope: Record<string, unknown>, allowed: string[]): TypedPolicyParseResult | null {
  const allowedSet = new Set(allowed);
  const unknownKeys = Object.keys(envelope).filter((key) => !allowedSet.has(key)).sort();
  return unknownKeys.length
    ? invalid(ruleId, "TYPED_POLICY_UNKNOWN_FIELD", `typed policy contains unsupported field(s): ${unknownKeys.join(", ")}.`)
    : null;
}

function requireId(ruleId: string, envelope: Record<string, unknown>, key: "teacherId" | "roomId") {
  const value = nonEmptyString(envelope[key]);
  return value || invalid(ruleId, `TYPED_POLICY_${key === "teacherId" ? "TEACHER" : "ROOM"}_ID_REQUIRED`, `typed policy requires a stable ${key}.`);
}

/**
 * Parse schema-versioned typed policy. Absence of parameters.policy remains
 * legacy policy. Presence claims machine authority and therefore fails closed
 * on unknown kinds, versions, fields, IDs or malformed intervals.
 */
export function parseTypedPolicy(rule: Pick<StudioRule, "id" | "parameters">): TypedPolicyParseResult {
  if (!Object.prototype.hasOwnProperty.call(rule.parameters, TYPED_POLICY_ENVELOPE_KEY)) return { status: "NONE" };

  const envelope = object(rule.parameters[TYPED_POLICY_ENVELOPE_KEY]);
  if (!envelope) return invalid(rule.id, "TYPED_POLICY_ENVELOPE_INVALID", "parameters.policy must be an object.");
  if (envelope.schemaVersion !== TYPED_POLICY_SCHEMA_VERSION) {
    return invalid(rule.id, "TYPED_POLICY_SCHEMA_UNSUPPORTED", `typed policy schemaVersion must be ${TYPED_POLICY_SCHEMA_VERSION}.`);
  }

  const kind = nonEmptyString(envelope.kind);
  if (!kind) return invalid(rule.id, "TYPED_POLICY_KIND_UNSUPPORTED", "typed policy kind missing is unsupported.");

  if (kind === TEACHER_DAY_WINDOW_POLICY_KIND) {
    const keyError = ensureKeys(rule.id, envelope, ["schemaVersion", "kind", "teacherId", "allowedDays", "day", "start", "end"]);
    if (keyError) return keyError;
    const teacherId = requireId(rule.id, envelope, "teacherId");
    if (typeof teacherId !== "string") return teacherId;
    const allowedDays = envelope.allowedDays === undefined ? [] : canonicalDays(envelope.allowedDays);
    if (allowedDays === null) return invalid(rule.id, "TYPED_POLICY_ALLOWED_DAYS_INVALID", "allowedDays must be a non-empty list of supported studio days.");
    if (Array.isArray(envelope.allowedDays) && allowedDays.length !== envelope.allowedDays.length) {
      return invalid(rule.id, "TYPED_POLICY_ALLOWED_DAYS_INVALID", "allowedDays must not contain duplicates.");
    }
    const day = envelope.day === undefined ? null : parseDay(envelope.day);
    if (envelope.day !== undefined && !day) return invalid(rule.id, "TYPED_POLICY_DAY_INVALID", "day must be a supported studio day.");
    if (allowedDays.length > 0 && day) return invalid(rule.id, "TYPED_POLICY_WINDOW_AMBIGUOUS", "typed teacher window must use either allowedDays or one day/time window, not both.");
    const start = envelope.start === undefined ? null : nonEmptyString(envelope.start);
    const end = envelope.end === undefined ? null : nonEmptyString(envelope.end);
    if ((start && !TIME.test(start)) || (end && !TIME.test(end))) return invalid(rule.id, "TYPED_POLICY_TIME_INVALID", "start/end must use canonical HH:MM 24-hour time.");
    if ((start || end) && !day) return invalid(rule.id, "TYPED_POLICY_DAY_REQUIRED_FOR_TIME", "start/end require a specific day.");
    if (start && end && start >= end) return invalid(rule.id, "TYPED_POLICY_WINDOW_INVALID", "typed teacher window start must be earlier than end.");
    if (allowedDays.length === 0 && !day) return invalid(rule.id, "TYPED_POLICY_WINDOW_REQUIRED", "typed teacher availability policy requires allowedDays or a specific day window.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, teacherId, ...(allowedDays.length ? { allowedDays } : {}), ...(day ? { day } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) } };
  }

  if (kind === STUDIO_OPERATING_WINDOWS_POLICY_KIND) {
    const keyError = ensureKeys(rule.id, envelope, ["schemaVersion", "kind", "windows", "closedDays"]);
    if (keyError) return keyError;
    const windows = parseWindows(envelope.windows);
    if (!windows) return invalid(rule.id, "TYPED_POLICY_WINDOWS_INVALID", "operating windows must be non-empty half-open same-day intervals with start earlier than end.");
    const closedDays = envelope.closedDays === undefined ? [] : canonicalDays(envelope.closedDays, true);
    if (closedDays === null) return invalid(rule.id, "TYPED_POLICY_CLOSED_DAYS_INVALID", "closedDays must contain supported studio days.");
    const conflicts = windows.filter((window) => closedDays.includes(window.day));
    if (conflicts.length) return invalid(rule.id, "TYPED_POLICY_WINDOW_CLOSED_DAY_CONFLICT", `cannot define an operating window on closed day ${conflicts[0].day}.`);
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, windows, ...(closedDays.length ? { closedDays } : {}) } };
  }

  if (kind === ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND) {
    const keyError = ensureKeys(rule.id, envelope, ["schemaVersion", "kind", "roomId", "windows"]);
    if (keyError) return keyError;
    const roomId = requireId(rule.id, envelope, "roomId");
    if (typeof roomId !== "string") return roomId;
    const windows = parseWindows(envelope.windows);
    if (!windows) return invalid(rule.id, "TYPED_POLICY_WINDOWS_INVALID", "room unavailable windows must be non-empty half-open same-day intervals with start earlier than end.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, roomId, windows } };
  }

  if (kind === TEACHER_QUALIFICATION_POLICY_KIND) {
    const keyError = ensureKeys(rule.id, envelope, ["schemaVersion", "kind", "teacherId", "classIds"]);
    if (keyError) return keyError;
    const teacherId = requireId(rule.id, envelope, "teacherId");
    if (typeof teacherId !== "string") return teacherId;
    const classIds = canonicalStrings(envelope.classIds, true);
    if (classIds === null) return invalid(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", "qualification classIds must be an array of stable class IDs; an explicit empty array means no classes are qualified.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, teacherId, classIds } };
  }

  if (kind === REQUIRED_TEACHER_POLICY_KIND || kind === PREFERRED_TEACHER_POLICY_KIND) {
    const keyError = ensureKeys(rule.id, envelope, ["schemaVersion", "kind", "teacherId", "classIds"]);
    if (keyError) return keyError;
    const teacherId = requireId(rule.id, envelope, "teacherId");
    if (typeof teacherId !== "string") return teacherId;
    const classIds = canonicalStrings(envelope.classIds);
    if (!classIds) return invalid(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", `${kind} classIds must be a non-empty array of stable class IDs.`);
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, teacherId, classIds } };
  }

  if (kind === REQUIRED_ROOM_POLICY_KIND || kind === PREFERRED_ROOM_POLICY_KIND) {
    const keyError = ensureKeys(rule.id, envelope, ["schemaVersion", "kind", "roomId", "classIds"]);
    if (keyError) return keyError;
    const roomId = requireId(rule.id, envelope, "roomId");
    if (typeof roomId !== "string") return roomId;
    const classIds = canonicalStrings(envelope.classIds);
    if (!classIds) return invalid(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", `${kind} classIds must be a non-empty array of stable class IDs.`);
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, roomId, classIds } };
  }

  if (kind === ROOM_CAPACITY_POLICY_KIND) {
    const keyError = ensureKeys(rule.id, envelope, ["schemaVersion", "kind", "roomId", "exemptClassIds"]);
    if (keyError) return keyError;
    const roomId = requireId(rule.id, envelope, "roomId");
    if (typeof roomId !== "string") return roomId;
    const exemptClassIds = envelope.exemptClassIds === undefined ? [] : canonicalStrings(envelope.exemptClassIds, true);
    if (exemptClassIds === null) return invalid(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", "exemptClassIds must contain stable class IDs.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, roomId, ...(exemptClassIds.length ? { exemptClassIds } : {}) } };
  }

  if (kind === ROOM_REQUIRED_FEATURES_POLICY_KIND) {
    const keyError = ensureKeys(rule.id, envelope, ["schemaVersion", "kind", "classIds", "requiredFeatures"]);
    if (keyError) return keyError;
    const classIds = canonicalStrings(envelope.classIds);
    const requiredFeatures = canonicalStrings(envelope.requiredFeatures);
    if (!classIds) return invalid(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", "required-feature classIds must be a non-empty array of stable class IDs.");
    if (!requiredFeatures) return invalid(rule.id, "TYPED_POLICY_FEATURES_INVALID", "requiredFeatures must be a non-empty list of canonical room feature names.");
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, classIds, requiredFeatures } };
  }

  if (kind === PREFERRED_DAY_POLICY_KIND || kind === AVOID_DAY_POLICY_KIND) {
    const keyError = ensureKeys(rule.id, envelope, ["schemaVersion", "kind", "classIds", "days"]);
    if (keyError) return keyError;
    const classIds = canonicalStrings(envelope.classIds);
    const days = canonicalDays(envelope.days);
    if (!classIds) return invalid(rule.id, "TYPED_POLICY_CLASS_IDS_INVALID", `${kind} classIds must be a non-empty array of stable class IDs.`);
    if (!days) return invalid(rule.id, "TYPED_POLICY_DAYS_INVALID", `${kind} days must be a non-empty list of supported studio days.`);
    return { status: "VALID", policy: { schemaVersion: TYPED_POLICY_SCHEMA_VERSION, kind, classIds, days } };
  }

  return invalid(rule.id, "TYPED_POLICY_KIND_UNSUPPORTED", `typed policy kind ${kind} is unsupported.`);
}

export function teacherDayWindowPolicyParameters(policy: TeacherDayWindowPolicyV1): Record<string, unknown> {
  return {
    ...(policy.allowedDays ? { allowedDays: [...policy.allowedDays] } : {}),
    ...(policy.day ? { day: policy.day } : {}),
    ...(policy.start ? { start: policy.start } : {}),
    ...(policy.end ? { end: policy.end } : {}),
  };
}

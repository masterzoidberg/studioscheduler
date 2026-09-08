import type { Day, StudioRule } from "@/lib/domain";

export const TYPED_POLICY_ENVELOPE_KEY = "policy";
export const TEACHER_DAY_WINDOW_POLICY_SCHEMA_VERSION = "1.0" as const;
export const TEACHER_DAY_WINDOW_POLICY_KIND = "TEACHER_DAY_WINDOW" as const;

const DAYS: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SET = new Set<string>(DAYS);
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface TeacherDayWindowPolicyV1 {
  schemaVersion: typeof TEACHER_DAY_WINDOW_POLICY_SCHEMA_VERSION;
  kind: typeof TEACHER_DAY_WINDOW_POLICY_KIND;
  teacherId: string;
  allowedDays?: Day[];
  day?: Day;
  start?: string;
  end?: string;
}

export type TypedPolicyParseResult =
  | { status: "NONE" }
  | { status: "VALID"; policy: TeacherDayWindowPolicyV1 }
  | { status: "INVALID"; code: string; message: string };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDay(value: unknown): Day | null {
  return typeof value === "string" && DAY_SET.has(value) ? value as Day : null;
}

function parseAllowedDays(value: unknown): Day[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map(parseDay);
  if (parsed.some((day) => day === null)) return null;
  const unique = [...new Set(parsed as Day[])];
  return unique.length === value.length ? unique : null;
}

/**
 * Parse the deliberately small first typed-policy family.
 *
 * Absence of `parameters.policy` is legacy policy, not an error. Presence is an
 * explicit claim of machine-readable authority and therefore validates strictly:
 * unknown keys, kinds, versions and malformed windows fail closed.
 */
export function parseTypedPolicy(rule: Pick<StudioRule, "id" | "parameters">): TypedPolicyParseResult {
  if (!Object.prototype.hasOwnProperty.call(rule.parameters, TYPED_POLICY_ENVELOPE_KEY)) {
    return { status: "NONE" };
  }

  const envelope = object(rule.parameters[TYPED_POLICY_ENVELOPE_KEY]);
  if (!envelope) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_ENVELOPE_INVALID",
      message: `${rule.id} parameters.policy must be an object.`,
    };
  }

  const allowedKeys = new Set(["schemaVersion", "kind", "teacherId", "allowedDays", "day", "start", "end"]);
  const unknownKeys = Object.keys(envelope).filter((key) => !allowedKeys.has(key)).sort();
  if (unknownKeys.length > 0) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_UNKNOWN_FIELD",
      message: `${rule.id} typed policy contains unsupported field(s): ${unknownKeys.join(", ")}.`,
    };
  }

  if (envelope.schemaVersion !== TEACHER_DAY_WINDOW_POLICY_SCHEMA_VERSION) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_SCHEMA_UNSUPPORTED",
      message: `${rule.id} typed policy schemaVersion must be ${TEACHER_DAY_WINDOW_POLICY_SCHEMA_VERSION}.`,
    };
  }
  if (envelope.kind !== TEACHER_DAY_WINDOW_POLICY_KIND) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_KIND_UNSUPPORTED",
      message: `${rule.id} typed policy kind ${String(envelope.kind || "missing")} is unsupported.`,
    };
  }

  const teacherId = nonEmptyString(envelope.teacherId);
  if (!teacherId) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_TEACHER_ID_REQUIRED",
      message: `${rule.id} typed teacher availability policy requires a stable teacherId.`,
    };
  }

  const allowedDays = parseAllowedDays(envelope.allowedDays);
  if (allowedDays === null) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_ALLOWED_DAYS_INVALID",
      message: `${rule.id} allowedDays must be a non-empty, duplicate-free list of supported studio days.`,
    };
  }

  const day = envelope.day === undefined ? null : parseDay(envelope.day);
  if (envelope.day !== undefined && !day) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_DAY_INVALID",
      message: `${rule.id} day must be a supported studio day.`,
    };
  }
  if (allowedDays.length > 0 && day) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_WINDOW_AMBIGUOUS",
      message: `${rule.id} typed teacher window must use either allowedDays or one day/time window, not both.`,
    };
  }

  const start = envelope.start === undefined ? null : nonEmptyString(envelope.start);
  const end = envelope.end === undefined ? null : nonEmptyString(envelope.end);
  if ((start && !TIME.test(start)) || (end && !TIME.test(end))) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_TIME_INVALID",
      message: `${rule.id} start/end must use canonical HH:MM 24-hour time.`,
    };
  }
  if ((start || end) && !day) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_DAY_REQUIRED_FOR_TIME",
      message: `${rule.id} start/end require a specific day.`,
    };
  }
  if (start && end && start >= end) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_WINDOW_INVALID",
      message: `${rule.id} typed teacher window start must be earlier than end.`,
    };
  }
  if (allowedDays.length === 0 && !day) {
    return {
      status: "INVALID",
      code: "TYPED_POLICY_WINDOW_REQUIRED",
      message: `${rule.id} typed teacher availability policy requires allowedDays or a specific day window.`,
    };
  }

  return {
    status: "VALID",
    policy: {
      schemaVersion: TEACHER_DAY_WINDOW_POLICY_SCHEMA_VERSION,
      kind: TEACHER_DAY_WINDOW_POLICY_KIND,
      teacherId,
      ...(allowedDays.length > 0 ? { allowedDays } : {}),
      ...(day ? { day } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    },
  };
}

export function teacherDayWindowPolicyParameters(policy: TeacherDayWindowPolicyV1): Record<string, unknown> {
  return {
    ...(policy.allowedDays ? { allowedDays: [...policy.allowedDays] } : {}),
    ...(policy.day ? { day: policy.day } : {}),
    ...(policy.start ? { start: policy.start } : {}),
    ...(policy.end ? { end: policy.end } : {}),
  };
}

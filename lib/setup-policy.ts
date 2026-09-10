import type { Day } from "@/lib/domain";
import {
  parseTypedPolicy,
  ROOM_REQUIRED_FEATURES_POLICY_KIND,
  ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND,
  STUDIO_OPERATING_WINDOWS_POLICY_KIND,
  type PolicyTimeWindowV1,
  type TypedPolicyV1,
} from "@/lib/typed-policy";

export const STUDIO_OPERATING_WINDOWS_RULE_ID = "OPS-001" as const;
export const ROOM_UNAVAILABLE_WINDOWS_RULE_ID = "ROOM-002" as const;
export const ROOM_REQUIRED_FEATURES_RULE_ID = "ROOM-009" as const;

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
}

export interface SetupTypedPolicyPatch {
  ruleId: string;
  policy: TypedPolicyV1;
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

  return patches;
}

export function setupPolicyDraftFromRules(rules: Array<{ parameters: Record<string, unknown> }>): SetupPolicyDraft {
  const policies = rules.flatMap((rule) => {
    const policy = rule.parameters.policy;
    return policy && typeof policy === "object" && !Array.isArray(policy) ? [policy as Record<string, unknown>] : [];
  });
  const operating = policies.find((policy) => policy.kind === STUDIO_OPERATING_WINDOWS_POLICY_KIND);
  const unavailable = policies.find((policy) => policy.kind === ROOM_UNAVAILABLE_WINDOWS_POLICY_KIND);
  const features = policies.find((policy) => policy.kind === ROOM_REQUIRED_FEATURES_POLICY_KIND);
  return {
    operatingWindows: operating && Array.isArray(operating.windows) ? operating.windows as PolicyTimeWindowV1[] : DEFAULT_STUDIO_OPERATING_WINDOWS.map((window) => ({ ...window })),
    closedDays: operating && Array.isArray(operating.closedDays) ? operating.closedDays as Day[] : [],
    roomUnavailable: unavailable && typeof unavailable.roomId === "string" && Array.isArray(unavailable.windows)
      ? { roomId: unavailable.roomId, windows: unavailable.windows as PolicyTimeWindowV1[] }
      : null,
    roomRequiredFeatures: features && Array.isArray(features.classIds) && Array.isArray(features.requiredFeatures)
      ? { classIds: features.classIds as string[], requiredFeatures: features.requiredFeatures as string[] }
      : null,
  };
}

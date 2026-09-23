import { describe, expect, it } from "vitest";
import {
  buildSetupTypedPolicyPatches,
  ROOM_REQUIRED_FEATURES_RULE_ID,
  ROOM_UNAVAILABLE_WINDOWS_RULE_ID,
  setupPolicyDraftFromRules,
  STUDIO_OPERATING_WINDOWS_RULE_ID,
} from "@/lib/setup-policy";

describe("SET-03 setup policy drafts", () => {
  it("canonicalizes manager windows and keeps the supported quarter-hour grid explicit", () => {
    const patches = buildSetupTypedPolicyPatches({
      operatingWindows: [
        { day: "Tuesday", start: "17:00", end: "21:30" },
        { day: "Monday", start: "16:45", end: "21:30" },
        { day: "Monday", start: "16:45", end: "21:30" },
      ],
      closedDays: ["Saturday"],
      roomUnavailable: null,
      roomRequiredFeatures: null,
    });

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ ruleId: STUDIO_OPERATING_WINDOWS_RULE_ID });
    expect(patches[0].policy).toMatchObject({
      windows: [
        { day: "Monday", start: "16:45", end: "21:30" },
        { day: "Tuesday", start: "17:00", end: "21:30" },
      ],
      closedDays: ["Saturday"],
    });
  });

  it("rejects a closed-day or non-grid room interval before a write is attempted", () => {
    expect(() => buildSetupTypedPolicyPatches({
      operatingWindows: [{ day: "Friday", start: "16:45", end: "21:30" }],
      closedDays: ["Friday"],
      roomUnavailable: null,
      roomRequiredFeatures: null,
    })).toThrow(/closed day/i);

    expect(() => buildSetupTypedPolicyPatches({
      operatingWindows: [{ day: "Monday", start: "16:50", end: "21:30" }],
      closedDays: [],
      roomUnavailable: null,
      roomRequiredFeatures: null,
    })).toThrow(/15-minute grid/i);
  });

  it("omits an explicit no-additional-restriction room policy and preserves typed entries", () => {
    const draft = setupPolicyDraftFromRules([
      { parameters: { policy: { schemaVersion: "1.0", kind: "STUDIO_OPERATING_WINDOWS", windows: [{ day: "Monday", start: "17:00", end: "18:00" }] } } },
      { parameters: { policy: { schemaVersion: "1.0", kind: "ROOM_REQUIRED_FEATURES", classIds: ["class-a"], requiredFeatures: ["mirrors"] } } },
    ]);
    const patches = buildSetupTypedPolicyPatches(draft);
    expect(patches.map((patch) => patch.ruleId)).toEqual([
      STUDIO_OPERATING_WINDOWS_RULE_ID,
      ROOM_REQUIRED_FEATURES_RULE_ID,
    ]);
    expect(patches.map((patch) => patch.ruleId)).not.toContain(ROOM_UNAVAILABLE_WINDOWS_RULE_ID);
  });
});

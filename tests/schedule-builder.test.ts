import { describe, expect, it } from "vitest";
import { defaultStartTime, placementEndTime, sessionDurationMinutes, timeFromMinutes } from "@/lib/schedule-builder";

describe("schedule builder time helpers", () => {
  it("uses the reviewed normal weekday start instead of the visual-grid buffer", () => {
    expect(defaultStartTime("Monday")).toBe("16:45");
    expect(defaultStartTime("Friday")).toBe("16:45");
  });

  it("keeps Saturday's opening default", () => {
    expect(defaultStartTime("Saturday")).toBe("09:00");
  });

  it("preserves fixed class duration", () => {
    expect(placementEndTime("16:45", { durationMinutes: 90 })).toBe("18:15");
    expect(timeFromMinutes(18 * 60 + 15)).toBe("18:15");
  });

  it("uses a per-session duration override when one is present", () => {
    expect(sessionDurationMinutes({ durationMinutes: 105 }, { durationMinutes: 90 })).toBe(105);
    expect(placementEndTime("18:00", sessionDurationMinutes({ durationMinutes: 105 }, { durationMinutes: 90 }))).toBe("19:45");
  });

  it("inherits the class duration when the session override is absent", () => {
    expect(sessionDurationMinutes({ durationMinutes: undefined }, { durationMinutes: 90 })).toBe(90);
  });
});

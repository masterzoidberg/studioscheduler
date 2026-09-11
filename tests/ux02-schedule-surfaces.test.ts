import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const desktop = readFileSync("components/schedule/schedule-view.tsx", "utf8");
const mobile = readFileSync("components/schedule/mobile-schedule-view.tsx", "utf8");
const builder = readFileSync("components/schedule/schedule-builder-panel.tsx", "utf8");

describe("UX-02 schedule surfaces", () => {
  it("uses one shared assessment for explicit inspector outcomes", () => {
    expect(desktop).toContain("assessScheduleEdit");
    expect(desktop).toContain("PREFERENCE_WARNING");
    expect(desktop).toContain("INCOMPLETE");
    expect(desktop).toContain("REJECTED");
    expect(desktop).toContain("sessionDurationForAssignment");
    expect(desktop).toContain("onKeyDown");
  });

  it("does not truncate configured rooms in desktop week view", () => {
    expect(desktop).not.toContain("state.rooms.slice(0, 3)");
    expect(desktop).toContain("state.rooms.map");
  });

  it("keeps mobile tap assignment and an unscheduled tray available", () => {
    expect(mobile).toContain("setDetails");
    expect(mobile).toContain("sessionDurationForAssignment");
    expect(builder).toContain("Unscheduled");
    expect(builder).toContain("Place class");
  });
});

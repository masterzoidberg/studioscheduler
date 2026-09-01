import { describe, expect, it } from "vitest";
import { fallbackTeacherColor, safeTeacherColor, subjectMarker, translucentHex } from "./schedule-visuals";

describe("subjectMarker", () => {
  it.each([
    ["Hip Hop", "", "🎧"],
    ["Ballet", "", "🩰"],
    ["Pointe", "", "🩰"],
    ["Tap", "", "👞"],
    ["Jazz", "", "✨"],
    ["Contemporary", "", "🌊"],
    ["Lyrical", "", "🎵"],
    ["Combo", "", "🎀"],
    ["", "Company Technique 3", "⭐"],
    ["Adult", "", "◉"],
  ])("maps %s / %s to %s", (subject, className, expected) => {
    expect(subjectMarker(subject, className)).toBe(expected);
  });

  it("has a stable fallback for unknown subjects", () => {
    expect(subjectMarker("Acro", "Acro 2")).toBe("◆");
  });
});

describe("teacher schedule colors", () => {
  it("accepts a valid persisted color and normalizes it", () => {
    expect(safeTeacherColor("#db2777", "teacher-cami")).toBe("#DB2777");
  });

  it("falls back deterministically when stored color is missing or invalid", () => {
    const first = fallbackTeacherColor("teacher-example");
    expect(safeTeacherColor(undefined, "teacher-example")).toBe(first);
    expect(safeTeacherColor("pink", "teacher-example")).toBe(first);
    expect(safeTeacherColor(undefined, "teacher-example")).toBe(safeTeacherColor(undefined, "teacher-example"));
  });

  it("creates a translucent card background from a valid teacher color", () => {
    expect(translucentHex("#2563EB")).toBe("#2563EB12");
    expect(translucentHex("#2563EB", "24")).toBe("#2563EB24");
  });
});

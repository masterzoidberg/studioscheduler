import { describe, expect, it } from "vitest";
import { mondayAssignments, rules } from "@/lib/mock-data";
import { durationMinutes } from "@/lib/utils";

describe("Milestone 1 seed data", () => {
  it("uses unique rule IDs", () => {
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses unique assignment IDs", () => {
    const ids = mondayAssignments.map((assignment) => assignment.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every assignment duration positive", () => {
    for (const assignment of mondayAssignments) {
      expect(durationMinutes(assignment.startTime, assignment.endTime)).toBeGreaterThan(0);
    }
  });

  it("only references rules that exist", () => {
    const ruleIds = new Set(rules.map((rule) => rule.id));
    for (const assignment of mondayAssignments) {
      for (const ruleId of assignment.rules) {
        expect(ruleIds.has(ruleId)).toBe(true);
      }
    }
  });
});

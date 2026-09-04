import { describe, expect, it } from "vitest";
import type { ClassDefinition, Student } from "@/lib/domain";
import { requiredClassIntakeCandidates } from "@/lib/required-class-intake";

function student(id: string, name: string, level: string): Student {
  return { id, name, level, cohortIds: [] };
}

function klass(name: string): ClassDefinition {
  return {
    id: `class-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    subject: "Test",
    level: "Test",
    durationMinutes: 60,
    weeklyFrequency: 1,
    rosterStudentIds: [],
    eligibleTeacherIds: [],
    companyOnly: false,
  };
}

describe("required class intake", () => {
  it("surfaces only missing required classes whose structure is not already handled by the Ballet/Pointe repair lane", () => {
    const daughter = student("daughter", "Karly's daughter", "Level 4B");
    const candidates = requiredClassIntakeCandidates({ classes: [], sessions: [], students: [daughter] });
    const names = candidates.map((candidate) => candidate.className);

    expect(names).toEqual(["Hip Hop 2", "Jazz 2", "Lyrical 2", "Pre-Company Technique 1", "Tap 2"]);
    expect(names).not.toContain("Ballet 2");
    expect(names).not.toContain("Ballet 4A/4B");
    expect(candidates.every((candidate) => candidate.ruleIds.includes("KAR-008"))).toBe(true);
  });

  it("drops a candidate when that class already exists", () => {
    const daughter = student("daughter", "Karly's daughter", "Level 2");
    const candidates = requiredClassIntakeCandidates({
      classes: [klass("Hip Hop 2")],
      sessions: [],
      students: [daughter],
    });
    expect(candidates.map((candidate) => candidate.className)).not.toContain("Hip Hop 2");
  });

  it("uses suggestions only as placeholders rather than authoritative saved values", () => {
    const daughter = student("daughter", "Karly's daughter", "Level 2");
    const candidates = requiredClassIntakeCandidates({ classes: [], sessions: [], students: [daughter] });
    const jazz = candidates.find((candidate) => candidate.className === "Jazz 2");
    const preCompany = candidates.find((candidate) => candidate.className === "Pre-Company Technique 1");

    expect(jazz?.subjectPlaceholder).toBe("Jazz");
    expect(jazz?.levelPlaceholder).toBe("Level 2");
    expect(preCompany?.subjectPlaceholder).toBe("Company Technique");
    expect(preCompany?.levelPlaceholder).toBe("Pre-Company 1");
  });

  it("does not surface Karly-derived intake when the daughter relationship is ambiguous", () => {
    const students = [
      student("a", "Karly's daughter", "Level 2"),
      student("b", "Karlys daughter", "Level 2"),
    ];
    expect(requiredClassIntakeCandidates({ classes: [], sessions: [], students })).toEqual([]);
  });
});

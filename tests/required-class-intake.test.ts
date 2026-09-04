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
  it("routes both missing structure classes and relationship-required classes through reviewed intake", () => {
    const daughter = student("daughter", "Karly's daughter", "Level 2");
    const candidates = requiredClassIntakeCandidates({ classes: [], sessions: [], students: [daughter] });
    const names = candidates.map((candidate) => candidate.className);

    expect(names).toContain("Ballet 2");
    expect(names).toContain("Ballet 4A/4B");
    expect(names).toContain("Pointe 2/3");
    expect(names).toContain("Hip Hop 2");
    expect(names).toContain("Jazz 2");
    expect(names).toContain("Lyrical 2");
    expect(names).toContain("Pre-Company Technique 1");
    expect(names).toContain("Tap 2");
  });

  it("carries Rulebook-established structure without turning naming hints into saved facts", () => {
    const daughter = student("daughter", "Karly's daughter", "Level 2");
    const candidates = requiredClassIntakeCandidates({ classes: [], sessions: [], students: [daughter] });
    const ballet2 = candidates.find((candidate) => candidate.className === "Ballet 2");
    const ballet4a = candidates.find((candidate) => candidate.className === "Ballet 4A");

    expect(ballet2).toMatchObject({
      expectedFrequency: 2,
      expectedDurations: [90, 90],
      subjectPlaceholder: "Ballet",
      levelPlaceholder: "Level 2",
    });
    expect(ballet4a).toMatchObject({
      expectedFrequency: 1,
      expectedDurations: null,
      subjectPlaceholder: "Ballet",
      levelPlaceholder: "Level 4A",
    });
  });

  it("merges explicit required-student relationships into a structure-required intake candidate", () => {
    const daughter = student("daughter", "Karly's daughter", "Level 2");
    const candidates = requiredClassIntakeCandidates({ classes: [], sessions: [], students: [daughter] });
    const ballet2 = candidates.find((candidate) => candidate.className === "Ballet 2");

    expect(ballet2?.requiredStudentIds).toEqual(["daughter"]);
    expect(ballet2?.requiredStudentNames).toEqual(["Karly's daughter"]);
    expect(ballet2?.ruleIds).toEqual(expect.arrayContaining(["BAL-004", "KAR-008", "STU-002"]));
    expect(ballet2?.relationshipLabels).toEqual(expect.arrayContaining([
      "Verified Rulebook class structure",
      "Karly's daughter required enrollment",
    ]));
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

  it("does not invent Karly-derived enrollment when the daughter relationship is ambiguous", () => {
    const students = [
      student("a", "Karly's daughter", "Level 2"),
      student("b", "Karlys daughter", "Level 2"),
    ];
    const candidates = requiredClassIntakeCandidates({ classes: [], sessions: [], students });

    expect(candidates.map((candidate) => candidate.className)).not.toContain("Jazz 2");
    const ballet2 = candidates.find((candidate) => candidate.className === "Ballet 2");
    expect(ballet2?.requiredStudentIds).toEqual([]);
    expect(ballet2?.ruleIds).toContain("BAL-004");
    expect(ballet2?.ruleIds).not.toContain("KAR-008");
  });
});

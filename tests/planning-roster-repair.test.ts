import { describe, expect, it } from "vitest";
import type { ClassDefinition, Student } from "@/lib/domain";
import { rulebookRosterRepairDraft, rulebookRosterRepairs } from "@/lib/planning-roster-repair";

function student(id: string, name: string, level: string): Student {
  return { id, name, level, cohortIds: [] };
}

function klass(name: string, rosterStudentIds: string[] = [], id = `class-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`): ClassDefinition {
  return {
    id,
    name,
    subject: name.includes("Ballet") ? "Ballet" : name.startsWith("Hip Hop") ? "Hip Hop" : "Other",
    level: "Test",
    durationMinutes: 60,
    weeklyFrequency: 1,
    rosterStudentIds,
    eligibleTeacherIds: ["teacher-existing"],
    companyOnly: false,
  };
}

describe("Rulebook roster repairs", () => {
  it("surfaces Karly's daughter required enrollments without inventing other roster members", () => {
    const daughter = student("daughter", "Karly's daughter", "Level 4B");
    const findings = rulebookRosterRepairs({
      students: [daughter],
      classes: [klass("Hip Hop 2", ["someone-else"])],
    });

    const hipHop = findings.find((finding) => finding.className === "Hip Hop 2");
    expect(hipHop?.status).toBe("ROSTER_MISSING");
    expect(hipHop?.requiredStudentIds).toEqual(["daughter"]);
    expect(hipHop?.ruleIds).toContain("KAR-008");

    const missingNames = findings
      .filter((finding) => finding.status === "CLASS_MISSING")
      .map((finding) => finding.className);
    expect(missingNames).toEqual(expect.arrayContaining([
      "Ballet 2",
      "Jazz 2",
      "Lyrical 2",
      "Tap 2",
      "Pre-Company Technique 1",
    ]));
  });

  it("aggregates Level 4A and 4B dancers into one combined Ballet roster repair", () => {
    const fourA = student("four-a", "Dancer A", "Level 4A");
    const fourB = student("four-b", "Dancer B", "Level 4B");
    const findings = rulebookRosterRepairs({
      students: [fourA, fourB],
      classes: [klass("Ballet 4A/4B", [])],
    });

    const combined = findings.find((finding) => finding.className === "Ballet 4A/4B");
    expect(combined?.status).toBe("ROSTER_MISSING");
    expect(combined?.requiredStudentIds).toEqual(["four-a", "four-b"]);
    expect(combined?.ruleIds).toEqual(expect.arrayContaining(["BAL-006", "BAL-007", "STU-002"]));
  });

  it("creates additive review drafts and preserves existing roster and eligibility", () => {
    const existing = klass("Hip Hop 2", ["existing"], "hiphop-2");
    const repair = rulebookRosterRepairs({
      students: [student("daughter", "Karly's daughter", "Level 2")],
      classes: [existing],
    }).find((finding) => finding.className === "Hip Hop 2");

    expect(repair?.status).toBe("ROSTER_MISSING");
    const draft = rulebookRosterRepairDraft(repair!, existing);
    expect(draft.rosterStudentIds).toEqual(["daughter", "existing"]);
    expect(draft.eligibleTeacherIds).toEqual(["teacher-existing"]);
    expect(existing.rosterStudentIds).toEqual(["existing"]);
  });

  it("does not emit a roster repair once an explicit requirement is already satisfied", () => {
    const daughter = student("daughter", "Karly's daughter", "Level 2");
    const requiredClasses = [
      "Ballet 2",
      "Jazz 2",
      "Lyrical 2",
      "Tap 2",
      "Hip Hop 2",
      "Pre-Company Technique 1",
    ].map((name) => klass(name, [daughter.id]));

    const karlyFindings = rulebookRosterRepairs({ students: [daughter], classes: requiredClasses })
      .filter((finding) => finding.ruleIds.includes("KAR-008"));
    expect(karlyFindings).toHaveLength(0);
  });

  it("fails closed when the daughter relationship or class target is ambiguous", () => {
    const daughterA = student("daughter-a", "Karly's daughter", "Level 2");
    const daughterB = student("daughter-b", "Karlys daughter", "Level 2");
    const studentFinding = rulebookRosterRepairs({ students: [daughterA, daughterB], classes: [] })[0];
    expect(studentFinding.status).toBe("STUDENT_AMBIGUOUS");

    const single = student("daughter", "Karly's daughter", "Level 2");
    const ambiguous = rulebookRosterRepairs({
      students: [single],
      classes: [klass("Hip Hop 2", [], "one"), klass("Hip-Hop 2", [], "two")],
    }).find((finding) => finding.className === "Hip Hop 2");
    expect(ambiguous?.status).toBe("CLASS_AMBIGUOUS");
    expect(ambiguous?.duplicateClassIds).toEqual(["one", "two"]);
  });
});

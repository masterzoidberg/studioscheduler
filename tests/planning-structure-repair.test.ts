import { describe, expect, it } from "vitest";
import type { ClassDefinition, ClassSession } from "@/lib/domain";
import { rulebookClassStructureRepairs, rulebookRepairDraft } from "@/lib/planning-structure-repair";

function klass(overrides: Partial<ClassDefinition> = {}): ClassDefinition {
  return {
    id: "class-ballet-3",
    name: "Ballet 3",
    subject: "Ballet",
    level: "Level 3",
    durationMinutes: 90,
    weeklyFrequency: 1,
    rosterStudentIds: ["student-a"],
    eligibleTeacherIds: [],
    companyOnly: false,
    ...overrides,
  };
}

function session(id: string, classId: string, ordinal: number, durationMinutes?: number): ClassSession {
  return { id, classId, ordinal, locked: false, durationMinutes };
}

describe("Rulebook planning structure repairs", () => {
  it("identifies missing required classes without inventing roster enrollment", () => {
    const repairs = rulebookClassStructureRepairs({ classes: [], sessions: [] });
    const ballet2 = repairs.find((repair) => repair.className === "Ballet 2");
    expect(ballet2).toMatchObject({ status: "MISSING", expectedFrequency: 2, expectedDurations: [90, 90] });

    const draft = rulebookRepairDraft(ballet2!);
    expect(draft).toMatchObject({
      name: "Ballet 2",
      subject: "Ballet",
      level: "Level 2",
      durationMinutes: 90,
      weeklyFrequency: 2,
      rosterStudentIds: [],
    });
  });

  it("prefills deterministic frequency and uniform duration fixes while preserving the existing roster", () => {
    const existing = klass();
    const repairs = rulebookClassStructureRepairs({
      classes: [existing],
      sessions: [session("session-ballet-3-1", existing.id, 1)],
    });
    const repair = repairs.find((item) => item.className === "Ballet 3");
    expect(repair).toMatchObject({
      status: "MISMATCH",
      frequencyMismatch: true,
      durationMismatch: true,
      currentFrequency: 1,
      expectedFrequency: 2,
      expectedDurations: [90, 90],
    });

    const draft = rulebookRepairDraft(repair!, existing);
    expect(draft.weeklyFrequency).toBe(2);
    expect(draft.durationMinutes).toBe(90);
    expect(draft.rosterStudentIds).toEqual(["student-a"]);
  });

  it("recognizes the required distinct Ballet 4B/5 weekly durations", () => {
    const existing = klass({
      id: "class-ballet-4b5",
      name: "Ballet 4B/5",
      level: "Levels 4B/5",
      durationMinutes: 105,
      weeklyFrequency: 2,
    });
    const repairs = rulebookClassStructureRepairs({
      classes: [existing],
      sessions: [
        session("session-ballet-4b5-1", existing.id, 1, 105),
        session("session-ballet-4b5-2", existing.id, 2, 105),
      ],
    });
    const repair = repairs.find((item) => item.className === "Ballet 4B/5");
    expect(repair).toMatchObject({
      status: "MISMATCH",
      frequencyMismatch: false,
      durationMismatch: true,
      currentDurations: [105, 105],
      expectedDurations: [90, 105],
    });

    const draft = rulebookRepairDraft(repair!, existing);
    expect(draft.durationMinutes).toBe(105);
    expect(draft.rosterStudentIds).toEqual(["student-a"]);
  });

  it("leaves unspecified Rulebook durations unresolved instead of guessing", () => {
    const repairs = rulebookClassStructureRepairs({ classes: [], sessions: [] });
    const repair = repairs.find((item) => item.className === "Ballet 4A");
    const draft = rulebookRepairDraft(repair!);
    expect(draft.durationMinutes).toBe(0);
    expect(draft.weeklyFrequency).toBe(1);
  });
});

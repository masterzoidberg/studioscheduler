import type { ClassDefinition, ClassSession } from "@/lib/domain";
import { PLANNING_CLASS_STRUCTURE_REQUIREMENTS } from "@/lib/planning-class-structure";
import { sessionDurationMinutes } from "@/lib/schedule-builder";

export type RulebookClassStructureRepairStatus = "MISSING" | "MISMATCH" | "AMBIGUOUS";

export interface RulebookClassStructureRepair {
  status: RulebookClassStructureRepairStatus;
  className: string;
  classId: string | null;
  ruleIds: string[];
  expectedFrequency: number;
  expectedDurations: number[] | null;
  currentFrequency: number | null;
  currentDurations: number[] | null;
  frequencyMismatch: boolean;
  durationMismatch: boolean;
  duplicateClassIds: string[];
}

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const sameNumbers = (a: number[], b: number[]) => {
  const left = sorted(a);
  const right = sorted(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

export function rulebookClassStructureRepairs(input: {
  classes: ClassDefinition[];
  sessions: ClassSession[];
}): RulebookClassStructureRepair[] {
  return PLANNING_CLASS_STRUCTURE_REQUIREMENTS.flatMap((requirement) => {
    const target = normalizeName(requirement.className);
    const matching = input.classes.filter((klass) => normalizeName(klass.name) === target);
    const expectedDurations = requirement.durations ? sorted(requirement.durations) : null;

    if (matching.length === 0) {
      return [{
        status: "MISSING" as const,
        className: requirement.className,
        classId: null,
        ruleIds: [...requirement.ruleIds],
        expectedFrequency: requirement.frequency,
        expectedDurations,
        currentFrequency: null,
        currentDurations: null,
        frequencyMismatch: true,
        durationMismatch: Boolean(expectedDurations),
        duplicateClassIds: [],
      }];
    }

    if (matching.length > 1) {
      return [{
        status: "AMBIGUOUS" as const,
        className: requirement.className,
        classId: null,
        ruleIds: [...requirement.ruleIds],
        expectedFrequency: requirement.frequency,
        expectedDurations,
        currentFrequency: null,
        currentDurations: null,
        frequencyMismatch: true,
        durationMismatch: Boolean(expectedDurations),
        duplicateClassIds: matching.map((klass) => klass.id),
      }];
    }

    const klass = matching[0];
    const sessions = input.sessions.filter((session) => session.classId === klass.id).sort((a, b) => a.ordinal - b.ordinal);
    const currentDurations = sorted(sessions.map((session) => sessionDurationMinutes(session, klass)));
    const frequencyMismatch = klass.weeklyFrequency !== requirement.frequency || sessions.length !== requirement.frequency;
    const durationMismatch = expectedDurations ? !sameNumbers(currentDurations, expectedDurations) : false;

    if (!frequencyMismatch && !durationMismatch) return [];

    return [{
      status: "MISMATCH" as const,
      className: requirement.className,
      classId: klass.id,
      ruleIds: [...requirement.ruleIds],
      expectedFrequency: requirement.frequency,
      expectedDurations,
      currentFrequency: klass.weeklyFrequency,
      currentDurations,
      frequencyMismatch,
      durationMismatch,
      duplicateClassIds: [],
    }];
  });
}

export function rulebookRepairDraft(
  repair: RulebookClassStructureRepair,
  existing?: ClassDefinition | null,
): ClassDefinition {
  const firstExpectedDuration = repair.expectedDurations?.[0] ?? null;
  const uniformDuration = firstExpectedDuration != null
    && repair.expectedDurations?.every((value) => value === firstExpectedDuration)
    ? firstExpectedDuration
    : null;

  if (existing) {
    return {
      ...existing,
      rosterStudentIds: [...existing.rosterStudentIds],
      eligibleTeacherIds: [...existing.eligibleTeacherIds],
      weeklyFrequency: repair.expectedFrequency,
      durationMinutes: uniformDuration ?? existing.durationMinutes,
    };
  }

  const balletMatch = repair.className.match(/^Ballet (.+)$/);
  const elementaryMatch = repair.className.match(/^Elementary Ballet (.+)$/);
  const subject = elementaryMatch || balletMatch
    ? "Ballet"
    : repair.className === "Pre-Pointe"
      ? "Pre-Pointe"
      : repair.className.startsWith("Pointe ")
        ? "Pointe"
        : "";
  const level = elementaryMatch
    ? `Elementary ${elementaryMatch[1]}`
    : balletMatch
      ? `${balletMatch[1].includes("/") ? "Levels" : "Level"} ${balletMatch[1]}`
      : repair.className === "Pre-Pointe"
        ? "Level 3"
        : "";

  return {
    id: "",
    name: repair.className,
    subject,
    level,
    durationMinutes: uniformDuration ?? 0,
    weeklyFrequency: repair.expectedFrequency,
    rosterStudentIds: [],
    eligibleTeacherIds: [],
    companyOnly: false,
  };
}

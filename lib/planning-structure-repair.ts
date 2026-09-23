import type { ClassDefinition, ClassSession } from "@/lib/domain";
import { PLANNING_CLASS_STRUCTURE_REQUIREMENTS } from "@/lib/planning-class-structure";
import { sessionDurationMinutes } from "@/lib/schedule-builder";
import type { TenantClassStructureRequirement } from "@/lib/tenant-policy";

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
  /** Current tenant Rulebook requirements. Omit only for historical fixtures. */
  requirements?: TenantClassStructureRequirement[] | null;
}): RulebookClassStructureRepair[] {
  const repairs: RulebookClassStructureRepair[] = [];
  const requirements = input.requirements !== undefined && input.requirements !== null
    ? input.requirements.map((requirement) => ({
      ...requirement,
      className: input.classes.find((klass) => klass.id === requirement.classId)?.name ?? requirement.classId,
    }))
    : PLANNING_CLASS_STRUCTURE_REQUIREMENTS.map((requirement) => ({
      classId: "",
      ruleIds: requirement.ruleIds,
      expectedFrequency: requirement.frequency,
      expectedDurations: requirement.durations ?? null,
      className: requirement.className,
    }));

  for (const requirement of requirements) {
    const target = normalizeName(requirement.className);
    const matching = requirement.classId
      ? input.classes.filter((klass) => klass.id === requirement.classId)
      : input.classes.filter((klass) => normalizeName(klass.name) === target);
    const className = matching[0]?.name ?? requirement.className;
    const expectedDurations = requirement.expectedDurations ? sorted(requirement.expectedDurations) : null;

    if (matching.length === 0) {
      repairs.push({
        status: "MISSING",
        className,
        classId: null,
        ruleIds: [...requirement.ruleIds],
        expectedFrequency: requirement.expectedFrequency,
        expectedDurations,
        currentFrequency: null,
        currentDurations: null,
        frequencyMismatch: true,
        durationMismatch: Boolean(expectedDurations),
        duplicateClassIds: [],
      });
      continue;
    }

    if (matching.length > 1) {
      repairs.push({
        status: "AMBIGUOUS",
        className,
        classId: null,
        ruleIds: [...requirement.ruleIds],
        expectedFrequency: requirement.expectedFrequency,
        expectedDurations,
        currentFrequency: null,
        currentDurations: null,
        frequencyMismatch: true,
        durationMismatch: Boolean(expectedDurations),
        duplicateClassIds: matching.map((klass) => klass.id),
      });
      continue;
    }

    const klass = matching[0];
    const sessions = input.sessions.filter((session) => session.classId === klass.id).sort((a, b) => a.ordinal - b.ordinal);
    const currentDurations = sorted(sessions.map((session) => sessionDurationMinutes(session, klass)));
    const frequencyMismatch = klass.weeklyFrequency !== requirement.expectedFrequency || sessions.length !== requirement.expectedFrequency;
    const durationMismatch = expectedDurations ? !sameNumbers(currentDurations, expectedDurations) : false;

    if (!frequencyMismatch && !durationMismatch) continue;

    repairs.push({
      status: "MISMATCH",
      className,
      classId: klass.id,
      ruleIds: [...requirement.ruleIds],
      expectedFrequency: requirement.expectedFrequency,
      expectedDurations,
      currentFrequency: klass.weeklyFrequency,
      currentDurations,
      frequencyMismatch,
      durationMismatch,
      duplicateClassIds: [],
    });
  }

  return repairs;
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

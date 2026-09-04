import type { ClassDefinition, Student } from "@/lib/domain";

export type RulebookRosterRepairStatus =
  | "ROSTER_MISSING"
  | "CLASS_MISSING"
  | "CLASS_AMBIGUOUS"
  | "STUDENT_MISSING"
  | "STUDENT_AMBIGUOUS";

export interface RulebookRosterRepair {
  status: RulebookRosterRepairStatus;
  className: string | null;
  classId: string | null;
  ruleIds: string[];
  requiredStudentIds: string[];
  requiredStudentNames: string[];
  duplicateClassIds: string[];
  relationshipLabels: string[];
  detail: string;
}

type Requirement = {
  className: string;
  studentIds: string[];
  ruleIds: string[];
  relationshipLabel: string;
};

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const sorted = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b));

const ADVANCED_BALLET_REQUIREMENTS = [
  { level: "Level 4A", classNames: ["Ballet 4A", "Ballet 4A/4B"], ruleId: "BAL-006" },
  { level: "Level 4B", classNames: ["Ballet 4A/4B", "Ballet 4B/5"], ruleId: "BAL-007" },
  { level: "Level 5", classNames: ["Ballet 4B/5", "Ballet 5"], ruleId: "BAL-008" },
] as const;

const KARLY_DAUGHTER_CLASS_NAMES = [
  "Ballet 2",
  "Jazz 2",
  "Lyrical 2",
  "Tap 2",
  "Hip Hop 2",
  "Pre-Company Technique 1",
] as const;

function aggregateRequirements(requirements: Requirement[]) {
  const grouped = new Map<string, {
    className: string;
    studentIds: Set<string>;
    ruleIds: Set<string>;
    relationshipLabels: Set<string>;
  }>();

  for (const requirement of requirements) {
    const key = normalizeName(requirement.className);
    const current = grouped.get(key) ?? {
      className: requirement.className,
      studentIds: new Set<string>(),
      ruleIds: new Set<string>(),
      relationshipLabels: new Set<string>(),
    };
    requirement.studentIds.forEach((id) => current.studentIds.add(id));
    requirement.ruleIds.forEach((id) => current.ruleIds.add(id));
    current.relationshipLabels.add(requirement.relationshipLabel);
    grouped.set(key, current);
  }

  return [...grouped.values()];
}

export function rulebookRosterRepairs(input: {
  classes: ClassDefinition[];
  students: Student[];
}): RulebookRosterRepair[] {
  const requirements: Requirement[] = [];
  const standaloneFindings: RulebookRosterRepair[] = [];
  const studentById = new Map(input.students.map((student) => [student.id, student]));

  for (const requirement of ADVANCED_BALLET_REQUIREMENTS) {
    const dancers = input.students.filter((student) => student.level === requirement.level);
    if (!dancers.length) continue;
    for (const className of requirement.classNames) {
      requirements.push({
        className,
        studentIds: dancers.map((student) => student.id),
        ruleIds: [requirement.ruleId, "STU-002"],
        relationshipLabel: `${requirement.level} Ballet participation`,
      });
    }
  }

  const daughterMatches = input.students.filter(
    (student) => normalizeName(student.name) === normalizeName("Karly's daughter"),
  );
  if (daughterMatches.length !== 1) {
    standaloneFindings.push({
      status: daughterMatches.length === 0 ? "STUDENT_MISSING" : "STUDENT_AMBIGUOUS",
      className: null,
      classId: null,
      ruleIds: ["KAR-008", "KAR-009"],
      requiredStudentIds: daughterMatches.map((student) => student.id),
      requiredStudentNames: daughterMatches.map((student) => student.name),
      duplicateClassIds: [],
      relationshipLabels: ["Karly / daughter scheduling relationship"],
      detail: daughterMatches.length === 0
        ? "KAR-008 identifies Karly's daughter as a scheduling fact, but that student record is missing."
        : `KAR-008 identifies one daughter relationship, but ${daughterMatches.length} matching student records exist.`,
    });
  } else {
    const daughter = daughterMatches[0];
    for (const className of KARLY_DAUGHTER_CLASS_NAMES) {
      requirements.push({
        className,
        studentIds: [daughter.id],
        ruleIds: ["KAR-008", "STU-002"],
        relationshipLabel: "Karly's daughter required enrollment",
      });
    }
  }

  const findings = aggregateRequirements(requirements).flatMap<RulebookRosterRepair>((requirement) => {
    const matching = input.classes.filter(
      (klass) => normalizeName(klass.name) === normalizeName(requirement.className),
    );
    const requiredStudentIds = sorted(requirement.studentIds);
    const requiredStudentNames = requiredStudentIds.map(
      (id) => studentById.get(id)?.name ?? `Unknown student ${id}`,
    );
    const ruleIds = sorted(requirement.ruleIds);
    const relationshipLabels = sorted(requirement.relationshipLabels);

    if (matching.length === 0) {
      return [{
        status: "CLASS_MISSING",
        className: requirement.className,
        classId: null,
        ruleIds,
        requiredStudentIds,
        requiredStudentNames,
        duplicateClassIds: [],
        relationshipLabels,
        detail: `${requirement.className} is absent, so ${requiredStudentNames.join(", ")} cannot yet be placed on its required roster.`,
      }];
    }

    if (matching.length > 1) {
      return [{
        status: "CLASS_AMBIGUOUS",
        className: requirement.className,
        classId: null,
        ruleIds,
        requiredStudentIds,
        requiredStudentNames,
        duplicateClassIds: matching.map((klass) => klass.id),
        relationshipLabels,
        detail: `${requirement.className} resolves to ${matching.length} class records, so the required roster target is ambiguous.`,
      }];
    }

    const klass = matching[0];
    const missingIds = requiredStudentIds.filter((id) => !klass.rosterStudentIds.includes(id));
    if (!missingIds.length) return [];
    const missingNames = missingIds.map((id) => studentById.get(id)?.name ?? `Unknown student ${id}`);

    return [{
      status: "ROSTER_MISSING",
      className: requirement.className,
      classId: klass.id,
      ruleIds,
      requiredStudentIds: missingIds,
      requiredStudentNames: missingNames,
      duplicateClassIds: [],
      relationshipLabels,
      detail: `${missingNames.join(", ")} ${missingNames.length === 1 ? "is" : "are"} required on ${klass.name}'s roster by reviewed Rulebook facts.`,
    }];
  });

  return [...standaloneFindings, ...findings].sort((a, b) => {
    const aName = a.className ?? a.relationshipLabels[0] ?? "";
    const bName = b.className ?? b.relationshipLabels[0] ?? "";
    return aName.localeCompare(bName) || a.status.localeCompare(b.status);
  });
}

export function rulebookRosterRepairDraft(
  repair: RulebookRosterRepair,
  existing: ClassDefinition,
): ClassDefinition {
  if (repair.status !== "ROSTER_MISSING" || repair.classId !== existing.id) {
    throw new Error("Rulebook roster repair drafts require one resolved class with missing required students.");
  }

  return {
    ...existing,
    rosterStudentIds: sorted(new Set([...existing.rosterStudentIds, ...repair.requiredStudentIds])),
    eligibleTeacherIds: [...existing.eligibleTeacherIds],
  };
}

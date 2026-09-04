import type { ClassDefinition, ClassSession, Student } from "@/lib/domain";
import { rulebookRosterRepairs, type RulebookRosterRepair } from "@/lib/planning-roster-repair";
import { rulebookClassStructureRepairs } from "@/lib/planning-structure-repair";

export interface RequiredClassIntakeCandidate {
  className: string;
  ruleIds: string[];
  requiredStudentIds: string[];
  requiredStudentNames: string[];
  relationshipLabels: string[];
  subjectPlaceholder: string;
  levelPlaceholder: string;
  expectedFrequency: number | null;
  expectedDurations: number[] | null;
}

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

function placeholders(className: string) {
  const simpleLevel = className.match(/^(Jazz|Lyrical|Tap|Hip Hop)\s+(\d+)$/i);
  if (simpleLevel) {
    return {
      subjectPlaceholder: simpleLevel[1].replace(/\b\w/g, (char) => char.toUpperCase()),
      levelPlaceholder: `Level ${simpleLevel[2]}`,
    };
  }

  const elementaryBallet = className.match(/^Elementary Ballet\s+(.+)$/i);
  if (elementaryBallet) {
    return {
      subjectPlaceholder: "Ballet",
      levelPlaceholder: `Elementary ${elementaryBallet[1]}`,
    };
  }

  const ballet = className.match(/^Ballet\s+(.+)$/i);
  if (ballet) {
    return {
      subjectPlaceholder: "Ballet",
      levelPlaceholder: `${ballet[1].includes("/") ? "Levels" : "Level"} ${ballet[1]}`,
    };
  }

  const pointe = className.match(/^Pointe\s+(.+)$/i);
  if (pointe) {
    return {
      subjectPlaceholder: "Pointe",
      levelPlaceholder: `${pointe[1].includes("/") ? "Levels" : "Level"} ${pointe[1]}`,
    };
  }

  if (/^Pre-Pointe$/i.test(className)) {
    return { subjectPlaceholder: "Pre-Pointe", levelPlaceholder: "Enter verified level" };
  }

  if (/^Pre-Company Technique\s+1$/i.test(className)) {
    return {
      subjectPlaceholder: "Company Technique",
      levelPlaceholder: "Pre-Company 1",
    };
  }
  return { subjectPlaceholder: "Enter verified subject", levelPlaceholder: "Enter verified level" };
}

function missingRosterByClass(repairs: RulebookRosterRepair[]) {
  return new Map(
    repairs
      .filter((repair): repair is RulebookRosterRepair & { status: "CLASS_MISSING"; className: string } => (
        repair.status === "CLASS_MISSING" && Boolean(repair.className)
      ))
      .map((repair) => [normalizeName(repair.className), repair]),
  );
}

export function requiredClassIntakeCandidates(input: {
  classes: ClassDefinition[];
  sessions: ClassSession[];
  students: Student[];
}): RequiredClassIntakeCandidate[] {
  const rosterRepairs = rulebookRosterRepairs({ classes: input.classes, students: input.students });
  const rosterMissing = missingRosterByClass(rosterRepairs);
  const candidates = new Map<string, RequiredClassIntakeCandidate>();

  // Creating a missing class establishes new planning truth. Even when the
  // Rulebook establishes frequency/duration, roster membership, curriculum
  // scope and descriptive fields still require explicit manager review.
  for (const repair of rulebookClassStructureRepairs({ classes: input.classes, sessions: input.sessions })) {
    if (repair.status !== "MISSING") continue;
    const key = normalizeName(repair.className);
    const roster = rosterMissing.get(key);
    candidates.set(key, {
      className: repair.className,
      ruleIds: sorted([...repair.ruleIds, ...(roster?.ruleIds ?? [])]),
      requiredStudentIds: sorted(roster?.requiredStudentIds ?? []),
      requiredStudentNames: sorted(roster?.requiredStudentNames ?? []),
      relationshipLabels: sorted([
        "Verified Rulebook class structure",
        ...(roster?.relationshipLabels ?? []),
      ]),
      ...placeholders(repair.className),
      expectedFrequency: repair.expectedFrequency,
      expectedDurations: repair.expectedDurations ? [...repair.expectedDurations] : null,
    });
  }

  // Relationship-required classes that are not part of the structural Ballet /
  // Pointe requirements still need the same evidence-backed creation workflow.
  for (const repair of rosterRepairs) {
    if (repair.status !== "CLASS_MISSING" || !repair.className) continue;
    const key = normalizeName(repair.className);
    if (candidates.has(key)) continue;
    candidates.set(key, {
      className: repair.className,
      ruleIds: [...repair.ruleIds],
      requiredStudentIds: [...repair.requiredStudentIds],
      requiredStudentNames: [...repair.requiredStudentNames],
      relationshipLabels: [...repair.relationshipLabels],
      ...placeholders(repair.className),
      expectedFrequency: null,
      expectedDurations: null,
    });
  }

  return [...candidates.values()].sort((a, b) => a.className.localeCompare(b.className));
}

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
}

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function placeholders(className: string) {
  const simpleLevel = className.match(/^(Jazz|Lyrical|Tap|Hip Hop)\s+(\d+)$/i);
  if (simpleLevel) {
    return {
      subjectPlaceholder: simpleLevel[1].replace(/\b\w/g, (char) => char.toUpperCase()),
      levelPlaceholder: `Level ${simpleLevel[2]}`,
    };
  }
  if (/^Pre-Company Technique\s+1$/i.test(className)) {
    return {
      subjectPlaceholder: "Company Technique",
      levelPlaceholder: "Pre-Company 1",
    };
  }
  return { subjectPlaceholder: "Enter verified subject", levelPlaceholder: "Enter verified level" };
}

export function requiredClassIntakeCandidates(input: {
  classes: ClassDefinition[];
  sessions: ClassSession[];
  students: Student[];
}): RequiredClassIntakeCandidate[] {
  const structureHandled = new Set(
    rulebookClassStructureRepairs({ classes: input.classes, sessions: input.sessions })
      .filter((repair) => repair.status === "MISSING")
      .map((repair) => normalizeName(repair.className)),
  );

  return rulebookRosterRepairs({ classes: input.classes, students: input.students })
    .filter((repair): repair is RulebookRosterRepair & { status: "CLASS_MISSING"; className: string } => (
      repair.status === "CLASS_MISSING"
      && Boolean(repair.className)
      && !structureHandled.has(normalizeName(repair.className!))
    ))
    .map((repair) => ({
      className: repair.className,
      ruleIds: [...repair.ruleIds],
      requiredStudentIds: [...repair.requiredStudentIds],
      requiredStudentNames: [...repair.requiredStudentNames],
      relationshipLabels: [...repair.relationshipLabels],
      ...placeholders(repair.className),
    }))
    .sort((a, b) => a.className.localeCompare(b.className));
}

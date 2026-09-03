import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { ClassDefinition, StudioState, Student } from "@/lib/domain";

export interface DelegatedPreflightIssue {
  constraintId: string;
  ruleIds: string[];
  code: "LOWER_LEVEL_CLASS_MISSING" | "LOWER_LEVEL_ROSTER_MISSING" | "UNSUPPORTED_DELEGATED_CONSTRAINT";
  message: string;
  entityIds: string[];
}

export interface DelegatedSolverPreflightReport {
  complete: boolean;
  delegatedConstraintIds: string[];
  validatedDelegatedConstraintIds: string[];
  issues: DelegatedPreflightIssue[];
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const canonicalSort = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function levelKey(value: string): "4A" | "4B" | "5" | null {
  const normalized = normalize(value);
  if (normalized.includes("4a")) return "4A";
  if (normalized.includes("4b")) return "4B";
  if (/(^|[^0-9])5([^0-9]|$)/.test(value) || normalized.includes("level5")) return "5";
  return null;
}

function classHasLevel(klass: ClassDefinition, key: "4A" | "4B" | "5") {
  const haystack = `${klass.level} ${klass.name}`.toLowerCase();
  if (key === "4A") return /4\s*a/i.test(haystack);
  if (key === "4B") return /4\s*b/i.test(haystack);
  return /(^|[^0-9])5([^0-9]|$)/.test(haystack) || normalize(haystack).includes("level5");
}

function subjectFamily(value: string): "Ballet" | "Jazz" | "Tap" | "Contemporary" | null {
  const normalized = normalize(value);
  if (normalized.includes("ballet")) return "Ballet";
  if (normalized.includes("jazz")) return "Jazz";
  if (normalized.includes("tap")) return "Tap";
  if (normalized.includes("contemporary") || normalized.includes("modern")) return "Contemporary";
  return null;
}

function classFamily(klass: ClassDefinition) {
  return subjectFamily(`${klass.subject} ${klass.name}`);
}

function studentException(constraint: ConstraintIRNode, student: Student) {
  const exceptions = Array.isArray(constraint.parameters.exceptions)
    ? constraint.parameters.exceptions as Array<Record<string, unknown>>
    : [];
  return exceptions.find((item) => normalize(String(item.studentName || "")) === normalize(student.name)) ?? null;
}

function subjectSet(value: unknown) {
  return new Set((Array.isArray(value) ? value : []).map((item) => subjectFamily(String(item))).filter(Boolean));
}

function relevantHardSubjects(constraint: ConstraintIRNode, student: Student) {
  const selected = new Set(
    (constraint.selector.subjects || [])
      .map((item) => subjectFamily(item))
      .filter((item): item is "Ballet" | "Jazz" | "Tap" | "Contemporary" => Boolean(item)),
  );
  const exception = studentException(constraint, student);
  if (!exception) return selected;

  const hard = subjectSet(exception.hardSubjects);
  const excluded = subjectSet(exception.excludedHardSubjects);
  if (hard.size > 0) return new Set([...selected].filter((item) => hard.has(item)));
  return new Set([...selected].filter((item) => !excluded.has(item)));
}

function immediatelyLowerLevel(student: Student): "4A" | "4B" | null {
  const key = levelKey(student.level);
  if (key === "4B") return "4A";
  if (key === "5") return "4B";
  return null;
}

function validateLowerLevelConstraint(state: StudioState, constraint: ConstraintIRNode): DelegatedPreflightIssue[] {
  const issues: DelegatedPreflightIssue[] = [];
  const relevantStudents = state.students.filter((student) => {
    const key = levelKey(student.level);
    return key === "4B" || key === "5";
  });

  for (const student of relevantStudents) {
    const advancedLevel = levelKey(student.level);
    const lowerLevel = immediatelyLowerLevel(student);
    if (!advancedLevel || !lowerLevel) continue;

    for (const subject of relevantHardSubjects(constraint, student)) {
      const advancedClasses = state.classes.filter((klass) =>
        classFamily(klass) === subject
        && classHasLevel(klass, advancedLevel)
        && klass.rosterStudentIds.includes(student.id),
      );

      // ADV-001 applies only where the dancer is marked as requiring the advanced
      // subject. In the fluid Planning Dataset, current enrollment is that mark.
      if (advancedClasses.length === 0) continue;

      const lowerClasses = state.classes.filter((klass) =>
        classFamily(klass) === subject
        && classHasLevel(klass, lowerLevel)
        && !advancedClasses.some((advanced) => advanced.id === klass.id),
      );

      if (lowerClasses.length === 0) {
        issues.push({
          constraintId: constraint.id,
          ruleIds: constraint.ruleIds,
          code: "LOWER_LEVEL_CLASS_MISSING",
          message: `${student.name} is enrolled in ${subject} at ${student.level}, but no immediately lower ${subject} class for Level ${lowerLevel} exists in the current Planning Dataset.`,
          entityIds: [student.id, ...advancedClasses.map((klass) => klass.id)],
        });
        continue;
      }

      if (!lowerClasses.some((klass) => klass.rosterStudentIds.includes(student.id))) {
        issues.push({
          constraintId: constraint.id,
          ruleIds: constraint.ruleIds,
          code: "LOWER_LEVEL_ROSTER_MISSING",
          message: `${student.name} is enrolled in advanced ${subject} but is not enrolled in an immediately lower Level ${lowerLevel} ${subject} class as required.`,
          entityIds: [student.id, ...advancedClasses.map((klass) => klass.id), ...lowerClasses.map((klass) => klass.id)],
        });
      }
    }
  }

  return issues;
}

export function validateDelegatedSolverPreconditions(
  state: StudioState,
  model: ConstraintModelSnapshotV1,
): DelegatedSolverPreflightReport {
  const delegated = model.hardConstraints.filter((constraint) => constraint.kind === "REQUIRED_LOWER_LEVEL");
  const issues: DelegatedPreflightIssue[] = [];
  const validated: string[] = [];

  for (const constraint of delegated) {
    if (constraint.kind !== "REQUIRED_LOWER_LEVEL") {
      issues.push({
        constraintId: constraint.id,
        ruleIds: constraint.ruleIds,
        code: "UNSUPPORTED_DELEGATED_CONSTRAINT",
        message: `No deterministic preflight validator exists for delegated constraint ${constraint.id}.`,
        entityIds: [],
      });
      continue;
    }
    const constraintIssues = validateLowerLevelConstraint(state, constraint);
    issues.push(...constraintIssues);
    if (constraintIssues.length === 0) validated.push(constraint.id);
  }

  return {
    complete: issues.length === 0 && validated.length === delegated.length,
    delegatedConstraintIds: delegated.map((item) => item.id).sort(canonicalSort),
    validatedDelegatedConstraintIds: validated.sort(canonicalSort),
    issues,
  };
}

import type { Assignment, ClassDefinition, StudioState } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import {
  validateConstraintModelSchedule as validateBase,
  type ConstraintEngineResult,
  type ConstraintEngineViolation,
} from "@/lib/constraint-engine";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function levelTokens(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/levels?/g, "")
    .replace(/elementary/g, "elem")
    .replace(/[^a-z0-9/]+/g, "")
    .trim();
  return normalized ? normalized.split("/").filter(Boolean) : [];
}

function levelMatches(value: string, selectors: string[]) {
  if (!selectors.length) return false;
  const actual = new Set(levelTokens(value));
  return selectors.some((selector) => levelTokens(selector).some((token) => actual.has(token)));
}

function textMatches(value: string, selectors: string[]) {
  if (!selectors.length) return false;
  const actual = normalize(value);
  return selectors.some((selector) => normalize(selector) === actual);
}

function subjectMatches(klass: ClassDefinition, selectors: string[]) {
  if (!selectors.length) return false;
  const subject = normalize(klass.subject);
  const name = normalize(klass.name);
  const elementary = levelTokens(klass.level).some((token) => token.startsWith("elem"));
  return selectors.some((selector) => {
    const target = normalize(selector);
    if (target === subject || target === name) return true;
    return elementary && target === normalize(`Elementary ${klass.subject}`);
  });
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function pushUnique(violations: ConstraintEngineViolation[], violation: ConstraintEngineViolation) {
  const key = `${violation.constraintId}|${[...violation.assignmentIds].sort().join(",")}|${violation.message}`;
  const exists = violations.some((item) =>
    `${item.constraintId}|${[...item.assignmentIds].sort().join(",")}|${item.message}` === key,
  );
  if (!exists) violations.push(violation);
}

/**
 * Correctness layer over the initial IR evaluator.
 *
 * The first evaluator deliberately used selector helpers where an empty selector
 * means “match all”. For optional teacher exception lists and room-capacity
 * exemptions, however, an empty list must mean “no exception”. This layer makes
 * those two semantics explicit while the runtime is still running as an
 * independent diagnostic oracle. It can be folded into the base engine once the
 * golden-fixture suite is complete.
 */
export function validateConstraintModelSchedule(
  state: StudioState,
  model: ConstraintModelSnapshotV1,
  assignments: Assignment[],
): ConstraintEngineResult {
  const base = validateBase(state, model, assignments);
  const violations = [...base.violations];
  const classesById = new Map(state.classes.map((klass) => [klass.id, klass]));
  const classesBySession = new Map(
    state.sessions
      .map((session) => [session.id, classesById.get(session.classId)] as const)
      .filter((entry): entry is readonly [string, ClassDefinition] => Boolean(entry[1])),
  );
  const teachersById = new Map(state.teachers.map((teacher) => [teacher.id, teacher]));
  const roomsById = new Map(state.rooms.map((room) => [room.id, room]));

  for (const node of model.hardConstraints) {
    if (node.kind === "TEACHER_SUBJECT_DOMAIN") {
      const teacherNames = node.selector.teacherNames || [];
      const allowedSubjects = strings(node.parameters.allowedSubjects);
      const prohibitedSubjects = strings(node.parameters.prohibitedSubjects);
      const allowedLevels = strings(node.parameters.allowedLevels);
      const prohibitedLevels = strings(node.parameters.prohibitedLevels);
      const exceptionClasses = strings(node.parameters.exceptionClasses);

      for (const assignment of assignments) {
        const teacher = teachersById.get(assignment.teacherId);
        const klass = classesBySession.get(assignment.sessionId);
        if (!teacher || !klass || !textMatches(teacher.name, teacherNames)) continue;

        const explicitException = exceptionClasses.length > 0 && textMatches(klass.name, exceptionClasses);
        const prohibitedSubject = prohibitedSubjects.length > 0 && subjectMatches(klass, prohibitedSubjects);
        const prohibitedLevel = prohibitedLevels.length > 0 && levelMatches(klass.level, prohibitedLevels);
        const subjectAllowed = explicitException || allowedSubjects.length === 0 || subjectMatches(klass, allowedSubjects);
        const levelAllowed = explicitException || allowedLevels.length === 0 || levelMatches(klass.level, allowedLevels);

        if (prohibitedSubject || prohibitedLevel || !subjectAllowed || !levelAllowed) {
          pushUnique(violations, {
            constraintId: node.id,
            ruleIds: node.ruleIds,
            message: `${teacher.name} is not qualified by the current Rulebook domain for ${klass.name}.`,
            assignmentIds: [assignment.id],
            affectedEntityIds: [teacher.id, klass.id],
          });
        }
      }
    }

    if (node.kind === "ROOM_CAPACITY") {
      const roomNames = node.selector.roomNames || [];
      const exemptLevels = strings(node.parameters.exemptLevels);
      const maximum = Number(node.parameters.maxDancers || 0);
      if (!maximum) continue;

      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        const room = roomsById.get(assignment.roomId);
        if (!klass || !room || !textMatches(room.name, roomNames)) continue;
        const exempt = exemptLevels.length > 0 && levelMatches(klass.level, exemptLevels);
        if (exempt || klass.rosterStudentIds.length <= maximum) continue;

        pushUnique(violations, {
          constraintId: node.id,
          ruleIds: node.ruleIds,
          message: `${klass.name} has ${klass.rosterStudentIds.length} dancers, exceeding ${room.name}'s Rulebook capacity of ${maximum}.`,
          assignmentIds: [assignment.id],
          affectedEntityIds: [klass.id, room.id, ...klass.rosterStudentIds],
        });
      }
    }
  }

  return {
    ...base,
    valid: violations.length === 0 && base.unsupportedConstraintIds.length === 0,
    hardViolations: violations.length,
    violations,
  };
}

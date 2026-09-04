import type { Assignment, ClassDefinition, Day, StudioState } from "@/lib/domain";
import type {
  ConstraintIRRuleV1,
  ConstraintModelSnapshotV1,
  EntitySelectorV1,
} from "@/lib/constraint-ir";
import {
  assignmentInterval,
  intervalsOverlap,
  parseTime,
} from "@/lib/schedule-builder";

export type ConstraintEngineViolation = {
  constraintId: string;
  ruleIds: string[];
  message: string;
  assignmentIds: string[];
  affectedEntityIds: string[];
};

export type ConstraintEngineResult = {
  valid: boolean;
  hardViolations: number;
  violations: ConstraintEngineViolation[];
  evaluatedConstraintIds: string[];
  delegatedConstraintIds: string[];
  unsupportedConstraintIds: string[];
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function selectorMatchesClass(
  selector: EntitySelectorV1 | undefined,
  classId: string,
  className: string,
) {
  if (!selector) return false;
  if (selector.entityType !== "CLASS") return false;
  if (selector.entityId) return selector.entityId === classId;
  if (selector.name) return normalize(selector.name) === normalize(className);
  return false;
}

function classIdsForSelector(state: StudioState, selector: EntitySelectorV1 | undefined) {
  if (!selector || selector.entityType !== "CLASS") return [];
  return state.classes
    .filter((klass) => selectorMatchesClass(selector, klass.id, klass.name))
    .map((klass) => klass.id);
}

function teacherIdsForSelector(state: StudioState, selector: EntitySelectorV1 | undefined) {
  if (!selector || selector.entityType !== "TEACHER") return [];
  if (selector.entityId) return state.teachers.some((teacher) => teacher.id === selector.entityId) ? [selector.entityId] : [];
  if (!selector.name) return [];
  const wanted = normalize(selector.name);
  return state.teachers.filter((teacher) => normalize(teacher.name) === wanted).map((teacher) => teacher.id);
}

function roomIdsForSelector(state: StudioState, selector: EntitySelectorV1 | undefined) {
  if (!selector || selector.entityType !== "ROOM") return [];
  if (selector.entityId) return state.rooms.some((room) => room.id === selector.entityId) ? [selector.entityId] : [];
  if (!selector.name) return [];
  const wanted = normalize(selector.name);
  return state.rooms.filter((room) => normalize(room.name) === wanted).map((room) => room.id);
}

function studentIdsForSelector(state: StudioState, selector: EntitySelectorV1 | undefined) {
  if (!selector || selector.entityType !== "STUDENT") return [];
  if (selector.entityId) return state.students.some((student) => student.id === selector.entityId) ? [selector.entityId] : [];
  if (!selector.name) return [];
  const wanted = normalize(selector.name);
  return state.students.filter((student) => normalize(student.name) === wanted).map((student) => student.id);
}

function cohortStudentIds(state: StudioState, selector: EntitySelectorV1 | undefined) {
  if (!selector || selector.entityType !== "COHORT") return [];
  if (selector.entityId) return state.cohorts.find((cohort) => cohort.id === selector.entityId)?.studentIds ?? [];
  if (!selector.name) return [];
  const wanted = normalize(selector.name);
  return state.cohorts.find((cohort) => normalize(cohort.name) === wanted)?.studentIds ?? [];
}

function effectiveStudentIds(state: StudioState, selector: EntitySelectorV1 | undefined) {
  return unique([...studentIdsForSelector(state, selector), ...cohortStudentIds(state, selector)]);
}

function classAssignments(
  assignments: Assignment[],
  className: string,
  classesBySession: Map<string, ClassDefinition>,
) {
  const wanted = normalize(className);
  return assignments.filter((assignment) => normalize(classesBySession.get(assignment.sessionId)?.name || "") === wanted);
}

export function validateConstraintModelSchedule(
  state: StudioState,
  model: ConstraintModelSnapshotV1,
  assignments: Assignment[],
): ConstraintEngineResult {
  const violations: ConstraintEngineViolation[] = [];
  const evaluated = new Set<string>();
  const delegated = new Set<string>();
  const unsupported = new Set<string>();
  const classesById = new Map(state.classes.map((klass) => [klass.id, klass]));
  const classesBySession = new Map(
    state.sessions
      .map((session) => [session.id, classesById.get(session.classId)] as const)
      .filter((entry): entry is readonly [string, ClassDefinition] => Boolean(entry[1])),
  );
  const teachersById = new Map(state.teachers.map((teacher) => [teacher.id, teacher]));
  const roomsById = new Map(state.rooms.map((room) => [room.id, room]));

  for (const assignment of assignments) {
    const klass = classesBySession.get(assignment.sessionId);
    if (!klass) {
      violations.push({
        constraintId: "planning-reference-integrity",
        ruleIds: ["CUR-001"],
        message: `Assignment ${assignment.id} references a missing class session.`,
        assignmentIds: [assignment.id],
        affectedEntityIds: [assignment.sessionId],
      });
      continue;
    }
    if (!teachersById.has(assignment.teacherId) || !roomsById.has(assignment.roomId)) {
      violations.push({
        constraintId: "planning-reference-integrity",
        ruleIds: ["CUR-007"],
        message: `Assignment ${assignment.id} references a missing teacher or room.`,
        assignmentIds: [assignment.id],
        affectedEntityIds: [assignment.teacherId, assignment.roomId],
      });
    }
  }

  for (const constraint of model.hardConstraints) {
    evaluateConstraint(constraint);
  }

  function pushViolation(
    constraint: ConstraintIRRuleV1,
    message: string,
    matchingAssignments: Assignment[] = [],
    affectedEntityIds: string[] = [],
  ) {
    violations.push({
      constraintId: constraint.id,
      ruleIds: constraint.ruleIds,
      message,
      assignmentIds: matchingAssignments.map((assignment) => assignment.id),
      affectedEntityIds: unique(affectedEntityIds),
    });
  }

  function evaluateConstraint(constraint: ConstraintIRRuleV1) {
    switch (constraint.kind) {
      case "TIME_GRID": {
        evaluated.add(constraint.id);
        const gridMinutes = Number(constraint.params.gridMinutes ?? 15);
        const invalid = assignments.filter((assignment) => parseTime(assignment.startTime) % gridMinutes !== 0);
        if (invalid.length) pushViolation(constraint, `${invalid.length} assignment(s) are off the ${gridMinutes}-minute time grid.`, invalid);
        return;
      }
      case "ROOM_NO_OVERLAP": {
        evaluated.add(constraint.id);
        const conflicts: Assignment[] = [];
        for (let i = 0; i < assignments.length; i += 1) {
          for (let j = i + 1; j < assignments.length; j += 1) {
            const a = assignments[i];
            const b = assignments[j];
            if (a.day !== b.day || a.roomId !== b.roomId) continue;
            if (intervalsOverlap(assignmentInterval(a), assignmentInterval(b))) conflicts.push(a, b);
          }
        }
        if (conflicts.length) pushViolation(constraint, "Two or more assignments overlap in the same room.", uniqueAssignments(conflicts));
        return;
      }
      case "TEACHER_NO_OVERLAP": {
        evaluated.add(constraint.id);
        const conflicts: Assignment[] = [];
        for (let i = 0; i < assignments.length; i += 1) {
          for (let j = i + 1; j < assignments.length; j += 1) {
            const a = assignments[i];
            const b = assignments[j];
            if (a.day !== b.day || a.teacherId !== b.teacherId) continue;
            if (intervalsOverlap(assignmentInterval(a), assignmentInterval(b))) conflicts.push(a, b);
          }
        }
        if (conflicts.length) pushViolation(constraint, "A teacher is assigned to overlapping classes.", uniqueAssignments(conflicts));
        return;
      }
      case "STUDENT_NO_OVERLAP": {
        evaluated.add(constraint.id);
        const conflicts: Assignment[] = [];
        const classStudents = new Map(state.classes.map((klass) => [klass.id, new Set(klass.rosterStudentIds)]));
        for (let i = 0; i < assignments.length; i += 1) {
          for (let j = i + 1; j < assignments.length; j += 1) {
            const a = assignments[i];
            const b = assignments[j];
            if (a.day !== b.day || !intervalsOverlap(assignmentInterval(a), assignmentInterval(b))) continue;
            const classA = classesBySession.get(a.sessionId);
            const classB = classesBySession.get(b.sessionId);
            if (!classA || !classB) continue;
            const studentsA = classStudents.get(classA.id) ?? new Set<string>();
            const studentsB = classStudents.get(classB.id) ?? new Set<string>();
            if ([...studentsA].some((studentId) => studentsB.has(studentId))) conflicts.push(a, b);
          }
        }
        if (conflicts.length) pushViolation(constraint, "A student is assigned to overlapping classes.", uniqueAssignments(conflicts));
        return;
      }
      case "CLASS_FREQUENCY":
      case "CLASS_DURATION":
      case "ROOM_CAPACITY":
      case "ROOM_CAPACITY_EXCEPTION":
      case "TEACHER_QUALIFICATION":
      case "RELATIONSHIP_ARRIVAL_WINDOW":
      case "MAX_TEACHER_GAP":
      case "MAX_STUDENT_GAP":
      case "MAX_TEACHER_WORKDAYS":
      case "MAX_STUDENT_ATTENDANCE_DAYS":
      case "MIN_STUDENT_ATTENDANCE_DAYS":
      case "REQUIRED_LOWER_LEVEL": {
        delegated.add(constraint.id);
        return;
      }
      case "REQUIRED_ROOM": {
        evaluated.add(constraint.id);
        const classIds = classIdsForSelector(state, constraint.selectors.class);
        const roomIds = roomIdsForSelector(state, constraint.selectors.room);
        if (!classIds.length || !roomIds.length) return;
        const target = assignments.filter((assignment) => classIds.includes(classesBySession.get(assignment.sessionId)?.id || ""));
        const invalid = target.filter((assignment) => !roomIds.includes(assignment.roomId));
        if (invalid.length) pushViolation(constraint, `${invalid.length} assignment(s) violate a required-room rule.`, invalid, [...classIds, ...roomIds]);
        return;
      }
      case "REQUIRED_TEACHER": {
        evaluated.add(constraint.id);
        const classIds = classIdsForSelector(state, constraint.selectors.class);
        const teacherIds = teacherIdsForSelector(state, constraint.selectors.teacher);
        if (!classIds.length || !teacherIds.length) return;
        const target = assignments.filter((assignment) => classIds.includes(classesBySession.get(assignment.sessionId)?.id || ""));
        const invalid = target.filter((assignment) => !teacherIds.includes(assignment.teacherId));
        if (invalid.length) pushViolation(constraint, `${invalid.length} assignment(s) violate a required-teacher rule.`, invalid, [...classIds, ...teacherIds]);
        return;
      }
      case "TEACHER_UNAVAILABLE": {
        evaluated.add(constraint.id);
        const teacherIds = teacherIdsForSelector(state, constraint.selectors.teacher);
        const days = (constraint.params.days || []) as Day[];
        const invalid = assignments.filter((assignment) => teacherIds.includes(assignment.teacherId) && days.includes(assignment.day));
        if (invalid.length) pushViolation(constraint, `${invalid.length} assignment(s) place a teacher on an unavailable day.`, invalid, teacherIds);
        return;
      }
      case "TEACHER_AVAILABLE_WINDOW": {
        evaluated.add(constraint.id);
        const teacherIds = teacherIdsForSelector(state, constraint.selectors.teacher);
        const day = constraint.params.day as Day | undefined;
        const start = typeof constraint.params.start === "string" ? parseTime(constraint.params.start) : null;
        const end = typeof constraint.params.end === "string" ? parseTime(constraint.params.end) : null;
        if (!day || start == null || end == null) return;
        const invalid = assignments.filter((assignment) => {
          if (!teacherIds.includes(assignment.teacherId) || assignment.day !== day) return false;
          const interval = assignmentInterval(assignment);
          return interval.start < start || interval.end > end;
        });
        if (invalid.length) pushViolation(constraint, `${invalid.length} assignment(s) fall outside a teacher's available window.`, invalid, teacherIds);
        return;
      }
      case "NO_DAY": {
        evaluated.add(constraint.id);
        const classIds = classIdsForSelector(state, constraint.selectors.class);
        const teacherIds = teacherIdsForSelector(state, constraint.selectors.teacher);
        const studentIds = effectiveStudentIds(state, constraint.selectors.student || constraint.selectors.cohort);
        const days = (constraint.params.days || []) as Day[];
        const invalid = assignments.filter((assignment) => {
          const klass = classesBySession.get(assignment.sessionId);
          if (!klass) return false;
          if (classIds.length && !classIds.includes(klass.id)) return false;
          if (teacherIds.length && !teacherIds.includes(assignment.teacherId)) return false;
          if (studentIds.length && !klass.rosterStudentIds.some((studentId) => studentIds.includes(studentId))) return false;
          return days.includes(assignment.day);
        });
        if (invalid.length) pushViolation(constraint, `${invalid.length} assignment(s) violate a prohibited-day rule.`, invalid, [...classIds, ...teacherIds, ...studentIds]);
        return;
      }
      case "EARLIEST_START": {
        evaluated.add(constraint.id);
        const classIds = classIdsForSelector(state, constraint.selectors.class);
        const teacherIds = teacherIdsForSelector(state, constraint.selectors.teacher);
        const studentIds = effectiveStudentIds(state, constraint.selectors.student || constraint.selectors.cohort);
        const earliest = typeof constraint.params.time === "string" ? parseTime(constraint.params.time) : null;
        if (earliest == null) return;
        const invalid = assignments.filter((assignment) => {
          const klass = classesBySession.get(assignment.sessionId);
          if (!klass) return false;
          if (classIds.length && !classIds.includes(klass.id)) return false;
          if (teacherIds.length && !teacherIds.includes(assignment.teacherId)) return false;
          if (studentIds.length && !klass.rosterStudentIds.some((studentId) => studentIds.includes(studentId))) return false;
          return parseTime(assignment.startTime) < earliest;
        });
        if (invalid.length) pushViolation(constraint, `${invalid.length} assignment(s) start earlier than allowed.`, invalid, [...classIds, ...teacherIds, ...studentIds]);
        return;
      }
      case "LATEST_FINISH": {
        evaluated.add(constraint.id);
        const classIds = classIdsForSelector(state, constraint.selectors.class);
        const teacherIds = teacherIdsForSelector(state, constraint.selectors.teacher);
        const studentIds = effectiveStudentIds(state, constraint.selectors.student || constraint.selectors.cohort);
        const latest = typeof constraint.params.time === "string" ? parseTime(constraint.params.time) : null;
        if (latest == null) return;
        const invalid = assignments.filter((assignment) => {
          const klass = classesBySession.get(assignment.sessionId);
          if (!klass) return false;
          if (classIds.length && !classIds.includes(klass.id)) return false;
          if (teacherIds.length && !teacherIds.includes(assignment.teacherId)) return false;
          if (studentIds.length && !klass.rosterStudentIds.some((studentId) => studentIds.includes(studentId))) return false;
          return parseTime(assignment.endTime) > latest;
        });
        if (invalid.length) pushViolation(constraint, `${invalid.length} assignment(s) finish later than allowed.`, invalid, [...classIds, ...teacherIds, ...studentIds]);
        return;
      }
      case "DIRECTLY_AFTER": {
        evaluated.add(constraint.id);
        const firstName = constraint.params.firstClass as string | undefined;
        const secondName = constraint.params.secondClass as string | undefined;
        if (!firstName || !secondName) return;
        const firstAssignments = classAssignments(assignments, firstName, classesBySession);
        const secondAssignments = classAssignments(assignments, secondName, classesBySession);
        for (const first of firstAssignments) {
          const match = secondAssignments.find((second) => second.day === first.day && parseTime(second.startTime) === parseTime(first.endTime));
          if (!match) pushViolation(constraint, `${secondName} must immediately follow ${firstName}.`, [first], []);
        }
        return;
      }
      case "FIXED_ASSIGNMENT": {
        evaluated.add(constraint.id);
        const classIds = classIdsForSelector(state, constraint.selectors.class);
        if (!classIds.length) return;
        const day = constraint.params.day as Day | undefined;
        const startTime = typeof constraint.params.startTime === "string" ? constraint.params.startTime : null;
        const teacherIds = teacherIdsForSelector(state, constraint.selectors.teacher);
        const roomIds = roomIdsForSelector(state, constraint.selectors.room);
        const target = assignments.filter((assignment) => classIds.includes(classesBySession.get(assignment.sessionId)?.id || ""));
        for (const assignment of target) {
          const invalid = Boolean(
            (day && assignment.day !== day)
            || (startTime && assignment.startTime !== startTime)
            || (teacherIds.length && !teacherIds.includes(assignment.teacherId))
            || (roomIds.length && !roomIds.includes(assignment.roomId))
          );
          if (invalid) pushViolation(constraint, "A fixed assignment moved away from its required placement.", [assignment], [...classIds, ...teacherIds, ...roomIds]);
        }
        return;
      }
      default:
        unsupported.add(constraint.id);
    }
  }

  return {
    valid: violations.length === 0,
    hardViolations: violations.length,
    violations,
    evaluatedConstraintIds: [...evaluated],
    delegatedConstraintIds: [...delegated],
    unsupportedConstraintIds: [...unsupported],
  };
}

function uniqueAssignments(assignments: Assignment[]) {
  return [...new Map(assignments.map((assignment) => [assignment.id, assignment])).values()];
}

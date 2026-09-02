import type { Assignment, ClassDefinition, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";

export interface ConstraintEngineViolation {
  constraintId: string;
  ruleIds: string[];
  message: string;
  assignmentIds: string[];
  affectedEntityIds: string[];
}

export interface ConstraintEngineResult {
  valid: boolean;
  hardViolations: number;
  violations: ConstraintEngineViolation[];
  evaluatedConstraintIds: string[];
  delegatedConstraintIds: string[];
  unsupportedConstraintIds: string[];
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const minutes = (value: string) => {
  const [hour = "0", minute = "0"] = value.slice(0, 5).split(":");
  return Number(hour) * 60 + Number(minute);
};
const overlaps = (a: Assignment, b: Assignment) =>
  a.day === b.day && minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime);

function levelTokens(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/levels?/g, "")
    .replace(/elementary/g, "elem")
    .replace(/[^a-z0-9/]+/g, "")
    .trim();
  if (!normalized) return [];
  return normalized.split("/").filter(Boolean);
}

function levelMatches(value: string, selectors: string[] | undefined) {
  if (!selectors?.length) return true;
  const actual = new Set(levelTokens(value));
  return selectors.some((selector) => levelTokens(selector).some((token) => actual.has(token)));
}

function textMatches(value: string, selectors: string[] | undefined) {
  if (!selectors?.length) return true;
  const actual = normalize(value);
  return selectors.some((selector) => normalize(selector) === actual);
}

function subjectAllowed(klass: ClassDefinition, allowed: string[]) {
  const subject = normalize(klass.subject);
  const name = normalize(klass.name);
  const elementary = levelTokens(klass.level).some((token) => token.startsWith("elem"));
  return allowed.some((entry) => {
    const candidate = normalize(entry);
    if (candidate === subject || candidate === name) return true;
    if (elementary && candidate === normalize(`Elementary ${klass.subject}`)) return true;
    return false;
  });
}

function selectorMatchesClass(node: ConstraintIRNode, klass: ClassDefinition) {
  return textMatches(klass.name, node.selector.classNames)
    && textMatches(klass.subject, node.selector.subjects)
    && levelMatches(klass.level, node.selector.levels);
}

function addViolation(
  violations: ConstraintEngineViolation[],
  node: ConstraintIRNode,
  message: string,
  assignments: Assignment[] = [],
  entities: string[] = [],
) {
  violations.push({
    constraintId: node.id,
    ruleIds: node.ruleIds,
    message,
    assignmentIds: assignments.map((assignment) => assignment.id),
    affectedEntityIds: [...new Set(entities)],
  });
}

function targetClassNames(node: ConstraintIRNode) {
  const names = [...(node.selector.classNames || [])];
  const params = node.parameters;
  for (const key of ["predecessor", "successor"] as const) {
    if (typeof params[key] === "string") names.push(String(params[key]));
  }
  if (Array.isArray(params.daughterClassNames)) names.push(...params.daughterClassNames.map(String));
  return [...new Set(names)];
}

function requiresConcreteClassTargets(node: ConstraintIRNode) {
  return ["REQUIRED_ROOM", "REQUIRED_TEACHER", "DIRECTLY_AFTER", "FIXED_ASSIGNMENT", "RELATIONSHIP_START_WINDOW"].includes(node.kind);
}

function parameterStrings(node: ConstraintIRNode, key: string) {
  const value = node.parameters[key];
  return Array.isArray(value) ? value.map(String) : [];
}

function dayApplies(node: ConstraintIRNode, assignment: Assignment) {
  const days = parameterStrings(node, "days");
  return days.length === 0 || days.includes(assignment.day);
}

function classAssignments(
  state: StudioState,
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
  const sessionsById = new Map(state.sessions.map((session) => [session.id, session]));
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
    if (!teachersById.has(assignment.teacherId)) {
      violations.push({
        constraintId: "planning-reference-integrity",
        ruleIds: ["CUR-001"],
        message: `${klass.name} references a missing teacher.`,
        assignmentIds: [assignment.id],
        affectedEntityIds: [assignment.teacherId],
      });
    }
    if (!roomsById.has(assignment.roomId)) {
      violations.push({
        constraintId: "planning-reference-integrity",
        ruleIds: ["CUR-001"],
        message: `${klass.name} references a missing room.`,
        assignmentIds: [assignment.id],
        affectedEntityIds: [assignment.roomId],
      });
    }
  }

  // CUR-007 is a governance assertion: qualification is default-deny. A teacher
  // with no compiled qualification domain may exist in inventory, but may not be
  // scheduled until the Rulebook is updated and recompiled.
  const teacherDomainNodes = model.hardConstraints.filter((node) => node.kind === "TEACHER_SUBJECT_DOMAIN");
  const coveredTeacherNames = new Set(teacherDomainNodes.flatMap((node) => node.selector.teacherNames || []).map(normalize));
  for (const assignment of assignments) {
    const teacher = teachersById.get(assignment.teacherId);
    const klass = classesBySession.get(assignment.sessionId);
    if (!teacher || !klass || coveredTeacherNames.has(normalize(teacher.name))) continue;
    violations.push({
      constraintId: "teacher-qualification-default-deny",
      ruleIds: ["CUR-007"],
      message: `${teacher.name} has no compiled Rulebook qualification domain, so ${klass.name} cannot be assigned to that teacher yet.`,
      assignmentIds: [assignment.id],
      affectedEntityIds: [teacher.id, klass.id],
    });
  }

  for (const node of model.hardConstraints) {
    if (requiresConcreteClassTargets(node)) {
      for (const className of targetClassNames(node)) {
        if (!state.classes.some((klass) => normalize(klass.name) === normalize(className))) {
          addViolation(violations, node, `${className} is referenced by the current Rulebook constraint model but is missing from planning inventory.`);
        }
      }
    }
    for (const teacherName of node.selector.teacherNames || []) {
      if (!state.teachers.some((teacher) => normalize(teacher.name) === normalize(teacherName))) {
        addViolation(violations, node, `${teacherName} is referenced by the current Rulebook constraint model but is missing from teacher inventory.`);
      }
    }
    for (const roomName of node.selector.roomNames || []) {
      if (!state.rooms.some((room) => normalize(room.name) === normalize(roomName))) {
        addViolation(violations, node, `${roomName} is referenced by the current Rulebook constraint model but is missing from room inventory.`);
      }
    }

    if (node.kind === "RESOURCE_NO_OVERLAP") {
      evaluated.add(node.id);
      const resource = String(node.parameters.resource || "");
      for (let i = 0; i < assignments.length; i += 1) {
        const left = assignments[i];
        const leftClass = classesBySession.get(left.sessionId);
        if (!leftClass) continue;
        for (let j = i + 1; j < assignments.length; j += 1) {
          const right = assignments[j];
          const rightClass = classesBySession.get(right.sessionId);
          if (!rightClass || !overlaps(left, right)) continue;
          if (resource === "ROOM" && left.roomId === right.roomId) {
            addViolation(violations, node, `${roomsById.get(left.roomId)?.name || left.roomId} is double-booked.`, [left, right], [left.roomId]);
          }
          if (resource === "TEACHER" && left.teacherId === right.teacherId) {
            addViolation(violations, node, `${teachersById.get(left.teacherId)?.name || left.teacherId} is double-booked.`, [left, right], [left.teacherId]);
          }
          if (resource === "STUDENT_ROSTER") {
            const shared = leftClass.rosterStudentIds.filter((id) => rightClass.rosterStudentIds.includes(id));
            if (shared.length) addViolation(violations, node, `${shared.length} dancer${shared.length === 1 ? "" : "s"} would be double-booked between ${leftClass.name} and ${rightClass.name}.`, [left, right], shared);
          }
        }
      }
      continue;
    }

    if (node.kind === "TIME_GRID") {
      evaluated.add(node.id);
      const grid = Number(node.parameters.minutes || 15);
      for (const assignment of assignments) {
        if (minutes(assignment.startTime) % grid || minutes(assignment.endTime) % grid) {
          const klass = classesBySession.get(assignment.sessionId);
          addViolation(violations, node, `${klass?.name || assignment.sessionId} must start and end on the ${grid}-minute scheduling grid.`, [assignment], klass ? [klass.id] : []);
        }
      }
      continue;
    }

    if (node.kind === "DAY_TIME_WINDOW") {
      evaluated.add(node.id);
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        if (!klass || !selectorMatchesClass(node, klass) || !dayApplies(node, assignment)) continue;

        const overridden = model.hardConstraints.some((candidate) =>
          candidate.kind === "DAY_TIME_WINDOW"
          && candidate.parameters.overrides === node.id
          && selectorMatchesClass(candidate, klass)
          && dayApplies(candidate, assignment),
        );
        if (overridden) continue;

        let earliest = typeof node.parameters.earliestStart === "string" ? String(node.parameters.earliestStart) : null;
        if (typeof node.parameters.normalEarliestStart === "string") {
          const exceptions = parameterStrings(node, "exceptionLevels");
          earliest = levelMatches(klass.level, exceptions)
            ? String(node.parameters.exceptionEarliestStart || node.parameters.normalEarliestStart)
            : String(node.parameters.normalEarliestStart);
        }
        const latest = typeof node.parameters.latestFinish === "string" ? String(node.parameters.latestFinish) : null;
        if (earliest && minutes(assignment.startTime) < minutes(earliest)) {
          addViolation(violations, node, `${klass.name} starts before ${earliest}.`, [assignment], [klass.id]);
        }
        if (latest && minutes(assignment.endTime) > minutes(latest)) {
          addViolation(violations, node, `${klass.name} ends after ${latest}.`, [assignment], [klass.id]);
        }
      }
      continue;
    }

    if (node.kind === "NO_DAY") {
      evaluated.add(node.id);
      const prohibited = parameterStrings(node, "days");
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        if (klass && selectorMatchesClass(node, klass) && prohibited.includes(assignment.day)) {
          addViolation(violations, node, `${klass.name} cannot be scheduled on ${assignment.day}.`, [assignment], [klass.id]);
        }
      }
      continue;
    }

    if (node.kind === "MAX_GAP") {
      evaluated.add(node.id);
      const maximum = Number(node.parameters.minutes || 60);
      const resource = String(node.parameters.resource || "");
      if (resource === "TEACHER") {
        for (const teacher of state.teachers.filter((item) => textMatches(item.name, node.selector.teacherNames))) {
          for (const day of DAYS) {
            const list = assignments.filter((assignment) => assignment.teacherId === teacher.id && assignment.day === day)
              .sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
            for (let index = 1; index < list.length; index += 1) {
              if (minutes(list[index].startTime) - minutes(list[index - 1].endTime) > maximum) {
                addViolation(violations, node, `${teacher.name} has a gap longer than ${maximum} minutes on ${day}.`, [list[index - 1], list[index]], [teacher.id]);
              }
            }
          }
        }
      } else if (resource === "STUDENT_ROSTER") {
        for (const student of state.students) {
          for (const day of DAYS) {
            const list = assignments.filter((assignment) => {
              const klass = classesBySession.get(assignment.sessionId);
              return assignment.day === day && Boolean(klass?.rosterStudentIds.includes(student.id));
            }).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
            for (let index = 1; index < list.length; index += 1) {
              if (minutes(list[index].startTime) - minutes(list[index - 1].endTime) > maximum) {
                addViolation(violations, node, `${student.name} has a gap longer than ${maximum} minutes on ${day}.`, [list[index - 1], list[index]], [student.id]);
              }
            }
          }
        }
      }
      continue;
    }

    if (node.kind === "MAX_WORKDAYS") {
      evaluated.add(node.id);
      const maximum = Number(node.parameters.maxDays || 0);
      for (const teacher of state.teachers.filter((item) => textMatches(item.name, node.selector.teacherNames))) {
        const list = assignments.filter((assignment) => assignment.teacherId === teacher.id);
        const count = new Set(list.map((assignment) => assignment.day)).size;
        if (maximum && count > maximum) addViolation(violations, node, `${teacher.name} is scheduled on ${count} days; maximum is ${maximum}.`, list, [teacher.id]);
      }
      continue;
    }

    if (node.kind === "LATEST_FINISH_BY_LEVEL") {
      evaluated.add(node.id);
      const latest = String(node.parameters.latestFinish || "23:59");
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        if (klass && selectorMatchesClass(node, klass) && minutes(assignment.endTime) > minutes(latest)) {
          addViolation(violations, node, `${klass.name} ends after the ${latest} dancer-level limit.`, [assignment], [klass.id]);
        }
      }
      continue;
    }

    if (node.kind === "MAX_ATTENDANCE_DAYS") {
      evaluated.add(node.id);
      const maximum = Number(node.parameters.maxDays || 0);
      for (const student of state.students.filter((item) => levelMatches(item.level, node.selector.levels))) {
        const list = assignments.filter((assignment) => classesBySession.get(assignment.sessionId)?.rosterStudentIds.includes(student.id));
        const count = new Set(list.map((assignment) => assignment.day)).size;
        if (maximum && count > maximum) addViolation(violations, node, `${student.name} attends on ${count} days; maximum is ${maximum}.`, list, [student.id]);
      }
      continue;
    }

    if (node.kind === "REQUIRED_ROOM") {
      evaluated.add(node.id);
      const requiredName = String(node.parameters.roomName || node.selector.roomNames?.[0] || "");
      const room = state.rooms.find((item) => normalize(item.name) === normalize(requiredName));
      if (!room) continue;
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        if (klass && selectorMatchesClass(node, klass) && assignment.roomId !== room.id) {
          addViolation(violations, node, `${klass.name} requires ${room.name}.`, [assignment], [klass.id, room.id]);
        }
      }
      continue;
    }

    if (node.kind === "REQUIRED_TEACHER") {
      evaluated.add(node.id);
      const requiredName = String(node.parameters.teacherName || node.selector.teacherNames?.[0] || "");
      const teacher = state.teachers.find((item) => normalize(item.name) === normalize(requiredName));
      if (!teacher) continue;
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        if (klass && selectorMatchesClass(node, klass) && assignment.teacherId !== teacher.id) {
          addViolation(violations, node, `${klass.name} requires ${teacher.name}.`, [assignment], [klass.id, teacher.id]);
        }
      }
      continue;
    }

    if (node.kind === "REQUIRED_LOWER_LEVEL") {
      delegated.add(node.id);
      continue;
    }

    if (node.kind === "TEACHER_SUBJECT_DOMAIN") {
      evaluated.add(node.id);
      const allowedSubjects = parameterStrings(node, "allowedSubjects");
      const allowedLevels = parameterStrings(node, "allowedLevels");
      const prohibitedSubjects = parameterStrings(node, "prohibitedSubjects");
      const prohibitedLevels = parameterStrings(node, "prohibitedLevels");
      const exceptionClasses = parameterStrings(node, "exceptionClasses");
      for (const teacher of state.teachers.filter((item) => textMatches(item.name, node.selector.teacherNames))) {
        for (const assignment of assignments.filter((item) => item.teacherId === teacher.id)) {
          const klass = classesBySession.get(assignment.sessionId);
          if (!klass) continue;
          const explicitException = textMatches(klass.name, exceptionClasses);
          const prohibitedSubject = prohibitedSubjects.length > 0 && subjectAllowed(klass, prohibitedSubjects);
          const prohibitedLevel = prohibitedLevels.length > 0 && levelMatches(klass.level, prohibitedLevels);
          const subjectOkay = explicitException || allowedSubjects.length === 0 || subjectAllowed(klass, allowedSubjects);
          const levelOkay = explicitException || allowedLevels.length === 0 || levelMatches(klass.level, allowedLevels);
          if (prohibitedSubject || prohibitedLevel || !subjectOkay || !levelOkay) {
            addViolation(violations, node, `${teacher.name} is not qualified by the current Rulebook domain for ${klass.name}.`, [assignment], [teacher.id, klass.id]);
          }
        }
      }
      continue;
    }

    if (node.kind === "TEACHER_DAY_WINDOW") {
      const inheritedOnly = node.parameters.inheritStudioOperatingWindows === true && node.parameters.mayExtendOperatingHours === false;
      if (inheritedOnly) {
        delegated.add(node.id);
        continue;
      }
      evaluated.add(node.id);
      const allowedDays = parameterStrings(node, "allowedDays");
      const exactDay = typeof node.parameters.day === "string" ? String(node.parameters.day) : null;
      const start = typeof node.parameters.start === "string" ? String(node.parameters.start) : null;
      const end = typeof node.parameters.end === "string" ? String(node.parameters.end) : null;
      for (const teacher of state.teachers.filter((item) => textMatches(item.name, node.selector.teacherNames))) {
        for (const assignment of assignments.filter((item) => item.teacherId === teacher.id)) {
          if (allowedDays.length && !allowedDays.includes(assignment.day)) {
            addViolation(violations, node, `${teacher.name} cannot teach on ${assignment.day}.`, [assignment], [teacher.id]);
            continue;
          }
          if (exactDay && assignment.day !== exactDay) {
            addViolation(violations, node, `${teacher.name} may teach this Rulebook window only on ${exactDay}.`, [assignment], [teacher.id]);
            continue;
          }
          if (start && minutes(assignment.startTime) < minutes(start)) addViolation(violations, node, `${teacher.name} starts before the ${start} availability window.`, [assignment], [teacher.id]);
          if (end && minutes(assignment.endTime) > minutes(end)) addViolation(violations, node, `${teacher.name} ends after the ${end} availability window.`, [assignment], [teacher.id]);
        }
      }
      continue;
    }

    if (node.kind === "DIRECTLY_AFTER") {
      evaluated.add(node.id);
      const predecessor = String(node.parameters.predecessor || node.selector.classNames?.[0] || "");
      const successor = String(node.parameters.successor || node.selector.classNames?.[1] || "");
      const gap = Number(node.parameters.gapMinutes || 0);
      const before = classAssignments(state, assignments, predecessor, classesBySession);
      const after = classAssignments(state, assignments, successor, classesBySession);
      if (!before.length || !after.length) continue;
      const designated = node.parameters.designatedWeeklyMeeting === true;
      const matches = after.filter((successorAssignment) => before.some((predecessorAssignment) =>
        predecessorAssignment.day === successorAssignment.day
        && minutes(successorAssignment.startTime) - minutes(predecessorAssignment.endTime) === gap,
      ));
      if (designated) {
        if (!matches.length) addViolation(violations, node, `${successor} must follow one designated ${predecessor} meeting directly.`, [...before, ...after]);
      } else {
        for (const successorAssignment of after) {
          const matched = before.some((predecessorAssignment) => predecessorAssignment.day === successorAssignment.day && minutes(successorAssignment.startTime) - minutes(predecessorAssignment.endTime) === gap);
          if (!matched) addViolation(violations, node, `${successor} must be scheduled directly after ${predecessor}.`, [successorAssignment, ...before]);
        }
      }
      continue;
    }

    if (node.kind === "FIXED_ASSIGNMENT") {
      evaluated.add(node.id);
      const className = node.selector.classNames?.[0];
      if (!className) continue;
      const list = classAssignments(state, assignments, className, classesBySession);
      if (!list.length) {
        addViolation(violations, node, `${className} is a fixed Rulebook anchor but is not assigned in the candidate schedule.`);
        continue;
      }
      const day = String(node.parameters.day || "");
      const start = String(node.parameters.start || "");
      const end = String(node.parameters.end || "");
      const teacherName = node.selector.teacherNames?.[0];
      const roomName = node.selector.roomNames?.[0];
      const teacher = teacherName ? state.teachers.find((item) => normalize(item.name) === normalize(teacherName)) : null;
      const room = roomName ? state.rooms.find((item) => normalize(item.name) === normalize(roomName)) : null;
      const matched = list.some((assignment) =>
        (!day || assignment.day === day)
        && (!start || minutes(assignment.startTime) === minutes(start))
        && (!end || minutes(assignment.endTime) === minutes(end))
        && (!teacher || assignment.teacherId === teacher.id)
        && (!room || assignment.roomId === room.id),
      );
      if (!matched) addViolation(violations, node, `${className} does not match its fixed Rulebook day/time/teacher/room anchor.`, list);
      continue;
    }

    if (node.kind === "ROOM_CAPACITY") {
      evaluated.add(node.id);
      const maximum = Number(node.parameters.maxDancers || 0);
      const exemptLevels = parameterStrings(node, "exemptLevels");
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        const room = roomsById.get(assignment.roomId);
        if (!klass || !room || !textMatches(room.name, node.selector.roomNames) || levelMatches(klass.level, exemptLevels)) continue;
        if (maximum && klass.rosterStudentIds.length > maximum) {
          addViolation(violations, node, `${klass.name} has ${klass.rosterStudentIds.length} dancers, exceeding ${room.name}'s Rulebook capacity of ${maximum}.`, [assignment], [klass.id, room.id, ...klass.rosterStudentIds]);
        }
      }
      continue;
    }

    if (node.kind === "RELATIONSHIP_START_WINDOW") {
      evaluated.add(node.id);
      const teacherName = node.selector.teacherNames?.[0] || "";
      const teacher = state.teachers.find((item) => normalize(item.name) === normalize(teacherName));
      if (!teacher) continue;
      const daughterClasses = parameterStrings(node, "daughterClassNames");
      const maximum = Number(node.parameters.maxStartDifferenceMinutes || 0);
      for (const day of DAYS) {
        const teacherDay = assignments.filter((assignment) => assignment.teacherId === teacher.id && assignment.day === day)
          .sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
        if (!teacherDay.length) continue;
        const daughterDay = assignments.filter((assignment) => {
          const klass = classesBySession.get(assignment.sessionId);
          return assignment.day === day && Boolean(klass && textMatches(klass.name, daughterClasses));
        }).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
        if (!daughterDay.length) {
          addViolation(violations, node, `${teacher.name} teaches on ${day}, but none of the daughter's Rulebook classes is scheduled that day.`, teacherDay, [teacher.id]);
          continue;
        }
        const difference = Math.abs(minutes(teacherDay[0].startTime) - minutes(daughterDay[0].startTime));
        if (difference > maximum) addViolation(violations, node, `${teacher.name}'s first teaching start and her daughter's first class are ${difference} minutes apart on ${day}; maximum is ${maximum}.`, [teacherDay[0], daughterDay[0]], [teacher.id]);
      }
      continue;
    }

    unsupported.add(node.id);
  }

  return {
    valid: violations.length === 0 && unsupported.size === 0,
    hardViolations: violations.length,
    violations,
    evaluatedConstraintIds: [...evaluated].sort(),
    delegatedConstraintIds: [...delegated].sort(),
    unsupportedConstraintIds: [...unsupported].sort(),
  };
}

import type { Assignment, ClassDefinition, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import {
  validateConstraintModelSchedule as validateBase,
  type ConstraintEngineResult,
  type ConstraintEngineViolation,
} from "@/lib/constraint-engine";
import { canonicalBindingName } from "@/lib/constraint-data-binding";

const normalize = canonicalBindingName;
const minutes = (value: string) => {
  const [hour = "0", minute = "0"] = value.slice(0, 5).split(":");
  return Number(hour) * 60 + Number(minute);
};

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

function matchesIds(actualId: string, expectedIds: string[] | undefined) {
  return !expectedIds?.length || expectedIds.includes(actualId);
}

function classMatchesNode(klass: ClassDefinition, node: ConstraintIRNode) {
  if (!matchesIds(klass.id, node.selector.classIds)) return false;
  if (node.selector.classNames?.length && !textMatches(klass.name, node.selector.classNames)) return false;
  if (node.selector.subjects?.length && !textMatches(klass.subject, node.selector.subjects)) return false;
  return !node.selector.levels?.length || levelMatches(klass.level, node.selector.levels);
}

function roomMatchesNode(roomId: string, roomName: string, node: ConstraintIRNode) {
  if (!matchesIds(roomId, node.selector.roomIds)) return false;
  return !node.selector.roomNames?.length || textMatches(roomName, node.selector.roomNames);
}

function teacherMatchesNode(teacherId: string, teacherName: string, node: ConstraintIRNode) {
  if (!matchesIds(teacherId, node.selector.teacherIds)) return false;
  return !node.selector.teacherNames?.length || textMatches(teacherName, node.selector.teacherNames);
}

interface PolicyWindow {
  day: string;
  start: string;
  end: string;
}

function policyWindows(value: unknown): PolicyWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.day !== "string" || typeof record.start !== "string" || typeof record.end !== "string") return [];
    return [{ day: record.day, start: record.start, end: record.end }];
  });
}

function assignmentOverlapsWindow(assignment: Assignment, window: PolicyWindow) {
  return assignment.day === window.day
    && minutes(assignment.startTime) < minutes(window.end)
    && minutes(window.start) < minutes(assignment.endTime);
}

function assignmentFitsWindow(assignment: Assignment, window: PolicyWindow) {
  return assignment.day === window.day
    && minutes(assignment.startTime) >= minutes(window.start)
    && minutes(assignment.endTime) <= minutes(window.end);
}

function pushUnique(violations: ConstraintEngineViolation[], violation: ConstraintEngineViolation) {
  const key = `${violation.constraintId}|${[...violation.assignmentIds].sort().join(",")}|${violation.message}`;
  const exists = violations.some((item) =>
    `${item.constraintId}|${[...item.assignmentIds].sort().join(",")}|${item.message}` === key,
  );
  if (!exists) violations.push(violation);
}

function pushAssignmentViolation(
  violations: ConstraintEngineViolation[],
  node: ConstraintIRNode,
  message: string,
  assignment: Assignment,
  affectedEntityIds: string[],
) {
  pushUnique(violations, {
    constraintId: node.id,
    ruleIds: node.ruleIds,
    message,
    assignmentIds: [assignment.id],
    affectedEntityIds,
  });
}

/**
 * Correctness layer over the initial IR evaluator.
 *
 * This layer owns semantics that need stricter empty-list behavior than the
 * original evaluator and the bounded stable-ID policy families introduced by
 * POL-01/POL-02. The base evaluator remains unchanged so legacy V3 behavior is
 * preserved while typed runtime parity is proven independently.
 */
export function validateConstraintModelSchedule(
  state: StudioState,
  model: ConstraintModelSnapshotV1,
  assignments: Assignment[],
): ConstraintEngineResult {
  const base = validateBase(state, model, assignments);
  const typedMaximumAttendanceIds = new Set(model.hardConstraints.filter((node) => node.kind === "MAX_ATTENDANCE_DAYS" && node.selector.participantIds?.length).map((node) => node.id));
  const typedQualificationTeacherIds = new Set(
    model.hardConstraints
      .filter((node) => node.kind === "TEACHER_CLASS_DOMAIN")
      .flatMap((node) => node.selector.teacherIds || []),
  );
  const violations = base.violations.filter((violation) => {
    if (typedMaximumAttendanceIds.has(violation.constraintId)) return false;
    if (violation.constraintId !== "teacher-qualification-default-deny") return true;
    return !violation.affectedEntityIds.some((entityId) => typedQualificationTeacherIds.has(entityId));
  });
  const evaluated = new Set(base.evaluatedConstraintIds);
  const unsupported = new Set(base.unsupportedConstraintIds);
  const classesById = new Map(state.classes.map((klass) => [klass.id, klass]));
  const classesBySession = new Map(
    state.sessions
      .map((session) => [session.id, classesById.get(session.classId)] as const)
      .filter((entry): entry is readonly [string, ClassDefinition] => Boolean(entry[1])),
  );
  const teachersById = new Map(state.teachers.map((teacher) => [teacher.id, teacher]));
  const roomsById = new Map(state.rooms.map((room) => [room.id, room]));

  for (const node of model.hardConstraints) {
    if (node.kind === "LATEST_FINISH_BY_PARTICIPANT") {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const participantIds = node.selector.participantIds || [];
      const selected = new Set(participantIds);
      const latestFinish = String(node.parameters.latestFinish || "");
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        if (!klass || minutes(assignment.endTime) <= minutes(latestFinish)) continue;
        const affected = klass.rosterStudentIds.filter((studentId) => selected.has(studentId));
        if (!affected.length) continue;
        pushAssignmentViolation(
          violations,
          node,
          `${affected.map((id) => state.students.find((student) => student.id === id)?.name || id).join(", ")} must finish by ${latestFinish}.`,
          assignment,
          affected,
        );
      }
      continue;
    }

    if (node.kind === "PARTICIPANT_NO_OVERLAP") {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const participantIds = node.selector.participantIds || [];
      const selected = new Set(participantIds);
      const attended = assignments.filter((assignment) => {
        const klass = classesBySession.get(assignment.sessionId);
        return klass?.rosterStudentIds.some((studentId) => selected.has(studentId));
      });
      for (let left = 0; left < attended.length; left += 1) {
        for (let right = left + 1; right < attended.length; right += 1) {
          const first = attended[left]; const second = attended[right];
          if (first.day !== second.day || minutes(first.startTime) >= minutes(second.endTime) || minutes(second.startTime) >= minutes(first.endTime)) continue;
          pushUnique(violations, {
            constraintId: node.id, ruleIds: node.ruleIds,
            message: "Sessions attended by this participant group cannot overlap.",
            assignmentIds: [first.id, second.id], affectedEntityIds: participantIds,
          });
        }
      }
      continue;
    }

    if (node.kind === "MAX_ATTENDANCE_DAYS" && node.selector.participantIds?.length) {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const maximum = Number(node.parameters.maxDays);
      for (const participantId of node.selector.participantIds) {
        const attended = assignments.filter((assignment) => classesBySession.get(assignment.sessionId)?.rosterStudentIds.includes(participantId));
        const count = new Set(attended.map((assignment) => assignment.day)).size;
        if (count > maximum) {
          pushUnique(violations, {
            constraintId: node.id, ruleIds: node.ruleIds,
            message: `${state.students.find((student) => student.id === participantId)?.name || participantId} attends on ${count} days; maximum is ${maximum}.`,
            assignmentIds: attended.map((assignment) => assignment.id), affectedEntityIds: [participantId],
          });
        }
      }
      continue;
    }

    if (node.kind === "DIRECTLY_AFTER" && typeof node.parameters.predecessorSessionId === "string") {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const predecessorSessionId = String(node.parameters.predecessorSessionId);
      const successorSessionId = String(node.parameters.successorSessionId);
      const predecessor = assignments.find((assignment) => assignment.sessionId === predecessorSessionId);
      const successor = assignments.find((assignment) => assignment.sessionId === successorSessionId);
      if (!predecessor || !successor) {
        pushUnique(violations, {
          constraintId: node.id, ruleIds: node.ruleIds,
          message: "Both direct-after session endpoints must be placed before this schedule is complete.",
          assignmentIds: [predecessor?.id, successor?.id].filter((id): id is string => Boolean(id)),
          affectedEntityIds: [predecessorSessionId, successorSessionId],
        });
      } else if (predecessor.day !== successor.day || minutes(successor.startTime) !== minutes(predecessor.endTime)) {
        pushUnique(violations, {
          constraintId: node.id, ruleIds: node.ruleIds,
          message: "The successor session must start exactly when the predecessor session ends on the same day.",
          assignmentIds: [predecessor.id, successor.id], affectedEntityIds: [predecessorSessionId, successorSessionId],
        });
      }
      continue;
    }

    if (node.kind === "LINKED_ARRIVAL") {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const teacherId = String(node.parameters.teacherId || node.selector.teacherIds?.[0] || "");
      const participantId = String(node.parameters.participantId || node.selector.participantIds?.[0] || "");
      const minimum = Number(node.parameters.minOffsetMinutes); const maximum = Number(node.parameters.maxOffsetMinutes);
      for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const) {
        const teaching = assignments.filter((assignment) => assignment.teacherId === teacherId && assignment.day === day).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
        if (!teaching.length) continue;
        const attending = assignments.filter((assignment) => assignment.day === day && classesBySession.get(assignment.sessionId)?.rosterStudentIds.includes(participantId)).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
        if (!attending.length) {
          pushUnique(violations, { constraintId: node.id, ruleIds: node.ruleIds, message: `The linked participant must attend on ${day} because the linked teacher teaches that day.`, assignmentIds: teaching.map((assignment) => assignment.id), affectedEntityIds: [teacherId, participantId] });
          continue;
        }
        const delta = minutes(teaching[0].startTime) - minutes(attending[0].startTime);
        if (delta < minimum || delta > maximum) {
          pushUnique(violations, { constraintId: node.id, ruleIds: node.ruleIds, message: `Linked arrival offset is ${delta} minutes on ${day}; allowed interval is ${minimum} to ${maximum} minutes inclusive.`, assignmentIds: [teaching[0].id, attending[0].id], affectedEntityIds: [teacherId, participantId] });
        }
      }
      continue;
    }

    if (node.kind === "STUDIO_OPERATING_WINDOWS") {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const windows = policyWindows(node.parameters.windows);
      const closedDays = strings(node.parameters.closedDays);
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        if (!klass) continue;
        const fits = !closedDays.includes(assignment.day)
          && windows.some((window) => assignmentFitsWindow(assignment, window));
        if (!fits) {
          pushAssignmentViolation(
            violations,
            node,
            `${klass.name} is outside the studio operating windows on ${assignment.day}.`,
            assignment,
            [klass.id],
          );
        }
      }
      continue;
    }

    if (node.kind === "ROOM_UNAVAILABLE_WINDOWS") {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const windows = policyWindows(node.parameters.windows);
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        const room = roomsById.get(assignment.roomId);
        if (!klass || !room || !roomMatchesNode(room.id, room.name, node)) continue;
        if (windows.some((window) => assignmentOverlapsWindow(assignment, window))) {
          pushAssignmentViolation(
            violations,
            node,
            `${room.name} is unavailable during ${klass.name}.`,
            assignment,
            [klass.id, room.id],
          );
        }
      }
      continue;
    }

    if (node.kind === "TEACHER_DAY_WINDOW" && (Array.isArray(node.parameters.windows) || Array.isArray(node.parameters.unavailableDays))) {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const windows = policyWindows(node.parameters.windows);
      const unavailableDays = strings(node.parameters.unavailableDays);
      for (const assignment of assignments) {
        const teacher = teachersById.get(assignment.teacherId);
        if (!teacher || !teacherMatchesNode(teacher.id, teacher.name, node)) continue;
        if (unavailableDays.includes(assignment.day)) {
          pushAssignmentViolation(
            violations,
            node,
            `${teacher.name} is unavailable on ${assignment.day}; move this class to an available day or change the teacher's Setup availability.`,
            assignment,
            [teacher.id],
          );
          continue;
        }
        if (windows.length && !windows.some((window) => assignmentFitsWindow(assignment, window))) {
          pushAssignmentViolation(
            violations,
            node,
            `${teacher.name} is outside the configured availability windows; move this class inside an available window or adjust the teacher's Setup availability.`,
            assignment,
            [teacher.id],
          );
        }
      }
      continue;
    }

    if (node.kind === "TEACHER_CLASS_DOMAIN") {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const allowedClassIds = strings(node.parameters.classIds);
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        const teacher = teachersById.get(assignment.teacherId);
        if (!klass || !teacher || !teacherMatchesNode(teacher.id, teacher.name, node)) continue;
        if (!allowedClassIds.includes(klass.id)) {
          pushAssignmentViolation(
            violations,
            node,
            `${teacher.name} is not qualified by the current Rulebook domain for ${klass.name}.`,
            assignment,
            [teacher.id, klass.id],
          );
        }
      }
      continue;
    }

    if (node.kind === "ROOM_REQUIRED_FEATURES") {
      unsupported.delete(node.id);
      evaluated.add(node.id);
      const requiredFeatures = strings(node.parameters.requiredFeatures);
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        const room = roomsById.get(assignment.roomId);
        if (!klass || !room || !classMatchesNode(klass, node)) continue;
        const available = new Set(room.features || []);
        const missing = requiredFeatures.filter((feature) => !available.has(feature));
        if (missing.length) {
          pushAssignmentViolation(
            violations,
            node,
            `${klass.name} requires room feature${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
            assignment,
            [klass.id, room.id],
          );
        }
      }
      continue;
    }

    if (node.kind === "REQUIRED_TEACHER" && (node.selector.teacherIds?.length || typeof node.parameters.teacherId === "string")) {
      const requiredTeacherId = String(node.parameters.teacherId || node.selector.teacherIds?.[0] || "");
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        if (!klass || !classMatchesNode(klass, node) || assignment.teacherId === requiredTeacherId) continue;
        const teacher = teachersById.get(requiredTeacherId);
        pushAssignmentViolation(
          violations,
          node,
          `${klass.name} requires ${teacher?.name || requiredTeacherId}.`,
          assignment,
          [klass.id, requiredTeacherId],
        );
      }
    }

    if (node.kind === "REQUIRED_ROOM" && (node.selector.roomIds?.length || typeof node.parameters.roomId === "string")) {
      const requiredRoomId = String(node.parameters.roomId || node.selector.roomIds?.[0] || "");
      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        if (!klass || !classMatchesNode(klass, node) || assignment.roomId === requiredRoomId) continue;
        const room = roomsById.get(requiredRoomId);
        pushAssignmentViolation(
          violations,
          node,
          `${klass.name} requires ${room?.name || requiredRoomId}.`,
          assignment,
          [klass.id, requiredRoomId],
        );
      }
    }

    if (node.kind === "TEACHER_SUBJECT_DOMAIN") {
      const allowedSubjects = strings(node.parameters.allowedSubjects);
      const prohibitedSubjects = strings(node.parameters.prohibitedSubjects);
      const allowedLevels = strings(node.parameters.allowedLevels);
      const prohibitedLevels = strings(node.parameters.prohibitedLevels);
      const exceptionClassIds = strings(node.parameters.exceptionClassIds);
      const exceptionClasses = strings(node.parameters.exceptionClasses);

      for (const assignment of assignments) {
        const teacher = teachersById.get(assignment.teacherId);
        const klass = classesBySession.get(assignment.sessionId);
        if (!teacher || !klass || !teacherMatchesNode(teacher.id, teacher.name, node)) continue;

        const explicitException = exceptionClassIds.length > 0
          ? exceptionClassIds.includes(klass.id)
          : exceptionClasses.length > 0 && textMatches(klass.name, exceptionClasses);
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
      const roomIds = node.selector.roomIds || [];
      const classIds = node.selector.classIds || [];
      const planningCapacity = node.parameters.capacitySource === "PLANNING_DATASET";
      if (planningCapacity) {
        const exemptClassIds = strings(node.parameters.exemptClassIds);
        for (const assignment of assignments) {
          const klass = classesBySession.get(assignment.sessionId);
          const room = roomsById.get(assignment.roomId);
          if (!klass || !room || (classIds.length > 0 && !classIds.includes(klass.id)) || !roomMatchesNode(room.id, room.name, node) || exemptClassIds.includes(klass.id)) continue;
          if (room.capacity === undefined || room.capacity === null) {
            pushAssignmentViolation(
              violations,
              node,
              `${room.name} has no reviewed planning capacity, so ${klass.name} cannot be capacity-validated.`,
              assignment,
              [klass.id, room.id],
            );
            continue;
          }
          if (klass.rosterStudentIds.length > room.capacity) {
            pushAssignmentViolation(
              violations,
              node,
              `${klass.name} has ${klass.rosterStudentIds.length} dancers, exceeding ${room.name}'s planning capacity of ${room.capacity}.`,
              assignment,
              [klass.id, room.id, ...klass.rosterStudentIds],
            );
          }
        }
        continue;
      }

      const roomNames = node.selector.roomNames || [];
      const exemptLevels = strings(node.parameters.exemptLevels);
      const maximum = Number(node.parameters.maxDancers || 0);
      if (!maximum) continue;

      for (const assignment of assignments) {
        const klass = classesBySession.get(assignment.sessionId);
        const room = roomsById.get(assignment.roomId);
        if (!klass || !room || (classIds.length > 0 && !classIds.includes(klass.id)) || (roomIds.length > 0 ? !roomIds.includes(room.id) : !textMatches(room.name, roomNames))) continue;
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
    valid: violations.length === 0 && unsupported.size === 0,
    hardViolations: violations.length,
    violations,
    evaluatedConstraintIds: [...evaluated].sort(),
    unsupportedConstraintIds: [...unsupported].sort(),
  };
}

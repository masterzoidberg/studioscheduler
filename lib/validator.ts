import type { Assignment, ClassDefinition, StudioRule, StudioState, ValidationResult, ValidationViolation } from "@/lib/domain";

function minutes(value: string) {
  const [h = "0", m = "0"] = value.slice(0, 5).split(":");
  return Number(h) * 60 + Number(m);
}

function overlaps(a: Assignment, b: Assignment) {
  return a.day === b.day && minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime);
}

function p<T>(rule: StudioRule, key: string, fallback: T): T {
  const value = rule.parameters[key];
  return (value === undefined ? fallback : value) as T;
}

function violation(rule: StudioRule | null, message: string, assignments: Assignment[], entities: string[] = []): ValidationViolation {
  return {
    constraintId: rule?.id || "SYSTEM",
    severity: rule?.strength || "HARD",
    message,
    affectedEntityIds: entities,
    assignmentIds: assignments.map((item) => item.id),
  };
}

function appliesToClass(rule: StudioRule, klass: ClassDefinition) {
  const ids = rule.affectedEntityIds || [];
  if (ids.includes(klass.id)) return true;
  const subject = p<string | undefined>(rule, "subject", undefined);
  const subjects = p<string[]>(rule, "subjects", []);
  const levels = p<string[]>(rule, "levels", []);
  return (!subject && subjects.length === 0 && levels.length === 0) || subject === klass.subject || subjects.includes(klass.subject) || levels.includes(klass.level);
}

function exceptionMatches(rule: StudioRule, klass: ClassDefinition) {
  return (rule.exceptions || []).some((exception) => {
    const prefix = exception.when.level_prefix;
    const level = exception.when.level;
    const classId = exception.when.class_id;
    const subject = exception.when.subject;
    return (typeof prefix === "string" && klass.level.startsWith(prefix)) || level === klass.level || classId === klass.id || subject === klass.subject;
  });
}

export function validateSchedule(state: StudioState, assignments?: Assignment[]): ValidationResult {
  const current = assignments ?? state.scheduleVersions.find((item) => item.version === Math.max(0, ...state.scheduleVersions.map((v) => v.version)))?.assignments ?? [];
  const violations: ValidationViolation[] = [];
  const classes = new Map(state.classes.map((item) => [item.id, item]));
  const sessions = new Map(state.sessions.map((item) => [item.id, item]));
  const teachers = new Map(state.teachers.map((item) => [item.id, item]));
  const rooms = new Map(state.rooms.map((item) => [item.id, item]));
  const classFor = (assignment: Assignment) => classes.get(sessions.get(assignment.sessionId)?.classId || "");

  for (let i = 0; i < current.length; i += 1) {
    const a = current[i];
    const klass = classFor(a);
    if (!klass) {
      violations.push(violation(null, `Assignment ${a.id} references a missing class session.`, [a], [a.sessionId]));
      continue;
    }
    if (!teachers.has(a.teacherId)) violations.push(violation(null, `${klass.name} references a missing teacher.`, [a], [a.teacherId]));
    if (!rooms.has(a.roomId)) violations.push(violation(null, `${klass.name} references a missing room.`, [a], [a.roomId]));
    if (minutes(a.endTime) - minutes(a.startTime) !== klass.durationMinutes) {
      violations.push(violation(null, `${klass.name} must be ${klass.durationMinutes} minutes.`, [a], [klass.id]));
    }
    if (!klass.eligibleTeacherIds.includes(a.teacherId)) {
      violations.push(violation(null, `${teachers.get(a.teacherId)?.name || a.teacherId} is not an eligible teacher for ${klass.name}.`, [a], [a.teacherId, klass.id]));
    }

    for (let j = i + 1; j < current.length; j += 1) {
      const b = current[j];
      if (!overlaps(a, b)) continue;
      if (a.roomId === b.roomId) violations.push(violation(null, `${rooms.get(a.roomId)?.name || a.roomId} is double-booked.`, [a, b], [a.roomId]));
      if (a.teacherId === b.teacherId) violations.push(violation(null, `${teachers.get(a.teacherId)?.name || a.teacherId} is double-booked.`, [a, b], [a.teacherId]));
      const classB = classFor(b);
      if (classB) {
        const shared = klass.rosterStudentIds.filter((id) => classB.rosterStudentIds.includes(id));
        if (shared.length) violations.push(violation(null, `${shared.length} dancer${shared.length === 1 ? "" : "s"} would be double-booked between ${klass.name} and ${classB.name}.`, [a, b], shared));
      }
    }
  }

  const activeRules = state.rules.filter((rule) => rule.status === "ACTIVE");
  for (const rule of activeRules) {
    if (rule.type === "REQUIRED_ROOM") {
      for (const a of current) {
        const klass = classFor(a);
        if (!klass || !appliesToClass(rule, klass)) continue;
        const required = p<string>(rule, "required_room_id", "");
        if (required && a.roomId !== required) violations.push(violation(rule, `${klass.name} requires ${rooms.get(required)?.name || required}.`, [a], [klass.id, required]));
      }
    }

    if (rule.type === "TEACHER_QUALIFICATION") {
      const teacherId = p<string>(rule, "teacher_id", "");
      const prohibitedSubjects = p<string[]>(rule, "prohibited_subjects", []);
      const prohibitedLevels = p<string[]>(rule, "prohibited_levels", []);
      for (const a of current.filter((item) => item.teacherId === teacherId)) {
        const klass = classFor(a);
        if (klass && (prohibitedSubjects.includes(klass.subject) || prohibitedLevels.includes(klass.level))) {
          violations.push(violation(rule, `${teachers.get(teacherId)?.name || teacherId} cannot teach ${klass.name}.`, [a], [teacherId, klass.id]));
        }
      }
    }

    if (rule.type === "TEACHER_UNAVAILABLE") {
      const teacherId = p<string>(rule, "teacher_id", "");
      const day = p<string>(rule, "day", "");
      for (const a of current.filter((item) => item.teacherId === teacherId && item.day === day)) violations.push(violation(rule, `${teachers.get(teacherId)?.name || teacherId} is unavailable ${day}.`, [a], [teacherId]));
    }

    if (rule.type === "TEACHER_AVAILABLE_WINDOW") {
      const teacherId = p<string>(rule, "teacher_id", "");
      const day = p<string>(rule, "day", "");
      const start = minutes(p<string>(rule, "start", "00:00"));
      const end = minutes(p<string>(rule, "end", "23:59"));
      for (const a of current.filter((item) => item.teacherId === teacherId)) {
        if (a.day !== day || minutes(a.startTime) < start || minutes(a.endTime) > end) violations.push(violation(rule, `${teachers.get(teacherId)?.name || teacherId} is outside the available ${day} window.`, [a], [teacherId]));
      }
    }

    if (rule.type === "REQUIRED_TEACHER") {
      const classId = p<string>(rule, "class_id", "");
      const teacherId = p<string>(rule, "teacher_id", "");
      for (const a of current) {
        const klass = classFor(a);
        if (klass?.id === classId && a.teacherId !== teacherId) violations.push(violation(rule, `${klass.name} requires ${teachers.get(teacherId)?.name || teacherId}.`, [a], [classId, teacherId]));
      }
    }

    if (rule.type === "MAX_TEACHER_WORKDAYS") {
      const teacherId = p<string>(rule, "teacher_id", "");
      const maxDays = Number(p(rule, "max_days", 0));
      const days = new Set(current.filter((a) => a.teacherId === teacherId).map((a) => a.day));
      if (maxDays && days.size > maxDays) violations.push(violation(rule, `${teachers.get(teacherId)?.name || teacherId} is scheduled on ${days.size} days; maximum is ${maxDays}.`, current.filter((a) => a.teacherId === teacherId), [teacherId]));
    }

    if (rule.type === "MAX_TEACHER_GAP") {
      const maxGap = Number(p(rule, "minutes", 60));
      for (const teacher of state.teachers) {
        for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const) {
          const list = current.filter((a) => a.teacherId === teacher.id && a.day === day).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
          for (let i = 1; i < list.length; i += 1) if (minutes(list[i].startTime) - minutes(list[i - 1].endTime) > maxGap) violations.push(violation(rule, `${teacher.name} has a gap longer than ${maxGap} minutes on ${day}.`, [list[i - 1], list[i]], [teacher.id]));
        }
      }
    }

    if (rule.type === "MAX_STUDENT_GAP") {
      const maxGap = Number(p(rule, "minutes", 60));
      for (const student of state.students) {
        for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const) {
          const list = current.filter((a) => a.day === day && (classFor(a)?.rosterStudentIds || []).includes(student.id)).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
          for (let i = 1; i < list.length; i += 1) if (minutes(list[i].startTime) - minutes(list[i - 1].endTime) > maxGap) violations.push(violation(rule, `${student.name} has a gap longer than ${maxGap} minutes on ${day}.`, [list[i - 1], list[i]], [student.id]));
        }
      }
    }

    if (rule.type === "LATEST_FINISH" || rule.type === "EARLIEST_START") {
      const limit = minutes(p<string>(rule, "time", rule.type === "LATEST_FINISH" ? "23:59" : "00:00"));
      for (const a of current) {
        const klass = classFor(a);
        if (!klass || !appliesToClass(rule, klass)) continue;
        if (rule.type === "LATEST_FINISH" && minutes(a.endTime) > limit) violations.push(violation(rule, `${klass.name} ends after ${p<string>(rule, "time", "")}.`, [a], [klass.id]));
        if (rule.type === "EARLIEST_START" && minutes(a.startTime) < limit) violations.push(violation(rule, `${klass.name} starts before ${p<string>(rule, "time", "")}.`, [a], [klass.id]));
      }
    }

    if (rule.type === "NO_DAY") {
      const day = p<string>(rule, "day", "");
      for (const a of current.filter((item) => item.day === day)) {
        const klass = classFor(a);
        if (klass && appliesToClass(rule, klass)) violations.push(violation(rule, `${klass.name} cannot be scheduled on ${day}.`, [a], [klass.id]));
      }
    }

    if (rule.type === "DIRECTLY_AFTER") {
      const beforeId = p<string>(rule, "before_class_id", "");
      const afterId = p<string>(rule, "after_class_id", "");
      const before = current.filter((a) => classFor(a)?.id === beforeId);
      const after = current.filter((a) => classFor(a)?.id === afterId);
      for (const a of before) {
        const match = after.find((b) => b.day === a.day && minutes(b.startTime) === minutes(a.endTime));
        if (!match) violations.push(violation(rule, `${classes.get(afterId)?.name || afterId} must be directly after ${classes.get(beforeId)?.name || beforeId}.`, [a], [beforeId, afterId]));
      }
    }

    if (rule.type === "ROOM_CAPACITY") {
      const roomId = p<string>(rule, "room_id", "");
      const capacity = Number(p(rule, "capacity", rooms.get(roomId)?.capacity || 0));
      for (const a of current.filter((item) => item.roomId === roomId)) {
        const klass = classFor(a);
        if (klass && capacity && klass.rosterStudentIds.length > capacity && !exceptionMatches(rule, klass)) violations.push(violation(rule, `${klass.name} exceeds ${rooms.get(roomId)?.name || roomId} capacity of ${capacity}.`, [a], [roomId, klass.id]));
      }
    }

    if (rule.type === "MAX_STUDENT_ATTENDANCE_DAYS" || rule.type === "MIN_STUDENT_ATTENDANCE_DAYS") {
      const target = Number(p(rule, "days", 0));
      for (const student of state.students) {
        const list = current.filter((a) => (classFor(a)?.rosterStudentIds || []).includes(student.id));
        const count = new Set(list.map((a) => a.day)).size;
        if (rule.type === "MAX_STUDENT_ATTENDANCE_DAYS" && target && count > target) violations.push(violation(rule, `${student.name} attends ${count} days; maximum is ${target}.`, list, [student.id]));
        if (rule.type === "MIN_STUDENT_ATTENDANCE_DAYS" && target && count < target) violations.push(violation(rule, `${student.name} attends ${count} days; minimum is ${target}.`, list, [student.id]));
      }
    }

    if (rule.type === "RELATIONSHIP_ARRIVAL_WINDOW") {
      const teacherId = p<string>(rule, "teacher_id", "");
      const studentId = p<string>(rule, "student_id", "");
      const allowed = Number(p(rule, "minutes", 0));
      for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const) {
        const teacherList = current.filter((a) => a.day === day && a.teacherId === teacherId).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
        const studentList = current.filter((a) => a.day === day && (classFor(a)?.rosterStudentIds || []).includes(studentId)).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
        if (teacherList.length && studentList.length && minutes(teacherList[0].startTime) < minutes(studentList[0].startTime) - allowed) violations.push(violation(rule, `Arrival timing for ${teachers.get(teacherId)?.name || teacherId} and the linked dancer exceeds the ${allowed}-minute window.`, [teacherList[0], studentList[0]], [teacherId, studentId]));
      }
    }
  }

  const hardViolations = violations.filter((item) => item.severity === "HARD").length;
  return { valid: hardViolations === 0, hardViolations, warnings: violations.length - hardViolations, violations };
}

export function applyAssignmentChanges(assignments: Assignment[], assignmentId: string, changes: Partial<Assignment>) {
  return assignments.map((item) => item.id === assignmentId ? { ...item, ...changes } : item);
}

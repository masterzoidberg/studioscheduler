import type {
  Assignment,
  ClassDefinition,
  RuleEnforcementMapping,
  RuleEnforcementVersion,
  RuleStrength,
  StudioRule,
  StudioState,
  ValidationResult,
  ValidationViolation,
} from "@/lib/domain";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function minutes(value: string) {
  const [h = "0", m = "0"] = value.slice(0, 5).split(":");
  return Number(h) * 60 + Number(m);
}

function overlaps(a: Assignment, b: Assignment) {
  return a.day === b.day && minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime);
}

function parameter<T>(mapping: RuleEnforcementMapping, key: string, fallback: T): T {
  const value = mapping.parameters[key];
  return (value === undefined ? fallback : value) as T;
}

export function ruleClassification(rule: StudioRule) {
  return rule.classificationRaw ?? rule.strength?.replaceAll("_", " ") ?? "UNCLASSIFIED";
}

function severity(rule: StudioRule | null): RuleStrength {
  if (!rule) return "HARD";
  if (rule.strength) return rule.strength;
  const raw = ruleClassification(rule).toUpperCase();
  if (raw === "HARD" || raw === "HARD ASSUMPTION") return "HARD";
  if (raw === "VERY STRONG") return "VERY_STRONG";
  if (raw === "LIGHT") return "LIGHT";
  if (raw === "BASELINE") return "BASELINE";
  return "MODERATE";
}

function violation(rule: StudioRule | null, message: string, assignments: Assignment[], entities: string[] = []): ValidationViolation {
  return {
    constraintId: rule?.id || "SYSTEM",
    severity: severity(rule),
    message,
    affectedEntityIds: entities,
    assignmentIds: assignments.map((item) => item.id),
  };
}

function mappingAppliesToClass(mapping: RuleEnforcementMapping, klass: ClassDefinition) {
  return mapping.affectedEntityIds.length === 0 || mapping.affectedEntityIds.includes(klass.id);
}

function dayApplies(mapping: RuleEnforcementMapping, day: Assignment["day"]) {
  const days = parameter<string[]>(mapping, "days", []);
  return days.length === 0 || days.includes(day);
}

function emptyCoverage() {
  return {
    applicableHardRules: 0,
    implementedHardRules: 0,
    partialHardRules: 0,
    notImplementedHardRules: 0,
    notApplicableHardRules: 0,
    uncoveredHardRuleIds: [] as string[],
  };
}

export function emptyValidation(): ValidationResult {
  return { valid: true, fullyValidated: true, hardViolations: 0, warnings: 0, violations: [], coverage: emptyCoverage() };
}

export function currentEnforcementVersion(state: StudioState): RuleEnforcementVersion | null {
  return state.enforcementVersions.find((version) => version.status === "CURRENT") ?? state.enforcementVersions[0] ?? null;
}

export function enforcementMappingForRule(state: StudioState, ruleId: string): RuleEnforcementMapping | null {
  return currentEnforcementVersion(state)?.snapshot.find((mapping) => mapping.ruleId === ruleId) ?? null;
}

export function validateSchedule(state: StudioState, assignments?: Assignment[]): ValidationResult {
  const currentSchedule = state.scheduleVersions.find((version) => version.isCurrent)
    ?? state.scheduleVersions.find((item) => item.version === Math.max(0, ...state.scheduleVersions.map((version) => version.version)));
  const current = assignments ?? currentSchedule?.assignments ?? [];
  const enforcement = currentEnforcementVersion(state);
  const mappings = enforcement?.snapshot ?? [];
  const violations: ValidationViolation[] = [];
  const classes = new Map(state.classes.map((item) => [item.id, item]));
  const sessions = new Map(state.sessions.map((item) => [item.id, item]));
  const teachers = new Map(state.teachers.map((item) => [item.id, item]));
  const rooms = new Map(state.rooms.map((item) => [item.id, item]));
  const rules = new Map(state.rules.map((item) => [item.id, item]));
  const classFor = (assignment: Assignment) => classes.get(sessions.get(assignment.sessionId)?.classId || "");

  // Referential-integrity failures are system failures, not inferred Rulebook mappings.
  for (const assignment of current) {
    const klass = classFor(assignment);
    if (!klass) {
      violations.push(violation(null, `Assignment ${assignment.id} references a missing class session.`, [assignment], [assignment.sessionId]));
      continue;
    }
    if (!teachers.has(assignment.teacherId)) violations.push(violation(null, `${klass.name} references a missing teacher.`, [assignment], [assignment.teacherId]));
    if (!rooms.has(assignment.roomId)) violations.push(violation(null, `${klass.name} references a missing room.`, [assignment], [assignment.roomId]));
  }

  for (const mapping of mappings) {
    const rule = rules.get(mapping.ruleId) ?? null;
    if (!rule || rule.status !== "ACTIVE" || ruleClassification(rule).toUpperCase() !== "HARD") continue;

    if (mapping.type === "CLASS_DURATION") {
      for (const assignment of current) {
        const klass = classFor(assignment);
        if (klass && minutes(assignment.endTime) - minutes(assignment.startTime) !== klass.durationMinutes) {
          violations.push(violation(rule, `${klass.name} must preserve its ${klass.durationMinutes}-minute curriculum duration.`, [assignment], [klass.id]));
        }
      }
    }

    if (mapping.type === "TIME_GRID") {
      for (const assignment of current) {
        const klass = classFor(assignment);
        if (klass && (minutes(assignment.startTime) % 15 !== 0 || minutes(assignment.endTime) % 15 !== 0)) {
          violations.push(violation(rule, `${klass.name} must start and end on the 15-minute scheduling grid.`, [assignment], [klass.id]));
        }
      }
    }

    if (mapping.type === "ROOM_NO_OVERLAP" || mapping.type === "TEACHER_NO_OVERLAP" || mapping.type === "STUDENT_NO_OVERLAP") {
      for (let i = 0; i < current.length; i += 1) {
        const a = current[i];
        const classA = classFor(a);
        if (!classA) continue;
        for (let j = i + 1; j < current.length; j += 1) {
          const b = current[j];
          if (!overlaps(a, b)) continue;
          if (mapping.type === "ROOM_NO_OVERLAP" && a.roomId === b.roomId) {
            violations.push(violation(rule, `${rooms.get(a.roomId)?.name || a.roomId} is double-booked.`, [a, b], [a.roomId]));
          }
          if (mapping.type === "TEACHER_NO_OVERLAP" && a.teacherId === b.teacherId) {
            violations.push(violation(rule, `${teachers.get(a.teacherId)?.name || a.teacherId} is double-booked.`, [a, b], [a.teacherId]));
          }
          if (mapping.type === "STUDENT_NO_OVERLAP") {
            const classB = classFor(b);
            if (!classB) continue;
            const shared = classA.rosterStudentIds.filter((id) => classB.rosterStudentIds.includes(id));
            if (shared.length) violations.push(violation(rule, `${shared.length} dancer${shared.length === 1 ? "" : "s"} would be double-booked between ${classA.name} and ${classB.name}.`, [a, b], shared));
          }
        }
      }
    }

    if (mapping.type === "CLASS_FREQUENCY") {
      for (const klass of state.classes) {
        const assignmentList = current.filter((assignment) => classFor(assignment)?.id === klass.id);
        if (assignmentList.length !== klass.weeklyFrequency) {
          violations.push(violation(rule, `${klass.name} has ${assignmentList.length} scheduled weekly session(s); curriculum frequency is ${klass.weeklyFrequency}.`, assignmentList, [klass.id]));
        }
      }
    }

    if (mapping.type === "EARLIEST_START" || mapping.type === "LATEST_FINISH") {
      const limitText = parameter<string>(mapping, "time", mapping.type === "LATEST_FINISH" ? "23:59" : "00:00");
      const limit = minutes(limitText);
      for (const assignment of current) {
        const klass = classFor(assignment);
        if (!klass || !dayApplies(mapping, assignment.day) || !mappingAppliesToClass(mapping, klass)) continue;
        if (mapping.type === "EARLIEST_START" && minutes(assignment.startTime) < limit) {
          violations.push(violation(rule, `${klass.name} starts before ${limitText}.`, [assignment], [klass.id]));
        }
        if (mapping.type === "LATEST_FINISH" && minutes(assignment.endTime) > limit) {
          violations.push(violation(rule, `${klass.name} ends after ${limitText}.`, [assignment], [klass.id]));
        }
      }
    }

    if (mapping.type === "NO_DAY") {
      const prohibitedDays = parameter<string[]>(mapping, "days", []);
      for (const assignment of current) {
        const klass = classFor(assignment);
        if (klass && prohibitedDays.includes(assignment.day) && mappingAppliesToClass(mapping, klass)) {
          violations.push(violation(rule, `${klass.name} cannot be scheduled on ${assignment.day}.`, [assignment], [klass.id]));
        }
      }
    }

    if (mapping.type === "MAX_TEACHER_GAP") {
      const maxGap = Number(parameter(mapping, "minutes", 60));
      const targetTeacher = parameter<string>(mapping, "teacher_id", "");
      for (const teacher of state.teachers.filter((item) => !targetTeacher || item.id === targetTeacher)) {
        for (const day of DAYS) {
          const list = current.filter((assignment) => assignment.teacherId === teacher.id && assignment.day === day)
            .sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
          for (let i = 1; i < list.length; i += 1) {
            if (minutes(list[i].startTime) - minutes(list[i - 1].endTime) > maxGap) {
              violations.push(violation(rule, `${teacher.name} has a gap longer than ${maxGap} minutes on ${day}.`, [list[i - 1], list[i]], [teacher.id]));
            }
          }
        }
      }
    }

    if (mapping.type === "MAX_STUDENT_GAP") {
      const maxGap = Number(parameter(mapping, "minutes", 60));
      for (const student of state.students) {
        for (const day of DAYS) {
          const list = current.filter((assignment) => assignment.day === day && (classFor(assignment)?.rosterStudentIds || []).includes(student.id))
            .sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
          for (let i = 1; i < list.length; i += 1) {
            if (minutes(list[i].startTime) - minutes(list[i - 1].endTime) > maxGap) {
              violations.push(violation(rule, `${student.name} has a gap longer than ${maxGap} minutes on ${day}.`, [list[i - 1], list[i]], [student.id]));
            }
          }
        }
      }
    }

    if (mapping.type === "MAX_TEACHER_WORKDAYS") {
      const teacherId = parameter<string>(mapping, "teacher_id", "");
      const maxDays = Number(parameter(mapping, "max_days", 0));
      const list = current.filter((assignment) => assignment.teacherId === teacherId);
      const count = new Set(list.map((assignment) => assignment.day)).size;
      if (teacherId && maxDays && count > maxDays) {
        violations.push(violation(rule, `${teachers.get(teacherId)?.name || teacherId} is scheduled on ${count} days; maximum is ${maxDays}.`, list, [teacherId]));
      }
    }

    if (mapping.type === "REQUIRED_ROOM") {
      const roomId = parameter<string>(mapping, "required_room_id", "");
      for (const assignment of current) {
        const klass = classFor(assignment);
        if (klass && mapping.affectedEntityIds.includes(klass.id) && roomId && assignment.roomId !== roomId) {
          violations.push(violation(rule, `${klass.name} requires ${rooms.get(roomId)?.name || roomId}.`, [assignment], [klass.id, roomId]));
        }
      }
    }

    if (mapping.type === "REQUIRED_TEACHER") {
      const teacherId = parameter<string>(mapping, "teacher_id", "");
      for (const assignment of current) {
        const klass = classFor(assignment);
        if (klass && mapping.affectedEntityIds.includes(klass.id) && teacherId && assignment.teacherId !== teacherId) {
          violations.push(violation(rule, `${klass.name} requires ${teachers.get(teacherId)?.name || teacherId}.`, [assignment], [klass.id, teacherId]));
        }
      }
    }
  }

  const activeHardRules = state.rules.filter((rule) => rule.status === "ACTIVE" && ruleClassification(rule).toUpperCase() === "HARD");
  const activeHardIds = new Set(activeHardRules.map((rule) => rule.id));
  const implementedIds = [...new Set(mappings.map((mapping) => mapping.ruleId))].filter((id) => activeHardIds.has(id));
  const implementedSet = new Set(implementedIds);
  const uncovered = activeHardRules.map((rule) => rule.id).filter((id) => !implementedSet.has(id));
  const coverage = {
    applicableHardRules: activeHardRules.length,
    implementedHardRules: implementedIds.length,
    partialHardRules: 0,
    notImplementedHardRules: uncovered.length,
    notApplicableHardRules: 0,
    uncoveredHardRuleIds: uncovered,
  };
  const hardViolations = violations.filter((item) => item.severity === "HARD").length;
  const valid = hardViolations === 0;
  return {
    valid,
    fullyValidated: valid && uncovered.length === 0,
    hardViolations,
    warnings: violations.length - hardViolations,
    violations,
    coverage,
    enforcementVersion: enforcement?.version,
  };
}

export function applyAssignmentChanges(assignments: Assignment[], assignmentId: string, changes: Partial<Assignment>) {
  return assignments.map((item) => item.id === assignmentId ? { ...item, ...changes } : item);
}

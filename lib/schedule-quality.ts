import type { ConstraintModelSnapshotV1, ObjectivePriorityIR, ObjectiveStrengthTier } from "@/lib/constraint-ir";
import type { Assignment, Day, StudioState } from "@/lib/domain";
import { SCHEDULE_DAYS } from "@/lib/domain";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";

export type ScheduleQualityMetric =
  | "preferredDayMatches"
  | "avoidedDayAssignments"
  | "teacherGapMinutes"
  | "studentAttendanceDays"
  | "preferredTeacherMatches"
  | "preferredRoomMatches";

export type ScheduleQualityUnit = "minutes" | "days" | "count";
export type ScheduleQualityDirection = "MAXIMIZE" | "MINIMIZE";

export interface ScheduleQualityComponent {
  metric: ScheduleQualityMetric;
  unit: ScheduleQualityUnit;
  direction: ScheduleQualityDirection;
  value: number;
  label: string;
  ruleId?: string;
  entityIds: string[];
}

export interface ScheduleQualityTier {
  rank: number;
  ruleId: string;
  title: string;
  strength: ObjectiveStrengthTier;
  components: ScheduleQualityComponent[];
}

export interface ScheduleQualityBreakdown {
  preferredDayMatches: number;
  avoidedDayAssignments: number;
  teacherGapMinutes: number;
  studentAttendanceDays: number;
  preferredTeacherMatches: number;
  preferredRoomMatches: number;
}

export interface ScheduleQualityReport {
  status: "FEASIBLE" | "INFEASIBLE";
  comparable: boolean;
  hardViolations: number;
  unsupportedConstraintIds: string[];
  breakdown: ScheduleQualityBreakdown;
  metrics: ScheduleQualityComponent[];
  tiers: ScheduleQualityTier[];
  explanations: string[];
  warnings: string[];
}

export type ScheduleQualityComparison = "IMPROVED" | "UNCHANGED" | "WORSE_THAN_BASELINE" | "NOT_COMPARABLE";

const compareCanonicalStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const STRENGTH_ORDER: ObjectiveStrengthTier[] = ["VERY_STRONG", "MODERATE", "LIGHT", "BASELINE"];
const SUPPORTED_PREFERENCE_KINDS = new Set<NonNullable<ObjectivePriorityIR["kind"]>>([
  "PREFERRED_TEACHER",
  "PREFERRED_ROOM",
  "PREFERRED_DAY",
  "AVOID_DAY",
]);

const METRIC_DEFINITIONS: Record<ScheduleQualityMetric, {
  unit: ScheduleQualityUnit;
  direction: ScheduleQualityDirection;
  label: string;
}> = {
  preferredDayMatches: { unit: "days", direction: "MAXIMIZE", label: "Preferred day matches" },
  avoidedDayAssignments: { unit: "days", direction: "MINIMIZE", label: "Avoided-day assignments" },
  teacherGapMinutes: { unit: "minutes", direction: "MINIMIZE", label: "Teacher gap minutes" },
  studentAttendanceDays: { unit: "days", direction: "MINIMIZE", label: "Student attendance days" },
  preferredTeacherMatches: { unit: "count", direction: "MAXIMIZE", label: "Preferred teacher matches" },
  preferredRoomMatches: { unit: "count", direction: "MAXIMIZE", label: "Preferred room matches" },
};

function minutes(value: string) {
  const [hours = "0", minute = "0"] = value.slice(0, 5).split(":");
  const result = Number(hours) * 60 + Number(minute);
  return Number.isFinite(result) ? result : Number.NaN;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function formatUnit(value: number, unit: ScheduleQualityUnit) {
  if (unit === "minutes") return `${value} minute${value === 1 ? "" : "s"}`;
  if (unit === "days") return `${value} day${value === 1 ? "" : "s"}`;
  return `${value} count${value === 1 ? "" : "s"}`;
}

function component(
  metric: ScheduleQualityMetric,
  value: number,
  entityIds: string[],
  ruleId?: string,
): ScheduleQualityComponent {
  const definition = METRIC_DEFINITIONS[metric];
  return {
    metric,
    unit: definition.unit,
    direction: definition.direction,
    value,
    label: `${definition.label}: ${formatUnit(value, definition.unit)}`,
    ...(ruleId ? { ruleId } : {}),
    entityIds: uniqueSorted(entityIds),
  };
}

function classIdsFor(objective: ObjectivePriorityIR) {
  const ids = objective.selector?.classIds;
  return Array.isArray(ids) ? uniqueSorted(ids) : [];
}

function stringParameter(objective: ObjectivePriorityIR, key: string, selectorValues?: string[]) {
  const parameter = objective.parameters?.[key];
  if (typeof parameter === "string" && parameter.trim()) return parameter;
  return selectorValues?.length === 1 ? selectorValues[0] : null;
}

function daysParameter(objective: ObjectivePriorityIR): Day[] {
  const days = objective.parameters?.days;
  return Array.isArray(days) && days.length > 0 && days.every((day) => SCHEDULE_DAYS.includes(day as Day))
    ? days as Day[]
    : [];
}

function strengthFor(objective: ObjectivePriorityIR): ObjectiveStrengthTier {
  return objective.strength && STRENGTH_ORDER.includes(objective.strength) ? objective.strength : "BASELINE";
}

function preferenceComponent(
  state: StudioState,
  assignments: Assignment[],
  objective: ObjectivePriorityIR,
  classesBySession: Map<string, StudioState["classes"][number]>,
): { component: ScheduleQualityComponent | null; warning?: string } {
  const kind = objective.kind;
  if (!kind || !SUPPORTED_PREFERENCE_KINDS.has(kind)) return {
    component: null,
    warning: `Objective ${objective.ruleId} has an unsupported or missing typed preference kind; no preference score was invented.`,
  };

  const classIds = classIdsFor(objective);
  if (!classIds.length || classIds.some((classId) => !state.classes.some((klass) => klass.id === classId))) return {
    component: null,
    warning: `Preference ${objective.ruleId} has no complete current class-ID binding; no preference contribution was scored.`,
  };

  const selected = assignments.filter((assignment) => classIds.includes(classesBySession.get(assignment.sessionId)?.id || ""));
  switch (kind) {
    case "PREFERRED_DAY": {
      const days = daysParameter(objective);
      if (!days.length) return { component: null, warning: `Preference ${objective.ruleId} has no valid typed day list; no preference contribution was scored.` };
      return { component: component("preferredDayMatches", selected.filter((assignment) => days.includes(assignment.day)).length, classIds, objective.ruleId) };
    }
    case "AVOID_DAY": {
      const days = daysParameter(objective);
      if (!days.length) return { component: null, warning: `Preference ${objective.ruleId} has no valid typed day list; no preference contribution was scored.` };
      return { component: component("avoidedDayAssignments", selected.filter((assignment) => days.includes(assignment.day)).length, classIds, objective.ruleId) };
    }
    case "PREFERRED_TEACHER": {
      const teacherId = stringParameter(objective, "teacherId", objective.selector?.teacherIds);
      if (!teacherId || !state.teachers.some((teacher) => teacher.id === teacherId)) return { component: null, warning: `Preference ${objective.ruleId} has no complete current teacher-ID binding; no preference contribution was scored.` };
      return { component: component("preferredTeacherMatches", selected.filter((assignment) => assignment.teacherId === teacherId).length, [teacherId, ...classIds], objective.ruleId) };
    }
    case "PREFERRED_ROOM": {
      const roomId = stringParameter(objective, "roomId", objective.selector?.roomIds);
      if (!roomId || !state.rooms.some((room) => room.id === roomId)) return { component: null, warning: `Preference ${objective.ruleId} has no complete current room-ID binding; no preference contribution was scored.` };
      return { component: component("preferredRoomMatches", selected.filter((assignment) => assignment.roomId === roomId).length, [roomId, ...classIds], objective.ruleId) };
    }
  }
}

function genericMetrics(state: StudioState, assignments: Assignment[], classesBySession: Map<string, StudioState["classes"][number]>) {
  const metrics: ScheduleQualityComponent[] = [];
  const teacherIds = [...state.teachers].sort((left, right) => compareCanonicalStrings(left.id, right.id)).map((teacher) => teacher.id);
  for (const teacherId of teacherIds) {
    for (const day of SCHEDULE_DAYS) {
      const daily = assignments
        .filter((assignment) => assignment.teacherId === teacherId && assignment.day === day)
        .sort((left, right) => minutes(left.startTime) - minutes(right.startTime) || minutes(left.endTime) - minutes(right.endTime) || compareCanonicalStrings(left.id, right.id));
      for (let index = 1; index < daily.length; index += 1) {
        const gap = minutes(daily[index].startTime) - minutes(daily[index - 1].endTime);
        if (Number.isFinite(gap) && gap > 0) metrics.push(component("teacherGapMinutes", gap, [teacherId, day]));
      }
    }
  }

  const rosterByStudent = new Map<string, Set<Day>>();
  for (const assignment of assignments) {
    const klass = classesBySession.get(assignment.sessionId);
    for (const studentId of klass?.rosterStudentIds || []) {
      const days = rosterByStudent.get(studentId) || new Set<Day>();
      days.add(assignment.day);
      rosterByStudent.set(studentId, days);
    }
  }
  for (const [studentId, days] of [...rosterByStudent.entries()].sort(([left], [right]) => compareCanonicalStrings(left, right))) {
    metrics.push(component("studentAttendanceDays", days.size, [studentId]));
  }
  return metrics;
}

function breakdownFrom(components: ScheduleQualityComponent[]): ScheduleQualityBreakdown {
  return components.reduce<ScheduleQualityBreakdown>((totals, item) => {
    totals[item.metric] += item.value;
    return totals;
  }, {
    preferredDayMatches: 0,
    avoidedDayAssignments: 0,
    teacherGapMinutes: 0,
    studentAttendanceDays: 0,
    preferredTeacherMatches: 0,
    preferredRoomMatches: 0,
  });
}

export function scoreScheduleQuality(
  state: StudioState,
  model: ConstraintModelSnapshotV1,
  assignments: Assignment[],
): ScheduleQualityReport {
  const classesBySession = new Map(state.sessions.map((session) => [session.id, state.classes.find((klass) => klass.id === session.classId)] as const).filter((entry): entry is readonly [string, StudioState["classes"][number]] => Boolean(entry[1])));
  const metrics = genericMetrics(state, assignments, classesBySession);
  const warnings: string[] = [];
  const tiers: ScheduleQualityTier[] = [];
  const objectives = [...model.objectivePrioritySpine]
    .sort((left, right) => left.rank - right.rank
      || STRENGTH_ORDER.indexOf(strengthFor(left)) - STRENGTH_ORDER.indexOf(strengthFor(right))
      || compareCanonicalStrings(left.ruleId, right.ruleId));

  for (const objective of objectives) {
    if (!objective.kind) {
      warnings.push(`Objective ${objective.ruleId} has no explicit typed preference record; no preference score was invented from its title or description.`);
      continue;
    }
    if (objective.scoringEnabled === false) {
      warnings.push(`Preference ${objective.ruleId} is recorded but scoring is disabled; no preference contribution was scored.`);
      continue;
    }
    const scored = preferenceComponent(state, assignments, objective, classesBySession);
    if (scored.warning) {
      warnings.push(scored.warning);
      continue;
    }
    if (!scored.component) continue;
    tiers.push({
      rank: objective.rank,
      ruleId: objective.ruleId,
      title: objective.title,
      strength: strengthFor(objective),
      components: [scored.component],
    });
  }

  const validation = validateConstraintModelSchedule(state, model, assignments);
  const complete = model.completeHardConstraintCompilation && validation.valid;
  if (!complete) warnings.push("HARD feasibility failed; this breakdown is diagnostic only and cannot rank or adopt the schedule.");
  if (!model.completeHardConstraintCompilation) warnings.push("The Constraint Model is incomplete; quality scoring cannot establish an acceptable schedule.");
  if (validation.unsupportedConstraintIds.length) warnings.push(`Unsupported HARD constraints: ${validation.unsupportedConstraintIds.join(", ")}.`);

  const allComponents = [...metrics, ...tiers.flatMap((tier) => tier.components)];
  const breakdown = breakdownFrom(allComponents);
  const explanations = (Object.keys(METRIC_DEFINITIONS) as ScheduleQualityMetric[]).map((metric) => {
    const definition = METRIC_DEFINITIONS[metric];
    return `${definition.label}: ${formatUnit(breakdown[metric], definition.unit)}`;
  });

  return {
    status: complete ? "FEASIBLE" : "INFEASIBLE",
    comparable: complete,
    hardViolations: validation.hardViolations,
    unsupportedConstraintIds: [...validation.unsupportedConstraintIds].sort(compareCanonicalStrings),
    breakdown,
    metrics,
    tiers,
    explanations,
    warnings: uniqueSorted(warnings),
  };
}

export function compareScheduleQuality(
  candidate: ScheduleQualityReport,
  baseline: ScheduleQualityReport,
): ScheduleQualityComparison {
  if (!candidate.comparable || !baseline.comparable) return "NOT_COMPARABLE";
  if (candidate.tiers.length !== baseline.tiers.length) return "NOT_COMPARABLE";

  for (let index = 0; index < candidate.tiers.length; index += 1) {
    const candidateTier = candidate.tiers[index];
    const baselineTier = baseline.tiers[index];
    if (!candidateTier || !baselineTier
      || candidateTier.rank !== baselineTier.rank
      || candidateTier.ruleId !== baselineTier.ruleId
      || candidateTier.strength !== baselineTier.strength
      || candidateTier.components.length !== baselineTier.components.length) {
      return "NOT_COMPARABLE";
    }
    for (let componentIndex = 0; componentIndex < candidateTier.components.length; componentIndex += 1) {
      const candidateComponent = candidateTier.components[componentIndex];
      const baselineComponent = baselineTier.components[componentIndex];
      if (!candidateComponent || !baselineComponent
        || candidateComponent.metric !== baselineComponent.metric
        || candidateComponent.direction !== baselineComponent.direction) {
        return "NOT_COMPARABLE";
      }
      if (candidateComponent.value === baselineComponent.value) continue;
      const improved = candidateComponent.direction === "MAXIMIZE"
        ? candidateComponent.value > baselineComponent.value
        : candidateComponent.value < baselineComponent.value;
      return improved ? "IMPROVED" : "WORSE_THAN_BASELINE";
    }
  }
  return "UNCHANGED";
}

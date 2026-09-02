import { describe, expect, it } from "vitest";
import type { Assignment, ClassDefinition, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";

const now = "2026-09-02T00:00:00Z";

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [
      { id: "teacher-aimee", name: "Aimee", subjects: [] },
      { id: "teacher-cami", name: "Cami", subjects: [] },
      { id: "teacher-new", name: "New Teacher", subjects: [] },
      { id: "teacher-karly", name: "Karly", subjects: [] },
    ],
    rooms: [
      { id: "room-a", name: "Studio A", capacity: 30, features: [] },
      { id: "room-c", name: "Studio C", capacity: 15, features: [] },
    ],
    students: [
      { id: "student-1", name: "Dancer 1", level: "Level 5", cohortIds: [] },
      { id: "student-2", name: "Dancer 2", level: "Level 5", cohortIds: [] },
    ],
    cohorts: [],
    classes: [],
    sessions: [],
    rules: [],
    rulebookVersions: [{ id: "rb3", version: 3, name: "Rulebook v3", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
    planningDatasetVersions: [],
  };
}

function addClass(s: StudioState, klass: ClassDefinition) {
  s.classes.push(klass);
  for (let ordinal = 1; ordinal <= klass.weeklyFrequency; ordinal += 1) {
    s.sessions.push({ id: `session-${klass.id}-${ordinal}`, classId: klass.id, ordinal });
  }
}

function assignment(s: StudioState, classId: string, values: Partial<Assignment> = {}): Assignment {
  const klass = s.classes.find((item) => item.id === classId)!;
  const session = s.sessions.find((item) => item.classId === classId)!;
  const start = values.startTime || "16:45";
  const duration = klass.durationMinutes;
  const [hour, minute] = start.split(":").map(Number);
  const endMinutes = hour * 60 + minute + duration;
  return {
    id: values.id || `assignment-${classId}`,
    sessionId: session.id,
    day: values.day || "Monday",
    startTime: start,
    endTime: values.endTime || `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
    teacherId: values.teacherId || "teacher-aimee",
    roomId: values.roomId || "room-a",
  };
}

function model(nodes: ConstraintIRNode[]): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "test",
    rulebookVersion: 3,
    planningDatasetVersion: 1,
    activeRuleCount: 178,
    hardConstraints: nodes,
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [{ ruleId: "CUR-007", family: "CURRICULUM_INTEGRITY", assertion: "Do not invent teacher qualifications." }],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

const node = (value: Partial<ConstraintIRNode> & Pick<ConstraintIRNode, "id" | "kind">): ConstraintIRNode => ({
  id: value.id,
  kind: value.kind,
  ruleIds: value.ruleIds || ["TEST-001"],
  selector: value.selector || {},
  parameters: value.parameters || {},
  explanation: value.explanation || value.id,
});

describe("Constraint IR runtime engine", () => {
  it("default-denies a teacher with no compiled qualification domain", () => {
    const s = state();
    addClass(s, { id: "class-jazz", name: "Jazz 3", subject: "Jazz", level: "Level 3", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] });
    const result = validateConstraintModelSchedule(s, model([]), [assignment(s, "class-jazz", { teacherId: "teacher-new" })]);
    expect(result.valid).toBe(false);
    expect(result.violations.some((item) => item.constraintId === "teacher-qualification-default-deny" && item.ruleIds.includes("CUR-007"))).toBe(true);
  });

  it("honors the Level 5 override instead of applying the normal weekday close twice", () => {
    const s = state();
    addClass(s, { id: "class-ballet5", name: "Ballet 5", subject: "Ballet", level: "Level 5", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] });
    const nodes = [
      node({ id: "normal-close", kind: "DAY_TIME_WINDOW", ruleIds: ["OPS-003"], parameters: { days: ["Monday"], latestFinish: "21:30" } }),
      node({ id: "level5-close", kind: "DAY_TIME_WINDOW", ruleIds: ["OPS-004"], selector: { levels: ["Level 5"] }, parameters: { days: ["Monday"], latestFinish: "21:45", overrides: "normal-close" } }),
      node({ id: "aimee-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["AIM-001"], selector: { teacherNames: ["Aimee"] }, parameters: { allowedSubjects: ["Ballet"] } }),
    ];
    const result = validateConstraintModelSchedule(s, model(nodes), [assignment(s, "class-ballet5", { startTime: "20:40", endTime: "21:40" })]);
    expect(result.violations.filter((item) => item.constraintId === "normal-close")).toEqual([]);
    expect(result.violations.filter((item) => item.constraintId === "level5-close")).toEqual([]);
  });

  it("enforces allowed teacher subjects even when no exception list exists", () => {
    const s = state();
    addClass(s, { id: "class-jazz", name: "Jazz 3", subject: "Jazz", level: "Level 3", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] });
    const nodes = [node({
      id: "aimee-domain",
      kind: "TEACHER_SUBJECT_DOMAIN",
      ruleIds: ["AIM-001"],
      selector: { teacherNames: ["Aimee"] },
      parameters: { allowedSubjects: ["Ballet", "Pre-Pointe", "Pointe"] },
    })];
    const result = validateConstraintModelSchedule(s, model(nodes), [assignment(s, "class-jazz", { teacherId: "teacher-aimee" })]);
    expect(result.violations.some((item) => item.constraintId === "aimee-domain")).toBe(true);
  });

  it("enforces prohibited teacher subjects from the compiled model", () => {
    const s = state();
    addClass(s, { id: "class-hiphop", name: "Hip Hop 2", subject: "Hip Hop", level: "Level 2", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] });
    const nodes = [node({
      id: "cami-domain",
      kind: "TEACHER_SUBJECT_DOMAIN",
      ruleIds: ["CAM-001", "CAM-003"],
      selector: { teacherNames: ["Cami"] },
      parameters: { allowedSubjects: ["Jazz", "Tap", "Contemporary", "Lyrical"], prohibitedSubjects: ["Hip Hop"] },
    })];
    const result = validateConstraintModelSchedule(s, model(nodes), [assignment(s, "class-hiphop", { teacherId: "teacher-cami" })]);
    expect(result.violations.some((item) => item.constraintId === "cami-domain")).toBe(true);
  });

  it("requires a fixed anchor and a direct-after sequence", () => {
    const s = state();
    addClass(s, { id: "class-ballet3", name: "Ballet 3", subject: "Ballet", level: "Level 3", durationMinutes: 90, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] });
    addClass(s, { id: "class-prepointe", name: "Pre-Pointe", subject: "Pre-Pointe", level: "Level 3", durationMinutes: 30, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] });
    const nodes = [
      node({ id: "aimee-domain", kind: "TEACHER_SUBJECT_DOMAIN", selector: { teacherNames: ["Aimee"] }, parameters: { allowedSubjects: ["Ballet", "Pre-Pointe"] } }),
      node({ id: "ballet3-fixed", kind: "FIXED_ASSIGNMENT", selector: { classNames: ["Ballet 3"] }, parameters: { day: "Monday", start: "16:45", end: "18:15" } }),
      node({ id: "prepointe-after", kind: "DIRECTLY_AFTER", selector: { classNames: ["Ballet 3", "Pre-Pointe"] }, parameters: { predecessor: "Ballet 3", successor: "Pre-Pointe", gapMinutes: 0 } }),
    ];
    const good = [
      assignment(s, "class-ballet3", { startTime: "16:45", endTime: "18:15" }),
      assignment(s, "class-prepointe", { id: "assignment-prepointe", startTime: "18:15", endTime: "18:45" }),
    ];
    expect(validateConstraintModelSchedule(s, model(nodes), good).violations).toEqual([]);

    const bad = [good[0], { ...good[1], startTime: "18:30", endTime: "19:00" }];
    expect(validateConstraintModelSchedule(s, model(nodes), bad).violations.some((item) => item.constraintId === "prepointe-after")).toBe(true);
  });

  it("enforces room capacity with an empty exemption list and Karly/daughter first-start alignment", () => {
    const s = state();
    addClass(s, { id: "class-jazz2", name: "Jazz 2", subject: "Jazz", level: "Level 2", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-1", "student-2"], eligibleTeacherIds: [] });
    addClass(s, { id: "class-other", name: "Jazz 3", subject: "Jazz", level: "Level 3", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] });
    const nodes = [
      node({ id: "karly-domain", kind: "TEACHER_SUBJECT_DOMAIN", selector: { teacherNames: ["Karly"] }, parameters: { allowedSubjects: ["Jazz"] } }),
      node({ id: "aimee-domain", kind: "TEACHER_SUBJECT_DOMAIN", selector: { teacherNames: ["Aimee"] }, parameters: { allowedSubjects: ["Jazz"] } }),
      node({ id: "small-room", kind: "ROOM_CAPACITY", selector: { roomNames: ["Studio C"] }, parameters: { maxDancers: 1, exemptLevels: [] } }),
      node({ id: "karly-arrival", kind: "RELATIONSHIP_START_WINDOW", selector: { teacherNames: ["Karly"] }, parameters: { daughterClassNames: ["Jazz 2"], maxStartDifferenceMinutes: 30 } }),
    ];
    const candidate = [
      assignment(s, "class-other", { teacherId: "teacher-karly", startTime: "16:45", endTime: "17:45" }),
      assignment(s, "class-jazz2", { id: "assignment-jazz2", teacherId: "teacher-aimee", roomId: "room-c", startTime: "17:30", endTime: "18:30" }),
    ];
    const result = validateConstraintModelSchedule(s, model(nodes), candidate);
    expect(result.violations.some((item) => item.constraintId === "small-room")).toBe(true);
    expect(result.violations.some((item) => item.constraintId === "karly-arrival")).toBe(true);
  });
});

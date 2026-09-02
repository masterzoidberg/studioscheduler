import { describe, expect, it } from "vitest";
import type { Assignment, ClassDefinition, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";

const now = "2026-09-02T00:00:00Z";

function klass(id: string, name: string, subject: string, level: string, durationMinutes: number): ClassDefinition {
  return { id, name, subject, level, durationMinutes, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] };
}

function fixtureState(): StudioState {
  const classes = [
    klass("ballet3", "Ballet 3", "Ballet", "Level 3", 90),
    klass("pre-pointe", "Pre-Pointe", "Pre-Pointe", "Level 3", 30),
    klass("jazz2", "Jazz 2", "Jazz", "Level 2", 60),
    klass("jazz3", "Jazz 3", "Jazz", "Level 3", 60),
    klass("hiphop2", "Hip Hop 2", "Hip Hop", "Level 2", 60),
  ];
  return {
    studioId: "golden",
    studioName: "DWDE golden fixture",
    teachers: [
      { id: "aimee", name: "Aimee", subjects: [] },
      { id: "cami", name: "Cami", subjects: [] },
      { id: "karly", name: "Karly", subjects: [] },
    ],
    rooms: [
      { id: "studio-a", name: "Studio A", capacity: 30, features: [] },
      { id: "studio-b", name: "Studio B", capacity: 30, features: [] },
      { id: "studio-c", name: "Studio C", capacity: 15, features: [] },
    ],
    students: [],
    cohorts: [],
    classes,
    sessions: classes.map((item) => ({ id: `session-${item.id}`, classId: item.id, ordinal: 1 })),
    rules: [],
    rulebookVersions: [{ id: "rb3", version: 3, name: "Rulebook v3", createdAt: now, actor: "fixture", reason: "fixture", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
  };
}

const node = (value: Partial<ConstraintIRNode> & Pick<ConstraintIRNode, "id" | "kind">): ConstraintIRNode => ({
  id: value.id,
  kind: value.kind,
  ruleIds: value.ruleIds || ["GOLD-001"],
  selector: value.selector || {},
  parameters: value.parameters || {},
  explanation: value.explanation || value.id,
});

function fixtureModel(): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "golden-fixture",
    rulebookVersion: 3,
    planningDatasetVersion: 1,
    activeRuleCount: 178,
    hardConstraints: [
      node({ id: "room-overlap", kind: "RESOURCE_NO_OVERLAP", ruleIds: ["OPS-001"], parameters: { resource: "ROOM" } }),
      node({ id: "teacher-overlap", kind: "RESOURCE_NO_OVERLAP", ruleIds: ["OPS-001"], parameters: { resource: "TEACHER" } }),
      node({ id: "time-grid", kind: "TIME_GRID", ruleIds: ["OPS-001"], parameters: { minutes: 15 } }),
      node({ id: "weekday-window", kind: "DAY_TIME_WINDOW", ruleIds: ["OPS-002", "OPS-003"], parameters: { days: ["Monday"], earliestStart: "16:45", latestFinish: "21:30" } }),
      node({ id: "aimee-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["AIM-001"], selector: { teacherNames: ["Aimee"] }, parameters: { allowedSubjects: ["Ballet", "Pre-Pointe", "Pointe"] } }),
      node({ id: "cami-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["CAM-001", "CAM-003"], selector: { teacherNames: ["Cami"] }, parameters: { allowedSubjects: ["Jazz", "Tap", "Contemporary", "Lyrical"], prohibitedSubjects: ["Hip Hop"] } }),
      node({ id: "karly-domain", kind: "TEACHER_SUBJECT_DOMAIN", ruleIds: ["KAR-001"], selector: { teacherNames: ["Karly"] }, parameters: { allowedSubjects: ["Jazz", "Tap", "Ballet", "Lyrical"] } }),
      node({ id: "ballet3-room", kind: "REQUIRED_ROOM", ruleIds: ["ROOM-001"], selector: { classNames: ["Ballet 3"], roomNames: ["Studio A"] }, parameters: { roomName: "Studio A" } }),
      node({ id: "ballet3-fixed", kind: "FIXED_ASSIGNMENT", ruleIds: ["FIX-001"], selector: { classNames: ["Ballet 3"], teacherNames: ["Aimee"], roomNames: ["Studio A"] }, parameters: { day: "Monday", start: "16:45", end: "18:15" } }),
      node({ id: "prepointe-after", kind: "DIRECTLY_AFTER", ruleIds: ["SEQ-001"], selector: { classNames: ["Ballet 3", "Pre-Pointe"] }, parameters: { predecessor: "Ballet 3", successor: "Pre-Pointe", gapMinutes: 0 } }),
      node({ id: "karly-arrival", kind: "RELATIONSHIP_START_WINDOW", ruleIds: ["KAR-009"], selector: { teacherNames: ["Karly"] }, parameters: { daughterClassNames: ["Jazz 2"], maxStartDifferenceMinutes: 30 } }),
      node({ id: "studio-c-capacity", kind: "ROOM_CAPACITY", ruleIds: ["ROOM-014"], selector: { roomNames: ["Studio C"] }, parameters: { maxDancers: 15, exemptLevels: ["Elementary 1", "Elementary 2"] } }),
    ],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [{ ruleId: "CUR-007", family: "CURRICULUM_INTEGRITY", assertion: "Do not invent teacher qualifications." }],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function assignment(id: string, classId: string, day: Assignment["day"], startTime: string, endTime: string, teacherId: string, roomId: string): Assignment {
  return { id, sessionId: `session-${classId}`, day, startTime, endTime, teacherId, roomId };
}

function feasibleCandidate(): Assignment[] {
  return [
    assignment("a-ballet3", "ballet3", "Monday", "16:45", "18:15", "aimee", "studio-a"),
    assignment("a-prepointe", "pre-pointe", "Monday", "18:15", "18:45", "aimee", "studio-a"),
    assignment("a-jazz3", "jazz3", "Monday", "16:45", "17:45", "karly", "studio-c"),
    assignment("a-jazz2", "jazz2", "Monday", "17:00", "18:00", "cami", "studio-b"),
  ];
}

describe("golden scheduling fixtures", () => {
  it("accepts a known-feasible candidate under the integrated HARD fixture", () => {
    const result = validateConstraintModelSchedule(fixtureState(), fixtureModel(), feasibleCandidate());
    expect(result.unsupportedConstraintIds).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("returns stable Rule IDs and constraint IDs for a deliberately impossible candidate", () => {
    const candidate = feasibleCandidate();
    candidate[0] = { ...candidate[0], roomId: "studio-b" };
    candidate[1] = { ...candidate[1], startTime: "18:30", endTime: "19:00" };
    candidate[3] = { ...candidate[3], sessionId: "session-hiphop2", startTime: "18:00", endTime: "19:00", roomId: "studio-b" };

    const result = validateConstraintModelSchedule(fixtureState(), fixtureModel(), candidate);
    const ids = new Set(result.violations.map((item) => item.constraintId));
    expect(ids).toContain("ballet3-room");
    expect(ids).toContain("ballet3-fixed");
    expect(ids).toContain("prepointe-after");
    expect(ids).toContain("cami-domain");
    expect(ids).toContain("karly-arrival");
    expect(result.violations.some((item) => item.ruleIds.includes("ROOM-001"))).toBe(true);
    expect(result.violations.some((item) => item.ruleIds.includes("CAM-003"))).toBe(true);
    expect(result.violations.some((item) => item.ruleIds.includes("KAR-009"))).toBe(true);
    expect(result.valid).toBe(false);
  });
});

import type { Assignment, StudioState } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compareScheduleQuality, scoreScheduleQuality } from "@/lib/schedule-quality";
import { describe, expect, it } from "vitest";

const now = "2026-09-11T00:00:00Z";

function fixtureState(): StudioState {
  return {
    studioId: "quality-studio",
    studioName: "Quality fixture",
    teachers: [
      { id: "teacher-a", name: "Teacher A", subjects: [] },
      { id: "teacher-b", name: "Teacher B", subjects: [] },
    ],
    rooms: [
      { id: "room-a", name: "Room A" },
      { id: "room-b", name: "Room B" },
    ],
    students: [
      { id: "student-a", name: "Student A", level: "Level 1" },
      { id: "student-b", name: "Student B", level: "Level 1" },
    ],
    cohorts: [],
    classes: [
      { id: "class-one", name: "Class One", subject: "Ballet", level: "Level 1", durationMinutes: 60, weeklyFrequency: 2, rosterStudentIds: ["student-a", "student-b"], eligibleTeacherIds: ["teacher-a"] },
      { id: "class-two", name: "Class Two", subject: "Jazz", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-a"], eligibleTeacherIds: ["teacher-a"] },
      { id: "class-three", name: "Class Three", subject: "Tap", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-b"], eligibleTeacherIds: ["teacher-b"] },
    ],
    sessions: [
      { id: "session-one-monday", classId: "class-one", ordinal: 1 },
      { id: "session-one-wednesday", classId: "class-one", ordinal: 2 },
      { id: "session-two", classId: "class-two", ordinal: 1 },
      { id: "session-three", classId: "class-three", ordinal: 1 },
    ],
    rules: [],
    rulebookVersions: [{ id: "rulebook", version: 1, name: "Fixture", createdAt: now, actor: "test", reason: "fixture", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
  };
}

const assignments: Assignment[] = [
  { id: "assignment-one-monday", sessionId: "session-one-monday", day: "Monday", startTime: "16:45", endTime: "17:45", teacherId: "teacher-a", roomId: "room-a" },
  { id: "assignment-one-wednesday", sessionId: "session-one-wednesday", day: "Wednesday", startTime: "16:45", endTime: "17:45", teacherId: "teacher-a", roomId: "room-a" },
  { id: "assignment-two", sessionId: "session-two", day: "Monday", startTime: "18:15", endTime: "19:15", teacherId: "teacher-a", roomId: "room-b" },
  { id: "assignment-three", sessionId: "session-three", day: "Friday", startTime: "17:00", endTime: "18:00", teacherId: "teacher-b", roomId: "room-a" },
];

function model(objectivePrioritySpine: ConstraintModelSnapshotV1["objectivePrioritySpine"]): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "quality-fixture",
    rulebookVersion: 1,
    planningDatasetVersion: 1,
    activeRuleCount: 4,
    hardConstraints: ["teacher-a", "teacher-b"].map((teacherId) => ({
      id: `${teacherId}-qualification`,
      kind: "TEACHER_SUBJECT_DOMAIN" as const,
      ruleIds: ["QUALIFICATION"],
      selector: { teacherIds: [teacherId] },
      parameters: { allowedSubjects: ["Ballet", "Jazz", "Tap"] },
      explanation: "Fixture qualification domain",
    })),
    objectivePrioritySpine,
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

describe("schedule quality scoring", () => {
  it("returns hand-calculated units and lexicographic typed preference tiers", () => {
    const result = scoreScheduleQuality(fixtureState(), model([
      { ruleId: "OPT-001", rank: 1, title: "Prefer Friday", description: "Prefer Friday classes." },
      { ruleId: "PREF-DAY", rank: 2, title: "Preferred days", description: "Reviewed day preference.", kind: "PREFERRED_DAY", selector: { classIds: ["class-one"] }, parameters: { days: ["Monday", "Wednesday"] }, scoringEnabled: true },
      { ruleId: "PREF-AVOID", rank: 3, title: "Avoid Friday", description: "Reviewed avoid-day preference.", kind: "AVOID_DAY", selector: { classIds: ["class-three"] }, parameters: { days: ["Friday"] }, scoringEnabled: true },
      { ruleId: "PREF-TEACHER", rank: 4, title: "Preferred teacher", description: "Reviewed teacher preference.", kind: "PREFERRED_TEACHER", selector: { classIds: ["class-two"], teacherIds: ["teacher-a"] }, parameters: { teacherId: "teacher-a" }, scoringEnabled: true },
      { ruleId: "PREF-ROOM", rank: 5, title: "Preferred room", description: "Reviewed room preference.", kind: "PREFERRED_ROOM", selector: { classIds: ["class-two"], roomIds: ["room-a"] }, parameters: { roomId: "room-a" }, scoringEnabled: true },
    ]), assignments);

    expect(result.status).toBe("FEASIBLE");
    expect(result.comparable).toBe(true);
    expect(result.hardViolations).toBe(0);
    expect(result.breakdown).toMatchObject({
      preferredDayMatches: 2,
      avoidedDayAssignments: 1,
      teacherGapMinutes: 30,
      studentAttendanceDays: 5,
      preferredTeacherMatches: 1,
      preferredRoomMatches: 0,
    });
    expect(result.tiers.map((tier) => [tier.ruleId, tier.rank])).toEqual([
      ["PREF-DAY", 2], ["PREF-AVOID", 3], ["PREF-TEACHER", 4], ["PREF-ROOM", 5],
    ]);
    expect(result.tiers[0]?.components[0]).toMatchObject({ metric: "preferredDayMatches", value: 2, unit: "days", direction: "MAXIMIZE" });
    expect(result.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "teacherGapMinutes", value: 30, unit: "minutes", direction: "MINIMIZE" }),
      expect.objectContaining({ metric: "studentAttendanceDays", value: 2, unit: "days", direction: "MINIMIZE", entityIds: ["student-a"] }),
      expect.objectContaining({ metric: "studentAttendanceDays", value: 3, unit: "days", direction: "MINIMIZE", entityIds: ["student-b"] }),
    ]));
    expect(result.explanations).toEqual(expect.arrayContaining([
      "Preferred day matches: 2 days",
      "Avoided-day assignments: 1 day",
      "Teacher gap minutes: 30 minutes",
      "Student attendance days: 5 days",
      "Preferred teacher matches: 1 count",
      "Preferred room matches: 0 counts",
    ]));
  });

  it("is order-stable and does not derive preferences from prose-only objectives", () => {
    const objectives = [
      { ruleId: "OPT-001", rank: 1, title: "Prefer Friday", description: "Prefer Friday classes." },
      { ruleId: "PREF-DAY", rank: 2, title: "Preferred days", description: "Reviewed day preference.", kind: "PREFERRED_DAY" as const, selector: { classIds: ["class-one"] }, parameters: { days: ["Monday", "Wednesday"] }, scoringEnabled: true },
    ];
    const first = scoreScheduleQuality(fixtureState(), model(objectives), assignments);
    const reversedState = fixtureState();
    reversedState.teachers.reverse();
    reversedState.students.reverse();
    reversedState.classes.reverse();
    reversedState.sessions.reverse();
    const second = scoreScheduleQuality(reversedState, model([...objectives].reverse()), [...assignments].reverse());

    expect(second).toEqual(first);
    expect(first.breakdown.preferredDayMatches).toBe(2);
    expect(first.warnings).toContain("Objective OPT-001 has no explicit typed preference record; no preference score was invented from its title or description.");
  });

  it("orders equal reviewed ranks by explicit strength without combining unlike units", () => {
    const result = scoreScheduleQuality(fixtureState(), model([
      { ruleId: "PREF-LIGHT", rank: 1, title: "Light", description: "Light preference.", kind: "PREFERRED_DAY", selector: { classIds: ["class-one"] }, parameters: { days: ["Monday"] }, strength: "LIGHT", scoringEnabled: true },
      { ruleId: "PREF-STRONG", rank: 1, title: "Strong", description: "Strong preference.", kind: "PREFERRED_DAY", selector: { classIds: ["class-one"] }, parameters: { days: ["Monday"] }, strength: "VERY_STRONG", scoringEnabled: true },
    ]), assignments);

    expect(result.tiers.map((tier) => [tier.ruleId, tier.strength])).toEqual([
      ["PREF-STRONG", "VERY_STRONG"],
      ["PREF-LIGHT", "LIGHT"],
    ]);
  });

  it("marks a schedule with HARD violations non-comparable instead of treating the quality as acceptable", () => {
    const hardModel = model([]);
    hardModel.hardConstraints.push({
      id: "time-grid",
      kind: "TIME_GRID",
      ruleIds: ["HARD-001"],
      selector: {},
      parameters: { minutes: 15 },
      explanation: "Fixture time grid",
    });
    const invalid = assignments.map((assignment, index) => index === 0
      ? { ...assignment, startTime: "16:50", endTime: "17:50" }
      : assignment);

    const result = scoreScheduleQuality(fixtureState(), hardModel, invalid);

    expect(result.status).toBe("INFEASIBLE");
    expect(result.comparable).toBe(false);
    expect(result.hardViolations).toBe(1);
    expect(result.warnings).toContain("HARD feasibility failed; this breakdown is diagnostic only and cannot rank or adopt the schedule.");
  });

  it("does not describe a candidate with a worse reviewed objective as improved", () => {
    const preference = model([{
      ruleId: "PREF-DAY",
      rank: 1,
      title: "Preferred day",
      description: "Prefer Monday.",
      kind: "PREFERRED_DAY",
      selector: { classIds: ["class-one"] },
      parameters: { days: ["Monday"] },
      strength: "VERY_STRONG",
      scoringEnabled: true,
    }]);
    const baseline = scoreScheduleQuality(fixtureState(), preference, assignments);
    const worse = scoreScheduleQuality(fixtureState(), preference, assignments.map((assignment) =>
      assignment.sessionId === "session-one-monday" ? { ...assignment, day: "Tuesday" as const } : assignment,
    ));

    expect(compareScheduleQuality(worse, baseline)).toBe("WORSE_THAN_BASELINE");
    expect(compareScheduleQuality(baseline, worse)).toBe("IMPROVED");
  });
});

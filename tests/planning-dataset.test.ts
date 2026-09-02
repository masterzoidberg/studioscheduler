import { describe, expect, it } from "vitest";
import type { StudioState } from "@/lib/domain";
import { buildPlanningDatasetSnapshot, planningDatasetMatches } from "@/lib/planning-dataset";

function fixture(): StudioState {
  return {
    studioId: "studio-1",
    studioName: "Display Name",
    teachers: [
      { id: "teacher-b", name: "Teacher B", subjects: ["Legacy"], notes: "presentation note", displayColor: "#ff0000" },
      { id: "teacher-a", name: "Teacher A", subjects: ["Legacy"], displayColor: "#00ff00" },
    ],
    rooms: [
      { id: "room-b", name: "Room B", capacity: 20, features: ["barre", "marley"] },
      { id: "room-a", name: "Room A", capacity: 12, features: ["mirrors"] },
    ],
    students: [
      { id: "student-b", name: "Student B", level: "2", cohortIds: ["cohort-b", "cohort-a"] },
      { id: "student-a", name: "Student A", level: "1", cohortIds: [] },
    ],
    cohorts: [
      { id: "cohort-a", name: "Cohort A", studentIds: ["student-b", "student-a"] },
    ],
    classes: [
      {
        id: "class-a",
        name: "Ballet 1",
        subject: "Ballet",
        level: "1",
        durationMinutes: 60,
        weeklyFrequency: 1,
        rosterStudentIds: ["student-b", "student-a"],
        eligibleTeacherIds: ["teacher-a"],
        companyOnly: false,
      },
    ],
    sessions: [{ id: "session-a", classId: "class-a", ordinal: 1, locked: false }],
    rules: [],
    rulebookVersions: [],
    enforcementVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
  };
}

describe("planning dataset snapshot", () => {
  it("is deterministic, order-normalized, and identifies schema 1.1", () => {
    const state = fixture();
    const snapshot = buildPlanningDatasetSnapshot(state);
    expect(snapshot.schemaVersion).toBe("1.1");
    expect(snapshot.teacherIds).toEqual(["teacher-a", "teacher-b"]);
    expect(snapshot.rooms.map((room) => room.id)).toEqual(["room-a", "room-b"]);
    expect(snapshot.classes[0].rosterStudentIds).toEqual(["student-a", "student-b"]);
    expect(snapshot.students[1].cohortIds).toEqual(["cohort-a", "cohort-b"]);
    expect(snapshot.sessions[0].durationMinutes).toBeNull();
  });

  it("ignores presentation-only and legacy teacher-eligibility changes", () => {
    const before = fixture();
    const after = fixture();
    after.studioName = "Renamed Studio";
    after.teachers[0].name = "Renamed Teacher";
    after.teachers[0].displayColor = "#123456";
    after.teachers[0].notes = "different note";
    after.teachers[0].subjects = ["Different legacy metadata"];
    after.rooms[0].name = "Renamed Room";
    after.students[0].name = "Renamed Student";
    after.classes[0].name = "Renamed Class";
    after.classes[0].eligibleTeacherIds = ["teacher-b"];

    expect(planningDatasetMatches(
      buildPlanningDatasetSnapshot(before),
      buildPlanningDatasetSnapshot(after),
    )).toBe(true);
  });

  it("changes when solver-significant facts change", () => {
    const before = buildPlanningDatasetSnapshot(fixture());

    const durationChanged = fixture();
    durationChanged.classes[0].durationMinutes = 75;
    expect(planningDatasetMatches(before, buildPlanningDatasetSnapshot(durationChanged))).toBe(false);

    const sessionDurationChanged = fixture();
    sessionDurationChanged.sessions[0].durationMinutes = 75;
    expect(planningDatasetMatches(before, buildPlanningDatasetSnapshot(sessionDurationChanged))).toBe(false);

    const capacityChanged = fixture();
    capacityChanged.rooms[0].capacity = 25;
    expect(planningDatasetMatches(before, buildPlanningDatasetSnapshot(capacityChanged))).toBe(false);

    const rosterChanged = fixture();
    rosterChanged.classes[0].rosterStudentIds = ["student-a"];
    expect(planningDatasetMatches(before, buildPlanningDatasetSnapshot(rosterChanged))).toBe(false);
  });
});

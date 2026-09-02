import { describe, expect, it } from "vitest";
import type { PlanningDatasetVersion, StudioState } from "@/lib/domain";
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
    cohorts: [{ id: "cohort-a", name: "Cohort A", studentIds: ["student-b", "student-a"] }],
    classes: [{
      id: "class-a", name: "Ballet 1", subject: "Ballet", level: "1", durationMinutes: 60, weeklyFrequency: 1,
      rosterStudentIds: ["student-b", "student-a"], eligibleTeacherIds: ["teacher-a"], companyOnly: false,
    }],
    sessions: [{ id: "session-a", classId: "class-a", ordinal: 1, locked: false }],
    rules: [], rulebookVersions: [], enforcementVersions: [], enforcementProposals: [], ruleHistory: [],
    scheduleVersions: [], scenarios: [], auditEvents: [],
  };
}

describe("planning dataset snapshot", () => {
  it("is deterministic, order-normalized, and identifies schema 1.3", () => {
    const state = fixture();
    const snapshot = buildPlanningDatasetSnapshot(state);
    expect(snapshot.schemaVersion).toBe("1.3");
    expect(snapshot.sourceManifest).toBeNull();
    expect(snapshot.teacherIds).toEqual(["teacher-a", "teacher-b"]);
    expect(snapshot.teachers).toEqual([
      { id: "teacher-a", name: "Teacher A" },
      { id: "teacher-b", name: "Teacher B" },
    ]);
    expect(snapshot.rooms.map((room) => [room.id, room.name])).toEqual([["room-a", "Room A"], ["room-b", "Room B"]]);
    expect(snapshot.classes[0].name).toBe("Ballet 1");
    expect(snapshot.classes[0].rosterStudentIds).toEqual(["student-a", "student-b"]);
    expect(snapshot.students[1].cohortIds).toEqual(["cohort-a", "cohort-b"]);
    expect(snapshot.sessions[0].durationMinutes).toBeNull();
  });

  it("pins the current source manifest identity into rebuilt snapshots", () => {
    const state = fixture();
    const current: PlanningDatasetVersion = {
      id: "pdv-1", version: 1, createdAt: "2026-09-02T00:00:00Z", actor: "test", reason: "test",
      snapshotHash: "a".repeat(64), status: "CURRENT",
      snapshot: {
        ...buildPlanningDatasetSnapshot(state),
        sourceManifest: {
          version: 7,
          snapshotHash: "b".repeat(64),
          complete: true,
          snapshot: {
            schemaVersion: "1.0",
            sources: [{ sourceId: "rosters", kind: "ROSTER", label: "2026-27 rosters", sha256: "c".repeat(64) }],
            classes: [{ id: "class-a", name: "Ballet 1", weeklyFrequency: 1, sessionDurations: [60], rosterStudentIds: ["student-a", "student-b"] }],
          },
        },
      },
    };
    state.planningDatasetVersions = [current];
    const rebuilt = buildPlanningDatasetSnapshot(state);
    expect(rebuilt.sourceManifest?.version).toBe(7);
    expect(rebuilt.sourceManifest?.complete).toBe(true);
  });

  it("uses locale-independent code-unit ordering for canonical values", () => {
    const state = fixture();
    state.teachers = [
      { id: "teacher-é", name: "Accent", subjects: [] },
      { id: "teacher-Z", name: "Upper", subjects: [] },
      { id: "teacher-a", name: "Lower", subjects: [] },
    ];
    state.rooms[0].features = ["équipement", "Z-floor", "alpha"];
    const snapshot = buildPlanningDatasetSnapshot(state);
    expect(snapshot.teacherIds).toEqual(["teacher-Z", "teacher-a", "teacher-é"]);
    expect(snapshot.rooms.find((room) => room.id === "room-b")?.features).toEqual(["Z-floor", "alpha", "équipement"]);
  });

  it("ignores presentation-only and legacy teacher-eligibility changes", () => {
    const before = fixture();
    const after = fixture();
    after.studioName = "Renamed Studio";
    after.teachers[0].displayColor = "#123456";
    after.teachers[0].notes = "different note";
    after.teachers[0].subjects = ["Different legacy metadata"];
    after.classes[0].eligibleTeacherIds = ["teacher-b"];
    expect(planningDatasetMatches(buildPlanningDatasetSnapshot(before), buildPlanningDatasetSnapshot(after))).toBe(true);
  });

  it("changes when selector-relevant entity names change", () => {
    const before = buildPlanningDatasetSnapshot(fixture());
    for (const mutate of [
      (state: StudioState) => { state.teachers[0].name = "Renamed Teacher"; },
      (state: StudioState) => { state.rooms[0].name = "Renamed Room"; },
      (state: StudioState) => { state.students[0].name = "Renamed Student"; },
      (state: StudioState) => { state.cohorts[0].name = "Renamed Cohort"; },
      (state: StudioState) => { state.classes[0].name = "Renamed Class"; },
    ]) {
      const changed = fixture();
      mutate(changed);
      expect(planningDatasetMatches(before, buildPlanningDatasetSnapshot(changed))).toBe(false);
    }
  });

  it("changes when other solver-significant facts change", () => {
    const before = buildPlanningDatasetSnapshot(fixture());
    const durationChanged = fixture(); durationChanged.classes[0].durationMinutes = 75;
    expect(planningDatasetMatches(before, buildPlanningDatasetSnapshot(durationChanged))).toBe(false);
    const sessionDurationChanged = fixture(); sessionDurationChanged.sessions[0].durationMinutes = 75;
    expect(planningDatasetMatches(before, buildPlanningDatasetSnapshot(sessionDurationChanged))).toBe(false);
    const capacityChanged = fixture(); capacityChanged.rooms[0].capacity = 25;
    expect(planningDatasetMatches(before, buildPlanningDatasetSnapshot(capacityChanged))).toBe(false);
    const rosterChanged = fixture(); rosterChanged.classes[0].rosterStudentIds = ["student-a"];
    expect(planningDatasetMatches(before, buildPlanningDatasetSnapshot(rosterChanged))).toBe(false);
  });
});

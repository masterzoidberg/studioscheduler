import { describe, expect, it } from "vitest";
import type { Assignment, StudioState, ValidationResult } from "@/lib/domain";
import type { ScheduleReadinessReport } from "@/lib/schedule-readiness";
import { buildScheduleExportModel, exportScheduleCsv, scheduleExportRows } from "@/lib/schedule-export";
import type { SolverSnapshotContextToken } from "@/lib/server-studio-state";

const validation: ValidationResult = {
  valid: true,
  fullyValidated: true,
  hardViolations: 0,
  warnings: 0,
  violations: [],
  coverage: {
    applicableHardRules: 1,
    implementedHardRules: 1,
    partialHardRules: 0,
    notImplementedHardRules: 0,
    notApplicableHardRules: 0,
    uncoveredHardRuleIds: [],
  },
};

const readiness = { ready: true, blockers: [], warnings: [] } as unknown as ScheduleReadinessReport;

function state(rooms = [{ id: "room-a", name: "Main Studio", capacity: 20, features: [] }]): StudioState {
  return {
    studioId: "studio",
    studioName: "Test Studio",
    teachers: [{ id: "teacher-a", name: "Alex Teacher", subjects: [] }],
    rooms,
    students: [{ id: "student-a", name: "Private Student Name", level: "1", cohortIds: [] }],
    cohorts: [],
    classes: [{ id: "class-a", name: "Ballet 1", subject: "Ballet", level: "1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-a"], eligibleTeacherIds: [] }],
    sessions: [{ id: "session-a", classId: "class-a", ordinal: 1 }],
    rules: [],
    rulebookVersions: [{ id: "rulebook", version: 2, name: "Current", createdAt: "2026-01-01", actor: "test", reason: "fixture", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [{ id: "enforcement", version: 1, rulebookVersion: 2, createdAt: "2026-01-01", actor: "test", reason: "fixture", changedRuleIds: [], snapshot: [], status: "CURRENT" }],
    planningDatasetVersions: [{
      id: "planning",
      version: 4,
      createdAt: "2026-01-01",
      actor: "test",
      reason: "fixture",
      snapshot: {} as never,
      snapshotHash: "planning-hash",
      status: "CURRENT",
      confirmedForSchedulingAt: "2026-01-01T00:00:00.000Z",
    }],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
  };
}

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: "assignment-a",
    sessionId: "session-a",
    day: "Monday",
    startTime: "17:00",
    endTime: "18:00",
    teacherId: "teacher-a",
    roomId: "room-a",
    locked: false,
    status: "NORMAL",
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof buildScheduleExportModel>[0]> = {}) {
  const currentState = state([
    { id: "room-a", name: "Main Studio", capacity: 20, features: [] },
    { id: "room-b", name: "Long Name Studio With Four Rooms", capacity: 20, features: [] },
    { id: "room-c", name: "Room C", capacity: 20, features: [] },
    { id: "room-d", name: "Room D", capacity: 20, features: [] },
  ]);
  const currentAssignment = assignment();
  const schedule = { id: "schedule", version: 7, rulebookVersion: 2, enforcementVersion: 1, planningDatasetVersion: 4, createdAt: "2026-01-01", actor: "test", reason: "fixture", assignments: [currentAssignment], isCurrent: true };
  const contextToken: SolverSnapshotContextToken = {
    schemaVersion: "1.0", studioId: "studio", rulebookVersion: 2, rulebookId: "rulebook", rulebookSourceHash: null, rulebookSnapshotHash: null, rulesHash: "rules",
    planningDatasetVersion: 4, planningDatasetId: "planning", planningSnapshotHash: "planning-hash", planningConfirmedForSchedulingAt: "2026-01-01T00:00:00.000Z",
    enforcementVersion: 1, enforcementId: "enforcement", constraintModelVersion: 3, constraintModelId: "model", constraintModelSnapshotHash: "model-hash",
    scheduleVersion: 7, scheduleId: "schedule", scheduleRulebookVersion: 2, scheduleEnforcementVersion: 1, schedulePlanningDatasetVersion: 4, scheduleConstraintModelVersion: 3, scheduleAssignmentsHash: "assignments",
  };
  currentState.scheduleVersions = [schedule];
  currentState.readinessCertification = {
    schemaVersion: 1,
    reviewSetSchemaVersion: 1,
    reviewSetFingerprint: "review-hash",
    currentRulebookVersion: 2,
    currentPlanningDatasetVersion: 4,
    currentPlanningSnapshotHash: "planning-hash",
    currentConstraintModelVersion: 3,
    currentConstraintModelSnapshotHash: "model-hash",
    currentConstraintModelCompilerVersion: "compiler",
    reviewFindings: [],
    certification: {
      planningDatasetVersion: 4,
      planningSnapshotHash: "planning-hash",
      rulebookVersion: 2,
      constraintModelVersion: 3,
      constraintModelSnapshotHash: "model-hash",
      reviewSetSchemaVersion: 1,
      reviewSetFingerprint: "review-hash",
      confirmedAt: "2026-01-01T00:00:00.000Z",
      confirmedByLabel: "Test Manager",
    },
  };
  return {
    state: currentState,
    assignments: [currentAssignment],
    currentSchedule: schedule,
    currentRulebookVersion: 2,
    currentEnforcementVersion: 1,
    currentPlanningDatasetVersion: 4,
    scheduleIsStale: false,
    validation,
    readiness,
    contextToken,
    ...overrides,
  };
}

describe("UX-03 schedule export", () => {
  it("keeps every configured room and every weekly horizon day, including empty cells", () => {
    const model = buildScheduleExportModel(input());
    const emptyRows = model.rows.filter((row) => row.rowType === "EMPTY");

    expect(model.rooms).toHaveLength(4);
    expect(model.days).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(emptyRows).toHaveLength(27);
    expect(model.rows.some((row) => row.day === "Saturday" && row.roomName === "Room D" && row.rowType === "EMPTY")).toBe(true);
  });

  it("redacts roster data and emits explicit empty and unassigned CSV rows", () => {
    const currentState = state([
      { id: "room-a", name: "Main Studio", capacity: 20, features: [] },
      { id: "room-b", name: "Overflow Studio", capacity: 20, features: [] },
    ]);
    const rows = scheduleExportRows(currentState, []);
    const model = buildScheduleExportModel(input({ assignments: [], currentSchedule: null }));
    const csv = exportScheduleCsv(model, "WEEK");

    expect(rows.some((row) => row.rowType === "EMPTY" && row.roomName === "Overflow Studio")).toBe(true);
    expect(csv).toContain('"EMPTY"');
    expect(csv).toContain('"UNSCHEDULED"');
    expect(csv).toContain('"Long Name Studio With Four Rooms"');
    expect(csv).toContain('"REDACTED (omitted by default)"');
    expect(csv).not.toContain("Private Student Name");
  });

  it("allows reviewed final status only for a current complete, fully validated context", () => {
    const model = buildScheduleExportModel(input());
    expect(model.status).toBe("REVIEWED_FINAL");
    expect(model.finalReady).toBe(true);
    expect(() => exportScheduleCsv(model, "ROOM", true)).not.toThrow();

    const stale = buildScheduleExportModel(input({ scheduleIsStale: true }));
    expect(stale.status).toBe("STALE");
    expect(stale.finalReady).toBe(false);
    expect(() => exportScheduleCsv(stale, "WEEK", true)).toThrow(/current complete certification/);
  });
});

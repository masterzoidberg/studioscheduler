import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PlanningDatasetSnapshotV1 } from "@/lib/domain";
import {
  parseCanonicalSolverSnapshotPayload,
  solverSnapshotContextTokensMatch,
  type SolverSnapshotContextToken,
} from "@/lib/server-studio-state";

const migration = readFileSync("supabase/migrations/20260907050000_coherent_solver_snapshot_v43.sql", "utf8");
const serverState = readFileSync("lib/server-studio-state.ts", "utf8");
const route = readFileSync("app/api/solver/feasibility/route.ts", "utf8");
const now = "2026-09-07T04:00:00Z";

function token(overrides: Partial<SolverSnapshotContextToken> = {}): SolverSnapshotContextToken {
  return {
    schemaVersion: "1.0",
    studioId: "studio",
    rulebookVersion: 3,
    rulebookId: "rb3",
    rulebookSourceHash: "r".repeat(64),
    rulebookSnapshotHash: "b".repeat(64),
    rulesHash: "c".repeat(64),
    planningDatasetVersion: 7,
    planningDatasetId: "pd7",
    planningSnapshotHash: "d".repeat(64),
    planningConfirmedForSchedulingAt: now,
    enforcementVersion: null,
    enforcementId: null,
    constraintModelVersion: null,
    constraintModelId: null,
    constraintModelSnapshotHash: null,
    scheduleVersion: null,
    scheduleId: null,
    scheduleRulebookVersion: null,
    scheduleEnforcementVersion: null,
    schedulePlanningDatasetVersion: null,
    scheduleConstraintModelVersion: null,
    scheduleAssignmentsHash: "e".repeat(64),
    ...overrides,
  };
}

function payload() {
  return {
    contextToken: token(),
    integrity: { planningSnapshotHashValid: true, constraintModelSnapshotHashValid: true },
    studio: { id: "studio", name: "Pinned Studio" },
    rules: [],
    rulebookVersion: {
      id: "rb3", version: 3, name: "Rulebook v3", created_at: now, actor_label: "test", reason: "test",
      changed_rule_ids: [], status: "CURRENT", snapshot: [], source_hash: "r".repeat(64),
    },
    enforcementVersion: null,
    planningDatasetVersion: {
      id: "pd7", version: 7, created_at: now, actor_label: "test", reason: "test", snapshot_hash: "d".repeat(64), status: "CURRENT",
      confirmed_for_scheduling_at: now,
      snapshot: {
        schemaVersion: "1.3", studioId: "studio", teacherIds: ["teacher-1"],
        teachers: [{ id: "teacher-1", name: "Pinned Teacher" }],
        rooms: [{ id: "room-1", name: "Pinned Room", capacity: 20, features: ["barre"] }],
        students: [{ id: "student-1", name: "Pinned Student", level: "Level 1", cohortIds: ["cohort-1"] }],
        cohorts: [{ id: "cohort-1", name: "Pinned Cohort", studentIds: ["student-1"] }],
        classes: [{ id: "class-1", name: "Pinned Class", subject: "Ballet", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-1"], companyOnly: false }],
        sessions: [{ id: "session-1", classId: "class-1", ordinal: 1, durationMinutes: 60, locked: false }],
      } as PlanningDatasetSnapshotV1,
    },
    constraintModelVersion: null,
    currentSchedule: null as Record<string, unknown> | null,
    currentAssignments: [] as Array<Record<string, unknown>>,
  };
}

describe("coherent solver snapshot", () => {
  it("reconstructs solver-significant planning facts only from the pinned immutable Planning Dataset snapshot", () => {
    const parsed = parseCanonicalSolverSnapshotPayload(payload(), "studio");
    expect(parsed.state.studioName).toBe("Pinned Studio");
    expect(parsed.state.teachers).toEqual([{ id: "teacher-1", name: "Pinned Teacher", subjects: [] }]);
    expect(parsed.state.rooms[0]).toMatchObject({ id: "room-1", name: "Pinned Room", capacity: 20 });
    expect(parsed.state.students[0].name).toBe("Pinned Student");
    expect(parsed.state.classes[0].name).toBe("Pinned Class");
    expect(parsed.state.sessions).toEqual([{ id: "session-1", classId: "class-1", ordinal: 1, durationMinutes: 60, locked: false }]);
  });

  it("fails closed for an older immutable snapshot that lacks names instead of filling from mutable current rows", () => {
    const raw = payload();
    raw.planningDatasetVersion.snapshot = {
      schemaVersion: "1.0", studioId: "studio", teacherIds: ["teacher-1"],
      rooms: [], students: [], cohorts: [], classes: [], sessions: [],
    } as PlanningDatasetSnapshotV1;
    expect(() => parseCanonicalSolverSnapshotPayload(raw, "studio")).toThrow(/SOLVER_PLANNING_SNAPSHOT_SCHEMA_UNSUPPORTED/);
  });

  it("rejects historical or cross-schedule assignments inside the current solver snapshot", () => {
    const raw = payload();
    raw.contextToken = token({ scheduleVersion: 9, scheduleId: "schedule-current", scheduleRulebookVersion: 3, schedulePlanningDatasetVersion: 7 });
    raw.currentSchedule = {
      id: "schedule-current", version: 9, rulebook_version: 3, enforcement_version: 0, planning_dataset_version: 7,
      created_at: now, actor_label: "test", reason: "test", is_current: true, validation_result: null,
    } as Record<string, unknown>;
    raw.currentAssignments = [{
      id: "historical-assignment", studio_id: "studio", schedule_version_id: "schedule-old", session_id: "session-1",
      day: "Monday", start_time: "17:00", end_time: "18:00", teacher_id: "teacher-1", room_id: "room-1", locked: false, status: "NORMAL",
    }];
    expect(() => parseCanonicalSolverSnapshotPayload(raw, "studio")).toThrow(/SOLVER_SNAPSHOT_HISTORICAL_ASSIGNMENT_LEAK/);
  });

  it("treats any policy/planning/model/schedule token drift as a different solver context", () => {
    const original = token();
    expect(solverSnapshotContextTokensMatch(original, { ...original })).toBe(true);
    expect(solverSnapshotContextTokensMatch(original, token({ rulesHash: "f".repeat(64) }))).toBe(false);
    expect(solverSnapshotContextTokensMatch(original, token({ planningDatasetVersion: 8 }))).toBe(false);
    expect(solverSnapshotContextTokensMatch(original, token({ constraintModelVersion: 2 }))).toBe(false);
    expect(solverSnapshotContextTokensMatch(original, token({ scheduleVersion: 10 }))).toBe(false);
    expect(solverSnapshotContextTokensMatch(original, token({ scheduleAssignmentsHash: "0".repeat(64) }))).toBe(false);
  });

  it("uses one authenticated snapshot RPC and excludes mutable planning-table fan-out", () => {
    expect(serverState).toContain('.rpc("get_solver_snapshot_v43"');
    for (const table of ["teachers", "rooms", "students", "class_definitions", "class_sessions", "assignments"]) {
      expect(serverState).not.toContain(`.from("${table}")`);
    }
    expect(migration).toContain("stable");
    expect(migration).toMatch(/a\.schedule_version_id=\(select id from current_schedule\)/);
    expect(migration).toContain("planningSnapshotHashValid");
    expect(migration).toContain("constraintModelSnapshotHashValid");
  });

  it("rechecks the coherent context immediately before and after the external solve", () => {
    const calls = route.match(/snapshotContextIsCurrent\(/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3); // definition + pre-solve + post-solve
    expect(route).toContain("SOLVER_CONTEXT_CHANGED_RETRY");
    expect(route).toContain("Reload the complete coherent snapshot");
  });
});

import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { Assignment, SchedulePatch, StudioState } from "@/lib/domain";
import { evaluateAuthoritativeManualMove } from "@/lib/manual-move-command";

const assignment: Assignment = {
  id: "a1",
  sessionId: "s1",
  day: "Monday",
  startTime: "17:00",
  endTime: "18:00",
  teacherId: "t1",
  roomId: "room-wide",
  locked: false,
  status: "NORMAL",
};

function state(current: Assignment[] = [assignment]): StudioState {
  return {
    studioId: "studio",
    studioName: "Fixture",
    teachers: [{ id: "t1", name: "Teacher", subjects: ["Ballet"] }],
    rooms: [
      { id: "room-wide", name: "Wide Room", capacity: 99, features: [] },
      { id: "room-ir-small", name: "IR Small Room", capacity: 99, features: [] },
    ],
    students: [
      { id: "student-1", name: "One", level: "Level 1" },
      { id: "student-2", name: "Two", level: "Level 1" },
    ],
    cohorts: [],
    classes: [{
      id: "class",
      name: "Fixture Ballet",
      subject: "Ballet",
      level: "Level 1",
      durationMinutes: 60,
      weeklyFrequency: 2,
      rosterStudentIds: ["student-1", "student-2"],
      eligibleTeacherIds: ["t1"],
      companyOnly: false,
    }],
    sessions: [
      { id: "s1", classId: "class", ordinal: 1 },
      { id: "s2", classId: "class", ordinal: 2 },
    ],
    rules: [],
    rulebookVersions: [{ id: "rb", version: 1, name: "Fixture", createdAt: "", actor: "", reason: "", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [],
    planningDatasetVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [{ id: "schedule", version: 1, rulebookVersion: 1, enforcementVersion: 1, planningDatasetVersion: 1, createdAt: "", actor: "", reason: "", assignments: current, isCurrent: true }],
    scenarios: [],
    auditEvents: [],
  };
}

function model(withCapacity = false): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "t10-test",
    rulebookVersion: 1,
    planningDatasetVersion: 1,
    activeRuleCount: 1,
    hardConstraints: [
      {
        id: "teacher-domain",
        kind: "TEACHER_SUBJECT_DOMAIN",
        ruleIds: ["DOMAIN-1"],
        selector: { teacherNames: ["Teacher"] },
        parameters: { allowedSubjects: ["Ballet"] },
        explanation: "Teacher may teach Ballet",
      },
      ...(withCapacity ? [{
        id: "ir-room-capacity",
        kind: "ROOM_CAPACITY" as const,
        ruleIds: ["IR-CAP-1"],
        selector: { roomNames: ["IR Small Room"] },
        parameters: { maxDancers: 1, exemptLevels: [] },
        explanation: "Authoritative IR-only room capacity witness",
      }] : []),
    ],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function move(changes: SchedulePatch["changes"]): SchedulePatch {
  return { id: "move", operation: "MOVE", assignmentId: "a1", changes, reason: "T10 test move", proposedBy: "USER" };
}

describe("T10 authoritative manual MOVE", () => {
  it("rejects an IR-only illegal move that the legacy gate would permit", () => {
    const decision = evaluateAuthoritativeManualMove(state(), move({ roomId: "room-ir-small" }), model(true));
    expect(decision.comparison.legacy.accepts).toBe(true);
    expect(decision.comparison.constraintIr.accepts).toBe(false);
    expect(decision.comparison.disagreement).toBe("IR_STRICTER");
    expect(decision.accepted).toBe(false);
    expect(decision.blocker?.code).toBe("MANUAL_MOVE_IR_REJECTED");
    expect(decision.blocker?.ruleIds).toContain("IR-CAP-1");
  });

  it("derives canonical end time and allows a legal move within an explicitly incomplete draft", () => {
    const decision = evaluateAuthoritativeManualMove(
      state(),
      move({ startTime: "18:15", endTime: "18:30" }),
      model(),
    );
    expect(decision.accepted).toBe(true);
    expect(decision.comparison.candidate.after?.startTime).toBe("18:15");
    expect(decision.comparison.candidate.after?.endTime).toBe("19:15");
    expect(decision.draftStatus.scheduleComplete).toBe(false);
    expect(decision.draftStatus.unscheduledSessionIds).toEqual(["s2"]);
    expect(decision.draftStatus.publishable).toBe(false);
  });

  it("marks repair mode explicitly and accepts a move that removes the IR conflict", () => {
    const conflicted = state([{ ...assignment, roomId: "room-ir-small" }]);
    const decision = evaluateAuthoritativeManualMove(conflicted, move({ roomId: "room-wide" }), model(true));
    expect(decision.draftStatus.mode).toBe("REPAIR");
    expect(decision.comparison.constraintIr.beforeHardViolations).toBeGreaterThan(0);
    expect(decision.comparison.constraintIr.afterHardViolations).toBe(0);
    expect(decision.accepted).toBe(true);
  });

  it("fails structural lock semantics before evaluating a moved candidate", () => {
    expect(() => evaluateAuthoritativeManualMove(
      state([{ ...assignment, locked: true }]),
      move({ startTime: "18:00" }),
      model(),
    )).toThrow(/LOCKED_ASSIGNMENT/);
  });
});

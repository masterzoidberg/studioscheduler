import { describe, expect, it } from "vitest";
import type { Assignment, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { evaluateAuthoritativeScheduleRecovery } from "@/lib/schedule-recovery";

const now = "2026-09-07T00:00:00Z";
const node = (value: Partial<ConstraintIRNode> & Pick<ConstraintIRNode, "id" | "kind">): ConstraintIRNode => ({
  id: value.id, kind: value.kind, ruleIds: value.ruleIds ?? [value.id], selector: value.selector ?? {}, parameters: value.parameters ?? {}, explanation: value.explanation ?? value.id,
});

function state(current: Assignment[], durationMinutes = 90): StudioState {
  return {
    studioId: "studio", studioName: "Fixture",
    teachers: [{ id: "t1", name: "Teacher", subjects: ["Ballet"] }],
    rooms: [{ id: "r1", name: "Room", capacity: 99, features: [] }],
    students: [], cohorts: [],
    classes: [{ id: "c1", name: "Ballet 5", subject: "Ballet", level: "5", durationMinutes, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: ["t1"] }],
    sessions: [{ id: "s1", classId: "c1", ordinal: 1 }],
    rules: [], rulebookVersions: [{ id: "rb", version: 1, name: "Fixture", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [], planningDatasetVersions: [], enforcementProposals: [], ruleHistory: [],
    scheduleVersions: [{ id: "current", version: 4, rulebookVersion: 1, enforcementVersion: 1, planningDatasetVersion: 2, createdAt: now, actor: "test", reason: "test", assignments: current, isCurrent: true }],
    scenarios: [], auditEvents: [],
  };
}

function model(extra: ConstraintIRNode[] = []): ConstraintModelSnapshotV1 {
  const qualification = node({
    id: "teacher-domain",
    kind: "TEACHER_SUBJECT_DOMAIN",
    selector: { teacherNames: ["Teacher"] },
    parameters: { allowedSubjects: ["Ballet"] },
  });
  const hardConstraints = [qualification, ...extra];
  return {
    schemaVersion: "1.0", compilerVersion: "t12-test", rulebookVersion: 1, planningDatasetVersion: 2, activeRuleCount: hardConstraints.length,
    hardConstraints, objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,
  };
}

const source: Assignment = { id: "a1", sessionId: "s1", day: "Monday", startTime: "17:15", endTime: "18:45", teacherId: "t1", roomId: "r1", locked: false, status: "NORMAL" };

describe("T12 authoritative recovery", () => {
  it("normalizes historical end time from the current session duration without mutating the source", () => {
    const historical = { ...source, endTime: "18:15" };
    const decision = evaluateAuthoritativeScheduleRecovery(state([source], 105), [historical], "UNDO", model());
    expect(decision.accepted).toBe(true);
    expect(decision.candidateAssignments[0].endTime).toBe("19:00");
    expect(historical.endTime).toBe("18:15");
    expect(decision.draftStatus.scheduleComplete).toBe(true);
  });

  it("REBASE retires an assignment whose active session no longer has an active resource and leaves a visible draft gap", () => {
    const s = state([source]);
    s.teachers = [];
    const decision = evaluateAuthoritativeScheduleRecovery(s, [source], "REBASE", model());
    expect(decision.accepted).toBe(true);
    expect(decision.candidateAssignments).toEqual([]);
    expect(decision.draftStatus.retiredAssignmentIds).toEqual(["a1"]);
    expect(decision.draftStatus.unscheduledSessionIds).toEqual(["s1"]);
    expect(decision.draftStatus.publishable).toBe(false);
  });

  it("UNDO fails clearly instead of silently skipping an active-session placement whose resource is inactive", () => {
    const s = state([source]);
    s.rooms = [];
    const decision = evaluateAuthoritativeScheduleRecovery(s, [source], "UNDO", model());
    expect(decision.accepted).toBe(false);
    expect(decision.blocker?.code).toBe("RECOVERY_SOURCE_RESOURCE_INACTIVE");
  });

  it("rejects a historical placement that violates current policy", () => {
    const fixed = node({ id: "fixed", kind: "FIXED_ASSIGNMENT", selector: { classNames: ["Ballet 5"] }, parameters: { day: "Tuesday", start: "17:15", end: "18:45" } });
    const decision = evaluateAuthoritativeScheduleRecovery(state([source]), [source], "UNDO", model([fixed]));
    expect(decision.accepted).toBe(false);
    expect(decision.blocker?.code).toBe("RECOVERY_CURRENT_POLICY_REJECTED");
  });

  it("does not let one-step undo remove or relocate an effective current lock", () => {
    const locked = { ...source, locked: true };
    const old = { ...source, day: "Tuesday" as const };
    const decision = evaluateAuthoritativeScheduleRecovery(state([locked]), [old], "UNDO", model());
    expect(decision.accepted).toBe(false);
    expect(decision.blocker?.code).toBe("LOCKED_SESSION_PLACEMENT_CHANGED");
  });

  it("treats an archived source session as historical provenance rather than active schedule truth", () => {
    const s = state([]);
    s.sessions = [];
    s.classes = [];
    const decision = evaluateAuthoritativeScheduleRecovery(s, [source], "REBASE", model());
    expect(decision.accepted).toBe(true);
    expect(decision.candidateAssignments).toEqual([]);
    expect(decision.draftStatus.retiredAssignmentIds).toEqual(["a1"]);
    expect(decision.draftStatus.scheduleComplete).toBe(true);
  });
});

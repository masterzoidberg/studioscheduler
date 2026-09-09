import { describe, expect, it } from "vitest";
import type { Assignment, RuleEnforcementMapping, SchedulePatch, StudioRule, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import { evaluateAuthoritativeScheduleCommand } from "@/lib/manual-move-command";

const now = "2026-09-07T00:00:00Z";

function rule(id: string): StudioRule {
  return {
    id, category: "Fixture", type: null, title: id, description: id, strength: "HARD", classificationRaw: "HARD",
    status: "ACTIVE", verificationStatus: "VERIFIED", reviewStatus: "VERIFIED", review: { verified: true },
    affectedEntityIds: [], parameters: {}, exceptions: [], source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now,
  };
}

function state(assignments: Assignment[] = [], withFrequency = false): StudioState {
  const frequency: RuleEnforcementMapping = { ruleId: "FREQ", type: "CLASS_FREQUENCY", parameters: {}, affectedEntityIds: [], exceptions: [] };
  return {
    studioId: "studio", studioName: "Fixture",
    teachers: [{ id: "t1", name: "Teacher", subjects: ["Ballet"] }],
    rooms: [{ id: "wide", name: "Wide", capacity: 99, features: [] }, { id: "small", name: "Small", capacity: 99, features: [] }],
    students: [{ id: "p1", name: "P1", level: "1" }, { id: "p2", name: "P2", level: "1" }], cohorts: [],
    classes: [{ id: "anchor", name: "Anchor", subject: "Ballet", level: "1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["p1", "p2"], eligibleTeacherIds: ["t1"] }],
    sessions: [{ id: "s-anchor", classId: "anchor", ordinal: 1 }],
    rules: withFrequency ? [rule("FREQ")] : [],
    rulebookVersions: [{ id: "rb", version: 1, name: "Fixture", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: withFrequency ? [{ id: "ev", version: 1, rulebookVersion: 1, createdAt: now, actor: "test", reason: "test", changedRuleIds: [], snapshot: [frequency], status: "CURRENT" }] : [],
    planningDatasetVersions: [], enforcementProposals: [], ruleHistory: [],
    scheduleVersions: [{ id: "sv", version: 1, rulebookVersion: 1, enforcementVersion: 1, planningDatasetVersion: 1, createdAt: now, actor: "test", reason: "test", assignments, isCurrent: true }],
    scenarios: [], auditEvents: [],
  };
}

const node = (value: Partial<ConstraintIRNode> & Pick<ConstraintIRNode, "id" | "kind">): ConstraintIRNode => ({
  id: value.id, kind: value.kind, ruleIds: value.ruleIds ?? [value.id], selector: value.selector ?? {}, parameters: value.parameters ?? {}, explanation: value.explanation ?? value.id,
});

function model(includeFixed = true, includeCapacity = true): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0", compilerVersion: "t11-test", rulebookVersion: 1, planningDatasetVersion: 1, activeRuleCount: 1,
    hardConstraints: [
      node({ id: "teacher-domain", kind: "TEACHER_SUBJECT_DOMAIN", selector: { teacherNames: ["Teacher"] }, parameters: { allowedSubjects: ["Ballet"] } }),
      ...(includeFixed ? [node({ id: "fixed-anchor", kind: "FIXED_ASSIGNMENT", selector: { classNames: ["Anchor"] }, parameters: { day: "Monday", start: "18:00", end: "19:00" } })] : []),
      ...(includeCapacity ? [node({ id: "small-capacity", kind: "ROOM_CAPACITY", selector: { roomNames: ["Small"] }, parameters: { maxDancers: 1, exemptLevels: [] } })] : []),
    ],
    objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,
  };
}

function assign(roomId = "wide"): SchedulePatch {
  return { id: "assign", operation: "ASSIGN", assignmentId: "", changes: { sessionId: "s-anchor", day: "Monday", startTime: "18:00", teacherId: "t1", roomId }, reason: "T11 assign", proposedBy: "USER" };
}
function unassign(): SchedulePatch {
  return { id: "unassign", operation: "UNASSIGN", assignmentId: "a-anchor", changes: {}, reason: "T11 unassign", proposedBy: "USER" };
}
const placed: Assignment = { id: "a-anchor", sessionId: "s-anchor", day: "Monday", startTime: "18:00", endTime: "19:00", teacherId: "t1", roomId: "wide", status: "NORMAL" };

describe("T11 authoritative incremental ASSIGN/UNASSIGN", () => {
  it("rejects a new placement violation even when it replaces an equal-count completeness finding", () => {
    const decision = evaluateAuthoritativeScheduleCommand(state(), assign("small"), model(true, true));
    expect(decision.comparison.constraintIr.beforeHardViolations).toBe(1);
    expect(decision.comparison.constraintIr.afterHardViolations).toBe(1);
    expect(decision.comparison.constraintIr.beforeBlockingHardViolations).toBe(0);
    expect(decision.comparison.constraintIr.newBlockingViolationKeys).toHaveLength(1);
    expect(decision.accepted).toBe(false);
    expect(decision.blocker?.code).toBe("INCREMENTAL_COMMAND_IR_REJECTED");
  });

  it("accepts a legal ASSIGN and derives the canonical interval", () => {
    const decision = evaluateAuthoritativeScheduleCommand(state(), assign("wide"), model(true, true));
    expect(decision.accepted).toBe(true);
    expect(decision.comparison.candidate.after?.endTime).toBe("19:00");
    expect(decision.draftStatus.scheduleComplete).toBe(true);
    expect(decision.draftStatus.publishable).toBe(true);
  });

  it("allows UNASSIGN to create a visible fixed-session completeness obligation instead of blocking construction", () => {
    const decision = evaluateAuthoritativeScheduleCommand(state([placed]), unassign(), model(true, false));
    expect(decision.accepted).toBe(true);
    expect(decision.comparison.constraintIr.afterHardViolations).toBe(1);
    expect(decision.comparison.constraintIr.afterBlockingHardViolations).toBe(0);
    expect(decision.draftStatus.scheduleComplete).toBe(false);
    expect(decision.draftStatus.completenessObligationKeys.length).toBeGreaterThan(0);
    expect(decision.draftStatus.publishable).toBe(false);
  });

  it("treats legacy CLASS_FREQUENCY as completeness rather than an UNASSIGN placement blocker", () => {
    const decision = evaluateAuthoritativeScheduleCommand(state([placed], true), unassign(), model(false, false));
    expect(decision.comparison.legacy.afterHardViolations).toBe(1);
    expect(decision.comparison.legacy.afterBlockingHardViolations).toBe(0);
    expect(decision.comparison.legacy.accepts).toBe(true);
    expect(decision.accepted).toBe(true);
  });

  it("rejects duplicate, unknown-resource, and locked structural commands before persistence", () => {
    expect(() => evaluateAuthoritativeScheduleCommand(state([placed]), assign(), model(false, false))).toThrow(/SESSION_ALREADY_ASSIGNED/);
    expect(() => evaluateAuthoritativeScheduleCommand(state(), { ...assign(), changes: { ...assign().changes, teacherId: "archived-or-unknown" } }, model(false, false))).toThrow(/not part of this studio/);
    expect(() => evaluateAuthoritativeScheduleCommand(state([{ ...placed, locked: true }]), unassign(), model(false, false))).toThrow(/LOCKED_ASSIGNMENT/);
  });

  it("emits a missing DIRECTLY_AFTER counterpart as a non-placement completeness finding", () => {
    const s = state([placed]);
    s.classes.push({ id: "pre", name: "Pre", subject: "Ballet", level: "1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: ["t1"] });
    s.sessions.push({ id: "s-pre", classId: "pre", ordinal: 1 });
    const directModel = model(false, false);
    directModel.hardConstraints.push(node({ id: "direct", kind: "DIRECTLY_AFTER", parameters: { predecessor: "Pre", successor: "Anchor", gapMinutes: 0 }, selector: { classNames: ["Pre", "Anchor"] } }));
    const result = validateConstraintModelSchedule(s, directModel, [placed]);
    const finding = result.violations.find((violation) => violation.constraintId === "direct");
    expect(finding).toBeDefined();
    expect(finding?.assignmentIds).toEqual([]);
  });
});

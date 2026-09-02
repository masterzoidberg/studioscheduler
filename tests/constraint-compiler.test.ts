import { describe, expect, it } from "vitest";
import type { StudioRule, StudioState } from "@/lib/domain";
import { compileConstraintModel } from "@/lib/constraint-compiler";

const prefixCounts: Record<string, number> = {
  ADV: 4, AIM: 9, BAL: 14, CAM: 19, CUR: 9, DATA: 8, DEN: 5, FIX: 4, FRI: 3,
  JAE: 3, JAL: 3, KAR: 14, KHY: 3, MEL: 3, OPS: 17, OPT: 9, REV: 2, ROOM: 14,
  SEQ: 9, STU: 22, SYD: 4,
};
const ruleIds = Object.entries(prefixCounts)
  .flatMap(([prefix, count]) => Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`));

function rule(id: string): StudioRule {
  const rank = id.startsWith("OPT-") ? Number(id.slice(-1)) : null;
  return {
    id,
    category: id.startsWith("OPT-") ? "Optimization Priorities" : "test",
    type: null,
    title: rank ? `Priority ${rank}` : id,
    description: id === "DATA-008"
      ? "Do not assume sibling scheduling, carpool restrictions, parent pickup restrictions, school commute times, teacher daily-hour limits, mandatory teacher breaks, room reset time, Sunday regular classes, or special room equipment unless explicitly added later."
      : id === "STU-001"
        ? "Assume dancers are available for whatever valid schedule DWDE establishes; do not model individual family availability restrictions initially."
        : rank
          ? `${rank} priority`
          : `${id} policy`,
    strength: null,
    classificationRaw: rank ? `PRIORITY ${rank}` : "HARD",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    reviewStatus: "VERIFIED",
    review: { decision: "APPROVED", verified: true },
    affectedEntityIds: [],
    parameters: {},
    exceptions: [],
    source: { type: "IMPORT" },
    sourceRaw: { type: "DWDE_RULEBOOK_REVIEW" },
    versionIntroduced: 2,
    updatedAt: "2026-09-02T00:00:00Z",
  };
}

function state(): StudioState {
  return {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [], rooms: [], students: [], cohorts: [], classes: [], sessions: [],
    rules: ruleIds.map(rule),
    rulebookVersions: [{ id: "rb2", version: 2, name: "Rulebook V2", createdAt: "2026-09-02", actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [], enforcementProposals: [], ruleHistory: [], scheduleVersions: [], scenarios: [], auditEvents: [],
    planningDatasetVersions: [{
      id: "pdv3", version: 3, createdAt: "2026-09-02", actor: "test", reason: "test", snapshotHash: "0".repeat(64), status: "CURRENT",
      snapshot: { schemaVersion: "1.2", studioId: "studio", sourceManifest: null, teacherIds: [], rooms: [], students: [], cohorts: [], classes: [], sessions: [] },
    }],
  };
}

function findConstraint(model: ReturnType<typeof compileConstraintModel>, id: string) {
  return model.hardConstraints.find((node) => node.id === id);
}

describe("canonical Constraint IR compiler", () => {
  it("pins the Rulebook and Planning Dataset context", () => {
    const model = compileConstraintModel(state());
    expect(model).toMatchObject({
      schemaVersion: "1.0",
      compilerVersion: "dwde-ir-0.1",
      rulebookVersion: 2,
      planningDatasetVersion: 3,
      activeRuleCount: 178,
    });
  });

  it("compiles core HARD resource and time semantics into typed IR", () => {
    const model = compileConstraintModel(state());
    expect(findConstraint(model, "room-no-overlap")).toMatchObject({ kind: "RESOURCE_NO_OVERLAP", ruleIds: ["OPS-008"], parameters: { resource: "ROOM" } });
    expect(findConstraint(model, "teacher-no-overlap")).toMatchObject({ kind: "RESOURCE_NO_OVERLAP", ruleIds: ["OPS-009"], parameters: { resource: "TEACHER" } });
    expect(findConstraint(model, "student-no-overlap")?.ruleIds).toEqual(["OPS-010", "STU-003"]);
    expect(findConstraint(model, "fifteen-minute-grid")).toMatchObject({ kind: "TIME_GRID", parameters: { minutes: 15 } });
    expect(findConstraint(model, "saturday-hard-close")).toMatchObject({ kind: "DAY_TIME_WINDOW", parameters: { days: ["Saturday"], latestFinish: "15:00" } });
  });

  it("structures teacher, room, sequence, fixed-anchor, and relationship rules without legacy class eligibility arrays", () => {
    const s = state();
    s.classes = [{ id: "class-x", name: "Fake", subject: "Ballet", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: ["legacy-teacher"] }];
    const before = compileConstraintModel(s);
    s.classes[0].eligibleTeacherIds = ["different-legacy-teacher"];
    const after = compileConstraintModel(s);
    expect(after).toEqual(before);

    expect(findConstraint(before, "cami-required-jazz-3")).toMatchObject({ kind: "REQUIRED_TEACHER", parameters: { teacherName: "Cami" } });
    expect(findConstraint(before, "ballet-levels-studio-a")).toMatchObject({ kind: "REQUIRED_ROOM", parameters: { roomName: "Studio A" } });
    expect(findConstraint(before, "jazz-3-contemporary-lyrical-3")).toMatchObject({ kind: "DIRECTLY_AFTER", parameters: { gapMinutes: 0 } });
    expect(findConstraint(before, "combo-1-fixed")).toMatchObject({ kind: "FIXED_ASSIGNMENT", parameters: { lockType: "POLICY_FIXED" } });
    expect(findConstraint(before, "karly-daughter-start-alignment")).toMatchObject({ kind: "RELATIONSHIP_START_WINDOW", parameters: { maxStartDifferenceMinutes: 30 } });
  });

  it("preserves the authoritative OPT-001 through OPT-009 lexicographic spine", () => {
    const model = compileConstraintModel(state());
    expect(model.objectivePrioritySpine.map((item) => [item.ruleId, item.rank])).toEqual([
      ["OPT-001", 1], ["OPT-002", 2], ["OPT-003", 3], ["OPT-004", 4], ["OPT-005", 5],
      ["OPT-006", 6], ["OPT-007", 7], ["OPT-008", 8], ["OPT-009", 9],
    ]);
  });

  it("turns explicit negative-space rules into governance assertions, not solver constraints", () => {
    const model = compileConstraintModel(state());
    expect(model.governanceAssertions.find((item) => item.ruleId === "DATA-008")?.assertion).toContain("Do not assume sibling scheduling");
    expect(model.governanceAssertions.find((item) => item.ruleId === "STU-001")?.assertion).toContain("do not model individual family availability restrictions initially");
    expect(model.hardConstraints.some((node) => node.ruleIds.includes("DATA-008") || node.ruleIds.includes("STU-001"))).toBe(false);
  });

  it("stays explicitly partial until every CONSTRAINT_IR rule has one canonical interpretation", () => {
    const model = compileConstraintModel(state());
    expect(model.completeHardConstraintCompilation).toBe(false);
    expect(model.uncompiledConstraintRuleIds).toContain("OPS-001");
    expect(model.uncompiledConstraintRuleIds).toContain("ADV-001");
    expect(model.uncompiledConstraintRuleIds.length).toBeGreaterThan(0);
  });

  it("is deterministic when Rulebook input order changes", () => {
    const a = state();
    const b = state();
    b.rules.reverse();
    expect(compileConstraintModel(b)).toEqual(compileConstraintModel(a));
  });
});

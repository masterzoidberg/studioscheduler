import { describe, expect, it } from "vitest";
import type { StudioRule, StudioState } from "@/lib/domain";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";

const prefixCounts: Record<string, number> = {
  ADV: 4, AIM: 9, BAL: 14, CAM: 19, CUR: 9, DATA: 8, DEN: 5, FIX: 4, FRI: 3,
  JAE: 3, JAL: 3, KAR: 14, KHY: 3, MEL: 3, OPS: 17, OPT: 9, REV: 2, ROOM: 14,
  SEQ: 9, STU: 22, SYD: 4,
};
const ruleIds = Object.entries(prefixCounts)
  .flatMap(([prefix, count]) => Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`));

function rule(id: string): StudioRule {
  const rank = id.startsWith("OPT-") ? Number(id.slice(-1)) : null;
  const descriptions: Record<string, string> = {
    "OPS-001": "Regular weekday classes may not start before 4:45 PM unless a level-specific exception applies.",
    "OPS-002": "Only Elementary 1, Elementary 2, Level 4B, Level 4B/5, and Level 5 may start at 4:30 PM when needed. All other regular weekday classes have a HARD 4:45 PM earliest start. 4:45 PM remains the preferred normal weekday start time for all classes, including the exception levels.",
    "ADV-001": "For relevant Level 4B and Level 5 dancers marked as required, the dancer must take the immediately lower-level class in the same subject.",
    "ADV-002": "Required lower-level participation applies across Ballet, Jazz, Tap, and Contemporary where indicated by the rosters.",
    "ADV-003": "The required lower-level class does not have to occur on the same day as the advanced class.",
    "ADV-004": "For Kiran Landis, the normal lower-level requirement does not apply to Jazz or Contemporary. Kiran's extra/lower-level Tap class remains a HARD requirement. Kiran's Ballet placement and training remain a priority, but Ballet is not treated as a HARD lower-level requirement under this exception.",
    "CUR-009": "Do not remove required lower-level participation unless Cami explicitly changes the rule.",
  };
  return {
    id,
    category: id.startsWith("OPT-") ? "Optimization Priorities" : "test",
    type: null,
    title: rank ? `Priority ${rank}` : id,
    description: descriptions[id] ?? (id === "DATA-008"
      ? "Do not assume sibling scheduling, carpool restrictions, parent pickup restrictions, school commute times, teacher daily-hour limits, mandatory teacher breaks, room reset time, Sunday regular classes, or special room equipment unless explicitly added later."
      : id === "STU-001"
        ? "Assume dancers are available for whatever valid schedule DWDE establishes; do not model individual family availability restrictions initially."
        : rank
          ? `${rank} priority`
          : `${id} policy`),
    strength: null,
    classificationRaw: id === "ADV-004" ? "EXCEPTION" : rank ? `PRIORITY ${rank}` : "HARD",
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
    rulebookVersions: [{ id: "rb3", version: 3, name: "Rulebook V3", createdAt: "2026-09-02", actor: "test", reason: "post-review confirmations", changedRuleIds: ["ADV-004", "OPS-002"], status: "CURRENT" }],
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
      compilerVersion: "dwde-ir-0.2",
      rulebookVersion: 3,
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

  it("compiles the V3 weekday 4:30 exception without turning 4:15 display space into legal schedule time", () => {
    const model = compileConstraintModel(state());
    expect(findConstraint(model, "weekday-earliest-start")).toMatchObject({
      kind: "DAY_TIME_WINDOW",
      ruleIds: ["OPS-001", "OPS-002"],
      parameters: {
        normalEarliestStart: "16:45",
        exceptionEarliestStart: "16:30",
        exceptionLevels: ["Elementary 1", "Elementary 2", "Level 4B", "Level 4B/5", "Level 5"],
        preferredNormalStart: "16:45",
        displayOnlyEarlierTime: "16:15",
      },
    });
  });

  it("compiles Kiran's V3 progression exception with Tap HARD and Ballet priority only", () => {
    const model = compileConstraintModel(state());
    expect(findConstraint(model, "required-lower-level-progression")).toMatchObject({
      kind: "REQUIRED_LOWER_LEVEL",
      ruleIds: ["ADV-001", "ADV-002", "ADV-003", "ADV-004", "CUR-009"],
      parameters: {
        appliesWhenMarkedRequired: true,
        relationship: "IMMEDIATELY_LOWER_LEVEL_SAME_SUBJECT",
        sameDayRequired: false,
        exceptions: [{
          studentName: "Kiran Landis",
          hardSubjects: ["Tap"],
          excludedHardSubjects: ["Ballet", "Jazz", "Contemporary"],
          softPrioritySubjects: ["Ballet"],
        }],
      },
    });
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

  it("removes resolved V3 semantics from the uncompiled set but remains explicitly partial", () => {
    const model = compileConstraintModel(state());
    expect(model.completeHardConstraintCompilation).toBe(false);
    expect(model.uncompiledConstraintRuleIds).not.toContain("OPS-001");
    expect(model.uncompiledConstraintRuleIds).not.toContain("ADV-001");
    expect(model.uncompiledConstraintRuleIds).not.toContain("ADV-004");
    expect(model.uncompiledConstraintRuleIds).not.toContain("CUR-009");
    expect(model.uncompiledConstraintRuleIds).toContain("AIM-006");
    expect(model.uncompiledConstraintRuleIds.length).toBeGreaterThan(0);
  });

  it("is deterministic when Rulebook input order changes", () => {
    const a = state();
    const b = state();
    b.rules.reverse();
    expect(compileConstraintModel(b)).toEqual(compileConstraintModel(a));
  });
});

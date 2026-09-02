import { describe, expect, it } from "vitest";
import type { ClassDefinition, ClassSession, StudioRule, StudioState } from "@/lib/domain";
import { buildPlanningDatasetSnapshot } from "@/lib/planning-dataset";
import { BALLET_STRUCTURE_REQUIREMENTS, evaluateScheduleReadiness } from "@/lib/schedule-readiness";
import { sessionDurationMinutes } from "@/lib/schedule-builder";

const now = "2026-09-02T08:00:00Z";
const prefixCounts: Record<string, number> = {
  ADV: 4, AIM: 9, BAL: 14, CAM: 19, CUR: 9, DATA: 8, DEN: 5, FIX: 4, FRI: 3,
  JAE: 3, JAL: 3, KAR: 14, KHY: 3, MEL: 3, OPS: 17, OPT: 9, REV: 2, ROOM: 14,
  SEQ: 9, STU: 22, SYD: 4,
};
const ruleIds = Object.entries(prefixCounts)
  .flatMap(([prefix, count]) => Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`));

function rule(id: string): StudioRule {
  return {
    id, category: "test", type: null, title: id, description: id, strength: null, classificationRaw: "HARD",
    status: "ACTIVE", verificationStatus: "VERIFIED", reviewStatus: "VERIFIED", review: { decision: "APPROVED", verified: true },
    affectedEntityIds: [], parameters: {}, exceptions: [], source: { type: "IMPORT" }, sourceRaw: { type: "DWDE_RULEBOOK_REVIEW" },
    versionIntroduced: 2, updatedAt: now,
  };
}

function completeBalletData() {
  const classes: ClassDefinition[] = [];
  const sessions: ClassSession[] = [];
  for (const [classIndex, requirement] of BALLET_STRUCTURE_REQUIREMENTS.entries()) {
    const id = `class-${classIndex + 1}`;
    const firstDuration = requirement.durations?.[0] ?? 90;
    classes.push({
      id,
      name: requirement.className,
      subject: requirement.className.includes("Pointe") ? "Pointe" : "Ballet",
      level: "test",
      durationMinutes: firstDuration,
      weeklyFrequency: requirement.frequency,
      rosterStudentIds: [],
      eligibleTeacherIds: [],
    });
    for (let ordinal = 1; ordinal <= requirement.frequency; ordinal += 1) {
      const expectedDuration = requirement.durations?.[ordinal - 1];
      sessions.push({
        id: `session-${classIndex + 1}-${ordinal}`,
        classId: id,
        ordinal,
        durationMinutes: expectedDuration === undefined || expectedDuration === firstDuration ? undefined : expectedDuration,
      });
    }
  }
  return { classes, sessions };
}

function state(): StudioState {
  const { classes, sessions } = completeBalletData();
  const base: StudioState = {
    studioId: "studio",
    studioName: "DWDE",
    teachers: [], rooms: [], students: [], cohorts: [], classes, sessions,
    rules: ruleIds.map(rule),
    rulebookVersions: [{ id: "rb3", version: 3, name: "Rulebook V3", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [{ id: "ev1", version: 1, rulebookVersion: 3, createdAt: now, actor: "test", reason: "test", changedRuleIds: [], snapshot: [], status: "CURRENT" }],
    enforcementProposals: [], ruleHistory: [],
    scheduleVersions: [{ id: "sv1", version: 1, rulebookVersion: 3, enforcementVersion: 1, planningDatasetVersion: 1, createdAt: now, actor: "test", reason: "test", assignments: [], isCurrent: true }],
    scenarios: [], auditEvents: [],
  };
  base.planningDatasetVersions = [{ id: "pdv1", version: 1, createdAt: now, actor: "test", reason: "test", snapshot: buildPlanningDatasetSnapshot(base), snapshotHash: "0".repeat(64), status: "CURRENT" }];
  return base;
}

function pinCompleteSourceManifest(s: StudioState) {
  const current = s.planningDatasetVersions!.find((version) => version.status === "CURRENT")!;
  current.snapshot.sourceManifest = {
    version: 1,
    snapshotHash: "f".repeat(64),
    complete: true,
    snapshot: {
      schemaVersion: "1.0",
      sources: [{ sourceId: "historical-rosters", kind: "ROSTER_SET", label: "Frozen class and roster comparison baseline", sha256: "e".repeat(64) }],
      classes: s.classes.map((klass) => {
        const sessions = s.sessions.filter((session) => session.classId === klass.id).sort((a, b) => a.ordinal - b.ordinal);
        return {
          id: klass.id,
          name: klass.name,
          weeklyFrequency: klass.weeklyFrequency,
          sessionDurations: sessions.map((session) => sessionDurationMinutes(session, klass)),
          rosterStudentIds: [...klass.rosterStudentIds],
        };
      }),
    },
  };
}

describe("Ready-to-Schedule gate", () => {
  it("accepts mixed per-session Ballet 4B/5 durations structurally", () => {
    const report = evaluateScheduleReadiness(state());
    expect(report.ruleCoverage).toMatchObject({ activeRules: 178, accountedRules: 178, complete: true });
    expect(report.blockers.some((issue) => issue.code === "CLASS_DURATION_MISMATCH" && issue.ruleIds.includes("BAL-009"))).toBe(false);
    expect(report.blockers.some((issue) => issue.code === "CLASS_FREQUENCY_MISMATCH" && issue.ruleIds.includes("BAL-009"))).toBe(false);
  });

  it("blocks automatic solving when no authoritative roster/source baseline is pinned", () => {
    const report = evaluateScheduleReadiness(state());
    expect(report.ready).toBe(false);
    const source = report.blockers.find((issue) => issue.code === "SOURCE_MANIFEST_NOT_PINNED");
    expect(source?.severity).toBe("BLOCKER");
    expect(source?.message).toContain("automatic solving is blocked");
    expect(report.warnings.some((issue) => issue.code === "SOURCE_MANIFEST_NOT_PINNED")).toBe(false);
    expect(report.sourceManifestVersion).toBeNull();
    expect(report.sourceManifestComplete).toBe(false);
  });

  it("uses a complete source manifest as provenance while later roster drift remains a warning", () => {
    const s = state();
    pinCompleteSourceManifest(s);
    const report = evaluateScheduleReadiness(s);
    expect(report.sourceManifestVersion).toBe(1);
    expect(report.sourceManifestComplete).toBe(true);
    expect(report.blockers.filter((issue) => issue.code.startsWith("SOURCE_MANIFEST_")).length).toBe(0);
    expect(report.warnings.filter((issue) => issue.code.startsWith("SOURCE_MANIFEST_")).length).toBe(0);

    s.students.push({ id: "student-new", name: "New Student", level: "test", cohortIds: [] });
    s.classes[0].rosterStudentIds = ["student-new"];
    const changed = evaluateScheduleReadiness(s);
    expect(changed.blockers.some((issue) => issue.code === "SOURCE_MANIFEST_ROSTER_MISMATCH")).toBe(false);
    expect(changed.warnings.some((issue) => issue.code === "SOURCE_MANIFEST_ROSTER_MISMATCH")).toBe(true);
    expect(changed.blockers.some((issue) => issue.code === "ROSTER_STUDENT_MISSING")).toBe(false);
  });

  it("still blocks Rulebook-required curriculum structure mismatches in fluid inventory", () => {
    const s = state();
    const elementary2 = s.classes.find((klass) => klass.name === "Elementary Ballet 2")!;
    elementary2.durationMinutes = 60;
    elementary2.weeklyFrequency = 1;
    s.sessions = s.sessions.filter((session) => session.classId !== elementary2.id || session.ordinal === 1);

    const ballet3 = s.classes.find((klass) => klass.name === "Ballet 3")!;
    ballet3.weeklyFrequency = 1;
    s.sessions = s.sessions.filter((session) => session.classId !== ballet3.id || session.ordinal === 1);

    const report = evaluateScheduleReadiness(s);
    expect(report.blockers.some((issue) => issue.code === "CLASS_FREQUENCY_MISMATCH" && issue.ruleIds.includes("BAL-002"))).toBe(true);
    expect(report.blockers.some((issue) => issue.code === "CLASS_FREQUENCY_MISMATCH" && issue.ruleIds.includes("BAL-005"))).toBe(true);
  });

  it("blocks dangling roster references even though enrollment itself is fluid", () => {
    const s = state();
    s.classes[0].rosterStudentIds = ["student-does-not-exist"];
    const report = evaluateScheduleReadiness(s);
    expect(report.blockers.some((issue) => issue.code === "ROSTER_STUDENT_MISSING")).toBe(true);
  });

  it("treats a newer PlanningDatasetVersion as schedule staleness", () => {
    const s = state();
    s.planningDatasetVersions = [{ ...s.planningDatasetVersions![0], id: "pdv2", version: 2 }];
    const report = evaluateScheduleReadiness(s);
    expect(report.blockers.some((issue) => issue.code === "SCHEDULE_PLANNING_DATASET_STALE")).toBe(true);
  });

  it("checks the reviewed Karly-daughter class list against current enrollment", () => {
    const s = state();
    s.students.push({ id: "student-daughter", name: "Karly's daughter", level: "Level 4B", cohortIds: [] });
    for (const name of ["Jazz 2", "Lyrical 2", "Tap 2", "Hip Hop 2", "Pre-Company Technique 1"]) {
      s.classes.push({
        id: `class-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name,
        subject: name.split(" ")[0],
        level: "Level 2",
        durationMinutes: 60,
        weeklyFrequency: 1,
        rosterStudentIds: name === "Hip Hop 2" ? ["student-daughter"] : [],
        eligibleTeacherIds: [],
      });
    }
    const ballet2 = s.classes.find((klass) => klass.name === "Ballet 2")!;
    ballet2.rosterStudentIds = ["student-daughter"];

    const report = evaluateScheduleReadiness(s);
    const rosterFindings = report.blockers.filter((issue) => issue.code === "KARLY_DAUGHTER_ROSTER_MISSING");
    expect(rosterFindings).toHaveLength(4);
    expect(rosterFindings.every((issue) => issue.ruleIds.includes("KAR-008") && issue.ruleIds.includes("STU-002"))).toBe(true);
    expect(report.blockers.some((issue) => issue.code === "KARLY_DAUGHTER_CLASS_MISSING")).toBe(false);
  });

  it("surfaces unbound named Constraint IR references as readiness blockers", () => {
    const report = evaluateScheduleReadiness(state());
    expect(report.constraintBinding.valid).toBe(false);
    expect(report.blockers).toContainEqual(expect.objectContaining({
      code: "CONSTRAINT_ENTITY_MISSING",
      ruleIds: expect.arrayContaining(["CAM-008"]),
    }));
  });
});

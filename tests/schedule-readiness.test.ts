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
    rulebookVersions: [{ id: "rb2", version: 2, name: "Rulebook V2", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [{ id: "ev1", version: 1, rulebookVersion: 2, createdAt: now, actor: "test", reason: "test", changedRuleIds: [], snapshot: [], status: "CURRENT" }],
    enforcementProposals: [], ruleHistory: [],
    scheduleVersions: [{ id: "sv1", version: 1, rulebookVersion: 2, enforcementVersion: 1, planningDatasetVersion: 1, createdAt: now, actor: "test", reason: "test", assignments: [], isCurrent: true }],
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
      sources: [{ sourceId: "authoritative-rosters", kind: "ROSTER_SET", label: "Authoritative 2026-27 class and roster sources", sha256: "e".repeat(64) }],
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

  it("blocks automatic solving until an immutable complete source manifest is pinned", () => {
    const report = evaluateScheduleReadiness(state());
    expect(report.ready).toBe(false);
    const source = report.blockers.find((issue) => issue.code === "SOURCE_MANIFEST_NOT_PINNED");
    expect(source?.ruleIds).toEqual(["CUR-001", "CUR-002", "CUR-003", "CUR-004", "CUR-005", "CUR-006", "STU-002"]);
    expect(report.sourceManifestVersion).toBeNull();
    expect(report.sourceManifestComplete).toBe(false);
  });

  it("accepts a complete source manifest only when live inventory, durations, frequency, and rosters match", () => {
    const s = state();
    pinCompleteSourceManifest(s);
    const report = evaluateScheduleReadiness(s);
    expect(report.sourceManifestVersion).toBe(1);
    expect(report.sourceManifestComplete).toBe(true);
    expect(report.blockers.filter((issue) => issue.code.startsWith("SOURCE_MANIFEST_"))).toEqual([]);
    expect(report.ready).toBe(true);

    s.classes[0].rosterStudentIds = ["student-not-in-manifest"];
    const changed = evaluateScheduleReadiness(s);
    expect(changed.blockers.some((issue) => issue.code === "SOURCE_MANIFEST_ROSTER_MISMATCH")).toBe(true);
  });

  it("reports the representative-alpha curriculum mismatches instead of solving through them", () => {
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

  it("treats a newer PlanningDatasetVersion as schedule staleness", () => {
    const s = state();
    s.planningDatasetVersions = [{ ...s.planningDatasetVersions![0], id: "pdv2", version: 2 }];
    const report = evaluateScheduleReadiness(s);
    expect(report.blockers.some((issue) => issue.code === "SCHEDULE_PLANNING_DATASET_STALE")).toBe(true);
  });
});

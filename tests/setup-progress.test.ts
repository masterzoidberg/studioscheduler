import { describe, expect, it } from "vitest";
import type { StudioState } from "@/lib/domain";
import { buildSetupProgress } from "@/lib/setup-progress";

function state(overrides: Partial<StudioState> = {}): StudioState {
  return {
    studioId: "11111111-1111-4111-8111-111111111111",
    studioName: "Synthetic Studio",
    teachers: [],
    rooms: [],
    students: [],
    cohorts: [],
    classes: [],
    sessions: [],
    rules: [],
    rulebookVersions: [],
    enforcementVersions: [],
    planningDatasetVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [],
    scenarios: [],
    auditEvents: [],
    ...overrides,
  };
}

describe("SET-02 setup progress", () => {
  it("treats an empty workspace as first entry and selects Studio first", () => {
    const progress = buildSetupProgress(state());

    expect(progress.firstEntry).toBe(true);
    expect(progress.nextAction?.id).toBe("studio");
    expect(progress.sections.map((section) => section.id)).toEqual([
      "studio",
      "teachers",
      "classes",
      "students",
      "requirements",
      "preferences",
      "review",
    ]);
  });

  it("resumes a returning workspace at Classes after rooms and teachers exist", () => {
    const progress = buildSetupProgress(state({
      rooms: [{ id: "room-1", name: "Studio A", capacity: 20, features: [] }],
      teachers: [{ id: "teacher-1", name: "Teacher One", subjects: [] }],
    }));

    expect(progress.firstEntry).toBe(false);
    expect(progress.sections.find((section) => section.id === "studio")?.status).toBe("READY_FOR_NOW");
    expect(progress.sections.find((section) => section.id === "teachers")?.status).toBe("READY_FOR_NOW");
    expect(progress.nextAction?.id).toBe("classes");
  });

  it("keeps unavailable Preferences explicitly coming later rather than actionable", () => {
    const progress = buildSetupProgress(state());
    const preferences = progress.sections.find((section) => section.id === "preferences");

    expect(preferences?.status).toBe("COMING_LATER");
    expect(preferences?.href).toBeUndefined();
    expect(progress.actionableSections.some((section) => section.id === "preferences")).toBe(false);
  });

  it("requires Review when the current planning snapshot is not manager-confirmed", () => {
    const progress = buildSetupProgress(state({
      planningDatasetVersions: [{
        id: "planning-1",
        version: 1,
        createdAt: "2026-09-08T00:00:00Z",
        actor: "Verify Owner",
        reason: "Synthetic test",
        snapshot: {
          schemaVersion: "1.3",
          studioId: "11111111-1111-4111-8111-111111111111",
          teacherIds: [],
          rooms: [],
          students: [],
          cohorts: [],
          classes: [],
          sessions: [],
        },
        snapshotHash: "synthetic",
        status: "CURRENT",
        confirmedForSchedulingAt: null,
      }],
    }));

    expect(progress.sections.find((section) => section.id === "review")?.status).toBe("NEEDS_ACTION");
  });
});

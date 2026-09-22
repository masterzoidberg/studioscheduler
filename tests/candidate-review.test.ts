import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Assignment } from "@/lib/domain";
import type { SolverSnapshotContextToken } from "@/lib/server-studio-state";
import {
  compareSolverCandidateReviews,
  parseSolverCandidateReview,
  solverCandidateReviewIsStale,
} from "@/lib/solver-candidate-review";

const migration = readFileSync("supabase/migrations/20260912100000_cand01_persisted_solver_candidates_v68.sql", "utf8");
const feasibilityRoute = readFileSync("app/api/solver/feasibility/route.ts", "utf8");
const workspace = readFileSync("components/workspace-provider.tsx", "utf8");
const scenarios = readFileSync("components/scenarios-view.tsx", "utf8");
const adoptionRoute = readFileSync("app/api/solver/adopt/route.ts", "utf8");

function token(overrides: Partial<SolverSnapshotContextToken> = {}): SolverSnapshotContextToken {
  return {
    schemaVersion: "1.0",
    studioId: "studio-a",
    rulebookVersion: 3,
    rulebookId: "rulebook-3",
    rulebookSourceHash: "rulebook-source",
    rulebookSnapshotHash: "rulebook-snapshot",
    rulesHash: "rules-hash",
    planningDatasetVersion: 7,
    planningDatasetId: "planning-7",
    planningSnapshotHash: "planning-hash",
    planningConfirmedForSchedulingAt: "2026-09-12T00:00:00Z",
    enforcementVersion: 4,
    enforcementId: "enforcement-4",
    constraintModelVersion: 5,
    constraintModelId: "model-5",
    constraintModelSnapshotHash: "model-hash",
    scheduleVersion: 12,
    scheduleId: "schedule-12",
    scheduleRulebookVersion: 3,
    scheduleEnforcementVersion: 4,
    schedulePlanningDatasetVersion: 7,
    scheduleConstraintModelVersion: 5,
    scheduleAssignmentsHash: "assignments-hash",
    ...overrides,
  };
}

const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: "solver:session-1",
  sessionId: "session-1",
  day: "Monday",
  startTime: "17:00",
  endTime: "18:00",
  teacherId: "teacher-1",
  roomId: "room-1",
  locked: false,
  status: "AI_PROPOSED",
  ...overrides,
});

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1",
    studioId: "studio-a",
    name: "Candidate 1",
    createdAt: "2026-09-12T10:00:00Z",
    createdByLabel: "Owner",
    candidateContext: {
      schemaVersion: "1.0",
      compilerVersion: "dwde-ir-v3",
      solverContextToken: token(),
    },
    assignments: [assignment()],
    quality: {
      status: "FEASIBLE",
      comparable: true,
      hardViolations: 0,
      unsupportedConstraintIds: [],
      breakdown: { preferredDayMatches: 1, avoidedDayAssignments: 0 },
      metrics: [{ metric: "preferredDayMatches", unit: "days", direction: "MAXIMIZE", value: 1, label: "Preferred day matches", entityIds: [] }],
      tiers: [],
      explanations: [],
      warnings: [],
    },
    optimizationStatus: "OPTIMAL",
    provenOptimal: true,
    serviceVersion: "solver-test",
    ...overrides,
  };
}

describe("CAND-01 persisted solver candidate review", () => {
  it("round-trips the exact Assignment envelope and pinned historical context", () => {
    const raw = review({
      candidateContext: {
        schemaVersion: "1.0",
        compilerVersion: "dwde-ir-v3",
        solverContextToken: token({ planningDatasetVersion: 4, planningDatasetId: "planning-4" }),
      },
    });
    const parsed = parseSolverCandidateReview(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.candidateContext.solverContextToken.planningDatasetId).toBe("planning-4");
    expect(parsed?.assignments).toEqual(raw.assignments);
    expect(parsed?.quality).toEqual(raw.quality);
  });

  it("compares changed sessions and quality-score components deterministically", () => {
    const left = parseSolverCandidateReview(review())!;
    const right = parseSolverCandidateReview(review({
      id: "candidate-2",
      assignments: [assignment({ day: "Tuesday" })],
      quality: {
        ...left.quality,
        breakdown: { ...left.quality.breakdown, preferredDayMatches: 0 },
        metrics: [{ metric: "preferredDayMatches", unit: "days", direction: "MAXIMIZE", value: 0, label: "Preferred day matches", entityIds: [] }],
      },
    }))!;
    const comparison = compareSolverCandidateReviews(left, right);
    expect(comparison.changedSessions.map((item) => item.sessionId)).toEqual(["session-1"]);
    expect(comparison.qualityComponents).toEqual([
      expect.objectContaining({ key: "preferredDayMatches", leftValue: 1, rightValue: 0, delta: -1 }),
    ]);
  });

  it("marks a candidate stale when any coherent context field changes", () => {
    const candidate = parseSolverCandidateReview(review())!;
    expect(solverCandidateReviewIsStale(candidate, token())).toBe(false);
    expect(solverCandidateReviewIsStale(candidate, token({ scheduleVersion: 13, scheduleId: "schedule-13" }))).toBe(true);
    expect(solverCandidateReviewIsStale(candidate, token({ planningDatasetVersion: 8, planningDatasetId: "planning-8" }))).toBe(true);
  });

  it("defines the tenant-scoped persistence and no-schedule-write boundaries", () => {
    expect(migration).toContain("create table public.solver_candidate_reviews");
    expect(migration).toContain("studio_id uuid not null");
    expect(migration).toContain("create or replace function public.create_solver_candidate_review_v68");
    expect(migration).toContain("create or replace function public.list_solver_candidate_reviews_v68");
    expect(migration).toContain("create or replace function public.delete_solver_candidate_review_v68");
    expect(migration).toContain("private.require_actor_studio_context_v63");
    expect(migration).toContain("STALE_SOLVER_CANDIDATE_CONTEXT");
    expect(migration).not.toContain("insert into public.schedule_versions");
    expect(migration).not.toContain("insert into public.assignments");
    expect(feasibilityRoute).toContain("create_solver_candidate_review_v68");
    expect(workspace).toContain("/api/solver/candidates");
    expect(scenarios).toContain("compareSolverCandidateReviews");
    expect(scenarios).toContain("deleteSolverCandidateReview");
    expect(scenarios).toContain('fetch("/api/solver/adopt"');
    expect(adoptionRoute).toContain('admin.rpc("adopt_solver_candidate_v63"');
  });
});

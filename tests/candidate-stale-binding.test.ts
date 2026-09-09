import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260907070000_candidate_stale_schedule_binding_v44.sql", "utf8");
const feasibilityRoute = readFileSync("app/api/solver/feasibility/route.ts", "utf8");
const adoptionRoute = readFileSync("app/api/solver/adopt/route.ts", "utf8");
const card = readFileSync("components/solver-feasibility-card.tsx", "utf8");
const dbHarness = readFileSync("scripts/test-db.mjs", "utf8");

describe("T08 candidate stale-schedule binding", () => {
  it("returns a separate versioned review context without changing the solver-service problem contract", () => {
    expect(feasibilityRoute).toContain("candidateContext: buildReviewedSolverCandidateContext(problem, gateway.snapshot.contextToken)");
    expect(feasibilityRoute).toContain("body: JSON.stringify({ problem, maxSeconds: service.maxSeconds })");
  });

  it("passes the submitted reviewed context unchanged into the hardened transactional adoption boundary", () => {
    expect(adoptionRoute).toContain('admin.rpc("adopt_solver_candidate_v49"');
    expect(adoptionRoute).toContain("p_expected_context: reviewedContext");
    expect(adoptionRoute).not.toContain("p_expected_schedule_version: currentSchedule.version");
    expect(migration).toContain("v_current_context is distinct from p_expected_context");
    expect(migration).toContain("p_expected_context->'solverContextToken'");
    expect(migration).toContain("public.adopt_solver_candidate_v33");
  });

  it("serializes concurrent adopters and binds the base ScheduleVersion plus schedule/lock identity", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("scheduleAssignmentsHash");
    expect(migration).toContain("scheduleId");
    expect(migration).toContain("scheduleVersion");
    expect(dbHarness).toContain("T08 PASS:");
    expect(dbHarness).toContain("concurrent editor");
    expect(dbHarness).toContain("double adoption");
  });

  it("preserves the stale reviewed candidate in the UI and requires regeneration/re-review", () => {
    expect(card).toContain("reviewStale");
    expect(card).toContain("This reviewed candidate is stale");
    expect(card).toContain("Generate a fresh candidate and review it again");
    expect(card).toContain("schedule/lock fingerprint");
  });
});

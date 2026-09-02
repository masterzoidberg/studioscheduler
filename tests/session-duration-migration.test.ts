import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/pending/session_duration_and_planning_rebase_v25.sql"),
  "utf8",
);

describe("session-specific duration / planning rebase migration", () => {
  it("adds a nullable positive session duration override", () => {
    expect(sql).toContain("alter table public.class_sessions");
    expect(sql).toContain("add column if not exists duration_minutes integer");
    expect(sql).toContain("duration_minutes is null or duration_minutes > 0");
  });

  it("bumps the planning snapshot schema and fingerprints the override", () => {
    expect(sql).toContain("'schemaVersion', '1.1'");
    expect(sql).toContain("'durationMinutes', s.duration_minutes");
    expect(sql).toContain("private.ensure_planning_dataset_version_v25");
  });

  it("replaces class-only duration validation with effective session duration semantics", () => {
    expect(sql).toContain("create or replace function public.validate_schedule_hard_v25");
    expect(sql).toContain("coalesce(s.duration_minutes,c.duration_minutes)");
    expect(sql).toContain("public.validate_schedule_hard_v22(p_schedule_version_id)");
  });

  it("requires rebase to pin all three versioned scheduling inputs", () => {
    expect(sql).toContain("p_expected_rulebook_version integer");
    expect(sql).toContain("p_expected_enforcement_version integer");
    expect(sql).toContain("p_expected_planning_dataset_version integer");
    expect(sql).toContain("v_old.planning_dataset_version=v_pdv");
    expect(sql).toContain("'toPlanningDatasetVersion',v_pdv");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260902080544_planning_dataset_versions_v25.sql"),
  "utf8",
);

describe("PlanningDatasetVersion migration source", () => {
  it("creates a content-addressed, member-readable version table with RLS", () => {
    expect(sql).toContain("create table if not exists public.planning_dataset_versions");
    expect(sql).toContain("snapshot_hash text not null");
    expect(sql).toContain("alter table public.planning_dataset_versions enable row level security");
    expect(sql).toContain("using (private.is_studio_member(studio_id))");
    expect(sql).toContain("revoke all on table public.planning_dataset_versions from public, anon, authenticated");
    expect(sql).toContain("grant select on table public.planning_dataset_versions to authenticated");
  });

  it("does not pretend legacy historical schedules were reproducible", () => {
    expect(sql).toContain("and sv.is_current");
    expect(sql).not.toMatch(/update public\.schedule_versions[\s\S]*set planning_dataset_version=pdv\.version[\s\S]*where sv\.studio_id=pdv\.studio_id\s*and pdv\.status='CURRENT'\s*and sv\.planning_dataset_version is null;/);
  });

  it("pins every future schedule and scenario version automatically", () => {
    expect(sql).toContain("trg_schedule_versions_pin_planning_dataset_v25");
    expect(sql).toContain("before insert on public.schedule_versions");
    expect(sql).toContain("trg_scenarios_pin_planning_dataset_v25");
    expect(sql).toContain("before insert on public.scenarios");
  });

  it("refreshes planning snapshots transactionally while excluding legacy eligibility from the snapshot", () => {
    expect(sql).toContain("deferrable initially deferred");
    expect(sql).toContain("private.ensure_planning_dataset_version_v25");
    expect(sql).not.toContain("'eligibleTeacherIds'");
    expect(sql).toContain("'durationMinutes', c.duration_minutes");
    expect(sql).toContain("'rosterStudentIds', private.sorted_text_array_jsonb_v25(c.roster_student_ids)");
  });
});

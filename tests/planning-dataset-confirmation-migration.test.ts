import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260902213309_planning_dataset_confirmation_v32.sql"),
  "utf8",
);

describe("V3.2 fluid Planning Dataset confirmation", () => {
  it("stores confirmation metadata on the immutable PlanningDatasetVersion row", () => {
    expect(sql).toContain("confirmed_for_scheduling_at timestamptz null");
    expect(sql).toContain("confirmed_for_scheduling_by uuid null references auth.users(id)");
    expect(sql).toContain("confirmed_for_scheduling_by_label text null");
    expect(sql).toContain("scheduling_confirmation_note text null");
  });

  it("uses the existing editor authorization boundary and optimistic planning version check", () => {
    expect(sql).toContain("create or replace function public.confirm_current_planning_dataset_v32");
    expect(sql).toContain("private.assert_editor_context()");
    expect(sql).toContain("p_expected_planning_dataset_version integer");
    expect(sql).toContain("STALE_PLANNING_DATASET: expected %, current %");
  });

  it("confirms the current immutable version without altering its snapshot or fingerprint", () => {
    expect(sql).toContain("update public.planning_dataset_versions");
    expect(sql).toContain("set confirmed_for_scheduling_at=now()");
    expect(sql).not.toMatch(/set\s+snapshot\s*=/i);
    expect(sql).not.toMatch(/set\s+snapshot_hash\s*=/i);
    expect(sql).not.toContain("insert into public.planning_dataset_versions");
  });

  it("audits the confirmation and keeps anonymous callers out", () => {
    expect(sql).toContain("'PLANNING_DATASET_CONFIRMED'");
    expect(sql).toContain("revoke all on function public.confirm_current_planning_dataset_v32(integer,text) from public,anon");
    expect(sql).toContain("grant execute on function public.confirm_current_planning_dataset_v32(integer,text) to authenticated,service_role");
  });
});

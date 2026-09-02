import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/pending/schedule_commands_v25.sql"), "utf8");

describe("V2.5 canonical schedule commands", () => {
  it("uses one command RPC for MOVE, ASSIGN, and UNASSIGN", () => {
    expect(sql).toContain("create or replace function public.apply_schedule_command_v25");
    expect(sql).toContain("v_operation not in ('MOVE','ASSIGN','UNASSIGN')");
    expect(sql).toContain("'SCHEDULE_COMMAND'");
  });

  it("pins and checks the complete versioned scheduling context", () => {
    expect(sql).toContain("p_expected_rulebook_version integer");
    expect(sql).toContain("p_expected_enforcement_version integer");
    expect(sql).toContain("p_expected_planning_dataset_version integer");
    expect(sql).toContain("STALE_PLANNING_DATASET_LINK");
    expect(sql).toContain("planning_dataset_version,\n    actor_user_id");
  });

  it("owns effective duration and validation on the server", () => {
    expect(sql).toContain("coalesce(s.duration_minutes,c.duration_minutes)");
    expect(sql).toContain("v_end_time := v_start_time + make_interval(mins=>v_duration)");
    expect(sql).toContain("public.validate_schedule_hard_v25(v_current.id)");
    expect(sql).toContain("public.validate_schedule_hard_v25(v_new_id)");
  });

  it("makes undo compatible only inside the same planning dataset", () => {
    expect(sql).toContain("create or replace function public.undo_last_schedule_change_v25");
    expect(sql).toContain("and planning_dataset_version=v_current_planning");
    expect(sql).toContain("NO_COMPATIBLE_UNDO");
  });

  it("keeps mutation RPCs membership-governed and unavailable to anon", () => {
    expect(sql).toContain("private.assert_editor_context()");
    expect(sql).toContain("revoke all on function public.apply_schedule_command_v25");
    expect(sql).toContain("revoke all on function public.undo_last_schedule_change_v25");
    expect(sql).toContain("to authenticated,service_role");
  });
});

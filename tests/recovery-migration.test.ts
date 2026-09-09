import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260907170000_authoritative_schedule_recovery_v48.sql", "utf8");

describe("T12 V4.8 recovery migration", () => {
  it("is service-role-only and exact-context bound", () => {
    expect(sql).toContain("STALE_RECOVERY_CONTEXT");
    expect(sql).toContain("private.build_solver_context_token_v43");
    expect(sql).toMatch(/revoke all on function public\.apply_authoritative_schedule_recovery_v48[\s\S]*authenticated/);
    expect(sql).toMatch(/grant execute on function public\.apply_authoritative_schedule_recovery_v48[\s\S]*to service_role/);
  });

  it("limits UNDO to the immediately previous historical ScheduleVersion", () => {
    expect(sql).toContain("sv.version=v_current.version-1");
    expect(sql).toContain("RECOVERY_UNDO_SOURCE_NOT_PREVIOUS");
  });

  it("derives candidate interval validity from current active session/class duration", () => {
    expect(sql).toContain("coalesce(s.duration_minutes,c.duration_minutes)");
    expect(sql).toContain("RECOVERY_CANDIDATE_INVALID");
  });

  it("preserves effective locks and creates a new version instead of rewriting historical assignments", () => {
    expect(sql).toContain("LOCKED_SESSION_PLACEMENT_CHANGED");
    expect(sql).toContain("select coalesce(max(version),0)+1 into v_new_version");
    expect(sql).toContain("insert into public.schedule_versions");
    expect(sql).not.toMatch(/delete\s+from\s+public\.assignments/i);
    expect(sql).not.toMatch(/update\s+public\.assignments\s+set/i);
  });
});

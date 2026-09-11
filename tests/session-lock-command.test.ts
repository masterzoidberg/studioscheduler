import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260911041845_lock01_governed_session_lock_v61.sql",
  "utf8",
);

describe("LOCK-01 governed session lock command", () => {
  it("defines one service-role transaction with explicit context and actor checks", () => {
    expect(migration).toContain("public.apply_authoritative_session_lock_v61");
    expect(migration).toContain("p_expected_context jsonb");
    expect(migration).toContain("for update");
    expect(migration).toContain("v_selected_role not in ('OWNER','EDITOR')");
    expect(migration).toContain("STALE_SESSION_LOCK_CONTEXT");
    expect(migration).toContain("grant execute on function public.apply_authoritative_session_lock_v61");
    expect(migration).toContain("to service_role");
    expect(migration).toMatch(/revoke all on function public\.apply_authoritative_session_lock_v61[\s\S]*authenticated/);
  });

  it("requires one current placement, preserves history, and synchronizes both lock flags", () => {
    expect(migration).toContain("SESSION_LOCK_PLACEMENT_REQUIRED");
    expect(migration).toContain("SESSION_LOCK_PLACEMENT_AMBIGUOUS");
    expect(migration).toContain("insert into public.schedule_versions");
    expect(migration).toContain("insert into public.assignments");
    expect(migration).toContain("p_locked");
    expect(migration).toContain("previousScheduleVersion");
    expect(migration).toContain("certificationStale");
    expect(migration).not.toMatch(/update\s+public\.assignments\s+set/i);
    expect(migration).toMatch(/update\s+public\.class_sessions\s+set[\s\S]*locked\s*=\s*p_locked/i);
  });
});

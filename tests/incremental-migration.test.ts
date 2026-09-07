import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260907150000_authoritative_incremental_commands_v47.sql"), "utf8");

describe("T11 V4.7 authoritative incremental migration", () => {
  it("is service-role-only and rechecks exact tenant/context under advisory locks", () => {
    expect(sql).toMatch(/revoke all[\s\S]+from public,anon,authenticated/i);
    expect(sql).toMatch(/grant execute[\s\S]+to service_role/i);
    expect(sql).toContain("WORKSPACE_SELECTION_MISMATCH");
    expect(sql).toContain("private.build_solver_context_token_v43(p_studio_id)");
    expect(sql).toContain("STALE_INCREMENTAL_CONTEXT");
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("rejects archived/unknown targets, duplicates, and locks before version creation", () => {
    expect(sql).toMatch(/class_sessions[\s\S]+archived_at is null/i);
    expect(sql).toMatch(/class_definitions[\s\S]+archived_at is null/i);
    expect(sql).toMatch(/teachers[\s\S]+archived_at is null/i);
    expect(sql).toMatch(/rooms[\s\S]+archived_at is null/i);
    expect(sql).toContain("SESSION_ALREADY_ASSIGNED");
    expect(sql).toContain("ASSIGNMENT_ID_ALREADY_EXISTS");
    expect(sql).toContain("LOCKED_ASSIGNMENT");
    expect(sql).toContain("LOCKED_SESSION");
  });

  it("keeps completeness separate from placement legality and does not delegate to V2.5 aggregate validation", () => {
    expect(sql).not.toContain("public.apply_schedule_command_v25(");
    expect(sql).toContain("DRAFT_STATUS_MISMATCH");
    expect(sql).toContain("authoritativeConstraintIr");
    expect(sql).toContain("SERVER_CONSTRAINT_IR_V47");
  });
});

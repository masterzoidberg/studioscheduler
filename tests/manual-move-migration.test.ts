import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260907110000_authoritative_manual_move_v46.sql", "utf8");

describe("T10 V4.6 authoritative manual MOVE migration", () => {
  it("is service-role-only and verifies selected editor membership", () => {
    expect(sql).toMatch(/revoke all[\s\S]+from public,anon,authenticated/i);
    expect(sql).toMatch(/grant execute[\s\S]+to service_role/i);
    expect(sql).toContain("Editor membership required for selected workspace");
    expect(sql).toContain("WORKSPACE_SELECTION_MISMATCH");
  });

  it("serializes and compares the exact solver context before delegating V2.5", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("private.build_solver_context_token_v43(p_studio_id)");
    expect(sql).toContain("STALE_MANUAL_MOVE_CONTEXT");
    expect(sql).toContain("public.apply_schedule_command_v25(");
  });

  it("preserves ConstraintModelVersion and records authoritative audit evidence", () => {
    expect(sql).toContain("set constraint_model_version=v_constraint_model_version");
    expect(sql).toContain("SERVER_CONSTRAINT_IR_V46");
    expect(sql).toContain("applicationConstraintIrValidation");
    expect(sql).toContain("legacyWriteBypassRetirementTask','T13'");
  });
});

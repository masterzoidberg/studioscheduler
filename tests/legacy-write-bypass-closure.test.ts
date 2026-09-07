import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260907190000_close_legacy_write_bypasses_v49.sql",
  "utf8",
);
const feasibility = readFileSync("app/api/solver/feasibility/route.ts", "utf8");
const adoption = readFileSync("app/api/solver/adopt/route.ts", "utf8");
const dbHarness = readFileSync("scripts/test-db.mjs", "utf8");

describe("T13 legacy write bypass closure", () => {
  it("retires every superseded schedule writer from browser and direct service execution", () => {
    for (const name of [
      "apply_schedule_patch_v21",
      "rebase_current_schedule_v21",
      "apply_schedule_patch_v22",
      "rebase_current_schedule_v22",
      "apply_schedule_builder_patch_v23",
      "undo_last_schedule_change_v23",
      "apply_schedule_command_v25",
      "undo_last_schedule_change_v25",
      "rebase_current_schedule_v25",
    ]) {
      expect(migration).toContain(name);
    }
    expect(migration).toContain("from public,anon,authenticated,service_role");
  });

  it("makes Constraint Model publication a server-derived service-role boundary", () => {
    expect(migration).toContain("publish_server_constraint_model_v49");
    expect(migration).toContain("Editor membership required for selected workspace");
    expect(migration).toContain("SERVER_CONSTRAINT_COMPILER_V49");
    expect(feasibility).toContain("getServerAdminSupabase");
    expect(feasibility).toContain('admin.rpc("publish_server_constraint_model_v49"');
    expect(feasibility).not.toContain('supabase.rpc("publish_constraint_model_v30"');
  });

  it("rechecks the human actor inside the privileged adoption transaction", () => {
    expect(migration).toContain("adopt_solver_candidate_v49");
    expect(migration).toContain("where m.studio_id=p_studio_id and m.user_id=p_actor_user_id");
    expect(migration).toContain("v_selected_role not in ('OWNER','EDITOR')");
    expect(adoption).toContain('admin.rpc("adopt_solver_candidate_v49"');
  });

  it("removes direct service execution of the old publication and adoption primitives", () => {
    expect(migration).toContain("publish_constraint_model_v30(jsonb,text,integer)");
    expect(migration).toContain("adopt_solver_candidate_v33");
    expect(migration).toContain("adopt_solver_candidate_v44");
  });

  it("executes privilege enumeration and denied direct-RPC regressions in PostgreSQL", () => {
    expect(dbHarness).toContain("T13 legacy function remains executable");
    expect(dbHarness).toContain("T13 authenticated legacy schedule RPC unexpectedly executed");
    expect(dbHarness).toContain("T13 direct V3.0 model publication unexpectedly executed");
    expect(dbHarness).toContain("T13 actor role recheck did not reject downgraded editor");
    expect(dbHarness).toContain("T13 PASS:");
  });
});

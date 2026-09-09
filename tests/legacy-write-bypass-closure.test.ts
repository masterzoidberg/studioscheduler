import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260907190000_close_legacy_write_bypasses_v49.sql",
  "utf8",
);
const safe01Migration = readFileSync(
  "supabase/migrations/20260908010000_safe01_commit_membership_authorization_v50.sql",
  "utf8",
);
const feasibility = readFileSync("app/api/solver/feasibility/route.ts", "utf8");
const adoption = readFileSync("app/api/solver/adopt/route.ts", "utf8");
const dbHarness = readFileSync("scripts/test-db.mjs", "utf8");
const safe01DbHarness = readFileSync("scripts/test-safe01-db.mjs", "utf8");
const packageJson = readFileSync("package.json", "utf8");

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

describe("SAFE-01 commit-time membership authorization", () => {
  it("locks the resolved editor membership without changing the shared read resolver", () => {
    expect(safe01Migration).toContain("create or replace function private.assert_editor_context()");
    expect(safe01Migration).not.toContain("create or replace function private.dwde_actor_context()");
    expect(safe01Migration).toContain("volatile");
    expect(safe01Migration).toContain("for update");
    expect(safe01Migration).toContain("if not found or v_locked_role not in ('OWNER','EDITOR')");
  });

  it("makes V4.9 adoption explicitly null-safe before downstream adoption", () => {
    expect(safe01Migration).toContain("adopt_solver_candidate_v49");
    expect(safe01Migration).toContain("if not found or v_selected_role not in ('OWNER','EDITOR')");
    expect(safe01Migration).toContain("errcode = '42501'");
    expect(safe01Migration.indexOf("for update")).toBeLessThan(safe01Migration.lastIndexOf("adopt_solver_candidate_v44"));
  });

  it("runs a disposable two-connection authorization/revocation regression from test:db", () => {
    expect(packageJson).toContain("test-safe01-db.mjs");
    expect(safe01DbHarness).toContain("SAFE01_COMMAND_LOCKED");
    expect(safe01DbHarness).toContain("SAFE01_REVOKE_LOCKED");
    expect(safe01DbHarness).toContain("deleted membership");
    expect(safe01DbHarness).toContain("SAFE-01 PASS:");
  });
});

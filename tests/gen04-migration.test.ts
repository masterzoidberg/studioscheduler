import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = () => readFile(
  resolve(process.cwd(), "supabase/migrations/20260911140000_gen04_empty_workspace_v64.sql"),
  "utf8",
);
const readSetup = () => readFile(
  resolve(process.cwd(), "supabase/migrations/20260911160000_gen04_empty_workspace_setup_v66.sql"),
  "utf8",
);

describe("GEN-04 empty workspace provisioning", () => {
  it("defines an authenticated idempotent provisioning boundary", async () => {
    const migration = await read();
    expect(migration).toContain("create table if not exists public.studio_creation_requests");
    expect(migration).toContain("create or replace function public.create_studio_v64(");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("STUDIO_CREATION_REQUEST_FORBIDDEN");
    expect(migration).toContain("STUDIO_CREATION_SLUG_TAKEN");
    expect(migration).toContain("grant execute on function public.create_studio_v64(uuid,text,text) to authenticated, service_role");
  });

  it("creates empty canonical authorities and records neutral provisioning evidence", async () => {
    const migration = await read();
    expect(migration).toContain("'Initial empty rulebook'");
    expect(migration).toContain("'initial-empty-rulebook'");
    expect(migration).toContain("insert into public.rule_enforcement_versions");
    expect(migration).toContain("private.ensure_planning_dataset_version_v25");
    expect(migration).toContain("'EMPTY_WORKSPACE'");
    expect(migration).toContain("'STUDIO_CREATED'");
    expect(migration).toContain("'seededRules',0");
    expect(migration).toContain("'seededPeople',0");
  });

  it("has an executed disposable regression for retry, no-seed and rename behavior", async () => {
    const script = await readFile(resolve(process.cwd(), "scripts/test-gen04-db.mjs"), "utf8");
    expect(script).toContain("create_studio_v64");
    expect(script).toContain("ALREADY_CREATED");
    expect(script).toContain("tenant rename changed canonical authority");
    expect(script).toContain("invalid request wrote state");
    expect(script).toContain("GEN-04 DB PASS");
  });

  it("adds a neutral empty-workspace setup boundary without replacing the DWDE path", async () => {
    const migration = await readSetup();
    const client = await readFile(resolve(process.cwd(), "lib/setup-policy-client.ts"), "utf8");
    expect(migration).toContain("create or replace function public.apply_empty_workspace_setup_policies_v66(");
    expect(migration).toContain("EMPTY_WORKSPACE_SETUP_OWNER_UNSUPPORTED");
    expect(migration).toContain("GENERIC_SETUP_POLICY_V66");
    expect(migration).toContain("private.validate_setup_typed_policy_v55");
    expect(client).toContain("apply_empty_workspace_setup_policies_v66");
    expect(client).toContain("apply_setup_typed_policies_v63");
  });
});

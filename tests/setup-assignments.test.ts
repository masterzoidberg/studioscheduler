import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260922100000_setup_assignments_v69.sql", "utf8");
const client = readFileSync("lib/setup-assignments-client.ts", "utf8");

describe("manager-assigned setup workflow", () => {
  it("keeps assignment metadata tenant-scoped and outside canonical planning truth", () => {
    expect(migration).toContain("create table public.setup_assignments");
    expect(migration).toContain("private.require_studio_context_v63(p_studio_id,'MEMBER')");
    expect(migration).toContain("private.require_studio_context_v63(p_studio_id,'EDITOR')");
    expect(migration).toContain("where a.id=p_assignment_id and a.studio_id=p_studio_id");
    expect(migration).toContain("SETUP_ASSIGNMENT_ASSIGNEE_MUST_EDIT");
    expect(migration).toContain("setup_assignments_member_read");
    expect(migration).not.toContain("insert into public.planning_dataset_versions");
    expect(migration).not.toContain("insert into public.rulebook_versions");
    expect(migration).not.toContain("insert into public.schedule_versions");
  });

  it("uses the versioned RPC boundary and preserves independent form links in the client model", () => {
    expect(client).toContain('rpc("list_setup_assignments_v69"');
    expect(client).toContain('rpc("create_setup_assignment_v69"');
    expect(client).toContain('rpc("update_setup_assignment_v69"');
    expect(client).toContain("SetupAssignmentArea");
    expect(client).toContain("SetupAssignmentStatus");
  });
});

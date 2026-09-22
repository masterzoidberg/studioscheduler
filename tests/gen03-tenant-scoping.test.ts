import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFile(resolve(process.cwd(), file), "utf8");

describe("GEN-03 explicit tenant scoping", () => {
  it("adds an explicit-tenant command boundary and removes ambiguous membership fallback", async () => {
    const migration = await read("supabase/migrations/20260911120000_gen03_explicit_tenant_commands_v63.sql");
    expect(migration).toContain("private.require_studio_context_v63");
    expect(migration).toContain("Explicit studio selection is required");
    expect(migration).not.toContain("order by case m.role");
    expect(migration).toContain("create or replace function public.apply_rule_patch_v63");
    expect(migration).toContain("create or replace function public.mutate_planning_entity_v63");
    expect(migration).toContain("create or replace function public.confirm_current_planning_dataset_v63");
  });

  it("routes all active fixed-workspace paths through the selected tenant", async () => {
    const files = [
      "components/workspace-provider.tsx",
      "components/planning-archive-panel.tsx",
      "components/planning-dataset-confirmation-card.tsx",
      "components/solver-feasibility-card.tsx",
      "components/copilot-panel.tsx",
      "app/api/solver/feasibility/route.ts",
      "app/api/solver/adopt/route.ts",
      "app/api/planning/confirmation/route.ts",
      "app/api/copilot/route.ts",
      "supabase/functions/user-openrouter/index.ts",
    ];
    const source = await Promise.all(files.map(read));
    const combined = source.join("\n");
    expect(combined).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(source[0]).toContain("switchStudio");
    expect(source[0]).toContain("availableWorkspaces");
    expect(source[1]).not.toContain("const STUDIO_ID");
    expect(source[2]).toContain("p_studio_id");
    expect(source[3]).toContain('"x-studio-id"');
    expect(source[4]).toContain('"x-studio-id"');
    expect(source[5]).toContain("studioId");
    expect(source[6]).toContain("studioId");
    expect(source[7]).toContain("studioId");
    expect(source[8]).toContain("studioId");
    expect(source[9]).toContain("x-studio-id");
  });

  it("uses explicit tenant RPC names for inventory, policy, archive, and membership commands", async () => {
    const files = [
      "lib/planning-inventory-client.ts",
      "lib/planning-archive-client.ts",
      "lib/setup-policy-client.ts",
      "components/workspace-provider.tsx",
    ];
    const source = (await Promise.all(files.map(read))).join("\n");
    expect(source).toContain("mutate_planning_entity_v63");
    expect(source).toContain("set_planning_entity_archive_v63");
    expect(source).toContain("apply_setup_typed_policies_v63");
    expect(source).toContain("apply_rule_patch_v63");
    expect(source).toContain("list_studio_members_v63");
    expect(source).toContain("p_studio_id");
  });
});

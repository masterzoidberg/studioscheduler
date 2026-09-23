import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260911100000_gen02_tenant_policy_records_v62.sql"),
  "utf8",
);

describe("GEN-02 tenant policy-record migration", () => {
  it("stores a versioned manifest in an immutable Rulebook successor", () => {
    expect(migration).toContain("create or replace function public.convert_reviewed_rulebook_to_tenant_records_v62(");
    expect(migration).toContain("tenantPolicyManifest");
    expect(migration).toContain("update public.rulebook_versions set status='HISTORICAL'");
    expect(migration).toContain("parentVersion");
    expect(migration).toContain("convertedFromRulebookVersion");
    expect(migration).toContain("tenant_policy_manifest_hash_v62");
  });

  it("checks exact active-rule accounting, provenance, typed ownership and identity resolution", () => {
    expect(migration).toContain("TENANT_POLICY_ACTIVE_RULE_SET_MISMATCH");
    expect(migration).toContain("TENANT_POLICY_HARD_RULE_UNACCOUNTED");
    expect(migration).toContain("TENANT_POLICY_CONSTRAINT_OWNERSHIP_MISMATCH");
    expect(migration).toContain("TENANT_POLICY_CONSTRAINT_DISPOSITION_MISMATCH");
    expect(migration).toContain("TENANT_POLICY_PRECONDITION_OWNERSHIP_MISMATCH");
    expect(migration).toContain("TENANT_POLICY_CONSTRAINT_IDENTITY_UNRESOLVED");
    expect(migration).toContain("sourceRulebookVersion");
    expect(migration).toContain("sourceHash");
  });

  it("replaces fixed model accounting only for valid tenant manifests", () => {
    expect(migration).toContain("private.validate_constraint_model_snapshot_v62");
    expect(migration).toContain("TENANT_POLICY_ACTIVE_RULE_COUNT_MISMATCH");
    expect(migration).toContain("p_compiler_version<>'dwde-ir-0.9'");
    expect(migration).toContain("private.validate_constraint_model_snapshot_v27(p_snapshot,v_rulebook.version,v_compiler)");
    expect(migration).not.toContain("activeRuleCount')::integer)<>178");
  });

  it("serializes exact membership and preserves no-write stale/unauthorized behavior", () => {
    expect(migration).toContain("where m.studio_id=p_studio_id and m.user_id=v_uid for update");
    expect(migration).toContain("v_source.source_hash is distinct from p_expected_rulebook_source_hash");
    expect(migration).toContain("TENANT_POLICY_ALREADY_CONVERTED");
    expect(migration).toContain("grant execute on function public.convert_reviewed_rulebook_to_tenant_records_v62");
    expect(migration).toContain("to authenticated;");
    expect(migration).toContain("update public.constraint_model_versions set status='HISTORICAL'");
  });

  it("keeps the disposable publication regression block self-contained", async () => {
    const { readFile } = await import("node:fs/promises");
    const script = await readFile(resolve(process.cwd(), "scripts/test-gen02-db.mjs"), "utf8");
    expect(script).toContain("declare v_manifest jsonb; v_model jsonb; v_result jsonb; v_rejected boolean;");
  });
});

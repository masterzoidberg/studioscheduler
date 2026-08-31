import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();

const appliedV22 = [
  "20260831160150_v2_2_enforcement_infrastructure.sql",
  "20260831160237_v2_2_enforcement_validator.sql",
  "20260831160457_v2_2_enforcement_governance.sql",
  "20260831160536_v2_2_schedule_mutations.sql",
  "20260831160600_v2_2_rule_mutations.sql",
  "20260831160629_v2_2_seed_mapping_proposals.sql",
  "20260831164129_v2_2_scenario_versions.sql",
  "20260831164302_v2_2_v21_scenario_compat.sql",
  "20260831171138_v2_2_v21_rule_compat.sql",
  "20260831180357_v2_2_index_enforcement_foreign_keys.sql",
];

describe("V2.2 migration reconciliation", () => {
  it("uses the versions recorded by the production Supabase ledger", () => {
    for (const file of appliedV22) expect(files).toContain(file);
  });

  it("does not retain the pre-application draft version prefixes", () => {
    for (let index = 0; index <= 8; index += 1) {
      const draftPrefix = `2026083116000${index}_`;
      expect(files.some((file) => file.startsWith(draftPrefix))).toBe(false);
    }
  });
});

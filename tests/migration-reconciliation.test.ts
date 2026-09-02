import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "supabase", "migrations");
const archiveDir = join(process.cwd(), "supabase", "production-ledger");
const files = readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
const archivedFiles = readdirSync(archiveDir).filter((name) => name.endsWith(".sql")).sort();

const productionTrackedMigrations = [
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
  "20260901054230_milestone_1_teacher_display_colors.sql",
  "20260901200406_add_schedule_builder_assign_unassign_v23.sql",
  "20260901202548_add_schedule_undo_v23.sql",
  "20260902080544_planning_dataset_versions_v25.sql",
  "20260902080838_planning_dataset_advisor_cleanup_v25.sql",
  "20260902083652_session_duration_and_planning_rebase_v25.sql",
  "20260902122425_schedule_commands_v25.sql",
  "20260902122920_planning_dataset_canonical_collation_v25.sql",
  "20260902123142_planning_source_manifest_v26.sql",
  "20260902130713_rulebook_v3_post_review_confirmations.sql",
  "20260902132207_constraint_model_versions_v27.sql",
  "20260902133511_fluid_planning_inventory_v28.sql",
  "20260902134756_planning_dataset_named_entities_v29.sql",
  "20260902163046_constraint_model_publication_v30.sql",
  "20260902172328_class_session_duration_overrides_v31.sql",
  "20260902213309_planning_dataset_confirmation_v32.sql",
  "20260902214223_planning_dataset_confirmation_fk_index_v32.sql",
];

const archivedProductionHotfix = "20260901041429_fix_list_studio_members_v21_return_types.sql";

describe("production migration reconciliation", () => {
  it("uses the production-ledger versions for repository-tracked migrations", () => {
    for (const file of productionTrackedMigrations) expect(files).toContain(file);
  });

  it("archives the direct-production membership hotfix without replaying it", () => {
    expect(files).not.toContain(archivedProductionHotfix);
    expect(archivedFiles).toContain(archivedProductionHotfix);
  });

  it("does not retain the pre-application V2.2 draft version prefixes", () => {
    for (let index = 0; index <= 8; index += 1) {
      const draftPrefix = `2026083116000${index}_`;
      expect(files.some((file) => file.startsWith(draftPrefix))).toBe(false);
    }
  });
});

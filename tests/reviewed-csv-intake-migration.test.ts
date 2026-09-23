import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260911170000_import01_reviewed_csv_v67.sql", "utf8");

describe("IMPORT-01 reviewed CSV PlanningDataset boundary", () => {
  it("defines a tenant-scoped reviewed batch with replay protection", () => {
    expect(migration).toContain("create table if not exists public.planning_import_batches");
    expect(migration).toContain("create or replace function public.apply_reviewed_csv_import_v67(");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("IMPORT_BATCH_ID_REUSE");
    expect(migration).toContain("IMPORT_REVIEW_REQUIRED");
    expect(migration).toContain("STALE_PLANNING_DATASET");
    expect(migration).toContain("grant execute on function public.apply_reviewed_csv_import_v67");
  });

  it("validates all rows before canonical mutations and records provenance", () => {
    expect(migration).toContain("FORMULA_LIKE_VALUE");
    expect(migration).toContain("MISSING_ROSTER_REFERENCE");
    expect(migration).toContain("DUPLICATE_IMPORT_ENTITY");
    expect(migration).toContain("PLANNING_IMPORT_APPLIED");
    expect(migration).toContain("sourceMetadata");
    expect(migration).toContain("importCounts");
    expect(migration).toContain("public.mutate_planning_entity_v28");
  });

  it("keeps the client call explicit about studio, expected version, review, and batch", () => {
    const client = readFileSync("lib/reviewed-csv-import-client.ts", "utf8");
    const ui = readFileSync("components/reviewed-csv-import.tsx", "utf8");
    expect(client).toContain('rpc("apply_reviewed_csv_import_v67"');
    expect(client).toContain("p_studio_id");
    expect(client).toContain("p_expected_planning_dataset_version");
    expect(client).toContain("p_reviewed");
    expect(client).toContain("p_batch_id");
    expect(ui).toContain("reviewedCsvTemplates");
    expect(ui).toContain("parseReviewedCsvBundle");
    expect(ui).toContain("Apply reviewed batch");
    expect(ui).toContain("I reviewed the stable IDs");
  });
});

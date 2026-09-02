import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260902123142_planning_source_manifest_v26.sql"),
  "utf8",
);

describe("V2.6 immutable planning source manifest", () => {
  it("stores versioned content-addressed manifests with one current version", () => {
    expect(sql).toContain("create table if not exists public.planning_source_manifest_versions");
    expect(sql).toContain("snapshot_hash text not null");
    expect(sql).toContain("idx_planning_source_manifest_one_current");
    expect(sql).toContain("complete boolean not null");
  });

  it("validates source and class completeness claims before installation", () => {
    expect(sql).toContain("private.validate_planning_source_manifest_v26");
    expect(sql).toContain("Every source manifest class requires positive weeklyFrequency");
    expect(sql).toContain("sessionDurations must match weeklyFrequency");
    expect(sql).toContain("A complete source manifest must contain at least one authoritative source");
  });

  it("embeds source-manifest identity in Planning Dataset schema 1.2", () => {
    expect(sql).toContain("'schemaVersion','1.2'");
    expect(sql).toContain("'sourceManifest'");
    expect(sql).toContain("'snapshotHash',m.snapshot_hash");
    expect(sql).toContain("'complete',m.complete");
  });

  it("uses an editor-governed install RPC and creates a new PlanningDatasetVersion", () => {
    expect(sql).toContain("create or replace function public.install_planning_source_manifest_v26");
    expect(sql).toContain("private.assert_editor_context()");
    expect(sql).toContain("p_expected_planning_dataset_version integer");
    expect(sql).toContain("private.ensure_planning_dataset_version_v25");
    expect(sql).toContain("revoke all on function public.install_planning_source_manifest_v26");
  });
});

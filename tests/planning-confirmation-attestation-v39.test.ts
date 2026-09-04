import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904220608_planning_dataset_confirmation_attestation_v39.sql"),
  "utf8",
);
const retirement = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904220715_retire_direct_v32_planning_confirmation.sql"),
  "utf8",
);
const confirmationUi = readFileSync(
  resolve(process.cwd(), "components/planning-dataset-confirmation-card.tsx"),
  "utf8",
);

describe("Planning Dataset confirmation attestation v39", () => {
  it("requires editor authorization and exact version/hash concurrency", () => {
    expect(migration).toContain("private.assert_editor_context()");
    expect(migration).toContain("v_current.version<>p_expected_planning_dataset_version");
    expect(migration).toContain("STALE_PLANNING_DATASET");
    expect(migration).toContain("v_current.snapshot_hash<>btrim(p_expected_snapshot_hash)");
    expect(migration).toContain("STALE_PLANNING_DATASET_SNAPSHOT");
  });

  it("requires every attestation as a real JSON boolean true", () => {
    for (const key of [
      "peopleInventoryReviewed",
      "classSessionCatalogReviewed",
      "classRostersReviewed",
      "sourceAndCompletenessReviewed",
    ]) {
      expect(migration).toContain(`v_evidence->'${key}' is distinct from 'true'::jsonb`);
      expect(migration).toContain(`'${key}',true`);
    }
    expect(migration).toContain("PLANNING_CONFIRMATION_EVIDENCE_REQUIRED");
  });

  it("persists the evidence contract in the audit event", () => {
    expect(migration).toContain("'confirmationContractVersion',39");
    expect(migration).toContain("'evidence',jsonb_build_object(");
    expect(migration).toContain("'snapshotHash',v_current.snapshot_hash");
    expect(migration).toContain("'PLANNING_DATASET_CONFIRMED'");
  });

  it("routes the browser through v39 with snapshot-bound evidence", () => {
    expect(confirmationUi).toContain('rpc("confirm_current_planning_dataset_v39"');
    expect(confirmationUi).toContain("p_expected_snapshot_hash: row.snapshot_hash");
    expect(confirmationUi).toContain("p_evidence: confirmationEvidence");
    expect(confirmationUi).not.toContain('rpc("confirm_current_planning_dataset_v32"');
  });

  it("never prechecks attestations and invalidates them when version/hash changes", () => {
    expect(confirmationUi).toContain("peopleInventoryReviewed: false");
    expect(confirmationUi).toContain("classSessionCatalogReviewed: false");
    expect(confirmationUi).toContain("classRostersReviewed: false");
    expect(confirmationUi).toContain("sourceAndCompletenessReviewed: false");
    expect(confirmationUi).toContain('`${row.version}:${row.snapshot_hash}`');
    expect(confirmationUi).toContain("attestationState.snapshotKey === snapshotKey");
    expect(confirmationUi).toContain("!allAttestationsChecked");
  });

  it("states that deterministic validation is not completeness proof", () => {
    expect(confirmationUi).toContain("they cannot prove that the studio inventory itself is complete");
    expect(confirmationUi).toContain("best available current studio source or manager knowledge");
  });

  it("stages retirement of the legacy free-text-only v32 endpoint", () => {
    expect(retirement).toContain("confirm_current_planning_dataset_v32(integer,text)");
    expect(retirement).toContain("from authenticated,service_role");
  });
});

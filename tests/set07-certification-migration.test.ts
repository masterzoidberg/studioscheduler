import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260911030000_set07_readiness_certification_v60.sql"),
  "utf8",
);

describe("SET-07 certification migration", () => {
  it("pins aggregate certification to policy, model, and review-set context", () => {
    expect(migration).toContain("certification_rulebook_version");
    expect(migration).toContain("certification_constraint_model_version");
    expect(migration).toContain("certification_constraint_model_snapshot_hash");
    expect(migration).toContain("certification_review_set_fingerprint");
    expect(migration).toContain("certification_review_schema_version");
    expect(migration).toContain("create or replace function public.confirm_current_planning_dataset_v60");
    expect(migration).toContain("STALE_READINESS_REVIEW_SET");
    expect(migration).toContain("PLANNING_DATASET_CERTIFIED");
    expect(migration).toContain("assert_current_readiness_certification_v60");
    expect(migration).toContain("PLANNING_DATASET_NOT_CERTIFIED");
    expect(migration).toContain("readinessCertificationRequired");
  });

  it("derives current review state from existing append-only attestations", () => {
    expect(migration).toContain("build_readiness_review_set_v60");
    expect(migration).toContain("'ROOM_'||upper(v_aspect)||'_REVIEW'");
    expect(migration).toContain("TEACHER_" );
    expect(migration).toContain("CLASS_" );
    expect(migration).toContain("STUDENT_RESTRICTIONS_REVIEW");
    expect(migration).toContain("RELATIONSHIP_RULE_REVIEW");
    expect(migration).toContain("UNREVIEWED_HARD_RULE");
  });

  it("retires the old confirmation grant and extends the solver context", () => {
    expect(migration).toContain("confirm_current_planning_dataset_v39(integer,text,text,jsonb)");
    expect(migration).toContain("planningCertificationReviewSetFingerprint");
    expect(migration).toContain("'readinessCertification',private.build_readiness_certification_v60(p_studio_id)");
  });
});

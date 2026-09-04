import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const governedRepairs = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904190328_rulebook_v36_governed_repairs.sql"),
  "utf8",
);
const retireV35 = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904190357_retire_direct_v35_structure_rpc.sql"),
  "utf8",
);
const client = readFileSync(resolve(process.cwd(), "lib/planning-inventory-client.ts"), "utf8");
const repairsView = readFileSync(resolve(process.cwd(), "components/planning-repairs-view.tsx"), "utf8");

const RULEBOOK_ID = "dwde-2026-2027-master-rulebook";
const RULEBOOK_HASH = "7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b";

describe("Rulebook v36 exact-policy governance", () => {
  it("pins deterministic repair semantics to the exact reviewed Rulebook artifact", () => {
    expect(governedRepairs).toContain("private.assert_reviewed_rulebook_v3_v36");
    expect(governedRepairs).toContain("rb.status='CURRENT'");
    expect(governedRepairs).toContain("for share");
    expect(governedRepairs).toContain("v_version is distinct from 3");
    expect(governedRepairs).toContain(`v_rulebook_id is distinct from '${RULEBOOK_ID}'`);
    expect(governedRepairs).toContain("v_rule_count is distinct from 178");
    expect(governedRepairs).toContain(`v_source_hash is distinct from '${RULEBOOK_HASH}'`);
    expect(governedRepairs).toContain("RULEBOOK_POLICY_CONTENT_MISMATCH");
  });

  it("content-pins required-class creation before the reviewed-intake marker is honored", () => {
    expect(governedRepairs).toContain("create or replace function private.guard_required_class_insert_v34()");
    expect(governedRepairs).toContain("perform private.assert_reviewed_rulebook_v3_v36(new.studio_id)");
    expect(governedRepairs).toContain("dwde.reviewed_required_class_intake");
  });

  it("wraps the tested v35 atomic structure repair behind the v36 Rulebook pin", () => {
    expect(governedRepairs).toContain("public.apply_rulebook_structure_repair_v36(");
    expect(governedRepairs).toContain("perform private.assert_reviewed_rulebook_v3_v36(v_studio)");
    expect(governedRepairs).toContain("return public.apply_rulebook_structure_repair_v35(");
    expect(governedRepairs).toContain("grant execute on function public.apply_rulebook_structure_repair_v36");
  });

  it("retires direct client execution of the unpinned v35 structure endpoint", () => {
    expect(retireV35).toContain("revoke execute on function public.apply_rulebook_structure_repair_v35(text,text,integer) from authenticated,service_role");
    expect(client).not.toContain('rpc("apply_rulebook_structure_repair_v35"');
    expect(client).toContain('rpc("apply_rulebook_structure_repair_v36"');
  });
});

describe("Rulebook v36 server-derived roster repair", () => {
  it("accepts only class identity, reason, and the Planning Dataset concurrency token", () => {
    expect(governedRepairs).toContain("public.apply_rulebook_roster_repair_v36(\n  p_class_id text,\n  p_reason text,\n  p_expected_planning_dataset_version integer");
    expect(governedRepairs).not.toContain("p_student_ids");
    expect(governedRepairs).not.toContain("p_roster_student_ids");
  });

  it("derives all current advanced-Ballet participation relationships server-side", () => {
    expect(governedRepairs).toContain("v_key in ('ballet4a','ballet4a4b')");
    expect(governedRepairs).toContain("s.level='Level 4A'");
    expect(governedRepairs).toContain("array['BAL-006','STU-002']");

    expect(governedRepairs).toContain("v_key in ('ballet4a4b','ballet4b5')");
    expect(governedRepairs).toContain("s.level='Level 4B'");
    expect(governedRepairs).toContain("array['BAL-007','STU-002']");

    expect(governedRepairs).toContain("v_key in ('ballet4b5','ballet5')");
    expect(governedRepairs).toContain("s.level='Level 5'");
    expect(governedRepairs).toContain("array['BAL-008','STU-002']");
  });

  it("derives Karly's daughter identity and required enrollments without browser-supplied student IDs", () => {
    expect(governedRepairs).toContain("v_key in ('ballet2','jazz2','lyrical2','tap2','hiphop2','precompanytechnique1')");
    expect(governedRepairs).toContain("='karlysdaughter'");
    expect(governedRepairs).toContain("RULEBOOK_ROSTER_REPAIR_STUDENT_MISSING");
    expect(governedRepairs).toContain("RULEBOOK_ROSTER_REPAIR_STUDENT_AMBIGUOUS");
    expect(governedRepairs).toContain("array['KAR-008','STU-002']");
  });

  it("preserves every non-roster class fact by delegating a roster-only partial update", () => {
    expect(governedRepairs).toContain("public.mutate_planning_entity_v28(");
    expect(governedRepairs).toContain("jsonb_build_object('rosterStudentIds',to_jsonb(v_after_roster))");
    expect(governedRepairs).not.toContain("jsonb_build_object('name'");
    expect(governedRepairs).not.toContain("'durationMinutes'");
    expect(governedRepairs).not.toContain("'weeklyFrequency'");
  });

  it("is additive, idempotent, concurrency-protected, and auditable", () => {
    expect(governedRepairs).toContain("STALE_PLANNING_DATASET");
    expect(governedRepairs).toContain("array_cat(v_current_roster,v_required_ids)");
    expect(governedRepairs).toContain("if cardinality(v_missing_ids)=0 then");
    expect(governedRepairs).toContain("'changed',false");
    expect(governedRepairs).toContain("'scheduleRequiresRevalidation',false");
    expect(governedRepairs).toContain("'RULEBOOK_ROSTER_REPAIR'");
    expect(governedRepairs).toContain("'addedStudentIds'");
    expect(governedRepairs).toContain("'rulebookSourceHash'");
  });

  it("routes the browser through the server-derived roster boundary", () => {
    expect(client).toContain("export async function applyRulebookRosterRepair");
    expect(client).toContain('rpc("apply_rulebook_roster_repair_v36"');
    expect(repairsView).toContain("applyRulebookRosterRepair({");
    expect(repairsView).not.toContain("rulebookRosterRepairDraft");
    expect(repairsView).not.toContain("mutatePlanningEntity({");
  });
});

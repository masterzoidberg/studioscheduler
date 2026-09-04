import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904193500_shared_rulebook_roster_compiler_v38.sql"),
  "utf8",
);

describe("shared Rulebook roster compiler v38", () => {
  it("pins the shared compiler to the reviewed Rulebook artifact", () => {
    expect(migration).toContain("private.rulebook_required_roster_v38(");
    expect(migration).toContain("perform private.assert_reviewed_rulebook_v3_v36(p_studio)");
    expect(migration).toContain("revoke all on function private.rulebook_required_roster_v38(uuid,text) from public,anon,authenticated");
  });

  it("owns every currently reviewed Rulebook roster relationship in one private compiler", () => {
    expect(migration).toContain("v_key in ('ballet4a','ballet4a4b')");
    expect(migration).toContain("s.level='Level 4A'");
    expect(migration).toContain("array['BAL-006','STU-002']");

    expect(migration).toContain("v_key in ('ballet4a4b','ballet4b5')");
    expect(migration).toContain("s.level='Level 4B'");
    expect(migration).toContain("array['BAL-007','STU-002']");

    expect(migration).toContain("v_key in ('ballet4b5','ballet5')");
    expect(migration).toContain("s.level='Level 5'");
    expect(migration).toContain("array['BAL-008','STU-002']");

    expect(migration).toContain("v_key in ('ballet2','jazz2','lyrical2','tap2','hiphop2','precompanytechnique1')");
    expect(migration).toContain("='karlysdaughter'");
    expect(migration).toContain("array['KAR-008','STU-002']");
  });

  it("fails closed when the KAR-008 person identity is missing or ambiguous", () => {
    expect(migration).toContain("RULEBOOK_ROSTER_REPAIR_STUDENT_MISSING");
    expect(migration).toContain("RULEBOOK_ROSTER_REPAIR_STUDENT_AMBIGUOUS");
    expect(migration).toContain("v_daughter_count<>1");
  });

  it("makes reviewed class creation enforce the same server-derived minimum roster", () => {
    const guardStart = migration.indexOf("create or replace function private.guard_required_class_insert_v34()");
    const repairStart = migration.indexOf("create or replace function public.apply_rulebook_roster_repair_v36(");
    const guard = migration.slice(guardStart, repairStart);

    expect(guard).toContain("REVIEWED_REQUIRED_CLASS_INTAKE_REQUIRED");
    expect(guard).toContain("private.rulebook_required_roster_v38(new.studio_id,new.name)");
    expect(guard).toContain("new.roster_student_ids");
    expect(guard).toContain("@> v_required_ids");
    expect(guard).toContain("REVIEWED_REQUIRED_CLASS_REQUIRED_ROSTER_MISSING");
  });

  it("makes existing-class roster repair consume the same compiler instead of duplicating relationships", () => {
    const repairStart = migration.indexOf("create or replace function public.apply_rulebook_roster_repair_v36(");
    const repair = migration.slice(repairStart);

    expect(repair).toContain("v_requirements:=private.rulebook_required_roster_v38(v_studio,v_name)");
    expect(repair).toContain("RULEBOOK_ROSTER_REPAIR_UNSUPPORTED");
    expect(repair).toContain("jsonb_build_object('rosterStudentIds',to_jsonb(v_after_roster))");
    expect(repair).not.toContain("s.level='Level 4A'");
    expect(repair).not.toContain("s.level='Level 4B'");
    expect(repair).not.toContain("s.level='Level 5'");
    expect(repair).not.toContain("='karlysdaughter'");
    expect(repair).not.toContain("array['KAR-008','STU-002']");
  });

  it("uses explicit JSON set-returning-function aliases", () => {
    expect(migration).toContain("as r(value)");
    expect(migration).not.toContain("jsonb_array_elements_text(coalesce(v_requirements->'requiredStudentIds','[]'::jsonb)) value;");
  });
});

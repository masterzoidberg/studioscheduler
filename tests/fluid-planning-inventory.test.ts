import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260902133511_fluid_planning_inventory_v28.sql"),
  "utf8",
);

describe("fluid planning inventory V2.8", () => {
  it("supports separately creating and updating teachers, students, rooms, and classes", () => {
    expect(sql).toContain("p_operation not in ('CREATE','UPDATE')");
    expect(sql).toContain("p_entity_type not in ('TEACHER','STUDENT','ROOM','CLASS')");
    expect(sql).toContain("entity_type in ('TEACHER','STUDENT','ROOM','CLASS')");
  });

  it("uses PlanningDatasetVersion optimistic concurrency instead of freezing inventory", () => {
    expect(sql).toContain("STALE_PLANNING_DATASET");
    expect(sql).toContain("private.ensure_planning_dataset_version_v25");
    expect(sql).toContain("'scheduleRequiresRevalidation',true");
  });

  it("does not invent teacher qualifications or class eligibility", () => {
    expect(sql).toContain("Teacher qualifications are Rulebook truth");
    expect(sql).toContain("Teacher eligibility is Rulebook truth");
    expect(sql).toContain("values(v_entity_id,v_studio,v_name,'{}'::text[]");
    expect(sql).toContain("'{}'::text[],coalesce((p_changes->>'companyOnly')::boolean,false)");
  });

  it("validates roster references and creates session rows from weekly frequency", () => {
    expect(sql).toContain("Roster contains unknown student IDs");
    expect(sql).toContain("for v_ordinal in 1..v_frequency loop");
    expect(sql).toContain("insert into public.class_sessions");
  });

  it("protects historical session identity when frequency is reduced", () => {
    expect(sql).toContain("CLASS_FREQUENCY_REDUCTION_BLOCKED");
    expect(sql).toContain("join public.assignments a on a.session_id=s.id");
  });

  it("uses a constrained authenticated SECURITY DEFINER API boundary", () => {
    expect(sql).toContain("ctx jsonb:=private.assert_editor_context()");
    expect(sql).toContain("security definer\nset search_path=''\n");
    expect(sql).toContain("revoke all on function public.mutate_planning_entity_v28");
    expect(sql).toContain("grant execute on function public.mutate_planning_entity_v28");
  });
});

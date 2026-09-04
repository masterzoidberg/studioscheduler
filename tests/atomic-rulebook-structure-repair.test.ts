import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANNING_CLASS_STRUCTURE_REQUIREMENTS } from "@/lib/planning-class-structure";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904064000_atomic_rulebook_structure_repair_v35.sql"),
  "utf8",
);
const classesView = readFileSync(resolve(process.cwd(), "components/classes-view.tsx"), "utf8");

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

describe("atomic Rulebook structure repair V3.5", () => {
  it("derives every current Ballet/Pointe structure target server-side", () => {
    for (const requirement of PLANNING_CLASS_STRUCTURE_REQUIREMENTS) {
      expect(migration).toContain(`v_key='${normalize(requirement.className)}'`);
    }
  });

  it("accepts only class identity, reason, and the Planning Dataset concurrency token", () => {
    expect(migration).toContain("public.apply_rulebook_structure_repair_v35(\n  p_class_id text,\n  p_reason text,\n  p_expected_planning_dataset_version integer");
    expect(migration).not.toContain("p_frequency");
    expect(migration).not.toContain("p_durations");
    expect(migration).not.toContain("p_weekly_frequency");
  });

  it("handles the Ballet 4B/5 mixed-duration repair in one transaction", () => {
    expect(migration).toContain("v_key='ballet4b5' then v_frequency:=2; v_durations:=array[90,105]");
    expect(migration).toContain("Ordinal order is the canonical storage normalization for that multiset");
    expect(migration).toContain("set duration_minutes=v_durations[v_ordinal]");
  });

  it("creates missing session rows, protects historical reductions, and advances planning once", () => {
    expect(migration).toContain("CLASS_FREQUENCY_REDUCTION_BLOCKED");
    expect(migration).toContain("insert into public.class_sessions");
    expect(migration.match(/private\.ensure_planning_dataset_version_v25/g)).toHaveLength(1);
    expect(migration).toContain("'RULEBOOK_STRUCTURE_REPAIR'");
    expect(migration).toContain("insert into public.entity_versions");
  });

  it("fails closed for unsupported or ambiguous canonical class names", () => {
    expect(migration).toContain("RULEBOOK_STRUCTURE_REPAIR_UNSUPPORTED");
    expect(migration).toContain("RULEBOOK_STRUCTURE_REPAIR_AMBIGUOUS");
    expect(migration).toContain("regexp_replace(lower(btrim(c.name)), '[^a-z0-9]+', '', 'g')=v_key");
  });

  it("keeps the RPC behind editor authorization and optimistic concurrency", () => {
    expect(migration).toContain("ctx jsonb := private.assert_editor_context()");
    expect(migration).toContain("STALE_PLANNING_DATASET");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("revoke all on function public.apply_rulebook_structure_repair_v35");
    expect(migration).toContain("grant execute on function public.apply_rulebook_structure_repair_v35");
  });
});

describe("Classes Rulebook repair UI", () => {
  it("uses the atomic RPC for reviewed mismatches", () => {
    expect(classesView).toContain("applyRulebookStructureRepair({");
    expect(classesView).toContain("Apply reviewed repair");
    expect(classesView).toContain("complete Rulebook structure repair atomically");
  });

  it("does not expose the ordinary per-session duration editor during an active repair", () => {
    expect(classesView).toContain("{!activeRepair && !creating && editingSessions.length ? (");
    expect(classesView).not.toContain("save the class structure, reopen it, then set the per-session overrides");
  });

  it("renders ordinary planning facts read-only during a reviewed structure repair", () => {
    expect(classesView).toContain("readOnly={Boolean(activeRepair)} value={editing.name}");
    expect(classesView).toContain("readOnly={Boolean(activeRepair)} value={editing.weeklyFrequency}");
    expect(classesView).toContain("disabled={Boolean(activeRepair)} checked={selected}");
    expect(classesView).toContain("disabled={Boolean(activeRepair)} checked={Boolean(editing.companyOnly)}");
  });
});

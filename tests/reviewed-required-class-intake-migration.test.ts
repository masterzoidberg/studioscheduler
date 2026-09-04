import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANNING_CLASS_STRUCTURE_REQUIREMENTS } from "@/lib/planning-class-structure";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904055500_reviewed_required_class_intake_v34.sql"),
  "utf8",
);
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

describe("reviewed required-class intake V3.4", () => {
  it("blocks generic inserts for known Rulebook-required classes", () => {
    expect(sql).toContain("class_definitions_required_intake_v34");
    expect(sql).toContain("REVIEWED_REQUIRED_CLASS_INTAKE_REQUIRED");
    expect(sql).toContain("current_setting('dwde.reviewed_required_class_intake',true)");
    expect(sql).toContain("before insert on public.class_definitions");
  });

  it("keeps every current structural requirement inside the database guard whitelist", () => {
    for (const requirement of PLANNING_CLASS_STRUCTURE_REQUIREMENTS) {
      expect(sql).toContain(`'${normalized(requirement.className)}'`);
    }
  });

  it("requires explicit manager evidence before enabling the guarded insert", () => {
    expect(sql).toContain("REVIEWED_REQUIRED_CLASS_ROSTER_REQUIRED");
    expect(sql).toContain("REVIEWED_REQUIRED_CLASS_SCOPE_REQUIRED");
    expect(sql).toContain("REVIEWED_REQUIRED_CLASS_CURRICULUM_REQUIRED");
    expect(sql).toContain("set_config('dwde.reviewed_required_class_intake','on',true)");
  });

  it("enforces Rulebook-established frequency and uniform durations server-side", () => {
    expect(sql).toContain("Elementary Ballet 2 requires 2/week at 75 minutes");
    expect(sql).toContain("Ballet 4A/4B requires 1/week at 90 minutes");
    expect(sql).toContain("Pointe 1 requires 1/week at 30 minutes");
    expect(sql).toContain("Pointe 2/3 requires 1/week at 60 minutes");
  });

  it("fails closed when a missing class needs distinct weekly durations", () => {
    expect(sql).toContain("DISTINCT_SESSION_DURATION_INTAKE_REQUIRED");
    expect(sql).toContain("Ballet 4B/5 requires 90/105 minute weekly sessions");
  });

  it("keeps the reviewed intake behind editor authorization", () => {
    expect(sql).toContain("ctx jsonb:=private.assert_editor_context()");
    expect(sql).toContain("revoke all on function public.create_reviewed_required_class_v34");
    expect(sql).toContain("grant execute on function public.create_reviewed_required_class_v34");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260902131000_rulebook_v3_post_review_confirmations.sql"),
  "utf8",
);

describe("DWDE Rulebook V3 post-review confirmations", () => {
  it("creates exactly one V3 from V2 while preserving the 178-rule inventory", () => {
    expect(sql).toContain("if v_current.version<>2");
    expect(sql).toContain("v_rule_count<>178");
    expect(sql).toContain("v_studio,3,'DWDE 2026-2027 Master Rulebook v3'");
    expect(sql).toContain("array['ADV-004','OPS-002']::text[]");
    expect(sql).toContain("178,2,'2.1','DWDE_SITE_RULEBOOK'");
  });

  it("pins Level 5 into the legal 4:30 weekday exception while preserving the 4:45 preference", () => {
    expect(sql).toContain("Level 4B/5, and Level 5 may start at 4:30 PM when needed");
    expect(sql).toContain("All other regular weekday classes have a HARD 4:45 PM earliest start");
    expect(sql).toContain("4:45 PM remains the preferred normal weekday start time for all classes");
  });

  it("resolves Kiran as a dancer progression exception without weakening Tap", () => {
    expect(sql).toContain("classification_raw='EXCEPTION'");
    expect(sql).toContain("normal lower-level requirement does not apply to Jazz or Contemporary");
    expect(sql).toContain("extra/lower-level Tap class remains a HARD requirement");
    expect(sql).toContain("Ballet placement and training remain a priority");
    expect(sql).toContain("Ballet is not treated as a HARD lower-level requirement");
  });

  it("records before/after history and post-review provenance for both changed rules", () => {
    expect(sql).toContain("'2026-09-02T04:14:37Z'");
    expect(sql).toContain("'2026-09-02T04:16:19Z'");
    expect(sql).toContain("'POST_REVIEW_CAMI_CONFIRMATION'");
    expect(sql).toContain("(v_studio,'ADV-004',3,null,'Cami post-review confirmation'");
    expect(sql).toContain("(v_studio,'OPS-002',3,null,'Cami post-review confirmation'");
  });

  it("does not silently rebase the existing schedule and only carries unrelated legacy mappings", () => {
    expect(sql).not.toContain("update public.schedule_versions set rulebook_version=3");
    expect(sql).toContain("where elem->>'ruleId' in ('ADV-004','OPS-002')");
    expect(sql).toContain("Carry existing unrelated enforcement mappings forward to Rulebook v3");
  });
});

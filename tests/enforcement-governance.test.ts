import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scheduleRepairDecision } from "@/lib/schedule-repair";

const root = process.cwd();
const sql = (name: string) => readFileSync(join(root, "supabase", "migrations", name), "utf8");

const governance = sql("20260831160002_v2_2_enforcement_governance.sql");
const scheduleMutations = sql("20260831160003_v2_2_schedule_mutations.sql");
const ruleCompatibility = sql("20260831160008_v2_2_v21_rule_compat.sql");

describe("V2.2 enforcement governance", () => {
  it("requires explicit review and optimistic EnforcementVersion checks", () => {
    expect(governance).toContain("p_decision not in ('APPROVE','REJECT')");
    expect(governance).toContain("STALE_ENFORCEMENT: expected %, current %");
    expect(governance).toContain("STALE_PROPOSAL: proposal is based on Rulebook v% / Enforcement v%");
    expect(governance).toContain("set status='REJECTED'");
    expect(governance).toContain("set status='APPROVED'");
    expect(governance).toContain("v_new_version:=v_current.version+1");
    expect(governance).toContain("'scheduleStale',true");
  });

  it("keeps proposed mappings non-enforcing until approval", () => {
    const proposalInsert = governance.indexOf("insert into public.rule_enforcement_proposals");
    const versionInsert = governance.indexOf("insert into public.rule_enforcement_versions");
    expect(proposalInsert).toBeGreaterThan(-1);
    expect(versionInsert).toBeGreaterThan(proposalInsert);
    expect(governance.slice(proposalInsert, versionInsert)).not.toContain("update public.rule_enforcement_versions set status='HISTORICAL'");
  });

  it("invalidates machine mappings after semantic human Rulebook changes", () => {
    expect(ruleCompatibility).toContain("private.apply_rule_patch_base_v21");
    expect(ruleCompatibility).toContain("where elem->>'ruleId'<>v_rule_id");
    expect(ruleCompatibility).toContain("'ENFORCEMENT_INVALIDATE'");
    expect(ruleCompatibility).toContain("machine mapping requires fresh review");
    expect(ruleCompatibility).toContain("V2_2_MACHINE_MAPPING_SEPARATE");
  });

  it("routes the V2.1 compatibility entrypoint through V2.2 instead of bypassing it", () => {
    expect(ruleCompatibility).toContain("return public.apply_rule_patch_v22(p_operation,p_rule_id,v_human");
    expect(ruleCompatibility).toContain("v_result:=private.apply_rule_patch_base_v21");
    expect(ruleCompatibility).not.toContain("v_result:=public.apply_rule_patch_v21(");
  });

  it("binds schedule writes to Rulebook, Enforcement, and Schedule versions", () => {
    expect(scheduleMutations).toContain("STALE_SCHEDULE: expected %, current %");
    expect(scheduleMutations).toContain("STALE_RULEBOOK: expected %, current %");
    expect(scheduleMutations).toContain("STALE_ENFORCEMENT: expected %, current %");
    expect(scheduleMutations).toContain("STALE_ENFORCEMENT_LINK");
    expect(scheduleMutations).toContain("LOCKED_ASSIGNMENT");
  });

  it("enforces repair mode in PostgreSQL", () => {
    expect(scheduleMutations).toContain("if v_after_hard>0 and v_before_hard=0");
    expect(scheduleMutations).toContain("HARD_VALIDATION_FAILED");
    expect(scheduleMutations).toContain("if v_before_hard>0 and v_after_hard>=v_before_hard");
    expect(scheduleMutations).toContain("HARD_VALIDATION_NOT_IMPROVED");
  });
});

describe("client repair preview", () => {
  it("allows a clean schedule to stay clean", () => {
    expect(scheduleRepairDecision({ hardViolations: 0 }, { hardViolations: 0 })).toEqual({ ok: true });
  });

  it("rejects introducing a HARD violation into a clean schedule", () => {
    const result = scheduleRepairDecision({ hardViolations: 0 }, { hardViolations: 1 });
    expect(result.ok).toBe(false);
  });

  it("allows an invalid schedule only to move strictly toward fewer HARD violations", () => {
    expect(scheduleRepairDecision({ hardViolations: 3 }, { hardViolations: 2 })).toEqual({ ok: true });
    expect(scheduleRepairDecision({ hardViolations: 3 }, { hardViolations: 3 }).ok).toBe(false);
    expect(scheduleRepairDecision({ hardViolations: 3 }, { hardViolations: 4 }).ok).toBe(false);
  });
});

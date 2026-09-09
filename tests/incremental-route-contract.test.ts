import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "app/api/schedule/incremental/route.ts"), "utf8");
const provider = fs.readFileSync(path.join(root, "components/workspace-provider.tsx"), "utf8");
const panel = fs.readFileSync(path.join(root, "components/schedule/schedule-builder-panel.tsx"), "utf8");

describe("T11 incremental server route contract", () => {
  it("uses the coherent pinned snapshot and published deterministic Constraint IR", () => {
    expect(route).toContain("loadCanonicalSolverSnapshot");
    expect(route).toContain("compileConstraintModel");
    expect(route).toContain("constraintModelDefinitionsMatch");
    expect(route).toContain("evaluateAuthoritativeScheduleCommand");
    expect(route).toContain("loadCurrentSolverContextToken");
    expect(route).toContain("solverSnapshotContextTokensMatch");
  });

  it("commits only through the service-role V4.7 transaction", () => {
    expect(route).toContain('admin.rpc("apply_authoritative_incremental_command_v47"');
    expect(route).not.toContain('apply_schedule_command_v25');
  });

  it("removes direct browser ASSIGN/UNASSIGN writes from the schedule builder", () => {
    expect(panel).not.toContain("getBrowserSupabase");
    expect(panel).not.toContain("apply_schedule_command_v25");
    expect(panel).toContain("applySchedulePatch");
    expect(provider).toContain('/api/schedule/incremental');
  });

  it("does not use aggregate client validation as the placement authority", () => {
    expect(panel).not.toContain("hardViolations <= validation.hardViolations");
    expect(panel).not.toContain("placementPreview");
  });
});

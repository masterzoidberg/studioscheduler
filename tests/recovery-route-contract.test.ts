import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/schedule/recovery/route.ts", "utf8");
const provider = readFileSync("components/workspace-provider.tsx", "utf8");
const controls = readFileSync("components/schedule/schedule-edit-controls.tsx", "utf8");

describe("T12 recovery route contract", () => {
  it("reconstructs coherent current authority and rechecks the exact token before persistence", () => {
    expect(route).toContain("loadCanonicalSolverSnapshot");
    expect(route).toContain("compileConstraintModel(snapshot.state)");
    expect(route).toContain("constraintModelDefinitionsMatch");
    expect(route).toContain("loadCurrentSolverContextToken");
    expect(route).toContain("solverSnapshotContextTokensMatch");
  });

  it("treats immediate previous history as source while evaluating under the current model", () => {
    expect(route).toContain("currentVersion - 1");
    expect(route).toContain("evaluateAuthoritativeScheduleRecovery(snapshot.state, sourceAssignments, operation, model)");
    expect(route).toContain("sourceScheduleVersion");
  });

  it("commits only through the service-role V4.8 transaction", () => {
    expect(route).toContain("getServerAdminSupabase");
    expect(route).toContain('admin.rpc("apply_authoritative_schedule_recovery_v48"');
  });

  it("removes active browser calls to legacy rebase/undo RPCs", () => {
    expect(provider).not.toContain('rpc("rebase_current_schedule_v25"');
    expect(controls).not.toContain('rpc("undo_last_schedule_change_v25"');
    expect(provider).toContain('fetch("/api/schedule/recovery"');
    expect(controls).toContain("undoSchedule");
  });
});

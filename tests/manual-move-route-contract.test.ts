import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/schedule/move/route.ts", "utf8");
const provider = readFileSync("components/workspace-provider.tsx", "utf8");

describe("T10 manual MOVE server route contract", () => {
  it("authenticates the explicit selected workspace and rejects viewer writes", () => {
    expect(route).toContain('const studioId = typeof body.studioId === "string"');
    expect(route).toContain('.eq("studio_id", studioId)');
    expect(route).toContain('.eq("user_id", user.id)');
    expect(route).toContain('authorized.role === "VIEWER"');
  });

  it("reconstructs pinned context and requires the published model to equal deterministic IR", () => {
    expect(route).toContain("loadCanonicalSolverSnapshot(authorized.supabase, studioId)");
    expect(route).toContain("compileConstraintModel(snapshot.state)");
    expect(route).toContain("constraintModelDefinitionsMatch(definition, published.snapshot)");
    expect(route).toContain("evaluateAuthoritativeManualMove(snapshot.state, patch, model)");
  });

  it("rechecks context before the service-role-only transaction and sends only canonical derived placement fields", () => {
    expect(route).toContain("loadCurrentSolverContextToken");
    expect(route).toContain("solverSnapshotContextTokensMatch(snapshot.contextToken, currentToken)");
    expect(route).toContain('admin.rpc("apply_authoritative_move_v46"');
    expect(route).toContain("p_expected_context: snapshot.contextToken");
    expect(route).not.toContain("endTime: after.endTime");
  });

  it("desktop and mobile MOVE share WorkspaceProvider and no longer call V2.5 directly", () => {
    expect(provider).toContain('fetch("/api/schedule/move"');
    expect(provider).not.toContain('rpc("apply_schedule_command_v25"');
  });
});

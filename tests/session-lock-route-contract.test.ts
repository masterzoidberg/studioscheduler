import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/schedule/lock/route.ts", "utf8");
const provider = readFileSync("components/workspace-provider.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260911041845_lock01_governed_session_lock_v61.sql", "utf8");

describe("LOCK-01 session lock route contract", () => {
  it("validates the selected tenant, session, lock state, reason, and expected context", () => {
    expect(route).toContain("An explicit studioId is required");
    expect(route).toContain("An explicit sessionId is required");
    expect(route).toContain("typeof body.locked !== \"boolean\"");
    expect(route).toContain("A reason is required for a governed lock change");
    expect(route).toContain("isExpectedContext(body.expectedContext, studioId)");
    expect(route).toContain("solverSnapshotContextTokensMatch(body.expectedContext, snapshot.contextToken)");
  });

  it("authorizes current OWNER/EDITOR membership and maps governed rejection cases", () => {
    expect(route).toContain('.eq("studio_id", studioId)');
    expect(route).toContain('.eq("user_id", user.id)');
    expect(route).toContain('authorized.role === "VIEWER"');
    expect(route).toContain("SESSION_LOCK_CONTEXT_CHANGED_RETRY");
    expect(route).toContain("SESSION_LOCK_PLACEMENT_REQUIRED");
    expect(route).toContain("SESSION_LOCK_STATE_UNCHANGED");
    expect(route).toContain("SESSION_LOCK_UNAUTHORIZED");
  });

  it("uses the service-role governed RPC and exposes explicit staleness", () => {
    expect(route).toContain('admin.rpc("apply_authoritative_session_lock_v63"');
    expect(route).toContain("p_expected_context: body.expectedContext");
    expect(route).toContain("certificationStale: true");
    expect(route).toContain("candidateStale: true");
    expect(provider).toContain('fetch("/api/schedule/lock"');
    expect(migration).toContain("grant execute on function public.apply_authoritative_session_lock_v61");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const view = readFileSync("components/schedule/schedule-view.tsx", "utf8");
const mobileView = readFileSync("components/schedule/mobile-schedule-view.tsx", "utf8");
const provider = readFileSync("components/workspace-provider.tsx", "utf8");
const editMode = readFileSync("components/schedule/schedule-edit-mode.tsx", "utf8");

describe("LOCK-01 schedule control contract", () => {
  it("uses effective session-or-placement locking for movement and editing", () => {
    expect(view).toContain("Boolean(assignment.locked || sessionFor(assignment)?.locked)");
    expect(view).toContain("effectiveLock(editing)");
    expect(view).toContain("effectiveLock(assignment)");
    expect(view).toContain("Effective lock:");
  });

  it("identifies the exact session placement and offers one governed lock action", () => {
    expect(view).toContain("Session {inspectedSession?.ordinal ?? editing.sessionId}");
    expect(view).toContain("inspectedEffectiveLock ? \"Unlock session\" : \"Lock session\"");
    expect(view).toContain("A reason is required for a governed lock change.");
    expect(view).toContain("The current readiness certification and solver candidates become stale");
    expect(view).toContain("lockSaving");
  });

  it("routes lock changes through the provider and keeps the expected context pinned", () => {
    expect(provider).toContain("solverContextToken");
    expect(provider).toContain('expectedContext: solverContextToken');
    expect(provider).toContain("if (!response.ok)");
    expect(provider).toContain("await load();");
    expect(provider).toContain('fetch("/api/schedule/lock"');
    expect(provider).not.toContain('rpc("apply_authoritative_session_lock_v61"');
  });

  it("supports the same governed action on mobile and only in editing mode", () => {
    expect(mobileView).toContain("async function changeDetailsLock()");
    expect(mobileView).toContain("!editingEnabled");
    expect(mobileView).toContain("The current certification and solver candidates are stale");
    expect(view).toContain("!editingEnabled");
    expect(editMode).toContain('"lock session"');
    expect(editMode).toContain('"unlock session"');
  });
});

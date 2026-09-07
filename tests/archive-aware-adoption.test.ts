import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260907030000_archive_aware_solver_adoption_v42.sql", "utf8");
const serverState = readFileSync("lib/server-studio-state.ts", "utf8");

describe("archive-aware solver adoption", () => {
  it("defines candidate completeness from active sessions with active parent classes", () => {
    expect(migration).toContain("select count(*)::integer into v_expected_sessions");
    expect(migration).toMatch(/from public\.class_sessions s\s+join public\.class_definitions c[\s\S]*?c\.archived_at is null[\s\S]*?where s\.studio_id=p_studio_id\s+and s\.archived_at is null/);
    expect(migration).toContain("expected % active sessions");
  });

  it("rejects archived sessions, parent classes, teachers, and rooms at the transactional boundary", () => {
    expect(migration).toMatch(/left join public\.class_sessions s[\s\S]*?s\.archived_at is null/);
    expect(migration).toMatch(/left join public\.class_definitions c[\s\S]*?c\.archived_at is null/);
    expect(migration).toMatch(/left join public\.teachers t[\s\S]*?t\.archived_at is null/);
    expect(migration).toMatch(/left join public\.rooms r[\s\S]*?r\.archived_at is null/);
    expect(migration).toContain("active canonical ID/day/time-grid/interval validation");
  });

  it("persists assignments only through active planning identities", () => {
    const insertSection = migration.slice(migration.indexOf("insert into public.assignments"));
    expect(insertSection).toMatch(/join public\.class_sessions s[\s\S]*?s\.archived_at is null/);
    expect(insertSection).toMatch(/join public\.class_definitions c[\s\S]*?c\.archived_at is null/);
    expect(insertSection).toMatch(/join public\.teachers t[\s\S]*?t\.archived_at is null/);
    expect(insertSection).toMatch(/join public\.rooms r[\s\S]*?r\.archived_at is null/);
  });

  it("applies current lock obligations only to active sessions", () => {
    expect(migration).toMatch(/select count\(\*\)::integer into v_locked_changed[\s\S]*?s\.archived_at is null[\s\S]*?s\.locked=true/);
    expect(migration).toContain("active locked placement(s) changed");
    expect(migration).toContain("an active locked session has no current assignment");
  });

  it("keeps server solver sessions inside the active parent-class inventory", () => {
    expect(serverState).toContain("const activeClassIds = new Set(classes.map((klass) => klass.id));");
    expect(serverState).toContain(".filter((row) => activeClassIds.has(String(row.class_id)))");
  });

  it("preserves archive history instead of deleting or rewriting historical identities", () => {
    expect(migration).not.toMatch(/delete\s+from\s+public\.(class_sessions|class_definitions|teachers|rooms)/i);
    expect(migration).not.toMatch(/update\s+public\.(class_sessions|class_definitions|teachers|rooms)\s+set\s+archived_at/i);
    expect(migration).toContain("Historical ScheduleVersions");
  });
});

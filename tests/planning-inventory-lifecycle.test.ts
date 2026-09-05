import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260905031500_planning_inventory_archive_v40.sql", "utf8");
const guards = readFileSync("supabase/migrations/20260905032000_planning_inventory_archive_guards_v40.sql", "utf8");
const browserState = readFileSync("components/workspace-provider.tsx", "utf8");
const serverState = readFileSync("lib/server-studio-state.ts", "utf8");
const peopleView = readFileSync("components/people-view.tsx", "utf8");
const classesView = readFileSync("components/classes-view.tsx", "utf8");
const archivePanel = readFileSync("components/planning-archive-panel.tsx", "utf8");
const archiveClient = readFileSync("lib/planning-archive-client.ts", "utf8");

describe("planning inventory archive lifecycle", () => {
  it("adds reversible archived_at state without deleting canonical identities", () => {
    for (const table of ["teachers", "students", "rooms", "class_definitions", "class_sessions"]) {
      expect(migration).toContain(`alter table public.${table} add column if not exists archived_at timestamptz`);
    }
    expect(migration).not.toMatch(/delete from public\.(teachers|students|rooms|class_definitions)/i);
    expect(migration).toContain("PLANNING_ENTITY_ARCHIVED");
    expect(migration).toContain("PLANNING_ENTITY_RESTORED");
    expect(migration).toContain("public.entity_versions");
  });

  it("excludes archived entities from the canonical Planning Dataset snapshot", () => {
    expect(migration.match(/archived_at is null/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(migration).toContain("from public.class_sessions s join public.class_definitions c");
    expect(migration).toContain("s.archived_at is null and c.archived_at is null");
  });

  it("filters archived entities from both browser workspace and server solver state", () => {
    for (const source of [browserState, serverState]) {
      for (const table of ["teachers", "rooms", "students", "class_definitions", "class_sessions"]) {
        expect(source).toContain(`from(\"${table}\").select(\"*\")`);
        expect(source).toMatch(new RegExp(`from\\(\\\"${table}\\\"\\).*?is\\(\\\"archived_at\\\", null\\)`, "s"));
      }
    }
  });

  it("scopes archived history reads to the DWDE studio", () => {
    expect(archivePanel).toContain('const STUDIO_ID = "11111111-1111-4111-8111-111111111111"');
    expect(archivePanel.match(/\.eq\("studio_id", STUDIO_ID\)/g)?.length ?? 0).toBe(4);
  });

  it("blocks unsafe student, teacher, room, and class archives", () => {
    expect(migration).toContain("STUDENT_ARCHIVE_BLOCKED_ACTIVE_ROSTER");
    expect(migration).toContain("_ARCHIVE_BLOCKED_LOCKED_SESSION");
    expect(migration).toContain("CLASS_ROSTER_ARCHIVED_STUDENT");
    expect(guards).toContain("CLASS_ARCHIVE_BLOCKED_LOCKED_SESSION");
  });

  it("makes archived records read-only until explicitly restored", () => {
    expect(guards).toContain("ARCHIVED_ENTITY_READ_ONLY");
    for (const table of ["teachers", "students", "rooms", "class_definitions", "class_sessions"]) {
      expect(guards).toContain(`on public.${table}`);
    }
  });

  it("archives class sessions with the class but keeps restoration explicit", () => {
    expect(migration).toContain("update public.class_sessions set archived_at=case when p_archive then v_now else null end");
    expect(migration).toContain("update public.class_definitions set archived_at=case when p_archive then v_now else null end");
  });

  it("routes archive and restore through the governed RPC with explicit archive confirmation", () => {
    expect(archiveClient).toContain('rpc("set_planning_entity_archive_v40"');
    expect(peopleView).toContain('archiveEntity("TEACHER"');
    expect(peopleView).toContain('archiveEntity("STUDENT"');
    expect(peopleView).toContain('archiveEntity("ROOM"');
    expect(peopleView).toContain("window.confirm");
    expect(classesView).toContain("archiveClass()");
    expect(classesView).toContain("window.confirm");
    expect(archivePanel).toContain("Restore");
    expect(archivePanel).toContain("setPlanningEntityArchived");
  });

  it("keeps archived records visible as history rather than silently disappearing", () => {
    expect(peopleView).toContain('<PlanningArchivePanel entityTypes={["TEACHER", "STUDENT", "ROOM"]} />');
    expect(classesView).toContain('<PlanningArchivePanel entityTypes={["CLASS"]} />');
    expect(archivePanel).toContain("Archived records remain available for historical schedules and audit history");
  });
});

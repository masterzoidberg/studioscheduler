import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const v25Sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260902083652_session_duration_and_planning_rebase_v25.sql"),
  "utf8",
);
const v31Sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260902172328_class_session_duration_overrides_v31.sql"),
  "utf8",
);

describe("session-specific duration / planning rebase migration", () => {
  it("adds a nullable positive session duration override", () => {
    expect(v25Sql).toContain("alter table public.class_sessions");
    expect(v25Sql).toContain("add column if not exists duration_minutes integer");
    expect(v25Sql).toContain("duration_minutes is null or duration_minutes > 0");
  });

  it("bumps the planning snapshot schema and fingerprints the override", () => {
    expect(v25Sql).toContain("'schemaVersion', '1.1'");
    expect(v25Sql).toContain("'durationMinutes', s.duration_minutes");
    expect(v25Sql).toContain("private.ensure_planning_dataset_version_v25");
  });

  it("replaces class-only duration validation with effective session duration semantics", () => {
    expect(v25Sql).toContain("create or replace function public.validate_schedule_hard_v25");
    expect(v25Sql).toContain("coalesce(s.duration_minutes,c.duration_minutes)");
    expect(v25Sql).toContain("public.validate_schedule_hard_v22(p_schedule_version_id)");
  });

  it("requires rebase to pin all three versioned scheduling inputs", () => {
    expect(v25Sql).toContain("p_expected_rulebook_version integer");
    expect(v25Sql).toContain("p_expected_enforcement_version integer");
    expect(v25Sql).toContain("p_expected_planning_dataset_version integer");
    expect(v25Sql).toContain("v_old.planning_dataset_version=v_pdv");
    expect(v25Sql).toContain("'toPlanningDatasetVersion',v_pdv");
  });
});

describe("V3.1 atomic class session duration command", () => {
  it("uses the editor authorization boundary and hardened function privileges", () => {
    expect(v31Sql).toContain("ctx jsonb := private.assert_editor_context()");
    expect(v31Sql).toContain("security definer");
    expect(v31Sql).toContain("set search_path=''");
    expect(v31Sql).toContain("revoke all on function public.update_class_session_durations_v31(text,jsonb,text,integer) from public,anon");
    expect(v31Sql).toContain("grant execute on function public.update_class_session_durations_v31(text,jsonb,text,integer) to authenticated,service_role");
  });

  it("fails closed on stale planning truth and an incomplete session payload", () => {
    expect(v31Sql).toContain("STALE_PLANNING_DATASET");
    expect(v31Sql).toContain("Session duration payload is missing current session IDs");
    expect(v31Sql).toContain("Session duration payload contains unknown session IDs");
  });

  it("accepts only positive whole-minute overrides or null inheritance", () => {
    expect(v31Sql).toContain("jsonb_typeof(e.value) not in ('number','null')");
    expect(v31Sql).toContain("(e.value #>> '{}') !~ '^[0-9]+$'");
    expect(v31Sql).toContain("(e.value #>> '{}')::numeric <= 0");
    expect(v31Sql).toContain("(e.value #>> '{}')::numeric > 1440");
  });

  it("advances PlanningDatasetVersion and audits the before/after duration set", () => {
    expect(v31Sql).toContain("private.ensure_planning_dataset_version_v25");
    expect(v31Sql).toContain("'CLASS_SESSION_DURATIONS_UPDATE'");
    expect(v31Sql).toContain("'before',v_before");
    expect(v31Sql).toContain("'after',v_after");
    expect(v31Sql).toContain("'scheduleRequiresRevalidation',v_planning_version<>v_current_planning");
  });
});

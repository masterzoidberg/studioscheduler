from pathlib import Path
import re
import sys

ROOT = Path('.')

MANUAL_MOVE = r'''import type { Assignment, SchedulePatch, StudioState } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compareConstraintGatesForCommand, type ConstraintGateComparison } from "@/lib/constraint-gate-equivalence";

export interface ManualMoveDraftStatus {
  mode: "NORMAL" | "REPAIR";
  scheduleComplete: boolean;
  publishable: boolean;
  unscheduledSessionIds: string[];
  duplicateSessionIds: string[];
  unknownAssignmentSessionIds: string[];
}

export interface ManualMoveDecision {
  accepted: boolean;
  comparison: ConstraintGateComparison;
  draftStatus: ManualMoveDraftStatus;
  blocker: null | {
    code: string;
    message: string;
    ruleIds: string[];
    entityIds: string[];
  };
}

function canonicalCompleteness(state: StudioState, assignments: Assignment[]) {
  const activeSessionIds = new Set(state.sessions.map((session) => session.id));
  const counts = new Map<string, number>();
  const unknownAssignmentSessionIds = new Set<string>();
  for (const assignment of assignments) {
    if (!activeSessionIds.has(assignment.sessionId)) unknownAssignmentSessionIds.add(assignment.sessionId);
    counts.set(assignment.sessionId, (counts.get(assignment.sessionId) || 0) + 1);
  }
  const unscheduledSessionIds = state.sessions
    .filter((session) => (counts.get(session.id) || 0) === 0)
    .map((session) => session.id)
    .sort();
  const duplicateSessionIds = state.sessions
    .filter((session) => (counts.get(session.id) || 0) > 1)
    .map((session) => session.id)
    .sort();
  return {
    scheduleComplete: unscheduledSessionIds.length === 0
      && duplicateSessionIds.length === 0
      && unknownAssignmentSessionIds.size === 0,
    unscheduledSessionIds,
    duplicateSessionIds,
    unknownAssignmentSessionIds: [...unknownAssignmentSessionIds].sort(),
  };
}

function firstIrMessage(comparison: ConstraintGateComparison) {
  return comparison.constraintIr.after.violations[0]?.message
    || "The proposed move is illegal under the authoritative Constraint IR.";
}

/**
 * Authoritative manual MOVE decision.
 *
 * The IR is the new placement authority. The legacy validator remains a temporary
 * safety floor until T13 closes superseded write paths, so IR may be stricter but
 * this boundary never permits a move the current legacy gate would reject.
 *
 * Completeness is deliberately orthogonal to MOVE legality: a partially built
 * schedule may be repaired/moved, but it is never reported as publishable.
 */
export function evaluateAuthoritativeManualMove(
  state: StudioState,
  patch: SchedulePatch,
  model: ConstraintModelSnapshotV1,
): ManualMoveDecision {
  if (patch.operation !== "MOVE") throw new Error("Authoritative manual move evaluation accepts MOVE only.");
  const current = state.scheduleVersions.find((version) => version.isCurrent);
  if (!current) throw new Error("No current ScheduleVersion exists.");

  const comparison = compareConstraintGatesForCommand(state, current.assignments, patch, model);
  const completeness = canonicalCompleteness(state, comparison.candidate.assignments);
  const mode: ManualMoveDraftStatus["mode"] = (
    comparison.constraintIr.beforeHardViolations > 0 || comparison.legacy.beforeHardViolations > 0
  ) ? "REPAIR" : "NORMAL";
  const draftStatus: ManualMoveDraftStatus = {
    mode,
    ...completeness,
    publishable: completeness.scheduleComplete
      && comparison.constraintIr.after.valid
      && comparison.legacy.after.valid
      && comparison.legacy.after.fullyValidated,
  };

  const unsupported = [...new Set([
    ...comparison.constraintIr.before.unsupportedConstraintIds,
    ...comparison.constraintIr.after.unsupportedConstraintIds,
  ])].sort();
  if (unsupported.length) {
    return {
      accepted: false,
      comparison,
      draftStatus,
      blocker: {
        code: "MANUAL_MOVE_IR_UNSUPPORTED",
        message: `Manual MOVE failed closed because ${unsupported.length} authoritative HARD constraint node(s) are unsupported by the IR evaluator.`,
        ruleIds: [],
        entityIds: unsupported,
      },
    };
  }

  if (!comparison.constraintIr.accepts) {
    const violation = comparison.constraintIr.after.violations[0];
    return {
      accepted: false,
      comparison,
      draftStatus,
      blocker: {
        code: "MANUAL_MOVE_IR_REJECTED",
        message: firstIrMessage(comparison),
        ruleIds: violation?.ruleIds || [],
        entityIds: violation?.affectedEntityIds || [comparison.candidate.sessionId],
      },
    };
  }

  if (!comparison.legacy.accepts || !comparison.preservesLegacySafety) {
    return {
      accepted: false,
      comparison,
      draftStatus,
      blocker: {
        code: "MANUAL_MOVE_LEGACY_SAFETY_REJECTED",
        message: comparison.legacy.after.violations.find((item) => item.severity === "HARD")?.message
          || "The proposed move does not preserve the existing production safety floor.",
        ruleIds: comparison.legacyHardRuleIdsMissingFromIr,
        entityIds: [comparison.candidate.sessionId],
      },
    };
  }

  return { accepted: true, comparison, draftStatus, blocker: null };
}
'''

ROUTE = r'''import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchedulePatch } from "@/lib/domain";
import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";
import {
  loadCanonicalSolverSnapshot,
  loadCurrentSolverContextToken,
  solverSnapshotContextTokensMatch,
} from "@/lib/server-studio-state";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import {
  constraintModelDefinition,
  constraintModelDefinitionsMatch,
} from "@/lib/constraint-model-version";
import { evaluateAuthoritativeManualMove } from "@/lib/manual-move-command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
};

type ManualMoveRequest = {
  studioId?: string;
  patch?: SchedulePatch;
};

async function authorizeWorkspace(request: NextRequest, studioId: string): Promise<AuthorizedWorkspace | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const supabase = getServerSupabase(authorization);
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) return null;
  const membership = await supabase
    .from("studio_members")
    .select("role,studio_id")
    .eq("studio_id", studioId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error || !membership.data || membership.data.studio_id !== studioId) return null;
  return { supabase, role: membership.data.role as AuthorizedWorkspace["role"], userId: user.id };
}

function blocked(code: string, error: string, detail: Record<string, unknown> = {}) {
  return NextResponse.json({ status: "BLOCKED", code, error, ...detail }, { status: 409 });
}

function isCanonicalScheduleContext(token: Awaited<ReturnType<typeof loadCurrentSolverContextToken>>) {
  return token.scheduleVersion !== null
    && token.scheduleId !== null
    && token.rulebookVersion !== null
    && token.enforcementVersion !== null
    && token.planningDatasetVersion !== null
    && token.constraintModelVersion !== null
    && token.scheduleRulebookVersion === token.rulebookVersion
    && token.scheduleEnforcementVersion === token.enforcementVersion
    && token.schedulePlanningDatasetVersion === token.planningDatasetVersion
    && token.scheduleConstraintModelVersion === token.constraintModelVersion;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ManualMoveRequest;
    const studioId = typeof body.studioId === "string" ? body.studioId.trim() : "";
    const patch = body.patch;
    if (!studioId) return NextResponse.json({ error: "An explicit studioId is required." }, { status: 400 });
    if (!patch || patch.operation !== "MOVE" || !patch.assignmentId?.trim() || !patch.reason?.trim()) {
      return NextResponse.json({ error: "A complete MOVE patch with assignmentId and reason is required." }, { status: 400 });
    }

    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") {
      return NextResponse.json({ error: "Editor access is required to move schedule assignments." }, { status: 403 });
    }

    const snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, studioId);
    if (!isCanonicalScheduleContext(snapshot.contextToken)) {
      return blocked(
        "MANUAL_MOVE_CONTEXT_STALE",
        "The current schedule is not linked to the exact current Rulebook, EnforcementVersion, PlanningDatasetVersion, and ConstraintModelVersion. Revalidate before moving assignments.",
      );
    }

    const model = compileConstraintModel(snapshot.state);
    if (!model.completeHardConstraintCompilation || model.uncompiledConstraintRuleIds.length) {
      return blocked(
        "MANUAL_MOVE_CONSTRAINT_MODEL_INCOMPLETE",
        "Manual MOVE failed closed because the current Rulebook does not have a complete authoritative HARD Constraint IR.",
        { uncompiledRuleIds: model.uncompiledConstraintRuleIds },
      );
    }
    const published = snapshot.publishedConstraintModel;
    const definition = constraintModelDefinition(model);
    if (!published
      || !published.complete
      || published.version !== snapshot.contextToken.constraintModelVersion
      || !constraintModelDefinitionsMatch(definition, published.snapshot)) {
      return blocked(
        "MANUAL_MOVE_CONSTRAINT_MODEL_STALE",
        "The deterministic Constraint IR does not match the pinned published ConstraintModelVersion. Refresh the model before editing the schedule.",
      );
    }

    const decision = evaluateAuthoritativeManualMove(snapshot.state, patch, model);
    if (!decision.accepted || !decision.comparison.candidate.after) {
      return blocked(
        decision.blocker?.code || "MANUAL_MOVE_REJECTED",
        decision.blocker?.message || "The proposed move was rejected by server validation.",
        {
          blocker: decision.blocker,
          irValidation: decision.comparison.constraintIr.after,
          legacyValidation: decision.comparison.legacy.after,
          draftStatus: decision.draftStatus,
        },
      );
    }

    const currentToken = await loadCurrentSolverContextToken(authorized.supabase, studioId);
    if (!solverSnapshotContextTokensMatch(snapshot.contextToken, currentToken)) {
      return blocked(
        "MANUAL_MOVE_CONTEXT_CHANGED_RETRY",
        "Scheduling context changed while this move was being validated. Retry the move against the current schedule.",
      );
    }

    let admin: SupabaseClient;
    try {
      admin = getServerAdminSupabase();
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : String(error),
        code: "MANUAL_MOVE_ADMIN_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const after = decision.comparison.candidate.after;
    const result = await admin.rpc("apply_authoritative_move_v46", {
      p_studio_id: studioId,
      p_actor_user_id: authorized.userId,
      p_assignment_id: after.id,
      p_changes: {
        day: after.day,
        startTime: after.startTime,
        teacherId: after.teacherId,
        roomId: after.roomId,
        status: after.status || "NORMAL",
      },
      p_reason: patch.reason.trim(),
      p_expected_context: snapshot.contextToken,
      p_application_validation: decision.comparison.constraintIr.after,
      p_ai_proposed: patch.proposedBy === "AI",
    });
    if (result.error) {
      const message = result.error.message || "Manual move transaction failed.";
      if (message.includes("STALE_MANUAL_MOVE_CONTEXT")) {
        return blocked("MANUAL_MOVE_CONTEXT_CHANGED_RETRY", "Scheduling context changed before commit. Retry the move.");
      }
      if (message.includes("WORKSPACE_SELECTION_MISMATCH")) {
        return blocked("WORKSPACE_SELECTION_MISMATCH", "The selected workspace is not the legacy active membership context. Switch back to the active workspace; full multi-workspace writes arrive in T22/T23.");
      }
      if (message.includes("LOCKED_") || message.includes("HARD_VALIDATION")) {
        return blocked("MANUAL_MOVE_TRANSACTION_REJECTED", message);
      }
      throw result.error;
    }

    const mutation = result.data as Record<string, unknown>;
    return NextResponse.json({
      status: "MOVED",
      scheduleVersion: Number(mutation.scheduleVersion || 0),
      mutation,
      validation: mutation.validation || null,
      irValidation: decision.comparison.constraintIr.after,
      draftStatus: decision.draftStatus,
      authoritativeConstraintModelVersion: snapshot.contextToken.constraintModelVersion,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      code: "MANUAL_MOVE_ERROR",
    }, { status: 500 });
  }
}
'''

MIGRATION = r'''-- T10 / V4.6 authoritative manual MOVE boundary.
--
-- Browser clients no longer commit MOVE directly through the legacy authenticated
-- RPC. The application server validates one coherent pinned snapshot against the
-- complete Constraint IR, then this service-role-only wrapper atomically proves
-- that exact context is still current before delegating the structural/versioned
-- write to V2.5. ASSIGN/UNASSIGN and legacy grant retirement remain T11/T13.

create or replace function public.apply_authoritative_move_v46(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_assignment_id text,
  p_changes jsonb,
  p_reason text,
  p_expected_context jsonb,
  p_application_validation jsonb,
  p_ai_proposed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_selected_role text;
  v_actor_context jsonb;
  v_current_context jsonb;
  v_result jsonb;
  v_schedule_id uuid;
  v_constraint_model_version integer;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if coalesce(btrim(p_assignment_id),'')='' then raise exception 'Assignment is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  if p_changes is null or jsonb_typeof(p_changes)<>'object' then raise exception 'Canonical MOVE changes are required'; end if;
  if p_application_validation is null or jsonb_typeof(p_application_validation)<>'object' then
    raise exception 'Authoritative application Constraint IR validation is required';
  end if;
  if p_expected_context is null or jsonb_typeof(p_expected_context)<>'object'
     or p_expected_context->>'schemaVersion'<>'1.0'
     or p_expected_context->>'studioId' is distinct from p_studio_id::text
     or coalesce(p_expected_context->>'scheduleId','')=''
     or coalesce(p_expected_context->>'scheduleAssignmentsHash','')=''
     or coalesce(p_expected_context->>'constraintModelVersion','')='' then
    raise exception 'MANUAL_MOVE_CONTEXT_INVALID: exact pinned scheduling context is required';
  end if;

  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id;
  if v_selected_role not in ('OWNER','EDITOR') then
    raise exception 'Editor membership required for selected workspace';
  end if;

  -- V2.5 still derives its studio from the user's highest-priority legacy
  -- membership. T10 therefore rejects a different selected workspace instead of
  -- silently writing to the wrong tenant. T22/T23 replace this compatibility
  -- bridge with tenant-explicit commands.
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  v_actor_context:=private.assert_editor_context();
  if (v_actor_context->>'studio_id')::uuid is distinct from p_studio_id then
    raise exception 'WORKSPACE_SELECTION_MISMATCH: selected %, legacy active %',p_studio_id,v_actor_context->>'studio_id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  v_current_context:=private.build_solver_context_token_v43(p_studio_id);
  if v_current_context is distinct from p_expected_context then
    raise exception 'STALE_MANUAL_MOVE_CONTEXT: ScheduleVersion/locks/policy/planning/model context changed after server validation';
  end if;
  v_constraint_model_version:=(p_expected_context->>'constraintModelVersion')::integer;

  -- End time is intentionally absent from p_changes. V2.5 derives it from the
  -- effective session override/class duration inside the same transaction.
  v_result:=public.apply_schedule_command_v25(
    'MOVE',
    p_assignment_id,
    null,
    p_changes,
    p_reason,
    (p_expected_context->>'scheduleVersion')::integer,
    (p_expected_context->>'rulebookVersion')::integer,
    (p_expected_context->>'enforcementVersion')::integer,
    (p_expected_context->>'planningDatasetVersion')::integer,
    p_ai_proposed
  );

  select sv.id into v_schedule_id
  from public.schedule_versions sv
  where sv.studio_id=p_studio_id
    and sv.is_current
    and sv.version=(v_result->>'scheduleVersion')::integer;
  if v_schedule_id is null then raise exception 'MANUAL_MOVE_PERSISTENCE_FAILED: new current ScheduleVersion is missing'; end if;

  -- V2.5 predates ConstraintModelVersion linkage. Preserve the exact pinned model
  -- on the new version so subsequent coherent reads do not become stale solely
  -- because a legal manual move occurred.
  update public.schedule_versions
  set constraint_model_version=v_constraint_model_version
  where id=v_schedule_id;

  update public.audit_events
  set payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
    'authority','SERVER_CONSTRAINT_IR_V46',
    'authoritativeConstraintIr',true,
    'constraintModelVersion',v_constraint_model_version,
    'expectedSolverContext',p_expected_context,
    'applicationConstraintIrValidation',p_application_validation,
    'legacyWriteBypassRetirementTask','T13'
  )
  where studio_id=p_studio_id
    and action='SCHEDULE_COMMAND'
    and entity_id=p_assignment_id
    and (payload->>'scheduleVersion')::integer=(v_result->>'scheduleVersion')::integer;

  return v_result || jsonb_build_object(
    'scheduleId',v_schedule_id,
    'constraintModelVersion',v_constraint_model_version,
    'authority','SERVER_CONSTRAINT_IR_V46',
    'authoritativeConstraintIr',true
  );
end
$function$;

revoke all on function public.apply_authoritative_move_v46(uuid,uuid,text,jsonb,text,jsonb,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.apply_authoritative_move_v46(uuid,uuid,text,jsonb,text,jsonb,jsonb,boolean)
  to service_role;
'''

TEST = r'''import { describe, expect, it } from "vitest";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import type { Assignment, SchedulePatch, StudioState } from "@/lib/domain";
import { evaluateAuthoritativeManualMove } from "@/lib/manual-move-command";

const assignment: Assignment = {
  id: "a1",
  sessionId: "s1",
  day: "Monday",
  startTime: "17:00",
  endTime: "18:00",
  teacherId: "t1",
  roomId: "room-wide",
  locked: false,
  status: "NORMAL",
};

function state(current: Assignment[] = [assignment]): StudioState {
  return {
    studioId: "studio",
    studioName: "Fixture",
    teachers: [{ id: "t1", name: "Teacher", subjects: ["Ballet"] }],
    rooms: [
      { id: "room-wide", name: "Wide Room", capacity: 99, features: [] },
      { id: "room-ir-small", name: "IR Small Room", capacity: 99, features: [] },
    ],
    students: [
      { id: "student-1", name: "One", level: "Level 1" },
      { id: "student-2", name: "Two", level: "Level 1" },
    ],
    cohorts: [],
    classes: [{
      id: "class",
      name: "Fixture Ballet",
      subject: "Ballet",
      level: "Level 1",
      durationMinutes: 60,
      weeklyFrequency: 2,
      rosterStudentIds: ["student-1", "student-2"],
      eligibleTeacherIds: ["t1"],
      companyOnly: false,
    }],
    sessions: [
      { id: "s1", classId: "class", ordinal: 1 },
      { id: "s2", classId: "class", ordinal: 2 },
    ],
    rules: [],
    rulebookVersions: [{ id: "rb", version: 1, name: "Fixture", createdAt: "", actor: "", reason: "", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: [],
    planningDatasetVersions: [],
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: [{ id: "schedule", version: 1, rulebookVersion: 1, enforcementVersion: 1, planningDatasetVersion: 1, createdAt: "", actor: "", reason: "", assignments: current, isCurrent: true }],
    scenarios: [],
    auditEvents: [],
  };
}

function model(withCapacity = false): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0",
    compilerVersion: "t10-test",
    rulebookVersion: 1,
    planningDatasetVersion: 1,
    activeRuleCount: 1,
    hardConstraints: [
      {
        id: "teacher-domain",
        kind: "TEACHER_SUBJECT_DOMAIN",
        ruleIds: ["DOMAIN-1"],
        selector: { teacherNames: ["Teacher"] },
        parameters: { allowedSubjects: ["Ballet"] },
        explanation: "Teacher may teach Ballet",
      },
      ...(withCapacity ? [{
        id: "ir-room-capacity",
        kind: "ROOM_CAPACITY" as const,
        ruleIds: ["IR-CAP-1"],
        selector: { roomNames: ["IR Small Room"] },
        parameters: { maxDancers: 1, exemptLevels: [] },
        explanation: "Authoritative IR-only room capacity witness",
      }] : []),
    ],
    objectivePrioritySpine: [],
    readinessRuleIds: [],
    governanceAssertions: [],
    uncompiledConstraintRuleIds: [],
    completeHardConstraintCompilation: true,
  };
}

function move(changes: SchedulePatch["changes"]): SchedulePatch {
  return { id: "move", operation: "MOVE", assignmentId: "a1", changes, reason: "T10 test move", proposedBy: "USER" };
}

describe("T10 authoritative manual MOVE", () => {
  it("rejects an IR-only illegal move that the legacy gate would permit", () => {
    const decision = evaluateAuthoritativeManualMove(state(), move({ roomId: "room-ir-small" }), model(true));
    expect(decision.comparison.legacy.accepts).toBe(true);
    expect(decision.comparison.constraintIr.accepts).toBe(false);
    expect(decision.comparison.disagreement).toBe("IR_STRICTER");
    expect(decision.accepted).toBe(false);
    expect(decision.blocker?.code).toBe("MANUAL_MOVE_IR_REJECTED");
    expect(decision.blocker?.ruleIds).toContain("IR-CAP-1");
  });

  it("derives canonical end time and allows a legal move within an explicitly incomplete draft", () => {
    const decision = evaluateAuthoritativeManualMove(
      state(),
      move({ startTime: "18:15", endTime: "18:30" }),
      model(),
    );
    expect(decision.accepted).toBe(true);
    expect(decision.comparison.candidate.after?.startTime).toBe("18:15");
    expect(decision.comparison.candidate.after?.endTime).toBe("19:15");
    expect(decision.draftStatus.scheduleComplete).toBe(false);
    expect(decision.draftStatus.unscheduledSessionIds).toEqual(["s2"]);
    expect(decision.draftStatus.publishable).toBe(false);
  });

  it("marks repair mode explicitly and accepts a move that removes the IR conflict", () => {
    const conflicted = state([{ ...assignment, roomId: "room-ir-small" }]);
    const decision = evaluateAuthoritativeManualMove(conflicted, move({ roomId: "room-wide" }), model(true));
    expect(decision.draftStatus.mode).toBe("REPAIR");
    expect(decision.comparison.constraintIr.beforeHardViolations).toBeGreaterThan(0);
    expect(decision.comparison.constraintIr.afterHardViolations).toBe(0);
    expect(decision.accepted).toBe(true);
  });

  it("fails structural lock semantics before evaluating a moved candidate", () => {
    expect(() => evaluateAuthoritativeManualMove(
      state([{ ...assignment, locked: true }]),
      move({ startTime: "18:00" }),
      model(),
    )).toThrow(/LOCKED_ASSIGNMENT/);
  });
});
'''

ROUTE_TEST = r'''import { readFileSync } from "node:fs";
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
'''

MIGRATION_TEST = r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260907110000_authoritative_manual_move_v46.sql", "utf8");

describe("T10 V4.6 authoritative manual MOVE migration", () => {
  it("is service-role-only and verifies selected editor membership", () => {
    expect(sql).toMatch(/revoke all[\s\S]+from public,anon,authenticated/i);
    expect(sql).toMatch(/grant execute[\s\S]+to service_role/i);
    expect(sql).toContain("Editor membership required for selected workspace");
    expect(sql).toContain("WORKSPACE_SELECTION_MISMATCH");
  });

  it("serializes and compares the exact solver context before delegating V2.5", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("private.build_solver_context_token_v43(p_studio_id)");
    expect(sql).toContain("STALE_MANUAL_MOVE_CONTEXT");
    expect(sql).toContain("public.apply_schedule_command_v25(");
  });

  it("preserves ConstraintModelVersion and records authoritative audit evidence", () => {
    expect(sql).toContain("set constraint_model_version=v_constraint_model_version");
    expect(sql).toContain("SERVER_CONSTRAINT_IR_V46");
    expect(sql).toContain("applicationConstraintIrValidation");
    expect(sql).toContain("legacyWriteBypassRetirementTask','T13'");
  });
});
'''

DB_SQL = r'''const authoritativeManualMoveSql = String.raw`
set search_path=public,extensions;

-- T09 intentionally leaves the current assignment locked. T10 starts from a
-- legal unlocked current placement so its own transaction can exercise MOVE.
update public.assignments a
set locked=false
from public.schedule_versions sv
where sv.id=a.schedule_version_id
  and sv.studio_id='11111111-1111-4111-8111-111111111111'
  and sv.is_current
  and a.session_id='t04-session';

-- Give the same actor a second lower-priority membership. T10 must reject that
-- selected tenant instead of allowing V2.5 to silently choose the owner's first
-- legacy membership.
insert into public.studios(id,name)
values ('22222222-2222-4222-8222-222222222222','T10 Other Studio')
on conflict(id) do nothing;
insert into public.studio_members(studio_id,user_id,role)
values ('22222222-2222-4222-8222-222222222222','10000000-0000-4000-8000-000000000001','EDITOR')
on conflict(studio_id,user_id) do update set role=excluded.role;

set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_other uuid := '22222222-2222-4222-8222-222222222222';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_context jsonb;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_stale_rejected boolean := false;
  v_workspace_rejected boolean := false;
  v_locked_rejected boolean := false;
begin
  v_context:=private.build_solver_context_token_v43(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;

  v_result:=public.apply_authoritative_move_v46(
    v_studio,v_owner,'t04-existing-assignment',
    '{"day":"Monday","startTime":"17:15","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
    'T10 valid authoritative manual move',v_context,
    '{"valid":true,"hardViolations":0,"unsupportedConstraintIds":[]}'::jsonb,false
  );
  if (v_result->>'scheduleVersion')::integer<>(v_context->>'scheduleVersion')::integer+1 then
    raise exception 'T10 valid move did not advance exactly one ScheduleVersion';
  end if;
  if v_result->>'authority' is distinct from 'SERVER_CONSTRAINT_IR_V46' then
    raise exception 'T10 result did not identify authoritative IR boundary';
  end if;
  if not exists (
    select 1 from public.assignments a
    join public.schedule_versions sv on sv.id=a.schedule_version_id
    where sv.studio_id=v_studio and sv.is_current and a.id='t04-existing-assignment'
      and a.start_time='17:15'::time and a.end_time='18:45'::time
  ) then
    raise exception 'T10 valid move did not derive/persist the canonical 90-minute interval';
  end if;
  if not exists (
    select 1 from public.schedule_versions sv
    where sv.studio_id=v_studio and sv.is_current
      and sv.constraint_model_version=(v_context->>'constraintModelVersion')::integer
  ) then
    raise exception 'T10 move lost the pinned ConstraintModelVersion link';
  end if;
  if not exists (
    select 1 from public.audit_events e
    where e.studio_id=v_studio and e.action='SCHEDULE_COMMAND' and e.entity_id='t04-existing-assignment'
      and e.payload->>'authority'='SERVER_CONSTRAINT_IR_V46'
      and (e.payload->>'authoritativeConstraintIr')::boolean=true
      and e.payload->>'legacyWriteBypassRetirementTask'='T13'
  ) then
    raise exception 'T10 authoritative audit evidence was not recorded';
  end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_move_v46(
      v_studio,v_owner,'t04-existing-assignment',
      '{"day":"Monday","startTime":"17:30","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T10 stale-context rejection',v_context,
      '{"valid":true,"hardViolations":0,"unsupportedConstraintIds":[]}'::jsonb,false
    );
  exception when others then
    if position('STALE_MANUAL_MOVE_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_stale_rejected:=true;
  end;
  if not v_stale_rejected then raise exception 'T10 stale reviewed context was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T10 stale-context rejection was not atomic'; end if;

  begin
    perform public.apply_authoritative_move_v46(
      v_other,v_owner,'anything','{}'::jsonb,'T10 wrong selected workspace','{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('WORKSPACE_SELECTION_MISMATCH' in sqlerrm)=0 then raise; end if;
    v_workspace_rejected:=true;
  end;
  if not v_workspace_rejected then raise exception 'T10 wrong selected workspace was silently accepted'; end if;

  update public.assignments a set locked=true
  from public.schedule_versions sv
  where sv.id=a.schedule_version_id and sv.studio_id=v_studio and sv.is_current and a.id='t04-existing-assignment';
  v_context:=private.build_solver_context_token_v43(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_move_v46(
      v_studio,v_owner,'t04-existing-assignment',
      '{"day":"Monday","startTime":"17:30","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T10 locked rejection',v_context,
      '{"valid":true,"hardViolations":0,"unsupportedConstraintIds":[]}'::jsonb,false
    );
  exception when others then
    if position('LOCKED_ASSIGNMENT' in sqlerrm)=0 then raise; end if;
    v_locked_rejected:=true;
  end;
  if not v_locked_rejected then raise exception 'T10 locked assignment move was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T10 locked rejection was not atomic'; end if;
end
$block$;
reset role;

select 'T10 PASS: explicit tenant/context guard, duration-derived MOVE, pinned model linkage, audit evidence, and atomic stale/lock rejection' as result;
`;

'''


def apply():
    (ROOT / 'lib/manual-move-command.ts').write_text(MANUAL_MOVE, encoding='utf-8', newline='\n')
    route = ROOT / 'app/api/schedule/move/route.ts'
    route.parent.mkdir(parents=True, exist_ok=True)
    route.write_text(ROUTE, encoding='utf-8', newline='\n')
    migration = ROOT / 'supabase/migrations/20260907110000_authoritative_manual_move_v46.sql'
    migration.write_text(MIGRATION, encoding='utf-8', newline='\n')
    (ROOT / 'tests/manual-move-command.test.ts').write_text(TEST, encoding='utf-8', newline='\n')
    (ROOT / 'tests/manual-move-route-contract.test.ts').write_text(ROUTE_TEST, encoding='utf-8', newline='\n')
    (ROOT / 'tests/manual-move-migration.test.ts').write_text(MIGRATION_TEST, encoding='utf-8', newline='\n')

    provider = ROOT / 'components/workspace-provider.tsx'
    text = provider.read_text(encoding='utf-8')
    text = text.replace('import { applyAssignmentChanges, emptyValidation, validateSchedule } from "@/lib/validator";', 'import { emptyValidation, validateSchedule } from "@/lib/validator";')
    pattern = re.compile(r'  async function applySchedulePatch\(patch: SchedulePatch\): Promise<MutationResult> \{.*?\n  \}\n\n  async function rebaseSchedule', re.S)
    replacement = r'''  async function applySchedulePatch(patch: SchedulePatch): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    if (patch.operation !== "MOVE") return { ok: false, error: "This T10 command path moves an existing assignment only." };
    if (!state || !session) return { ok: false, error: "An authenticated workspace is required." };
    if (scheduleIsStale) return {
      ok: false,
      error: `Schedule v${currentScheduleVersion} is linked to Rulebook v${currentScheduleRulebookVersion} / Enforcement v${currentScheduleEnforcementVersion} / Planning Dataset v${currentSchedulePlanningDatasetVersion || "unversioned"}. Revalidate it against Rulebook v${currentRulebookVersion} / Enforcement v${currentEnforcementVersion} / Planning Dataset v${currentPlanningDatasetVersion} first.`,
    };
    try {
      const response = await fetch("/api/schedule/move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ studioId: state.studioId, patch }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        return {
          ok: false,
          error: String(payload.error || "The authoritative server MOVE gate rejected this change."),
          validation: (payload.legacyValidation || payload.validation) as ValidationResult | undefined,
          details: payload,
        };
      }
      await load();
      return {
        ok: true,
        version: Number(payload.scheduleVersion || 0),
        validation: payload.validation as ValidationResult | undefined,
        details: payload,
      };
    } catch (caught) { return fail(caught); }
  }

  async function rebaseSchedule'''
    text, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit(f'workspace-provider MOVE function replacement count {count}')
    provider.write_text(text, encoding='utf-8', newline='\n')

    db = ROOT / 'scripts/test-db.mjs'
    text = db.read_text(encoding='utf-8')
    if 'const authoritativeManualMoveSql = String.raw`' not in text:
        marker = '\nfunction psql(container, user, sql, label) {'
        if marker not in text:
            raise SystemExit('test-db psql marker not found')
        text = text.replace(marker, '\n' + DB_SQL + 'function psql(container, user, sql, label) {', 1)
    call_marker = "    const sessionLockOutput = psql(container, 'postgres', sessionSpecificLockAdoptionSql, 'T09 session-specific lock adoption integration tests');\n    process.stdout.write(sessionLockOutput);"
    if call_marker not in text:
        raise SystemExit('test-db T09 call marker not found')
    if 'authoritativeManualMoveSql' not in text[text.index(call_marker)+len(call_marker):]:
        text = text.replace(call_marker, call_marker + "\n    const manualMoveOutput = psql(container, 'postgres', authoritativeManualMoveSql, 'T10 authoritative manual MOVE integration tests');\n    process.stdout.write(manualMoveOutput);", 1)
    db.write_text(text, encoding='utf-8', newline='\n')


def finalize():
    readme = ROOT / 'plans/README.md'
    text = readme.read_text(encoding='utf-8')
    text = text.replace('- Current task: **T10 — manual MOVE through authoritative IR**.', '- Current task: **T11 — ASSIGN/UNASSIGN canonical authority**.')
    text = text.replace('- Next task: T11 after T10 acceptance.', '- Next task: T12 after T11 acceptance.')
    old = '- Implementation progress: T01 through T09 have verified DONE evidence. T09 now binds runtime locks directly to stable session IDs, supports one locked meeting inside a multi-session class, uses SESSION OR ASSIGNMENT lock precedence through solve/validation/adoption, and returns deterministic runtime-lock conflict IDs. T10 is READY; T11 remains NOT_STARTED pending T10.'
    new = '- Implementation progress: T01 through T10 have verified DONE evidence. T10 routes desktop/mobile MOVE through an authenticated explicit-workspace server gate, one coherent pinned context, deterministic/published Constraint IR equality, canonical duration derivation, legacy safety floor, and a service-role-only V4.6 transaction with exact context recheck. Partial drafts remain movable but never claim publishable completeness. T11 is READY; T12 remains NOT_STARTED pending T11.'
    if old not in text:
        raise SystemExit('README implementation progress marker not found')
    text = text.replace(old, new)
    readme.write_text(text, encoding='utf-8', newline='\n')

    tasks = ROOT / 'plans/TASKS.md'
    text = tasks.read_text(encoding='utf-8')
    text = text.replace('| [T10](#t10) | Manual MOVE through authoritative IR | READY |', '| [T10](#t10) | Manual MOVE through authoritative IR | DONE |')
    text = text.replace('| [T11](#t11) | ASSIGN/UNASSIGN canonical authority | NOT_STARTED |', '| [T11](#t11) | ASSIGN/UNASSIGN canonical authority | READY |')
    # T10 field block only
    t10_start = text.index('<a id="t10"></a>')
    t11_start = text.index('<a id="t11"></a>')
    t10 = text[t10_start:t11_start]
    t10 = t10.replace('| Status | READY |', '| Status | DONE |', 1)
    t10 = t10.replace('- [ ] Server authenticates and authorizes the explicit workspace, reconstructs pinned context, derives duration, and evaluates IR before MOVE commits.', '- [x] Server authenticates and authorizes the explicit workspace, reconstructs pinned context, derives duration, and evaluates IR before MOVE commits.')
    t10 = t10.replace('- [ ] An IR-only illegal move is rejected without a new canonical version.', '- [x] An IR-only illegal move is rejected without a new canonical version.')
    t10 = t10.replace('- [ ] Valid desktop/mobile moves persist with version checks and audit evidence.', '- [x] Valid desktop/mobile moves persist with version checks and audit evidence.')
    t10 = t10.replace('- [ ] Draft completeness and repair behavior are explicit; moving within a partial schedule remains possible without a false publishable claim.', '- [x] Draft completeness and repair behavior are explicit; moving within a partial schedule remains possible without a false publishable claim.')
    completion_old = '### Completion evidence\n\nNot yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.'
    completion_new = '''### Completion evidence

Task/child: T10

Implemented files: `app/api/schedule/move/route.ts`, `lib/manual-move-command.ts`, `components/workspace-provider.tsx`, forward migration `supabase/migrations/20260907110000_authoritative_manual_move_v46.sql`, `tests/manual-move-command.test.ts`, `tests/manual-move-route-contract.test.ts`, `tests/manual-move-migration.test.ts`, and `scripts/test-db.mjs`. Historical migrations and production-ledger bytes were not edited.

Verified behavior: desktop and mobile MOVE continue to share `WorkspaceProvider`, which now POSTs to one server route instead of calling V2.5 directly. The server authenticates the bearer token against the explicitly supplied studio, rejects VIEWER access, reconstructs the T07 coherent snapshot, requires current ScheduleVersion links, recompiles the deterministic Constraint IR, proves exact semantic equality with the pinned published ConstraintModelVersion, derives the candidate interval from session/class duration, evaluates IR plus the temporary legacy safety floor, and rechecks the context token before commit. V4.6 is service-role-only, rechecks the exact context under advisory locks, rejects a selected tenant that differs from the legacy active membership, delegates only canonical MOVE fields to V2.5, preserves the pinned ConstraintModelVersion on the new schedule, and appends authoritative IR validation/context evidence to the audit event.

Regression evidence: the TypeScript suite proves an IR-only room-capacity violation is rejected even while the legacy gate accepts it; a legal move ignores a caller-supplied shortened end time and derives the canonical end; partial schedules remain movable with `scheduleComplete=false` and `publishable=false`; repair mode is explicit; and assignment locks fail structurally. The disposable PostgreSQL lifecycle proves a valid duration-derived MOVE advances one version, preserves the model link, writes authoritative audit evidence, rejects stale context atomically, rejects the wrong selected tenant, and rejects a locked assignment atomically.

Verification run: GitHub Actions T10 implementation run on Ubuntu 24.04 and Windows. Ubuntu executed `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:db`; Windows executed lint/typecheck/test/build, with the Docker database gate intentionally Ubuntu-only. All required gates passed before the implementation/handoff commit.

Remaining limitation / T13 bypass register: `apply_schedule_command_v25` remains executable by authenticated callers for compatibility until T11/T12 migrate the remaining command/recovery paths and T13 revokes/delegates superseded write entry points. Therefore the interim release remains blocked against claiming the shared server authority is unavoidable.

Resulting task status: DONE. Newly READY task: T11.''' 
    if completion_old not in t10:
        raise SystemExit('T10 completion evidence marker not found')
    t10 = t10.replace(completion_old, completion_new, 1)
    notes_old = 'Dependencies T03 through T09 are verified DONE. T10 is READY and is now the first executable unfinished task.'
    notes_new = 'T10 acceptance is verified. T11 is now READY and is the first executable unfinished task. Direct authenticated V2.5 access remains intentionally tracked for T13; no claim of unavoidable server authority is made yet.'
    if notes_old not in t10:
        raise SystemExit('T10 notes marker not found')
    t10 = t10.replace(notes_old, notes_new, 1)
    text = text[:t10_start] + t10 + text[t11_start:]
    # T11 field + notes
    t11_start = text.index('<a id="t11"></a>')
    t12_start = text.index('<a id="t12"></a>')
    t11 = text[t11_start:t12_start]
    t11 = t11.replace('| Status | NOT_STARTED |', '| Status | READY |', 1)
    t11 = t11.replace('Waiting for dependency acceptance: T10. This is normal sequencing, not a BLOCKED status.', 'Dependency T10 is verified DONE. T11 is READY and is now the first executable unfinished task.')
    text = text[:t11_start] + t11 + text[t12_start:]
    tasks.write_text(text, encoding='utf-8', newline='\n')

    nextp = ROOT / 'plans/NEXT.md'
    text = nextp.read_text(encoding='utf-8')
    text = text.replace('Current Task: T10\nNext Task: T11', 'Current Task: T11\nNext Task: T12')
    text = text.replace('Baseline: `17b3a60`. T09 is DONE. T10 is the next executable task; T11 remains pending T10.', 'Baseline: `17b3a60`. T10 is DONE. T11 is the next executable task; T12 remains pending T11.')
    # Update T10 status/dependency text if section exists.
    text = text.replace('## T10 — Manual MOVE through authoritative IR\n\n**Current status:** READY', '## T10 — Manual MOVE through authoritative IR\n\n**Current status:** DONE')
    text = text.replace('**Dependency check:** Satisfied: T03 through T09 are DONE. T10 is READY.', '**Dependency check:** Satisfied: T03 through T09 are DONE. T10 acceptance is verified.')
    text = text.replace('## T11 — ASSIGN/UNASSIGN canonical authority\n\n**Current status:** NOT_STARTED', '## T11 — ASSIGN/UNASSIGN canonical authority\n\n**Current status:** READY')
    nextp.write_text(text, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'apply'
    if mode == 'apply':
        apply()
    elif mode == 'finalize':
        finalize()
    else:
        raise SystemExit(f'unknown mode {mode}')

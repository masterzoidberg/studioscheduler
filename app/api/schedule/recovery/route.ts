import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Assignment } from "@/lib/domain";
import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";
import {
  loadCanonicalSolverSnapshot,
  loadCurrentSolverContextToken,
  solverSnapshotContextTokensMatch,
} from "@/lib/server-studio-state";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { constraintModelDefinition, constraintModelDefinitionsMatch } from "@/lib/constraint-model-version";
import { evaluateAuthoritativeScheduleRecovery, type ScheduleRecoveryOperation } from "@/lib/schedule-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
};

type RecoveryRequest = {
  studioId?: string;
  operation?: ScheduleRecoveryOperation;
  reason?: string;
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

function mapAssignment(row: Record<string, unknown>): Assignment {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    day: row.day as Assignment["day"],
    startTime: String(row.start_time || "").slice(0, 5),
    endTime: String(row.end_time || "").slice(0, 5),
    teacherId: String(row.teacher_id),
    roomId: String(row.room_id),
    locked: Boolean(row.locked),
    status: row.status as Assignment["status"],
  };
}

async function loadPreviousSchedule(
  supabase: SupabaseClient,
  studioId: string,
  currentVersion: number,
): Promise<{ id: string; version: number; assignments: Assignment[] } | null> {
  if (currentVersion <= 1) return null;
  const schedule = await supabase
    .from("schedule_versions")
    .select("id,version")
    .eq("studio_id", studioId)
    .eq("version", currentVersion - 1)
    .maybeSingle();
  if (schedule.error) throw schedule.error;
  if (!schedule.data) return null;
  const assignments = await supabase
    .from("assignments")
    .select("*")
    .eq("schedule_version_id", schedule.data.id)
    .order("id");
  if (assignments.error) throw assignments.error;
  return {
    id: String(schedule.data.id),
    version: Number(schedule.data.version),
    assignments: (assignments.data || []).map((row) => mapAssignment(row as Record<string, unknown>)),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RecoveryRequest;
    const studioId = typeof body.studioId === "string" ? body.studioId.trim() : "";
    const operation = body.operation;
    if (!studioId) return NextResponse.json({ error: "An explicit studioId is required." }, { status: 400 });
    if (operation !== "REBASE" && operation !== "UNDO") {
      return NextResponse.json({ error: "Recovery operation must be REBASE or UNDO." }, { status: 400 });
    }

    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") {
      return NextResponse.json({ error: "Editor access is required for schedule recovery." }, { status: 403 });
    }

    const snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, studioId);
    const token = snapshot.contextToken;
    if (token.scheduleVersion === null || token.scheduleId === null
      || token.rulebookVersion === null || token.enforcementVersion === null
      || token.planningDatasetVersion === null || token.constraintModelVersion === null) {
      return blocked("RECOVERY_CONTEXT_INCOMPLETE", "Recovery requires current schedule, policy, planning, and ConstraintModelVersion pointers.");
    }
    if (!token.planningConfirmedForSchedulingAt) {
      return blocked("RECOVERY_PLANNING_NOT_CONFIRMED", "The current PlanningDatasetVersion must be confirmed before recovery can create a new canonical schedule.");
    }

    const model = compileConstraintModel(snapshot.state);
    if (!model.completeHardConstraintCompilation || model.uncompiledConstraintRuleIds.length) {
      return blocked(
        "RECOVERY_CONSTRAINT_MODEL_INCOMPLETE",
        "Recovery failed closed because the current Rulebook does not have a complete authoritative HARD Constraint IR.",
        { uncompiledRuleIds: model.uncompiledConstraintRuleIds },
      );
    }
    const published = snapshot.publishedConstraintModel;
    const definition = constraintModelDefinition(model);
    if (!published || !published.complete
      || published.version !== token.constraintModelVersion
      || !constraintModelDefinitionsMatch(definition, published.snapshot)) {
      return blocked(
        "RECOVERY_CONSTRAINT_MODEL_STALE",
        "The deterministic Constraint IR does not match the current published ConstraintModelVersion. Sync the model before recovery.",
      );
    }

    const currentSchedule = snapshot.state.scheduleVersions.find((version) => version.isCurrent);
    if (!currentSchedule || currentSchedule.id !== token.scheduleId || currentSchedule.version !== token.scheduleVersion) {
      return blocked("RECOVERY_CONTEXT_INVALID", "The coherent snapshot does not contain the pinned current ScheduleVersion.");
    }

    let sourceScheduleId = currentSchedule.id;
    let sourceScheduleVersion = currentSchedule.version;
    let sourceAssignments = currentSchedule.assignments;
    if (operation === "UNDO") {
      const previous = await loadPreviousSchedule(authorized.supabase, studioId, currentSchedule.version);
      if (!previous) {
        return blocked("RECOVERY_NO_PREVIOUS_VERSION", `Schedule v${currentSchedule.version} has no immediately previous version to undo.`);
      }
      sourceScheduleId = previous.id;
      sourceScheduleVersion = previous.version;
      sourceAssignments = previous.assignments;
    }

    const decision = evaluateAuthoritativeScheduleRecovery(snapshot.state, sourceAssignments, operation, model);
    if (!decision.accepted) {
      return blocked(
        decision.blocker?.code || "RECOVERY_REJECTED",
        decision.blocker?.message || "The historical placements are incompatible with the current scheduling authority.",
        {
          blocker: decision.blocker,
          sourceScheduleVersion,
          irValidation: decision.irValidation,
          legacyValidation: decision.legacyValidation,
          draftStatus: decision.draftStatus,
        },
      );
    }

    const currentToken = await loadCurrentSolverContextToken(authorized.supabase, studioId);
    if (!solverSnapshotContextTokensMatch(token, currentToken)) {
      return blocked(
        "RECOVERY_CONTEXT_CHANGED_RETRY",
        "Scheduling context changed while recovery was being validated. Retry against the current schedule and policy.",
      );
    }

    let admin: SupabaseClient;
    try {
      admin = getServerAdminSupabase();
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : String(error),
        code: "RECOVERY_ADMIN_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : operation === "REBASE"
        ? `Revalidate Schedule v${currentSchedule.version} against the current scheduling context`
        : `Undo Schedule v${currentSchedule.version} by re-adopting Schedule v${sourceScheduleVersion} placements under current policy`;
    const candidate = decision.candidateAssignments.map((assignment) => ({
      assignmentId: assignment.id,
      sessionId: assignment.sessionId,
      day: assignment.day,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      teacherId: assignment.teacherId,
      roomId: assignment.roomId,
      status: assignment.status || "NORMAL",
    }));
    const result = await admin.rpc("apply_authoritative_schedule_recovery_v48", {
      p_operation: operation,
      p_studio_id: studioId,
      p_actor_user_id: authorized.userId,
      p_source_schedule_id: sourceScheduleId,
      p_reason: reason,
      p_expected_context: token,
      p_candidate: candidate,
      p_application_validation: decision.irValidation,
      p_draft_status: decision.draftStatus,
    });
    if (result.error) {
      const message = result.error.message || "Schedule recovery transaction failed.";
      if (message.includes("STALE_RECOVERY_CONTEXT")) {
        return blocked("RECOVERY_CONTEXT_CHANGED_RETRY", "Scheduling context changed before recovery commit. Retry the operation.");
      }
      if (message.includes("WORKSPACE_SELECTION_MISMATCH")) {
        return blocked("WORKSPACE_SELECTION_MISMATCH", "The selected workspace is not the legacy active membership context. Full multi-workspace writes arrive in T22/T23.");
      }
      if (message.includes("RECOVERY_") || message.includes("LOCKED_") || message.includes("DRAFT_STATUS_")) {
        return blocked("RECOVERY_TRANSACTION_REJECTED", message);
      }
      throw result.error;
    }

    const mutation = result.data as Record<string, unknown>;
    return NextResponse.json({
      status: operation === "REBASE" ? "REBASED" : "UNDONE",
      scheduleVersion: Number(mutation.scheduleVersion || 0),
      sourceScheduleVersion,
      mutation,
      validation: mutation.validation || null,
      irValidation: decision.irValidation,
      legacyValidation: decision.legacyValidation,
      draftStatus: decision.draftStatus,
      authoritativeConstraintModelVersion: token.constraintModelVersion,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      code: "RECOVERY_ERROR",
    }, { status: 500 });
  }
}

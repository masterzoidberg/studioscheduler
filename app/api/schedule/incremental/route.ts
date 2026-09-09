import { NextRequest, NextResponse } from "next/server";
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
import { evaluateAuthoritativeScheduleCommand } from "@/lib/manual-move-command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
};

type IncrementalRequest = {
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
    const body = await request.json() as IncrementalRequest;
    const studioId = typeof body.studioId === "string" ? body.studioId.trim() : "";
    const patch = body.patch;
    if (!studioId) return NextResponse.json({ error: "An explicit studioId is required." }, { status: 400 });
    if (!patch || !["ASSIGN", "UNASSIGN"].includes(patch.operation) || !patch.reason?.trim()) {
      return NextResponse.json({ error: "A complete ASSIGN or UNASSIGN patch with a reason is required." }, { status: 400 });
    }
    if (patch.operation === "ASSIGN" && !patch.changes.sessionId?.trim()) {
      return NextResponse.json({ error: "ASSIGN requires an explicit sessionId." }, { status: 400 });
    }
    if (patch.operation === "UNASSIGN" && !patch.assignmentId?.trim()) {
      return NextResponse.json({ error: "UNASSIGN requires an assignmentId." }, { status: 400 });
    }

    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") {
      return NextResponse.json({ error: "Editor access is required to change schedule assignments." }, { status: 403 });
    }

    const snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, studioId);
    if (!isCanonicalScheduleContext(snapshot.contextToken)) {
      return blocked(
        "INCREMENTAL_CONTEXT_STALE",
        "The current schedule is not linked to the exact current Rulebook, EnforcementVersion, PlanningDatasetVersion, and ConstraintModelVersion. Revalidate before editing.",
      );
    }

    const model = compileConstraintModel(snapshot.state);
    if (!model.completeHardConstraintCompilation || model.uncompiledConstraintRuleIds.length) {
      return blocked(
        "INCREMENTAL_CONSTRAINT_MODEL_INCOMPLETE",
        "Incremental schedule editing failed closed because the current Rulebook does not have a complete authoritative HARD Constraint IR.",
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
        "INCREMENTAL_CONSTRAINT_MODEL_STALE",
        "The deterministic Constraint IR does not match the pinned published ConstraintModelVersion. Refresh the model before editing the schedule.",
      );
    }

    let decision;
    try {
      decision = evaluateAuthoritativeScheduleCommand(snapshot.state, patch, model);
    } catch (error) {
      return blocked(
        "INCREMENTAL_STRUCTURE_REJECTED",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!decision.accepted) {
      return blocked(
        decision.blocker?.code || "INCREMENTAL_COMMAND_REJECTED",
        decision.blocker?.message || "The proposed incremental command was rejected by server validation.",
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
        "INCREMENTAL_CONTEXT_CHANGED_RETRY",
        "Scheduling context changed while this command was being validated. Retry against the current schedule.",
      );
    }

    let admin: SupabaseClient;
    try {
      admin = getServerAdminSupabase();
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : String(error),
        code: "INCREMENTAL_ADMIN_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const candidate = decision.comparison.candidate;
    const after = candidate.after;
    const result = await admin.rpc("apply_authoritative_incremental_command_v47", {
      p_operation: patch.operation,
      p_studio_id: studioId,
      p_actor_user_id: authorized.userId,
      p_assignment_id: candidate.assignmentId,
      p_session_id: candidate.sessionId,
      p_changes: patch.operation === "ASSIGN" && after ? {
        day: after.day,
        startTime: after.startTime,
        teacherId: after.teacherId,
        roomId: after.roomId,
        status: after.status || "NORMAL",
      } : {},
      p_reason: patch.reason.trim(),
      p_expected_context: snapshot.contextToken,
      p_application_validation: decision.comparison.constraintIr.after,
      p_draft_status: decision.draftStatus,
      p_ai_proposed: patch.proposedBy === "AI",
    });
    if (result.error) {
      const message = result.error.message || "Incremental schedule transaction failed.";
      if (message.includes("STALE_INCREMENTAL_CONTEXT")) {
        return blocked("INCREMENTAL_CONTEXT_CHANGED_RETRY", "Scheduling context changed before commit. Retry the command.");
      }
      if (message.includes("WORKSPACE_SELECTION_MISMATCH")) {
        return blocked("WORKSPACE_SELECTION_MISMATCH", "The selected workspace is not the legacy active membership context. Switch back to the active workspace; full multi-workspace writes arrive in T22/T23.");
      }
      if (/LOCKED_|ARCHIVED_OR_UNKNOWN_|SESSION_ALREADY_ASSIGNED|ASSIGNMENT_ID_ALREADY_EXISTS/.test(message)) {
        return blocked("INCREMENTAL_TRANSACTION_REJECTED", message);
      }
      throw result.error;
    }

    const mutation = (result.data || {}) as Record<string, unknown>;
    return NextResponse.json({
      status: patch.operation === "ASSIGN" ? "ASSIGNED" : "UNASSIGNED",
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
      code: "INCREMENTAL_COMMAND_ERROR",
    }, { status: 500 });
  }
}

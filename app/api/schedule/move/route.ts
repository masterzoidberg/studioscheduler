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

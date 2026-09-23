import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";
import {
  loadCanonicalSolverSnapshot,
  solverSnapshotContextTokensMatch,
  type SolverSnapshotContextToken,
} from "@/lib/server-studio-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
  actorLabel: string;
};

type SessionLockRequest = {
  studioId?: unknown;
  sessionId?: unknown;
  locked?: unknown;
  reason?: unknown;
  expectedContext?: unknown;
};

const requiredNumberKeys = [
  "rulebookVersion",
  "enforcementVersion",
  "planningDatasetVersion",
  "constraintModelVersion",
  "scheduleVersion",
] as const;
const requiredStringKeys = ["studioId", "scheduleId", "scheduleAssignmentsHash"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpectedContext(value: unknown, studioId: string): value is SolverSnapshotContextToken {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || value.studioId !== studioId) return false;
  return requiredNumberKeys.every((key) => typeof value[key] === "number" && Number.isSafeInteger(value[key]))
    && requiredStringKeys.every((key) => typeof value[key] === "string" && Boolean(value[key]?.trim()));
}

function isCanonicalScheduleContext(token: SolverSnapshotContextToken) {
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
  const metadata = isRecord(user.user_metadata) ? user.user_metadata : {};
  const actorLabel = typeof metadata.full_name === "string" && metadata.full_name.trim()
    ? metadata.full_name.trim()
    : user.email || "Studio manager";
  return { supabase, role: membership.data.role as AuthorizedWorkspace["role"], userId: user.id, actorLabel };
}

function blocked(code: string, error: string, detail: Record<string, unknown> = {}) {
  return NextResponse.json({ status: "BLOCKED", code, error, ...detail }, { status: 409 });
}

function transactionErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return String(error);
}

function transactionBlock(error: unknown) {
  const message = transactionErrorMessage(error);
  if (message.includes("STALE_SESSION_LOCK_CONTEXT")) {
    return blocked("SESSION_LOCK_CONTEXT_CHANGED_RETRY", "Scheduling context changed before the lock change could be committed. Refresh and retry.");
  }
  if (message.includes("SESSION_LOCK_PLACEMENT_REQUIRED")) {
    return blocked("SESSION_LOCK_PLACEMENT_REQUIRED", "Lock changes require this session to have exactly one current placement. Place it first.");
  }
  if (message.includes("SESSION_LOCK_PLACEMENT_AMBIGUOUS")) {
    return blocked("SESSION_LOCK_PLACEMENT_AMBIGUOUS", "This session has more than one current placement. Repair the schedule before changing its lock.");
  }
  if (message.includes("SESSION_LOCK_STATE_UNCHANGED")) {
    return blocked("SESSION_LOCK_STATE_UNCHANGED", "The selected session already has that effective lock state. No schedule version was created.");
  }
  if (message.includes("SESSION_LOCK_SESSION_NOT_FOUND")) {
    return NextResponse.json({ status: "BLOCKED", code: "SESSION_LOCK_SESSION_NOT_FOUND", error: "The selected session is no longer active in this studio." }, { status: 404 });
  }
  if (message.includes("Editor membership required") || message.includes("WORKSPACE_SELECTION_MISMATCH")) {
    return NextResponse.json({ status: "BLOCKED", code: "SESSION_LOCK_UNAUTHORIZED", error: "Editor access is required to change a session lock." }, { status: 403 });
  }
  if (message.includes("SESSION_LOCK_CONTEXT_INVALID")) {
    return blocked("SESSION_LOCK_CONTEXT_INVALID", "The submitted scheduling context is not valid. Refresh the schedule and retry.");
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SessionLockRequest;
    const studioId = typeof body.studioId === "string" ? body.studioId.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!studioId) return NextResponse.json({ error: "An explicit studioId is required." }, { status: 400 });
    if (!sessionId) return NextResponse.json({ error: "An explicit sessionId is required." }, { status: 400 });
    if (typeof body.locked !== "boolean") return NextResponse.json({ error: "A boolean locked state is required." }, { status: 400 });
    if (!reason) return NextResponse.json({ error: "A reason is required for a governed lock change." }, { status: 400 });
    if (!isExpectedContext(body.expectedContext, studioId)) {
      return NextResponse.json({ error: "A complete expected scheduling context is required." }, { status: 400 });
    }

    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") {
      return NextResponse.json({ error: "Editor access is required to change session locks." }, { status: 403 });
    }

    const snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, studioId);
    if (!solverSnapshotContextTokensMatch(body.expectedContext, snapshot.contextToken)) {
      return blocked("SESSION_LOCK_CONTEXT_CHANGED_RETRY", "The schedule or lock context changed before this request was reviewed. Refresh and retry.");
    }
    if (!isCanonicalScheduleContext(snapshot.contextToken)) {
      return blocked("SESSION_LOCK_CONTEXT_STALE", "The current schedule needs revalidation against the current scheduling context before its lock can change.");
    }

    const currentSchedule = snapshot.state.scheduleVersions.find((version) => version.isCurrent);
    const targetSession = snapshot.state.sessions.find((session) => session.id === sessionId);
    if (!targetSession) {
      return NextResponse.json({ status: "BLOCKED", code: "SESSION_LOCK_SESSION_NOT_FOUND", error: "The selected session is no longer active in this studio." }, { status: 404 });
    }
    const placements = currentSchedule?.assignments.filter((assignment) => assignment.sessionId === sessionId) || [];
    if (placements.length === 0) return blocked("SESSION_LOCK_PLACEMENT_REQUIRED", "Lock changes require this session to have exactly one current placement. Place it first.");
    if (placements.length !== 1) return blocked("SESSION_LOCK_PLACEMENT_AMBIGUOUS", "This session has more than one current placement. Repair the schedule before changing its lock.");

    let admin: SupabaseClient;
    try {
      admin = getServerAdminSupabase();
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : String(error),
        code: "SESSION_LOCK_ADMIN_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const result = await admin.rpc("apply_authoritative_session_lock_v63", {
      p_studio_id: studioId,
      p_actor_user_id: authorized.userId,
      p_actor_label: authorized.actorLabel,
      p_session_id: sessionId,
      p_locked: body.locked,
      p_reason: reason,
      p_expected_context: body.expectedContext,
    });
    if (result.error) {
      const knownBlock = transactionBlock(result.error);
      if (knownBlock) return knownBlock;
      throw result.error;
    }

    const mutation = isRecord(result.data) ? result.data : {};
    return NextResponse.json({
      status: mutation.status || (body.locked ? "LOCKED" : "UNLOCKED"),
      sessionId,
      locked: body.locked,
      effectiveLock: body.locked,
      scheduleVersion: Number(mutation.scheduleVersion || 0),
      planningDatasetVersion: Number(mutation.planningDatasetVersion || 0),
      certificationStale: true,
      candidateStale: true,
      mutation,
      validation: mutation.validation || null,
    });
  } catch (error) {
    const knownBlock = transactionBlock(error);
    if (knownBlock) return knownBlock;
    return NextResponse.json({
      error: transactionErrorMessage(error),
      code: "SESSION_LOCK_ERROR",
    }, { status: 500 });
  }
}

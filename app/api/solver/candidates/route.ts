import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";
import { isStudioId, selectedStudioIdFromHeader } from "@/lib/selected-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
  studioId: string;
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
    .select("role")
    .eq("studio_id", studioId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error || !membership.data) return null;
  return { supabase, role: membership.data.role as AuthorizedWorkspace["role"], userId: user.id, studioId };
}

function errorResponse(error: unknown, code: string, status = 500) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : String(error),
    code,
  }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const studioId = selectedStudioIdFromHeader(request);
    if (!studioId) return NextResponse.json({ error: "An explicit studio selection is required." }, { status: 400 });
    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    const result = await authorized.supabase.rpc("list_solver_candidate_reviews_v68", { p_studio_id: studioId });
    if (result.error) throw result.error;
    return NextResponse.json({ candidates: Array.isArray(result.data) ? result.data : [] });
  } catch (error) {
    return errorResponse(error, "SOLVER_CANDIDATE_LIST_FAILED");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { studioId?: unknown; candidateId?: unknown };
    const studioId = isStudioId(body.studioId) ? body.studioId : selectedStudioIdFromHeader(request);
    const candidateId = typeof body.candidateId === "string" && /^[0-9a-f-]{36}$/i.test(body.candidateId)
      ? body.candidateId
      : null;
    if (!studioId) return NextResponse.json({ error: "An explicit studio selection is required." }, { status: 400 });
    if (!candidateId) return NextResponse.json({ error: "A valid candidate review ID is required." }, { status: 400 });
    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") return NextResponse.json({ error: "Editor access is required to delete a candidate review." }, { status: 403 });
    const result = await getServerAdminSupabase().rpc("delete_solver_candidate_review_v68", {
      p_studio_id: studioId,
      p_actor_user_id: authorized.userId,
      p_candidate_id: candidateId,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ deleted: result.data === true });
  } catch (error) {
    return errorResponse(error, "SOLVER_CANDIDATE_DELETE_FAILED");
  }
}

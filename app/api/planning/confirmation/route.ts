import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { constraintModelDefinition } from "@/lib/constraint-model-version";
import { evaluateScheduleReadiness } from "@/lib/schedule-readiness";
import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";
import { loadCanonicalSolverSnapshot, type CanonicalSolverSnapshot } from "@/lib/server-studio-state";
import { isStudioId, selectedStudioIdFromHeader } from "@/lib/selected-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  userId: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
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
  return { supabase, userId: user.id, role: membership.data.role as AuthorizedWorkspace["role"] };
}

function response(snapshot: CanonicalSolverSnapshot) {
  const model = compileConstraintModel(snapshot.state);
  const readiness = evaluateScheduleReadiness(snapshot.state);
  return {
    context: snapshot.contextToken,
    readiness,
    certification: snapshot.state.readinessCertification || null,
    model: {
      version: snapshot.publishedConstraintModel?.version ?? null,
      rulebookVersion: snapshot.publishedConstraintModel?.rulebookVersion ?? null,
      compilerVersion: snapshot.publishedConstraintModel?.compilerVersion ?? model.compilerVersion,
      snapshotHash: snapshot.publishedConstraintModel?.snapshotHash ?? null,
      complete: Boolean(snapshot.publishedConstraintModel?.complete),
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const studioId = selectedStudioIdFromHeader(request);
    if (!studioId) return NextResponse.json({ error: "An explicit studio selection is required." }, { status: 400 });
    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    const snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, studioId);
    return NextResponse.json(response(snapshot));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { studioId?: unknown };
    const studioId = selectedStudioIdFromHeader(request) || (isStudioId(body.studioId) ? body.studioId : null);
    if (!studioId) return NextResponse.json({ error: "An explicit studio selection is required." }, { status: 400 });
    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") return NextResponse.json({ error: "Editor access is required to prepare certification." }, { status: 403 });

    let snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, studioId);
    let model = compileConstraintModel(snapshot.state);
    const published = snapshot.publishedConstraintModel;
    const stale = !published
      || published.rulebookVersion !== model.rulebookVersion
      || published.compilerVersion !== model.compilerVersion
      || !published.complete;
    if (stale) {
      if (!model.completeHardConstraintCompilation) {
        return NextResponse.json({ error: "The current Rulebook still has unsupported or uncompiled HARD meaning.", code: "CONSTRAINT_MODEL_INCOMPLETE", readiness: evaluateScheduleReadiness(snapshot.state) }, { status: 409 });
      }
      const admin = getServerAdminSupabase();
      const publication = await admin.rpc("publish_server_constraint_model_v63", {
        p_studio_id: studioId,
        p_actor_user_id: authorized.userId,
        p_snapshot: constraintModelDefinition(model),
        p_reason: `SET-07 certification preparation of ${model.compilerVersion} for Rulebook v${model.rulebookVersion}`,
        p_expected_rulebook_version: model.rulebookVersion,
      });
      if (publication.error) throw publication.error;
      snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, studioId);
      model = compileConstraintModel(snapshot.state);
    }
    return NextResponse.json(response(snapshot));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: "CERTIFICATION_PREPARATION_FAILED" }, { status: 500 });
  }
}

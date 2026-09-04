import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";
import { loadCanonicalSolverStudioState } from "@/lib/server-studio-state";
import { prepareFeasibilitySolve } from "@/lib/solver-problem";
import { constraintModelDefinition } from "@/lib/constraint-model-version";
import { legacySafetyBridgeReport } from "@/lib/legacy-safety-bridge";
import {
  publishedConstraintModelBlockers,
  validateFeasibleSolverCandidate,
  type PublishedConstraintModelRecord,
  type SolverAssignmentCandidate,
  type SolverServicePayload,
} from "@/lib/solver-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUDIO_ID = "11111111-1111-4111-8111-111111111111";

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
  actorLabel: string;
};

type AdoptionRequest = {
  context?: {
    studioId?: string;
    rulebookVersion?: number;
    planningDatasetVersion?: number;
    compilerVersion?: string;
  };
  assignments?: SolverAssignmentCandidate[];
  reason?: string;
};

async function authorizeWorkspace(request: NextRequest): Promise<AuthorizedWorkspace | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const supabase = getServerSupabase(authorization);
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) return null;
  const membership = await supabase
    .from("studio_members")
    .select("role")
    .eq("studio_id", STUDIO_ID)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error || !membership.data) return null;
  return {
    supabase,
    role: membership.data.role as AuthorizedWorkspace["role"],
    userId: user.id,
    actorLabel: user.email || user.id,
  };
}

async function loadPublishedConstraintModel(supabase: SupabaseClient): Promise<PublishedConstraintModelRecord | null> {
  const query = await supabase
    .from("constraint_model_versions")
    .select("version,rulebook_version,compiler_version,snapshot,complete_hard_constraint_compilation")
    .eq("studio_id", STUDIO_ID)
    .eq("status", "CURRENT")
    .maybeSingle();
  if (query.error) throw query.error;
  if (!query.data) return null;
  return {
    version: Number(query.data.version),
    rulebookVersion: Number(query.data.rulebook_version),
    compilerVersion: String(query.data.compiler_version),
    complete: Boolean(query.data.complete_hard_constraint_compilation),
    snapshot: query.data.snapshot as PublishedConstraintModelRecord["snapshot"],
  };
}

function contextsMatch(expected: AdoptionRequest["context"], actual: {
  studioId: string;
  rulebookVersion: number;
  planningDatasetVersion: number;
  compilerVersion: string;
}) {
  return Boolean(expected
    && expected.studioId === actual.studioId
    && Number(expected.rulebookVersion) === actual.rulebookVersion
    && Number(expected.planningDatasetVersion) === actual.planningDatasetVersion
    && expected.compilerVersion === actual.compilerVersion);
}

export async function POST(request: NextRequest) {
  try {
    const authorized = await authorizeWorkspace(request);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") {
      return NextResponse.json({ error: "Editor access is required to adopt a solver candidate." }, { status: 403 });
    }

    const body = await request.json() as AdoptionRequest;
    const reason = body.reason?.trim() || "Adopt independently validated CP-SAT candidate";
    if (!Array.isArray(body.assignments)) {
      return NextResponse.json({ error: "Candidate assignments are required." }, { status: 400 });
    }

    const state = await loadCanonicalSolverStudioState(authorized.supabase, STUDIO_ID);
    const preparation = prepareFeasibilitySolve(state);
    if (!preparation.ok) {
      return NextResponse.json({
        status: "BLOCKED",
        code: "SOLVER_ADOPTION_PREPARATION_BLOCKED",
        blockers: preparation.blockers,
      }, { status: 409 });
    }

    if (!contextsMatch(body.context, preparation.problem.context)) {
      return NextResponse.json({
        status: "BLOCKED",
        code: "SOLVER_ADOPTION_CONTEXT_STALE",
        error: "The candidate was solved against a different canonical Rulebook, Planning Dataset, compiler, or studio context.",
      }, { status: 409 });
    }

    const published = await loadPublishedConstraintModel(authorized.supabase);
    const publishedBlockers = publishedConstraintModelBlockers(preparation.problem, published);
    if (publishedBlockers.length || !published) {
      return NextResponse.json({
        status: "BLOCKED",
        code: "SOLVER_ADOPTION_CONSTRAINT_MODEL_BLOCKED",
        blockers: publishedBlockers,
      }, { status: 409 });
    }

    const legacyBridge = legacySafetyBridgeReport(state, preparation.problem.constraintModel);
    if (!legacyBridge.complete) {
      return NextResponse.json({
        status: "BLOCKED",
        code: "SOLVER_ADOPTION_LEGACY_BRIDGE_INCOMPLETE",
        uncoveredRuleIds: legacyBridge.uncoveredRuleIds,
      }, { status: 409 });
    }

    // Reconstitute the solver response boundary and independently validate the
    // browser-supplied candidate against freshly loaded canonical state. The
    // browser's prior validation result is deliberately ignored.
    const syntheticPayload: SolverServicePayload = {
      serviceVersion: "adoption-revalidation",
      context: { ...preparation.problem.context },
      result: {
        status: "FEASIBLE",
        assignments: body.assignments,
        unsupportedConstraintIds: [],
        delegatedConstraintIds: [],
        missingPreconditionConstraintIds: [],
        blockingConstraintIds: [],
      },
    };
    const candidate = validateFeasibleSolverCandidate(state, preparation.problem, syntheticPayload);
    if (!candidate.ok || !candidate.validation) {
      return NextResponse.json({
        status: "BLOCKED",
        code: "SOLVER_ADOPTION_CANDIDATE_REJECTED",
        blockers: candidate.blockers,
        validation: candidate.validation,
      }, { status: 409 });
    }

    const currentSchedule = state.scheduleVersions.find((version) => version.isCurrent);
    const currentEnforcement = state.enforcementVersions.find((version) => version.status === "CURRENT");
    if (!currentSchedule || !currentEnforcement) {
      return NextResponse.json({
        status: "BLOCKED",
        code: "SOLVER_ADOPTION_VERSION_CONTEXT_INCOMPLETE",
        error: "Current schedule or EnforcementVersion is missing.",
      }, { status: 409 });
    }

    let admin: SupabaseClient;
    try {
      admin = getServerAdminSupabase();
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : String(error),
        code: "SOLVER_ADOPTION_ADMIN_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const canonicalAssignments = candidate.assignments.map((assignment) => ({
      sessionId: assignment.sessionId,
      day: assignment.day,
      startTime: assignment.startTime,
      teacherId: assignment.teacherId,
      roomId: assignment.roomId,
    }));

    const result = await admin.rpc("adopt_solver_candidate_v33", {
      p_studio_id: STUDIO_ID,
      p_actor_user_id: authorized.userId,
      p_actor_label: authorized.actorLabel,
      p_reason: reason,
      p_expected_schedule_version: currentSchedule.version,
      p_expected_rulebook_version: preparation.problem.context.rulebookVersion,
      p_expected_enforcement_version: currentEnforcement.version,
      p_expected_planning_dataset_version: preparation.problem.context.planningDatasetVersion,
      p_expected_constraint_model_version: published.version,
      p_candidate: canonicalAssignments,
      p_application_validation: candidate.validation,
    });
    if (result.error) throw result.error;

    return NextResponse.json({
      status: "ADOPTED",
      adoption: result.data,
      compilerDefinition: constraintModelDefinition(preparation.problem.constraintModel),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      code: "SOLVER_ADOPTION_ERROR",
    }, { status: 500 });
  }
}

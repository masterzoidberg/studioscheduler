import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";
import { loadCanonicalSolverSnapshot, type CanonicalSolverSnapshot } from "@/lib/server-studio-state";
import { prepareFeasibilitySolve } from "@/lib/solver-problem";
import {
  buildReviewedSolverCandidateContext,
  parseReviewedSolverCandidateContext,
  reviewedSolverCandidateContextFromSnapshot,
  reviewedSolverCandidateContextsMatch,
} from "@/lib/solver-candidate-context";
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
  candidateContext?: unknown;
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

function publishedModel(snapshot: CanonicalSolverSnapshot): PublishedConstraintModelRecord | null {
  const published = snapshot.publishedConstraintModel;
  return published ? {
    version: published.version,
    rulebookVersion: published.rulebookVersion,
    compilerVersion: published.compilerVersion,
    complete: published.complete,
    snapshot: published.snapshot,
  } : null;
}

function staleReviewResponse() {
  return NextResponse.json({
    status: "BLOCKED",
    code: "SOLVER_ADOPTION_REVIEW_CONTEXT_STALE",
    error: "The schedule, locks, policy, planning data, or model changed after this candidate was generated. Generate a fresh candidate and review it again before adoption.",
  }, { status: 409 });
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
    const reviewedContext = parseReviewedSolverCandidateContext(body.candidateContext);
    if (!reviewedContext) {
      return NextResponse.json({
        error: "A complete versioned candidate review context is required. Generate the candidate again with the current solver gateway.",
        code: "SOLVER_ADOPTION_REVIEW_CONTEXT_REQUIRED",
      }, { status: 400 });
    }
    if (reviewedContext.solverContextToken.studioId !== STUDIO_ID) return staleReviewResponse();

    const snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, STUDIO_ID);
    const currentPublished = snapshot.publishedConstraintModel;
    if (!currentPublished) return staleReviewResponse();
    const currentReviewedContext = reviewedSolverCandidateContextFromSnapshot(
      snapshot.contextToken,
      currentPublished.compilerVersion,
    );
    if (!reviewedSolverCandidateContextsMatch(reviewedContext, currentReviewedContext)) {
      return staleReviewResponse();
    }

    const state = snapshot.state;
    const preparation = prepareFeasibilitySolve(state);
    if (!preparation.ok) {
      return NextResponse.json({
        status: "BLOCKED",
        code: "SOLVER_ADOPTION_PREPARATION_BLOCKED",
        blockers: preparation.blockers,
      }, { status: 409 });
    }
    const preparedReviewedContext = buildReviewedSolverCandidateContext(preparation.problem, snapshot.contextToken);
    if (!reviewedSolverCandidateContextsMatch(reviewedContext, preparedReviewedContext)) {
      return staleReviewResponse();
    }

    const published = publishedModel(snapshot);
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
    // browser-supplied candidate against the exact coherent state the manager
    // reviewed. The browser's prior validation result is deliberately ignored.
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
      endTime: assignment.endTime,
      teacherId: assignment.teacherId,
      roomId: assignment.roomId,
    }));

    // Critical T08 boundary: pass the manager-reviewed context into the database
    // unchanged. Do not substitute versions from a fresh server read here.
    const result = await admin.rpc("adopt_solver_candidate_v49", {
      p_studio_id: STUDIO_ID,
      p_actor_user_id: authorized.userId,
      p_actor_label: authorized.actorLabel,
      p_reason: reason,
      p_expected_context: reviewedContext,
      p_candidate: canonicalAssignments,
      p_application_validation: candidate.validation,
    });
    if (result.error) {
      if (result.error.message?.includes("STALE_SOLVER_CANDIDATE_CONTEXT")) return staleReviewResponse();
      throw result.error;
    }

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

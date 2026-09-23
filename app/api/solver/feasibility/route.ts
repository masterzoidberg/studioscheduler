import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";
import {
  loadCanonicalSolverSnapshot,
  loadCurrentSolverContextToken,
  solverSnapshotContextTokensMatch,
  type CanonicalSolverSnapshot,
} from "@/lib/server-studio-state";
import { prepareFeasibilitySolve, type FeasibilitySolverProblem } from "@/lib/solver-problem";
import { buildReviewedSolverCandidateContext } from "@/lib/solver-candidate-context";
import { constraintModelDefinition } from "@/lib/constraint-model-version";
import { legacySafetyBridgeReport } from "@/lib/legacy-safety-bridge";
import {
  constraintModelSyncDecision,
  publishedConstraintModelBlockers,
  validateFeasibleSolverCandidate,
  type PublishedConstraintModelRecord,
  type SolverServicePayload,
} from "@/lib/solver-gateway";
import { isStudioId, selectedStudioIdFromHeader } from "@/lib/selected-studio";
import { compareScheduleQuality, scoreScheduleQuality } from "@/lib/schedule-quality";
import { solverFeasibilityDiagnostic } from "@/lib/solver-operations";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SERVICE_SECONDS = 30;

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
  actorLabel: string;
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
  return {
    supabase,
    role: membership.data.role as AuthorizedWorkspace["role"],
    userId: user.id,
    actorLabel: user.email || user.id,
    studioId,
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

async function publishConstraintModelForSolve(
  studioId: string,
  actorUserId: string,
  problem: FeasibilitySolverProblem,
  published: PublishedConstraintModelRecord | null,
) {
  const decision = constraintModelSyncDecision(problem, published);
  if (decision.action !== "PUBLISH") return false;

  // T13: only the deterministic server compiler may cross the publication
  // boundary. Browser-authenticated clients no longer execute V3.0 directly.
  const definition = constraintModelDefinition(problem.constraintModel);
  const admin = getServerAdminSupabase();
  const result = await admin.rpc("publish_server_constraint_model_v63", {
    p_studio_id: studioId,
    p_actor_user_id: actorUserId,
    p_snapshot: definition,
    p_reason: `Solver preflight sync of ${definition.compilerVersion} for Rulebook v${definition.rulebookVersion}: ${decision.reason}`,
    p_expected_rulebook_version: problem.context.rulebookVersion,
  });
  if (result.error) throw result.error;
  return true;
}

function serviceConfiguration() {
  const url = process.env.SOLVER_SERVICE_URL?.trim().replace(/\/+$/, "") || "";
  const token = process.env.SOLVER_INTERNAL_TOKEN?.trim() || "";
  const requested = Number(process.env.SOLVER_MAX_SECONDS || 10);
  const maxSeconds = Number.isFinite(requested)
    ? Math.min(MAX_SERVICE_SECONDS, Math.max(1, requested))
    : 10;
  return { url, token, maxSeconds, configured: Boolean(url && token) };
}

function adoptionConfiguration() {
  return { configured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) };
}

async function buildGatewayPreflight(
  supabase: SupabaseClient,
  studioId: string,
  options: { syncPublishedModel?: boolean; actorUserId?: string } = {},
) {
  let snapshot = await loadCanonicalSolverSnapshot(supabase, studioId);
  let preparation = prepareFeasibilitySolve(snapshot.state);
  if (!preparation.ok) {
    return {
      snapshot,
      preparation,
      published: null,
      publishedBlockers: [],
      legacyBridge: null,
      blockers: preparation.blockers,
    };
  }

  let published = publishedModel(snapshot);
  if (options.syncPublishedModel) {
    if (!options.actorUserId) throw new Error("Constraint Model publication requires an authenticated actor.");
  }
  if (options.syncPublishedModel && await publishConstraintModelForSolve(studioId, options.actorUserId!, preparation.problem, published)) {
    // Publication is a context mutation. Reload the complete coherent snapshot
    // instead of combining the new model pointer with planning/rules read earlier.
    snapshot = await loadCanonicalSolverSnapshot(supabase, studioId);
    preparation = prepareFeasibilitySolve(snapshot.state);
    if (!preparation.ok) {
      return {
        snapshot,
        preparation,
        published: null,
        publishedBlockers: [],
        legacyBridge: null,
        blockers: preparation.blockers,
      };
    }
    published = publishedModel(snapshot);
  }

  const publishedBlockers = publishedConstraintModelBlockers(preparation.problem, published);
  const legacyBridge = legacySafetyBridgeReport(snapshot.state, preparation.problem.constraintModel);
  const legacyBlockers = legacyBridge.complete ? [] : [{
    code: "LEGACY_SAFETY_BRIDGE_INCOMPLETE",
    message: `The new Constraint IR has not yet accounted for ${legacyBridge.uncoveredRuleIds.length} protection(s) from the current legacy EnforcementVersion.`,
    ruleIds: legacyBridge.uncoveredRuleIds,
    entityIds: [],
  }];
  const normalizedPublishedBlockers = publishedBlockers.map((blocker) => ({ ...blocker, ruleIds: [] as string[] }));
  return {
    snapshot,
    preparation,
    published,
    publishedBlockers,
    legacyBridge,
    blockers: [...normalizedPublishedBlockers, ...legacyBlockers],
  };
}

async function snapshotContextIsCurrent(supabase: SupabaseClient, studioId: string, snapshot: CanonicalSolverSnapshot) {
  const current = await loadCurrentSolverContextToken(supabase, studioId);
  return solverSnapshotContextTokensMatch(snapshot.contextToken, current);
}

function contextChangedResponse() {
  return NextResponse.json({
    status: "BLOCKED",
    code: "SOLVER_CONTEXT_CHANGED_RETRY",
    error: "Rulebook, planning, model, schedule, lock, or policy context changed during solver preparation/execution. Generate a fresh candidate from one coherent snapshot.",
  }, { status: 409 });
}

export async function GET(request: NextRequest) {
  try {
    const studioId = selectedStudioIdFromHeader(request);
    if (!studioId) return NextResponse.json({ error: "An explicit studio selection is required." }, { status: 400 });
    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });

    const gateway = await buildGatewayPreflight(authorized.supabase, authorized.studioId);
    const service = serviceConfiguration();
    const adoption = adoptionConfiguration();
    const preparation = gateway.preparation;
    return NextResponse.json({
      serviceConfigured: service.configured,
      adoptionConfigured: adoption.configured,
      readyToRun: preparation.ok && gateway.blockers.length === 0 && service.configured,
      canRun: authorized.role === "OWNER" || authorized.role === "EDITOR",
      context: preparation.ok ? preparation.problem.context : null,
      preparationReady: preparation.ok,
      blockers: preparation.ok ? gateway.blockers : preparation.blockers,
      readiness: preparation.readiness,
      delegatedPreflight: preparation.delegatedPreflight,
      publishedConstraintModel: gateway.published ? {
        version: gateway.published.version,
        rulebookVersion: gateway.published.rulebookVersion,
        compilerVersion: gateway.published.compilerVersion,
        complete: gateway.published.complete,
      } : null,
      legacySafetyBridge: gateway.legacyBridge,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

async function processFeasibilityRequest(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { studioId?: unknown };
    const studioId = isStudioId(body.studioId) ? body.studioId : null;
    if (!studioId) return NextResponse.json({ error: "An explicit studio selection is required." }, { status: 400 });
    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") {
      return NextResponse.json({ error: "Editor access is required to run the feasibility solver." }, { status: 403 });
    }

    const service = serviceConfiguration();
    if (!service.configured) {
      return NextResponse.json({
        error: "The internal solver service is not configured on the application backend.",
        code: "SOLVER_SERVICE_NOT_CONFIGURED",
      }, { status: 503 });
    }

    // An explicit OWNER/EDITOR solve may repair a missing or plainly stale
    // deterministic ConstraintModelVersion. Any such publication is followed by
    // a full coherent-snapshot reload before the service request is constructed.
    const gateway = await buildGatewayPreflight(authorized.supabase, authorized.studioId, {
      syncPublishedModel: true,
      actorUserId: authorized.userId,
    });
    if (!gateway.preparation.ok) {
      return NextResponse.json({
        status: "BLOCKED",
        code: "SOLVER_PREPARATION_BLOCKED",
        blockers: gateway.preparation.blockers,
        readiness: gateway.preparation.readiness,
        delegatedPreflight: gateway.preparation.delegatedPreflight,
      }, { status: 409 });
    }
    if (gateway.blockers.length) {
      return NextResponse.json({
        status: "BLOCKED",
        code: "SOLVER_GATEWAY_BLOCKED",
        blockers: gateway.blockers,
      }, { status: 409 });
    }

    if (!await snapshotContextIsCurrent(authorized.supabase, authorized.studioId, gateway.snapshot)) {
      return contextChangedResponse();
    }

    const problem = gateway.preparation.problem;
    let response: Response;
    try {
      response = await fetch(`${service.url}/v1/feasibility`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${service.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ problem, maxSeconds: service.maxSeconds }),
        cache: "no-store",
        signal: AbortSignal.timeout((service.maxSeconds + 5) * 1000),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return NextResponse.json({
        error: timeout
          ? "The schedule service did not finish before its time limit. Your current schedule is unchanged."
          : "The schedule service could not be reached. Your current schedule is unchanged.",
        code: timeout ? "SOLVER_SERVICE_TIMEOUT" : "SOLVER_SERVICE_UNAVAILABLE",
      }, { status: timeout ? 504 : 503 });
    }

    if (!response.ok) {
      return NextResponse.json({
        error: "The schedule service returned an error. Your current schedule is unchanged.",
        code: "SOLVER_SERVICE_ERROR",
        serviceStatus: response.status,
      }, { status: 502 });
    }

    // The external solve may be long enough for a manager/editor to change
    // planning or policy. Discard the result if any coherent-context token field
    // changed; T08 separately binds a reviewed candidate through later adoption.
    if (!await snapshotContextIsCurrent(authorized.supabase, authorized.studioId, gateway.snapshot)) {
      return contextChangedResponse();
    }

    const payload = await response.json() as SolverServicePayload;
    const resultStatus = payload.result?.status || "UNKNOWN";
    if (resultStatus === "INFEASIBLE" || resultStatus === "UNKNOWN") {
      return NextResponse.json({
        status: resultStatus,
        optimizationStatus: payload.result?.optimizationStatus || null,
        provenOptimal: payload.result?.provenOptimal === true,
        context: payload.context || problem.context,
        blockingConstraintIds: payload.result?.blockingConstraintIds || [],
        wallTimeSeconds: payload.result?.wallTimeSeconds ?? null,
        candidate: null,
        persisted: false,
      });
    }
    if (resultStatus === "UNSUPPORTED" || resultStatus === "PRECONDITION_REQUIRED") {
      return NextResponse.json({
        error: `Solver contract failed closed with ${resultStatus}.`,
        code: "SOLVER_CONTRACT_DRIFT",
        unsupportedConstraintIds: payload.result?.unsupportedConstraintIds || [],
        missingPreconditionConstraintIds: payload.result?.missingPreconditionConstraintIds || [],
      }, { status: 502 });
    }

    const candidate = validateFeasibleSolverCandidate(gateway.snapshot.state, problem, payload);
    if (!candidate.ok || !candidate.validation) {
      return NextResponse.json({
        error: "The solver returned a candidate that did not pass independent application-side Constraint IR validation.",
        code: "SOLVER_CANDIDATE_REJECTED",
        blockers: candidate.blockers,
        validation: candidate.validation,
      }, { status: 502 });
    }

    const candidateContext = buildReviewedSolverCandidateContext(problem, gateway.snapshot.contextToken);
    const qualityComparison = (() => {
      const current = gateway.snapshot.state.scheduleVersions.find((version) => version.isCurrent);
      const baseline = scoreScheduleQuality(gateway.snapshot.state, problem.constraintModel, current?.assignments || []);
      return {
        status: compareScheduleQuality(candidate.quality!, baseline),
        baseline,
      };
    })();

    let candidateReview: Record<string, unknown>;
    try {
      const admin = getServerAdminSupabase();
      const persisted = await admin.rpc("create_solver_candidate_review_v68", {
        p_studio_id: authorized.studioId,
        p_actor_user_id: authorized.userId,
        p_actor_label: authorized.actorLabel,
        p_name: "Solver candidate",
        p_candidate_context: candidateContext,
        p_assignments: candidate.assignments,
        p_quality: candidate.quality,
        p_optimization_status: payload.result?.optimizationStatus || "FEASIBILITY_ONLY",
        p_proven_optimal: payload.result?.provenOptimal === true,
        p_service_version: payload.serviceVersion || null,
      });
      if (persisted.error) {
        if (persisted.error.message?.includes("STALE_SOLVER_CANDIDATE_CONTEXT")) return contextChangedResponse();
        throw persisted.error;
      }
      candidateReview = (persisted.data && typeof persisted.data === "object" ? persisted.data : {}) as Record<string, unknown>;
      if (typeof candidateReview.id !== "string") throw new Error("Candidate review persistence returned an incomplete record.");
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error && error.message.includes("SUPABASE_SERVICE_ROLE_KEY")
          ? "The server cannot persist solver reviews until its governed database credential is configured."
          : "The validated candidate could not be saved for review. The current schedule is unchanged; retry the build.",
        code: "SOLVER_CANDIDATE_PERSISTENCE_FAILED",
      }, { status: 503 });
    }

    return NextResponse.json({
      status: "FEASIBLE",
      context: problem.context,
      candidateContext,
      candidateId: candidateReview.id,
      serviceVersion: payload.serviceVersion || null,
      optimizationStatus: payload.result?.optimizationStatus || "FEASIBILITY_ONLY",
      provenOptimal: payload.result?.provenOptimal === true,
      candidate: {
        assignments: candidate.assignments,
        validation: candidate.validation,
        quality: candidate.quality,
      },
      qualityComparison,
      diagnostics: {
        delegatedConstraintIds: payload.result?.delegatedConstraintIds || [],
        blockingConstraintIds: payload.result?.blockingConstraintIds || [],
        wallTimeSeconds: payload.result?.wallTimeSeconds ?? null,
        branches: payload.result?.branches ?? null,
        conflicts: payload.result?.conflicts ?? null,
        objectiveValues: payload.result?.objectiveValues || [],
      },
      persisted: true,
      adoptionAllowed: false,
      adoptionMessage: "This candidate is saved for review. Adoption still uses the governed ScheduleVersion command after a fresh server-side revalidation.",
    });
  } catch {
    return NextResponse.json({
      error: "The schedule builder could not complete this request. Your current schedule is unchanged. Try again later; if it continues, share the support reference with the workspace operator.",
      code: "SOLVER_GATEWAY_ERROR",
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const response = await processFeasibilityRequest(request);
  response.headers.set("x-request-id", requestId);

  const payload = await response.clone().json().catch(() => ({})) as { status?: unknown; code?: unknown };
  const event = solverFeasibilityDiagnostic({
    requestId,
    httpStatus: response.status,
    durationMs: Date.now() - startedAt,
    solverStatus: payload.status,
    code: payload.code,
  });
  console.info(JSON.stringify(event));
  return response;
}

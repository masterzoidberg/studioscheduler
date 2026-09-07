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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUDIO_ID = "11111111-1111-4111-8111-111111111111";
const MAX_SERVICE_SECONDS = 30;

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
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
  const result = await admin.rpc("publish_server_constraint_model_v49", {
    p_studio_id: STUDIO_ID,
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
  options: { syncPublishedModel?: boolean; actorUserId?: string } = {},
) {
  let snapshot = await loadCanonicalSolverSnapshot(supabase, STUDIO_ID);
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
  if (options.syncPublishedModel && await publishConstraintModelForSolve(options.actorUserId!, preparation.problem, published)) {
    // Publication is a context mutation. Reload the complete coherent snapshot
    // instead of combining the new model pointer with planning/rules read earlier.
    snapshot = await loadCanonicalSolverSnapshot(supabase, STUDIO_ID);
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

async function snapshotContextIsCurrent(supabase: SupabaseClient, snapshot: CanonicalSolverSnapshot) {
  const current = await loadCurrentSolverContextToken(supabase, STUDIO_ID);
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
    const authorized = await authorizeWorkspace(request);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });

    const gateway = await buildGatewayPreflight(authorized.supabase);
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

export async function POST(request: NextRequest) {
  try {
    const authorized = await authorizeWorkspace(request);
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
    const gateway = await buildGatewayPreflight(authorized.supabase, {
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

    if (!await snapshotContextIsCurrent(authorized.supabase, gateway.snapshot)) {
      return contextChangedResponse();
    }

    const problem = gateway.preparation.problem;
    const response = await fetch(`${service.url}/v1/feasibility`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${service.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ problem, maxSeconds: service.maxSeconds }),
      cache: "no-store",
      signal: AbortSignal.timeout((service.maxSeconds + 5) * 1000),
    });

    if (!response.ok) {
      let detail = "Solver service request failed.";
      try {
        const payload = await response.json() as { detail?: string };
        if (payload.detail) detail = payload.detail;
      } catch {}
      return NextResponse.json({
        error: detail,
        code: "SOLVER_SERVICE_ERROR",
        serviceStatus: response.status,
      }, { status: 502 });
    }

    // The external solve may be long enough for a manager/editor to change
    // planning or policy. Discard the result if any coherent-context token field
    // changed; T08 separately binds a reviewed candidate through later adoption.
    if (!await snapshotContextIsCurrent(authorized.supabase, gateway.snapshot)) {
      return contextChangedResponse();
    }

    const payload = await response.json() as SolverServicePayload;
    const resultStatus = payload.result?.status || "UNKNOWN";
    if (resultStatus === "INFEASIBLE" || resultStatus === "UNKNOWN") {
      return NextResponse.json({
        status: resultStatus,
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

    return NextResponse.json({
      status: "FEASIBLE",
      context: problem.context,
      candidateContext: buildReviewedSolverCandidateContext(problem, gateway.snapshot.contextToken),
      serviceVersion: payload.serviceVersion || null,
      candidate: {
        assignments: candidate.assignments,
        validation: candidate.validation,
      },
      diagnostics: {
        delegatedConstraintIds: payload.result?.delegatedConstraintIds || [],
        blockingConstraintIds: payload.result?.blockingConstraintIds || [],
        wallTimeSeconds: payload.result?.wallTimeSeconds ?? null,
        branches: payload.result?.branches ?? null,
        conflicts: payload.result?.conflicts ?? null,
      },
      persisted: false,
      adoptionAllowed: false,
      adoptionMessage: "This is a validated candidate only. A separate governed adoption command must re-check versions and persist a new ScheduleVersion.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return NextResponse.json({
      error: timeout ? "The internal solver service timed out." : message,
      code: timeout ? "SOLVER_SERVICE_TIMEOUT" : "SOLVER_GATEWAY_ERROR",
    }, { status: timeout ? 504 : 500 });
  }
}

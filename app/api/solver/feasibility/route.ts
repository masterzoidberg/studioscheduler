import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase";
import { loadCanonicalSolverStudioState } from "@/lib/server-studio-state";
import { prepareFeasibilitySolve, type FeasibilitySolverProblem } from "@/lib/solver-problem";
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

async function syncPublishedConstraintModelForSolve(
  supabase: SupabaseClient,
  problem: FeasibilitySolverProblem,
  published: PublishedConstraintModelRecord | null,
): Promise<PublishedConstraintModelRecord | null> {
  const decision = constraintModelSyncDecision(problem, published);
  if (decision.action !== "PUBLISH") return published;

  const definition = constraintModelDefinition(problem.constraintModel);
  const result = await supabase.rpc("publish_constraint_model_v30", {
    p_snapshot: definition,
    p_reason: `Solver preflight sync of ${definition.compilerVersion} for Rulebook v${definition.rulebookVersion}: ${decision.reason}`,
    p_expected_rulebook_version: problem.context.rulebookVersion,
  });
  if (result.error) throw result.error;
  return loadPublishedConstraintModel(supabase);
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

async function buildGatewayPreflight(
  supabase: SupabaseClient,
  options: { syncPublishedModel?: boolean } = {},
) {
  const state = await loadCanonicalSolverStudioState(supabase, STUDIO_ID);
  const preparation = prepareFeasibilitySolve(state);
  if (!preparation.ok) {
    return {
      state,
      preparation,
      published: null,
      publishedBlockers: [],
      legacyBridge: null,
      blockers: preparation.blockers,
    };
  }

  let published = await loadPublishedConstraintModel(supabase);
  if (options.syncPublishedModel) {
    published = await syncPublishedConstraintModelForSolve(supabase, preparation.problem, published);
  }
  const publishedBlockers = publishedConstraintModelBlockers(preparation.problem, published);
  const legacyBridge = legacySafetyBridgeReport(state, preparation.problem.constraintModel);
  const legacyBlockers = legacyBridge.complete ? [] : [{
    code: "LEGACY_SAFETY_BRIDGE_INCOMPLETE",
    message: `The new Constraint IR has not yet accounted for ${legacyBridge.uncoveredRuleIds.length} protection(s) from the current legacy EnforcementVersion.`,
    ruleIds: legacyBridge.uncoveredRuleIds,
    entityIds: [],
  }];
  const normalizedPublishedBlockers = publishedBlockers.map((blocker) => ({ ...blocker, ruleIds: [] as string[] }));
  return {
    state,
    preparation,
    published,
    publishedBlockers,
    legacyBridge,
    blockers: [...normalizedPublishedBlockers, ...legacyBlockers],
  };
}

export async function GET(request: NextRequest) {
  try {
    const authorized = await authorizeWorkspace(request);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });

    const gateway = await buildGatewayPreflight(authorized.supabase);
    const service = serviceConfiguration();
    const preparation = gateway.preparation;
    return NextResponse.json({
      serviceConfigured: service.configured,
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
    // deterministic ConstraintModelVersion. GET remains read-only, and a
    // same-identity snapshot mismatch still fails closed through the gateway.
    const gateway = await buildGatewayPreflight(authorized.supabase, { syncPublishedModel: true });
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

    const candidate = validateFeasibleSolverCandidate(gateway.state, problem, payload);
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

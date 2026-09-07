from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8", newline="\n")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f"T08 patch anchor missing in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


write("lib/solver-candidate-context.ts", r'''import type { FeasibilitySolverProblem } from "@/lib/solver-problem";
import {
  solverSnapshotContextTokensMatch,
  type SolverSnapshotContextToken,
} from "@/lib/server-studio-state";

export interface ReviewedSolverCandidateContextV1 {
  schemaVersion: "1.0";
  compilerVersion: string;
  solverContextToken: SolverSnapshotContextToken;
}

const TOP_LEVEL_KEYS = ["schemaVersion", "compilerVersion", "solverContextToken"] as const;
const REQUIRED_NUMBER_TOKEN_KEYS = [
  "rulebookVersion",
  "planningDatasetVersion",
  "enforcementVersion",
  "constraintModelVersion",
  "scheduleVersion",
] as const;
const REQUIRED_STRING_TOKEN_KEYS = [
  "studioId",
  "scheduleId",
  "scheduleAssignmentsHash",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function parseReviewedSolverCandidateContext(raw: unknown): ReviewedSolverCandidateContextV1 | null {
  if (!isRecord(raw) || !exactKeys(raw, TOP_LEVEL_KEYS)) return null;
  if (raw.schemaVersion !== "1.0" || typeof raw.compilerVersion !== "string" || !raw.compilerVersion.trim()) return null;
  if (!isRecord(raw.solverContextToken)) return null;

  const token = raw.solverContextToken;
  if (token.schemaVersion !== "1.0") return null;
  for (const key of REQUIRED_NUMBER_TOKEN_KEYS) {
    if (typeof token[key] !== "number" || !Number.isSafeInteger(token[key])) return null;
  }
  for (const key of REQUIRED_STRING_TOKEN_KEYS) {
    if (typeof token[key] !== "string" || !token[key].trim()) return null;
  }

  return raw as unknown as ReviewedSolverCandidateContextV1;
}

export function reviewedSolverCandidateContextFromSnapshot(
  token: SolverSnapshotContextToken,
  compilerVersion: string,
): ReviewedSolverCandidateContextV1 {
  const parsed = parseReviewedSolverCandidateContext({
    schemaVersion: "1.0",
    compilerVersion,
    solverContextToken: token,
  });
  if (!parsed) {
    throw new Error(
      "SOLVER_CANDIDATE_CONTEXT_INCOMPLETE: A reviewed candidate requires current Rulebook, Planning Dataset, EnforcementVersion, ConstraintModelVersion, ScheduleVersion, schedule identity, and schedule/lock fingerprint.",
    );
  }
  return parsed;
}

export function buildReviewedSolverCandidateContext(
  problem: FeasibilitySolverProblem,
  token: SolverSnapshotContextToken,
): ReviewedSolverCandidateContextV1 {
  const context = reviewedSolverCandidateContextFromSnapshot(token, problem.context.compilerVersion);
  if (token.studioId !== problem.context.studioId
      || token.rulebookVersion !== problem.context.rulebookVersion
      || token.planningDatasetVersion !== problem.context.planningDatasetVersion) {
    throw new Error("SOLVER_CANDIDATE_CONTEXT_MISMATCH: Prepared solver problem and coherent snapshot token disagree.");
  }
  return context;
}

export function reviewedSolverCandidateContextsMatch(
  left: ReviewedSolverCandidateContextV1,
  right: ReviewedSolverCandidateContextV1,
) {
  return left.schemaVersion === right.schemaVersion
    && left.compilerVersion === right.compilerVersion
    && solverSnapshotContextTokensMatch(left.solverContextToken, right.solverContextToken);
}
''')

replace_once(
    "app/api/solver/feasibility/route.ts",
    'import { prepareFeasibilitySolve, type FeasibilitySolverProblem } from "@/lib/solver-problem";\n',
    'import { prepareFeasibilitySolve, type FeasibilitySolverProblem } from "@/lib/solver-problem";\nimport { buildReviewedSolverCandidateContext } from "@/lib/solver-candidate-context";\n',
)
replace_once(
    "app/api/solver/feasibility/route.ts",
    '      status: "FEASIBLE",\n      context: problem.context,\n      serviceVersion: payload.serviceVersion || null,\n',
    '      status: "FEASIBLE",\n      context: problem.context,\n      candidateContext: buildReviewedSolverCandidateContext(problem, gateway.snapshot.contextToken),\n      serviceVersion: payload.serviceVersion || null,\n',
)

write("app/api/solver/adopt/route.ts", r'''import { NextRequest, NextResponse } from "next/server";
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
    const result = await admin.rpc("adopt_solver_candidate_v44", {
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
''')

replace_once(
    "components/solver-feasibility-card.tsx",
    'import { useWorkspace } from "@/components/workspace-provider";\n',
    'import { useWorkspace } from "@/components/workspace-provider";\nimport type { ReviewedSolverCandidateContextV1 } from "@/lib/solver-candidate-context";\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '  context?: SolveContext;\n  candidate?: {\n',
    '  context?: SolveContext;\n  candidateContext?: ReviewedSolverCandidateContextV1;\n  candidate?: {\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);\n',
    '  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);\n  const [reviewStale, setReviewStale] = useState(false);\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '    setResult(null);\n    setReviewAcknowledged(false);\n    setAdoptionSuccess("");\n',
    '    setResult(null);\n    setReviewAcknowledged(false);\n    setReviewStale(false);\n    setAdoptionSuccess("");\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '    const assignments = result?.candidate?.assignments;\n    const context = result?.context;\n    if (!headers || !assignments?.length || !context || !canEdit || !status?.adoptionConfigured || !reviewAcknowledged || adopting) return;\n\n    const confirmed = window.confirm(\n      `Adopt this reviewed ${assignments.length}-assignment candidate as a new immutable schedule version? The server will reload canonical data and independently validate it again before replacing the current schedule.`,\n    );\n',
    '    const assignments = result?.candidate?.assignments;\n    const candidateContext = result?.candidateContext;\n    const reviewedScheduleVersion = candidateContext?.solverContextToken.scheduleVersion;\n    if (!headers || !assignments?.length || !candidateContext || !canEdit || !status?.adoptionConfigured || !reviewAcknowledged || reviewStale || adopting) return;\n\n    const confirmed = window.confirm(\n      `Adopt this reviewed ${assignments.length}-assignment candidate from Schedule v${reviewedScheduleVersion ?? "?"} as a new immutable schedule version? Any intervening schedule or lock change will reject adoption and require a fresh review.`,\n    );\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '          context,\n          assignments,\n',
    '          candidateContext,\n          assignments,\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '      if (!response.ok || payload.status !== "ADOPTED") {\n        setNotice(payload.error || `Solver adoption returned HTTP ${response.status}.`);\n        return;\n      }\n',
    '      if (!response.ok || payload.status !== "ADOPTED") {\n        if (payload.code === "SOLVER_ADOPTION_REVIEW_CONTEXT_STALE") {\n          setReviewAcknowledged(false);\n          setReviewStale(true);\n          setNotice(payload.error || "This reviewed candidate is stale. Generate a fresh candidate and review it again.");\n          return;\n        }\n        setNotice(payload.error || `Solver adoption returned HTTP ${response.status}.`);\n        return;\n      }\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '      setResult(null);\n      setReviewAcknowledged(false);\n      await refresh();\n',
    '      setResult(null);\n      setReviewAcknowledged(false);\n      setReviewStale(false);\n      await refresh();\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '  const feasible = result?.status === "FEASIBLE" && Boolean(result.candidate);\n  const infeasible = result?.status === "INFEASIBLE";\n',
    '  const feasible = result?.status === "FEASIBLE" && Boolean(result.candidate);\n  const infeasible = result?.status === "INFEASIBLE";\n  const reviewedScheduleVersion = result?.candidateContext?.solverContextToken.scheduleVersion ?? null;\n  const reviewedScheduleFingerprint = result?.candidateContext?.solverContextToken.scheduleAssignmentsHash?.slice(0, 12) || "";\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '              Solved against Rulebook v{result.context.rulebookVersion}, Planning Dataset v{result.context.planningDatasetVersion}, and {result.context.compilerVersion}.\n',
    '              Solved against Rulebook v{result.context.rulebookVersion}, Planning Dataset v{result.context.planningDatasetVersion}, and {result.context.compilerVersion}. Review is bound to Schedule v{reviewedScheduleVersion ?? "?"} and schedule/lock fingerprint {reviewedScheduleFingerprint || "unavailable"}.\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '          {!status?.adoptionConfigured ? (\n',
    '          {reviewStale ? (\n            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950">\n              This reviewed candidate is stale. It remains visible for comparison, but the current schedule or lock context changed after it was generated. Generate a fresh candidate and review it again before adoption.\n            </div>\n          ) : null}\n\n          {!status?.adoptionConfigured ? (\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '              disabled={!status?.adoptionConfigured}\n',
    '              disabled={!status?.adoptionConfigured || reviewStale}\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '            <span>I reviewed every assignment above and want this candidate to replace the current schedule with a new immutable ScheduleVersion.</span>\n',
    '            <span>I reviewed every assignment above in the displayed Schedule v{reviewedScheduleVersion ?? "?"} / lock context and want this candidate to replace that exact reviewed base with a new immutable ScheduleVersion.</span>\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '              Adoption reloads canonical state, verifies the exact version context, independently validates the candidate again, preserves locks, runs the legacy HARD validator, and only then commits atomically.\n',
    '              Adoption verifies the exact reviewed base ScheduleVersion and schedule/lock fingerprint, independently validates the candidate again, preserves locks, runs the legacy HARD validator, and only then commits atomically. Any intervening change requires regeneration and re-review.\n',
)
replace_once(
    "components/solver-feasibility-card.tsx",
    '              disabled={!status?.adoptionConfigured || !reviewAcknowledged || adopting || !canEdit}\n',
    '              disabled={!status?.adoptionConfigured || !reviewAcknowledged || reviewStale || adopting || !canEdit}\n',
)

write("supabase/migrations/20260907070000_candidate_stale_schedule_binding_v44.sql", r'''-- T08 / V4.4 reviewed candidate binding.
--
-- A manager reviews a candidate generated from one T07 coherent context. Adoption
-- must use that submitted reviewed context transactionally rather than replacing
-- it with whichever ScheduleVersion/locks happen to be current when POST arrives.

create or replace function private.build_solver_candidate_context_v44(p_studio_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  select jsonb_build_object(
    'schemaVersion','1.0',
    'compilerVersion',(
      select cm.compiler_version
      from public.constraint_model_versions cm
      where cm.studio_id=p_studio_id and cm.status='CURRENT'
      order by cm.version desc limit 1
    ),
    'solverContextToken',private.build_solver_context_token_v43(p_studio_id)
  )
$function$;

revoke all on function private.build_solver_candidate_context_v44(uuid) from public,anon,authenticated;
grant execute on function private.build_solver_candidate_context_v44(uuid) to service_role;

create or replace function public.adopt_solver_candidate_v44(
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_actor_label text,
  p_reason text,
  p_expected_context jsonb,
  p_candidate jsonb,
  p_application_validation jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $function$
declare
  v_current_context jsonb;
  v_token jsonb;
begin
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_expected_context is null or jsonb_typeof(p_expected_context)<>'object' then
    raise exception 'SOLVER_CANDIDATE_CONTEXT_INVALID: reviewed candidate context is required';
  end if;
  if not (p_expected_context ?& array['schemaVersion','compilerVersion','solverContextToken'])
     or (p_expected_context - array['schemaVersion','compilerVersion','solverContextToken']) <> '{}'::jsonb
     or p_expected_context->>'schemaVersion'<>'1.0'
     or coalesce(btrim(p_expected_context->>'compilerVersion'),'')='' then
    raise exception 'SOLVER_CANDIDATE_CONTEXT_INVALID: unsupported or non-canonical review context';
  end if;
  v_token:=p_expected_context->'solverContextToken';
  if jsonb_typeof(v_token)<>'object'
     or not (v_token ?& array[
       'schemaVersion','studioId','rulebookVersion','planningDatasetVersion','enforcementVersion',
       'constraintModelVersion','scheduleVersion','scheduleId','scheduleAssignmentsHash'
     ])
     or v_token->>'schemaVersion'<>'1.0'
     or v_token->>'studioId' is distinct from p_studio_id::text
     or coalesce(v_token->>'scheduleId','')=''
     or coalesce(v_token->>'scheduleAssignmentsHash','')='' then
    raise exception 'SOLVER_CANDIDATE_CONTEXT_INVALID: base ScheduleVersion/lock identity is incomplete';
  end if;

  -- Serialize against the same mutation families as the existing adoption RPC.
  -- Two editors holding the same reviewed candidate therefore cannot both commit.
  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  v_current_context:=private.build_solver_candidate_context_v44(p_studio_id);
  if v_current_context is distinct from p_expected_context then
    raise exception 'STALE_SOLVER_CANDIDATE_CONTEXT: reviewed ScheduleVersion/lock/policy/planning/model context is no longer current';
  end if;

  -- Use versions from the submitted reviewed context. Do not substitute freshly
  -- read values. V3.3 remains the canonical candidate/legacy-validation writer.
  return public.adopt_solver_candidate_v33(
    p_studio_id,
    p_actor_user_id,
    p_actor_label,
    p_reason,
    (v_token->>'scheduleVersion')::integer,
    (v_token->>'rulebookVersion')::integer,
    (v_token->>'enforcementVersion')::integer,
    (v_token->>'planningDatasetVersion')::integer,
    (v_token->>'constraintModelVersion')::integer,
    p_candidate,
    p_application_validation
  );
end
$function$;

revoke all on function public.adopt_solver_candidate_v44(uuid,uuid,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.adopt_solver_candidate_v44(uuid,uuid,text,text,jsonb,jsonb,jsonb) to service_role;
''')

write("tests/solver-candidate-context.test.ts", r'''import { describe, expect, it } from "vitest";
import type { SolverSnapshotContextToken } from "@/lib/server-studio-state";
import {
  parseReviewedSolverCandidateContext,
  reviewedSolverCandidateContextFromSnapshot,
  reviewedSolverCandidateContextsMatch,
} from "@/lib/solver-candidate-context";

function token(): SolverSnapshotContextToken {
  return {
    schemaVersion: "1.0",
    studioId: "studio",
    rulebookVersion: 3,
    rulebookId: "rb",
    rulebookSourceHash: "source",
    rulebookSnapshotHash: "rb-hash",
    rulesHash: "rules-hash",
    planningDatasetVersion: 7,
    planningDatasetId: "pd",
    planningSnapshotHash: "pd-hash",
    planningConfirmedForSchedulingAt: "2026-09-07T00:00:00Z",
    enforcementVersion: 4,
    enforcementId: "ev",
    constraintModelVersion: 5,
    constraintModelId: "cm",
    constraintModelSnapshotHash: "cm-hash",
    scheduleVersion: 12,
    scheduleId: "schedule-12",
    scheduleRulebookVersion: 3,
    scheduleEnforcementVersion: 4,
    schedulePlanningDatasetVersion: 7,
    scheduleConstraintModelVersion: 5,
    scheduleAssignmentsHash: "locks-and-assignments-hash",
  };
}

describe("reviewed solver candidate context", () => {
  it("binds the candidate to the exact coherent ScheduleVersion and schedule/lock fingerprint", () => {
    const context = reviewedSolverCandidateContextFromSnapshot(token(), "dwde-ir-v3");
    expect(context.schemaVersion).toBe("1.0");
    expect(context.compilerVersion).toBe("dwde-ir-v3");
    expect(context.solverContextToken.scheduleVersion).toBe(12);
    expect(context.solverContextToken.scheduleId).toBe("schedule-12");
    expect(context.solverContextToken.scheduleAssignmentsHash).toBe("locks-and-assignments-hash");
  });

  it("rejects missing base schedule/lock identity instead of accepting an older partial wire context", () => {
    const raw = {
      schemaVersion: "1.0",
      compilerVersion: "dwde-ir-v3",
      solverContextToken: { ...token(), scheduleAssignmentsHash: null },
    };
    expect(parseReviewedSolverCandidateContext(raw)).toBeNull();
  });

  it("detects lock-state and ScheduleVersion drift independently of Rulebook/Planning versions", () => {
    const reviewed = reviewedSolverCandidateContextFromSnapshot(token(), "dwde-ir-v3");
    const lockDrift = reviewedSolverCandidateContextFromSnapshot(
      { ...token(), scheduleAssignmentsHash: "changed-lock-hash" },
      "dwde-ir-v3",
    );
    const scheduleDrift = reviewedSolverCandidateContextFromSnapshot(
      { ...token(), scheduleVersion: 13, scheduleId: "schedule-13" },
      "dwde-ir-v3",
    );
    expect(reviewedSolverCandidateContextsMatch(reviewed, lockDrift)).toBe(false);
    expect(reviewedSolverCandidateContextsMatch(reviewed, scheduleDrift)).toBe(false);
    expect(reviewed.solverContextToken.rulebookVersion).toBe(lockDrift.solverContextToken.rulebookVersion);
    expect(reviewed.solverContextToken.planningDatasetVersion).toBe(lockDrift.solverContextToken.planningDatasetVersion);
  });
});
''')

write("tests/candidate-stale-binding.test.ts", r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260907070000_candidate_stale_schedule_binding_v44.sql", "utf8");
const feasibilityRoute = readFileSync("app/api/solver/feasibility/route.ts", "utf8");
const adoptionRoute = readFileSync("app/api/solver/adopt/route.ts", "utf8");
const card = readFileSync("components/solver-feasibility-card.tsx", "utf8");
const dbHarness = readFileSync("scripts/test-db.mjs", "utf8");

describe("T08 candidate stale-schedule binding", () => {
  it("returns a separate versioned review context without changing the solver-service problem contract", () => {
    expect(feasibilityRoute).toContain("candidateContext: buildReviewedSolverCandidateContext(problem, gateway.snapshot.contextToken)");
    expect(feasibilityRoute).toContain("body: JSON.stringify({ problem, maxSeconds: service.maxSeconds })");
  });

  it("passes the submitted reviewed context unchanged into a transactional V4.4 adoption boundary", () => {
    expect(adoptionRoute).toContain('admin.rpc("adopt_solver_candidate_v44"');
    expect(adoptionRoute).toContain("p_expected_context: reviewedContext");
    expect(adoptionRoute).not.toContain("p_expected_schedule_version: currentSchedule.version");
    expect(migration).toContain("v_current_context is distinct from p_expected_context");
    expect(migration).toContain("p_expected_context->'solverContextToken'");
    expect(migration).toContain("public.adopt_solver_candidate_v33");
  });

  it("serializes concurrent adopters and binds the base ScheduleVersion plus schedule/lock identity", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("scheduleAssignmentsHash");
    expect(migration).toContain("scheduleId");
    expect(migration).toContain("scheduleVersion");
    expect(dbHarness).toContain("T08 PASS:");
    expect(dbHarness).toContain("concurrent editor");
    expect(dbHarness).toContain("double adoption");
  });

  it("preserves the stale reviewed candidate in the UI and requires regeneration/re-review", () => {
    expect(card).toContain("reviewStale");
    expect(card).toContain("This reviewed candidate is stale");
    expect(card).toContain("Generate a fresh candidate and review it again");
    expect(card).toContain("schedule/lock fingerprint");
  });
});
''')

script = read("scripts/test-db.mjs")
anchor = "\nfunction psql(container, user, sql, label) {\n"
if anchor not in script:
    raise SystemExit("T08 DB harness insertion anchor missing")
insert = r'''

const candidateStaleBindingSql = String.raw`
set search_path=public,extensions;
set role service_role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_editor uuid := '10000000-0000-4000-8000-000000000002';
  v_reviewed jsonb;
  v_current jsonb;
  v_candidate jsonb := jsonb_build_array(jsonb_build_object(
    'sessionId','t04-session','day','Monday','startTime','17:00','endTime','18:30',
    'teacherId','t04-teacher','roomId','t04-room'
  ));
  v_assignment_id text;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_lock_rejected boolean := false;
  v_editor_rejected boolean := false;
  v_double_rejected boolean := false;
begin
  v_reviewed:=private.build_solver_candidate_context_v44(v_studio);
  if v_reviewed->>'schemaVersion'<>'1.0'
     or coalesce(v_reviewed->'solverContextToken'->>'scheduleId','')=''
     or coalesce(v_reviewed->'solverContextToken'->>'scheduleAssignmentsHash','')='' then
    raise exception 'T08 reviewed context did not bind base ScheduleVersion/lock identity';
  end if;

  select a.id into v_assignment_id
  from public.assignments a
  join public.schedule_versions sv on sv.id=a.schedule_version_id
  where sv.studio_id=v_studio and sv.is_current
  order by a.id limit 1;
  if v_assignment_id is null then raise exception 'T08 fixture has no current assignment'; end if;

  -- Same ScheduleVersion, same Rulebook/Planning versions, different lock bit.
  update public.assignments set locked=not locked where studio_id=v_studio and id=v_assignment_id;
  begin
    perform public.adopt_solver_candidate_v44(
      v_studio,v_owner,'T08 owner','Reject stale candidate after lock drift',
      v_reviewed,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('STALE_SOLVER_CANDIDATE_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_lock_rejected:=true;
  end;
  if not v_lock_rejected then raise exception 'T08 lock drift was accepted'; end if;
  update public.assignments set locked=not locked where studio_id=v_studio and id=v_assignment_id;
  v_current:=private.build_solver_candidate_context_v44(v_studio);
  if v_current is distinct from v_reviewed then
    raise exception 'T08 lock drift fixture did not restore the reviewed context';
  end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  v_result:=public.adopt_solver_candidate_v44(
    v_studio,v_owner,'T08 owner','Adopt exact reviewed base once',
    v_reviewed,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
  );
  if (v_result->>'scheduleVersion')::integer<>(v_reviewed->'solverContextToken'->>'scheduleVersion')::integer+1 then
    raise exception 'T08 exact reviewed context did not adopt the next schedule version';
  end if;

  -- A second editor may have reviewed the same candidate concurrently. The first
  -- commit changes only the schedule pointer; Rulebook/Planning can remain equal.
  begin
    perform public.adopt_solver_candidate_v44(
      v_studio,v_editor,'T08 concurrent editor','Reject concurrent editor stale review',
      v_reviewed,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('STALE_SOLVER_CANDIDATE_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_editor_rejected:=true;
  end;
  if not v_editor_rejected then raise exception 'T08 concurrent editor stale review was accepted'; end if;

  -- Repeated/double adoption of the same reviewed artifact must also fail.
  begin
    perform public.adopt_solver_candidate_v44(
      v_studio,v_owner,'T08 owner','Reject double adoption',
      v_reviewed,v_candidate,'{"valid":true,"hardViolations":0}'::jsonb
    );
  exception when others then
    if position('STALE_SOLVER_CANDIDATE_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_double_rejected:=true;
  end;
  if not v_double_rejected then raise exception 'T08 double adoption was accepted'; end if;

  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count+1 then
    raise exception 'T08 stale/repeated rejection was not atomic';
  end if;
  v_current:=private.build_solver_candidate_context_v44(v_studio);
  if v_current->'solverContextToken'->>'rulebookVersion' is distinct from v_reviewed->'solverContextToken'->>'rulebookVersion'
     or v_current->'solverContextToken'->>'planningDatasetVersion' is distinct from v_reviewed->'solverContextToken'->>'planningDatasetVersion' then
    raise exception 'T08 fixture unexpectedly changed Rulebook/Planning while testing schedule staleness';
  end if;
  if v_current->'solverContextToken'->>'scheduleVersion' = v_reviewed->'solverContextToken'->>'scheduleVersion' then
    raise exception 'T08 successful adoption did not advance ScheduleVersion';
  end if;
end
$block$;
reset role;

select 'T08 PASS: exact reviewed context adopts once; same-version lock drift, concurrent editor stale review, and double adoption reject atomically without fresh-version substitution' as result;
`;
'''
write("scripts/test-db.mjs", script.replace(anchor, insert + anchor, 1))
replace_once(
    "scripts/test-db.mjs",
    "    const coherentSnapshotOutput = psql(container, 'postgres', coherentSolverSnapshotSql, 'T07 coherent solver snapshot integration tests');\n    process.stdout.write(coherentSnapshotOutput);\n",
    "    const coherentSnapshotOutput = psql(container, 'postgres', coherentSolverSnapshotSql, 'T07 coherent solver snapshot integration tests');\n    process.stdout.write(coherentSnapshotOutput);\n    const candidateStaleOutput = psql(container, 'postgres', candidateStaleBindingSql, 'T08 candidate stale-schedule binding integration tests');\n    process.stdout.write(candidateStaleOutput);\n",
)

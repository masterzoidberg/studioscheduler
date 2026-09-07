from pathlib import Path
import re

ROOT = Path('.')

GATE = r'''import type { Assignment, SchedulePatch, StudioState, ValidationResult, ValidationViolation } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import type { ConstraintEngineResult, ConstraintEngineViolation } from "@/lib/constraint-engine";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import { buildScheduleCommandCandidate, type ScheduleCommandCandidate } from "@/lib/schedule-command-candidate";
import { validateSchedule } from "@/lib/validator";

export interface GateDecision<T> {
  before: T;
  after: T;
  accepts: boolean;
  beforeHardViolations: number;
  afterHardViolations: number;
  beforeBlockingHardViolations: number;
  afterBlockingHardViolations: number;
  newBlockingViolationKeys: string[];
  completenessObligationKeys: string[];
}

export interface ConstraintGateComparison {
  candidate: ScheduleCommandCandidate;
  legacy: GateDecision<ValidationResult>;
  constraintIr: GateDecision<ConstraintEngineResult>;
  /**
   * False means promoting the IR gate would permit a command that today's legacy
   * production gate rejects. That is a release blocker. The reverse disagreement
   * is expected while the IR covers more of the Rulebook.
   */
  preservesLegacySafety: boolean;
  legacyHardRuleIdsMissingFromIr: string[];
  disagreement: "NONE" | "IR_STRICTER" | "IR_LOOSER";
}

type ViolationIdentity = Pick<ValidationViolation, "constraintId" | "assignmentIds" | "affectedEntityIds">;

function violationKey(violation: ViolationIdentity) {
  return JSON.stringify([
    violation.constraintId,
    [...violation.assignmentIds].sort(),
    [...violation.affectedEntityIds].sort(),
  ]);
}

function currentLegacyCompletenessRuleIds(state: StudioState) {
  const enforcement = state.enforcementVersions.find((version) => version.status === "CURRENT")
    ?? state.enforcementVersions[0]
    ?? null;
  return new Set(
    (enforcement?.snapshot || [])
      .filter((mapping) => mapping.type === "CLASS_FREQUENCY")
      .map((mapping) => mapping.ruleId),
  );
}

function isIrCompletenessObligation(violation: ConstraintEngineViolation, model: ConstraintModelSnapshotV1) {
  const node = model.hardConstraints.find((candidate) => candidate.id === violation.constraintId);
  return violation.assignmentIds.length === 0
    && Boolean(node && ["FIXED_ASSIGNMENT", "DIRECTLY_AFTER"].includes(node.kind));
}

function legacyHardViolations(result: ValidationResult) {
  return result.violations.filter((violation) => violation.severity === "HARD");
}

function legacyBlockingViolations(state: StudioState, result: ValidationResult) {
  const completenessRuleIds = currentLegacyCompletenessRuleIds(state);
  return legacyHardViolations(result).filter((violation) => !completenessRuleIds.has(violation.constraintId));
}

function irBlockingViolations(result: ConstraintEngineResult, model: ConstraintModelSnapshotV1) {
  return result.violations.filter((violation) => !isIrCompletenessObligation(violation, model));
}

function newViolationKeys<T extends ViolationIdentity>(before: T[], after: T[]) {
  const beforeKeys = new Set(before.map(violationKey));
  return [...new Set(after.map(violationKey).filter((key) => !beforeKeys.has(key)))].sort();
}

function commandAccepted(
  operation: SchedulePatch["operation"],
  beforeBlocking: number,
  afterBlocking: number,
  newBlocking: string[],
) {
  // A command may never trade one violation for a different violation. That was
  // the aggregate-count hole T11 closes.
  if (newBlocking.length) return false;
  if (operation === "MOVE" && beforeBlocking > 0 && afterBlocking >= beforeBlocking) return false;
  return true;
}

function legacyRuleIds(violations: ValidationViolation[]) {
  return new Set(
    violations
      .filter((violation) => violation.constraintId !== "SYSTEM")
      .map((violation) => violation.constraintId),
  );
}

function irRuleIds(violations: ConstraintEngineViolation[]) {
  return new Set(violations.flatMap((violation) => violation.ruleIds));
}

/**
 * Shadow comparison for the migration from the partial SQL/legacy validator to
 * the complete Constraint IR runtime.
 *
 * T11 distinguishes placement legality from completeness. CLASS_FREQUENCY and
 * missing FIXED_ASSIGNMENT/DIRECTLY_AFTER counterparts remain visible findings,
 * but do not prevent legal incremental construction. All other HARD findings are
 * compared by stable violation identity, never only by aggregate count.
 */
export function compareConstraintGatesForCommand(
  state: StudioState,
  assignments: Assignment[],
  patch: SchedulePatch,
  model: ConstraintModelSnapshotV1 = compileConstraintModel(state),
): ConstraintGateComparison {
  const candidate = buildScheduleCommandCandidate(state, assignments, patch);

  const legacyBefore = validateSchedule(state, assignments);
  const legacyAfter = validateSchedule(state, candidate.assignments);
  const irBefore = validateConstraintModelSchedule(state, model, assignments);
  const irAfter = validateConstraintModelSchedule(state, model, candidate.assignments);

  const legacyBeforeBlocking = legacyBlockingViolations(state, legacyBefore);
  const legacyAfterBlocking = legacyBlockingViolations(state, legacyAfter);
  const irBeforeBlocking = irBlockingViolations(irBefore, model);
  const irAfterBlocking = irBlockingViolations(irAfter, model);
  const legacyNewBlocking = newViolationKeys(legacyBeforeBlocking, legacyAfterBlocking);
  const irNewBlocking = newViolationKeys(irBeforeBlocking, irAfterBlocking);
  const legacyAccepts = commandAccepted(patch.operation, legacyBeforeBlocking.length, legacyAfterBlocking.length, legacyNewBlocking);
  const irAccepts = commandAccepted(patch.operation, irBeforeBlocking.length, irAfterBlocking.length, irNewBlocking);

  const legacyRules = legacyRuleIds(legacyAfterBlocking);
  const irRules = irRuleIds(irAfterBlocking);
  const legacyHardRuleIdsMissingFromIr = [...legacyRules].filter((ruleId) => !irRules.has(ruleId)).sort();
  const preservesLegacySafety = !(irAccepts && !legacyAccepts) && legacyHardRuleIdsMissingFromIr.length === 0;

  const legacyCompleteness = legacyHardViolations(legacyAfter)
    .filter((violation) => currentLegacyCompletenessRuleIds(state).has(violation.constraintId))
    .map(violationKey)
    .sort();
  const irCompleteness = irAfter.violations.filter((violation) => isIrCompletenessObligation(violation, model)).map(violationKey).sort();

  return {
    candidate,
    legacy: {
      before: legacyBefore,
      after: legacyAfter,
      accepts: legacyAccepts,
      beforeHardViolations: legacyBefore.hardViolations,
      afterHardViolations: legacyAfter.hardViolations,
      beforeBlockingHardViolations: legacyBeforeBlocking.length,
      afterBlockingHardViolations: legacyAfterBlocking.length,
      newBlockingViolationKeys: legacyNewBlocking,
      completenessObligationKeys: legacyCompleteness,
    },
    constraintIr: {
      before: irBefore,
      after: irAfter,
      accepts: irAccepts,
      beforeHardViolations: irBefore.hardViolations,
      afterHardViolations: irAfter.hardViolations,
      beforeBlockingHardViolations: irBeforeBlocking.length,
      afterBlockingHardViolations: irAfterBlocking.length,
      newBlockingViolationKeys: irNewBlocking,
      completenessObligationKeys: irCompleteness,
    },
    preservesLegacySafety,
    legacyHardRuleIdsMissingFromIr,
    disagreement: legacyAccepts === irAccepts ? "NONE" : irAccepts ? "IR_LOOSER" : "IR_STRICTER",
  };
}
'''

AUTHORITY = r'''import type { Assignment, SchedulePatch, StudioState } from "@/lib/domain";
import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { compareConstraintGatesForCommand, type ConstraintGateComparison } from "@/lib/constraint-gate-equivalence";

export interface ManualMoveDraftStatus {
  mode: "NORMAL" | "REPAIR";
  scheduleComplete: boolean;
  publishable: boolean;
  unscheduledSessionIds: string[];
  duplicateSessionIds: string[];
  unknownAssignmentSessionIds: string[];
  completenessObligationKeys: string[];
}

export interface ManualMoveDecision {
  accepted: boolean;
  comparison: ConstraintGateComparison;
  draftStatus: ManualMoveDraftStatus;
  blocker: null | {
    code: string;
    message: string;
    ruleIds: string[];
    entityIds: string[];
  };
}

function canonicalCompleteness(
  state: StudioState,
  assignments: Assignment[],
  completenessObligationKeys: string[],
) {
  const activeSessionIds = new Set(state.sessions.map((session) => session.id));
  const counts = new Map<string, number>();
  const unknownAssignmentSessionIds = new Set<string>();
  for (const assignment of assignments) {
    if (!activeSessionIds.has(assignment.sessionId)) unknownAssignmentSessionIds.add(assignment.sessionId);
    counts.set(assignment.sessionId, (counts.get(assignment.sessionId) || 0) + 1);
  }
  const unscheduledSessionIds = state.sessions
    .filter((session) => (counts.get(session.id) || 0) === 0)
    .map((session) => session.id)
    .sort();
  const duplicateSessionIds = state.sessions
    .filter((session) => (counts.get(session.id) || 0) > 1)
    .map((session) => session.id)
    .sort();
  return {
    scheduleComplete: unscheduledSessionIds.length === 0
      && duplicateSessionIds.length === 0
      && unknownAssignmentSessionIds.size === 0
      && completenessObligationKeys.length === 0,
    unscheduledSessionIds,
    duplicateSessionIds,
    unknownAssignmentSessionIds: [...unknownAssignmentSessionIds].sort(),
    completenessObligationKeys,
  };
}

function firstIrMessage(comparison: ConstraintGateComparison, operation: SchedulePatch["operation"]) {
  return comparison.constraintIr.after.violations
    .find((violation) => comparison.constraintIr.newBlockingViolationKeys.includes(JSON.stringify([
      violation.constraintId,
      [...violation.assignmentIds].sort(),
      [...violation.affectedEntityIds].sort(),
    ])))?.message
    || `The proposed ${operation} is illegal under the authoritative Constraint IR.`;
}

function blockerPrefix(operation: SchedulePatch["operation"]) {
  return operation === "MOVE" ? "MANUAL_MOVE" : "INCREMENTAL_COMMAND";
}

/**
 * Shared canonical schedule-command decision for MOVE / ASSIGN / UNASSIGN.
 *
 * Placement legality and draft completeness are deliberately separate. A legal
 * incremental command may leave required sessions or sequencing counterparts
 * unplaced, but it may not introduce a new HARD placement violation.
 */
export function evaluateAuthoritativeScheduleCommand(
  state: StudioState,
  patch: SchedulePatch,
  model: ConstraintModelSnapshotV1,
): ManualMoveDecision {
  const current = state.scheduleVersions.find((version) => version.isCurrent);
  if (!current) throw new Error("No current ScheduleVersion exists.");

  const comparison = compareConstraintGatesForCommand(state, current.assignments, patch, model);
  const completenessObligationKeys = [...new Set([
    ...comparison.constraintIr.completenessObligationKeys,
    ...comparison.legacy.completenessObligationKeys,
  ])].sort();
  const completeness = canonicalCompleteness(state, comparison.candidate.assignments, completenessObligationKeys);
  const mode: ManualMoveDraftStatus["mode"] = (
    comparison.constraintIr.beforeBlockingHardViolations > 0 || comparison.legacy.beforeBlockingHardViolations > 0
  ) ? "REPAIR" : "NORMAL";
  const draftStatus: ManualMoveDraftStatus = {
    mode,
    ...completeness,
    publishable: completeness.scheduleComplete
      && comparison.constraintIr.after.valid
      && comparison.legacy.after.valid
      && comparison.legacy.after.fullyValidated,
  };

  const unsupported = [...new Set([
    ...comparison.constraintIr.before.unsupportedConstraintIds,
    ...comparison.constraintIr.after.unsupportedConstraintIds,
  ])].sort();
  if (unsupported.length) {
    return {
      accepted: false,
      comparison,
      draftStatus,
      blocker: {
        code: `${blockerPrefix(patch.operation)}_IR_UNSUPPORTED`,
        message: `${patch.operation} failed closed because ${unsupported.length} authoritative HARD constraint node(s) are unsupported by the IR evaluator.`,
        ruleIds: [],
        entityIds: unsupported,
      },
    };
  }

  if (!comparison.constraintIr.accepts) {
    const violation = comparison.constraintIr.after.violations[0];
    return {
      accepted: false,
      comparison,
      draftStatus,
      blocker: {
        code: `${blockerPrefix(patch.operation)}_IR_REJECTED`,
        message: firstIrMessage(comparison, patch.operation),
        ruleIds: violation?.ruleIds || [],
        entityIds: violation?.affectedEntityIds || [comparison.candidate.sessionId],
      },
    };
  }

  if (!comparison.legacy.accepts || !comparison.preservesLegacySafety) {
    return {
      accepted: false,
      comparison,
      draftStatus,
      blocker: {
        code: `${blockerPrefix(patch.operation)}_LEGACY_SAFETY_REJECTED`,
        message: comparison.legacy.after.violations.find((item) => item.severity === "HARD")?.message
          || "The proposed command does not preserve the existing production safety floor.",
        ruleIds: comparison.legacyHardRuleIdsMissingFromIr,
        entityIds: [comparison.candidate.sessionId],
      },
    };
  }

  return { accepted: true, comparison, draftStatus, blocker: null };
}

/** Backward-compatible T10 entry point. */
export function evaluateAuthoritativeManualMove(
  state: StudioState,
  patch: SchedulePatch,
  model: ConstraintModelSnapshotV1,
): ManualMoveDecision {
  if (patch.operation !== "MOVE") throw new Error("Authoritative manual move evaluation accepts MOVE only.");
  return evaluateAuthoritativeScheduleCommand(state, patch, model);
}
'''

ROUTE = r'''import { NextRequest, NextResponse } from "next/server";
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
import { evaluateAuthoritativeScheduleCommand } from "@/lib/manual-move-command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
};

type IncrementalRequest = {
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
    const body = await request.json() as IncrementalRequest;
    const studioId = typeof body.studioId === "string" ? body.studioId.trim() : "";
    const patch = body.patch;
    if (!studioId) return NextResponse.json({ error: "An explicit studioId is required." }, { status: 400 });
    if (!patch || !["ASSIGN", "UNASSIGN"].includes(patch.operation) || !patch.reason?.trim()) {
      return NextResponse.json({ error: "A complete ASSIGN or UNASSIGN patch with a reason is required." }, { status: 400 });
    }
    if (patch.operation === "ASSIGN" && !patch.changes.sessionId?.trim()) {
      return NextResponse.json({ error: "ASSIGN requires an explicit sessionId." }, { status: 400 });
    }
    if (patch.operation === "UNASSIGN" && !patch.assignmentId?.trim()) {
      return NextResponse.json({ error: "UNASSIGN requires an assignmentId." }, { status: 400 });
    }

    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") {
      return NextResponse.json({ error: "Editor access is required to change schedule assignments." }, { status: 403 });
    }

    const snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, studioId);
    if (!isCanonicalScheduleContext(snapshot.contextToken)) {
      return blocked(
        "INCREMENTAL_CONTEXT_STALE",
        "The current schedule is not linked to the exact current Rulebook, EnforcementVersion, PlanningDatasetVersion, and ConstraintModelVersion. Revalidate before editing.",
      );
    }

    const model = compileConstraintModel(snapshot.state);
    if (!model.completeHardConstraintCompilation || model.uncompiledConstraintRuleIds.length) {
      return blocked(
        "INCREMENTAL_CONSTRAINT_MODEL_INCOMPLETE",
        "Incremental schedule editing failed closed because the current Rulebook does not have a complete authoritative HARD Constraint IR.",
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
        "INCREMENTAL_CONSTRAINT_MODEL_STALE",
        "The deterministic Constraint IR does not match the pinned published ConstraintModelVersion. Refresh the model before editing the schedule.",
      );
    }

    let decision;
    try {
      decision = evaluateAuthoritativeScheduleCommand(snapshot.state, patch, model);
    } catch (error) {
      return blocked(
        "INCREMENTAL_STRUCTURE_REJECTED",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!decision.accepted) {
      return blocked(
        decision.blocker?.code || "INCREMENTAL_COMMAND_REJECTED",
        decision.blocker?.message || "The proposed incremental command was rejected by server validation.",
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
        "INCREMENTAL_CONTEXT_CHANGED_RETRY",
        "Scheduling context changed while this command was being validated. Retry against the current schedule.",
      );
    }

    let admin: SupabaseClient;
    try {
      admin = getServerAdminSupabase();
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : String(error),
        code: "INCREMENTAL_ADMIN_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const candidate = decision.comparison.candidate;
    const after = candidate.after;
    const result = await admin.rpc("apply_authoritative_incremental_command_v47", {
      p_operation: patch.operation,
      p_studio_id: studioId,
      p_actor_user_id: authorized.userId,
      p_assignment_id: candidate.assignmentId,
      p_session_id: candidate.sessionId,
      p_changes: patch.operation === "ASSIGN" && after ? {
        day: after.day,
        startTime: after.startTime,
        teacherId: after.teacherId,
        roomId: after.roomId,
        status: after.status || "NORMAL",
      } : {},
      p_reason: patch.reason.trim(),
      p_expected_context: snapshot.contextToken,
      p_application_validation: decision.comparison.constraintIr.after,
      p_draft_status: decision.draftStatus,
      p_ai_proposed: patch.proposedBy === "AI",
    });
    if (result.error) {
      const message = result.error.message || "Incremental schedule transaction failed.";
      if (message.includes("STALE_INCREMENTAL_CONTEXT")) {
        return blocked("INCREMENTAL_CONTEXT_CHANGED_RETRY", "Scheduling context changed before commit. Retry the command.");
      }
      if (message.includes("WORKSPACE_SELECTION_MISMATCH")) {
        return blocked("WORKSPACE_SELECTION_MISMATCH", "The selected workspace is not the legacy active membership context. Switch back to the active workspace; full multi-workspace writes arrive in T22/T23.");
      }
      if (/LOCKED_|ARCHIVED_OR_UNKNOWN_|SESSION_ALREADY_ASSIGNED|ASSIGNMENT_ID_ALREADY_EXISTS/.test(message)) {
        return blocked("INCREMENTAL_TRANSACTION_REJECTED", message);
      }
      throw result.error;
    }

    const mutation = (result.data || {}) as Record<string, unknown>;
    return NextResponse.json({
      status: patch.operation === "ASSIGN" ? "ASSIGNED" : "UNASSIGNED",
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
      code: "INCREMENTAL_COMMAND_ERROR",
    }, { status: 500 });
  }
}
'''

MIGRATION = r'''-- T11 / V4.7 authoritative incremental ASSIGN/UNASSIGN boundary.
--
-- Incremental construction now uses the same pinned server Constraint IR authority
-- as T10 MOVE. This service-role-only transaction rechecks the exact coherent
-- context, active identities, duplicate/lock guards, and canonical duration before
-- creating a new ScheduleVersion. It intentionally does not delegate to V2.5,
-- whose aggregate CLASS_FREQUENCY gate conflates draft completeness with placement
-- legality. The legacy authenticated V2.5 entry point remains a tracked T13 bypass.

create or replace function public.apply_authoritative_incremental_command_v47(
  p_operation text,
  p_studio_id uuid,
  p_actor_user_id uuid,
  p_assignment_id text,
  p_session_id text,
  p_changes jsonb,
  p_reason text,
  p_expected_context jsonb,
  p_application_validation jsonb,
  p_draft_status jsonb,
  p_ai_proposed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_operation text := upper(coalesce(p_operation,''));
  v_selected_role text;
  v_actor_context jsonb;
  v_actor_label text;
  v_current_context jsonb;
  v_current public.schedule_versions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_assignment_id text;
  v_session_id text;
  v_duration integer;
  v_session_locked boolean;
  v_assignment_locked boolean;
  v_day text;
  v_start_time time;
  v_end_time time;
  v_teacher_id text;
  v_room_id text;
  v_status text;
  v_new_id uuid;
  v_new_version integer;
  v_legacy_validation jsonb;
  v_validation jsonb;
  v_unscheduled integer;
begin
  if v_operation not in ('ASSIGN','UNASSIGN') then raise exception 'Unsupported incremental operation: %',p_operation; end if;
  if p_studio_id is null then raise exception 'Studio is required'; end if;
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
  if p_application_validation is null or jsonb_typeof(p_application_validation)<>'object' then
    raise exception 'Authoritative application Constraint IR validation is required';
  end if;
  if p_draft_status is null or jsonb_typeof(p_draft_status)<>'object' then
    raise exception 'Authoritative draft status is required';
  end if;

  select m.role into v_selected_role
  from public.studio_members m
  where m.studio_id=p_studio_id and m.user_id=p_actor_user_id;
  if v_selected_role not in ('OWNER','EDITOR') then raise exception 'Editor membership required for selected workspace'; end if;

  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  v_actor_context:=private.assert_editor_context();
  if (v_actor_context->>'studio_id')::uuid is distinct from p_studio_id then
    raise exception 'WORKSPACE_SELECTION_MISMATCH: selected %, legacy active %',p_studio_id,v_actor_context->>'studio_id';
  end if;
  v_actor_label:=v_actor_context->>'actor';

  if p_expected_context is null or jsonb_typeof(p_expected_context)<>'object'
     or p_expected_context->>'schemaVersion'<>'1.0'
     or p_expected_context->>'studioId' is distinct from p_studio_id::text
     or coalesce(p_expected_context->>'scheduleId','')=''
     or coalesce(p_expected_context->>'scheduleAssignmentsHash','')=''
     or coalesce(p_expected_context->>'constraintModelVersion','')='' then
    raise exception 'INCREMENTAL_CONTEXT_INVALID: exact pinned scheduling context is required';
  end if;
  if p_expected_context->>'scheduleRulebookVersion' is distinct from p_expected_context->>'rulebookVersion'
     or p_expected_context->>'scheduleEnforcementVersion' is distinct from p_expected_context->>'enforcementVersion'
     or p_expected_context->>'schedulePlanningDatasetVersion' is distinct from p_expected_context->>'planningDatasetVersion'
     or p_expected_context->>'scheduleConstraintModelVersion' is distinct from p_expected_context->>'constraintModelVersion' then
    raise exception 'INCREMENTAL_CONTEXT_STALE: current schedule is not linked to the pinned policy/planning/model context';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

  v_current_context:=private.build_solver_context_token_v43(p_studio_id);
  if v_current_context is distinct from p_expected_context then
    raise exception 'STALE_INCREMENTAL_CONTEXT: ScheduleVersion/locks/policy/planning/model context changed after server validation';
  end if;

  select * into v_current
  from public.schedule_versions sv
  where sv.id=(p_expected_context->>'scheduleId')::uuid
    and sv.studio_id=p_studio_id
    and sv.is_current;
  if v_current.id is null then raise exception 'STALE_INCREMENTAL_CONTEXT: pinned current ScheduleVersion is missing'; end if;

  if v_operation='UNASSIGN' then
    if coalesce(btrim(p_assignment_id),'')='' then raise exception 'Assignment is required for UNASSIGN'; end if;
    select to_jsonb(a),a.session_id,a.locked into v_before,v_session_id,v_assignment_locked
    from public.assignments a
    where a.schedule_version_id=v_current.id and a.id=p_assignment_id;
    if v_before is null then raise exception 'Assignment % does not exist',p_assignment_id; end if;
    if coalesce(v_assignment_locked,false) then raise exception 'LOCKED_ASSIGNMENT: % is locked',p_assignment_id; end if;
    select s.locked into v_session_locked
    from public.class_sessions s
    join public.class_definitions c on c.id=s.class_id and c.studio_id=p_studio_id and c.archived_at is null
    where s.id=v_session_id and s.studio_id=p_studio_id and s.archived_at is null;
    if not found then raise exception 'ARCHIVED_OR_UNKNOWN_SESSION: %',v_session_id; end if;
    if coalesce(v_session_locked,false) then raise exception 'LOCKED_SESSION: % is locked',v_session_id; end if;
    v_assignment_id:=p_assignment_id;
  else
    v_session_id:=nullif(btrim(coalesce(p_session_id,'')),'');
    if v_session_id is null then raise exception 'Session is required for ASSIGN'; end if;
    select coalesce(s.duration_minutes,c.duration_minutes),s.locked into v_duration,v_session_locked
    from public.class_sessions s
    join public.class_definitions c on c.id=s.class_id and c.studio_id=p_studio_id and c.archived_at is null
    where s.id=v_session_id and s.studio_id=p_studio_id and s.archived_at is null;
    if not found or v_duration is null then raise exception 'ARCHIVED_OR_UNKNOWN_SESSION: %',v_session_id; end if;
    if exists(select 1 from public.assignments a where a.schedule_version_id=v_current.id and a.session_id=v_session_id) then
      raise exception 'SESSION_ALREADY_ASSIGNED: %',v_session_id;
    end if;
    v_assignment_id:=nullif(btrim(coalesce(p_assignment_id,'')),'');
    if v_assignment_id is null then raise exception 'Assignment is required for ASSIGN'; end if;
    if exists(select 1 from public.assignments a where a.schedule_version_id=v_current.id and a.id=v_assignment_id) then
      raise exception 'ASSIGNMENT_ID_ALREADY_EXISTS: %',v_assignment_id;
    end if;
    if p_changes is null or jsonb_typeof(p_changes)<>'object' then raise exception 'Canonical ASSIGN changes are required'; end if;
    v_day:=p_changes->>'day';
    v_start_time:=(p_changes->>'startTime')::time;
    v_teacher_id:=nullif(p_changes->>'teacherId','');
    v_room_id:=nullif(p_changes->>'roomId','');
    v_status:=coalesce(nullif(p_changes->>'status',''),'NORMAL');
    if v_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') then raise exception 'Invalid schedule day: %',v_day; end if;
    if v_start_time is null then raise exception 'startTime is required for ASSIGN'; end if;
    if extract(second from v_start_time)<>0 or mod(extract(minute from v_start_time)::integer,15)<>0 then
      raise exception 'TIME_GRID: start time must be on a 15-minute boundary';
    end if;
    if v_teacher_id is null or not exists(
      select 1 from public.teachers t where t.id=v_teacher_id and t.studio_id=p_studio_id and t.archived_at is null
    ) then raise exception 'ARCHIVED_OR_UNKNOWN_TEACHER: %',coalesce(v_teacher_id,''); end if;
    if v_room_id is null or not exists(
      select 1 from public.rooms r where r.id=v_room_id and r.studio_id=p_studio_id and r.archived_at is null
    ) then raise exception 'ARCHIVED_OR_UNKNOWN_ROOM: %',coalesce(v_room_id,''); end if;
    if v_status not in ('NORMAL','WARNING','AI_PROPOSED') then raise exception 'Invalid assignment status: %',v_status; end if;
    v_end_time:=v_start_time+make_interval(mins=>v_duration);
    if v_end_time<=v_start_time then raise exception 'Assignment may not cross midnight'; end if;
  end if;

  v_new_version:=v_current.version+1;
  insert into public.schedule_versions(
    studio_id,version,rulebook_version,enforcement_version,planning_dataset_version,constraint_model_version,
    actor_user_id,actor_label,reason,is_current
  ) values(
    p_studio_id,v_new_version,(p_expected_context->>'rulebookVersion')::integer,
    (p_expected_context->>'enforcementVersion')::integer,(p_expected_context->>'planningDatasetVersion')::integer,
    (p_expected_context->>'constraintModelVersion')::integer,p_actor_user_id,v_actor_label,p_reason,false
  ) returning id into v_new_id;

  insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
  select v_new_id,a.id,a.studio_id,a.session_id,a.day,a.start_time,a.end_time,a.teacher_id,a.room_id,a.locked,a.status
  from public.assignments a where a.schedule_version_id=v_current.id;

  if v_operation='ASSIGN' then
    insert into public.assignments(schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status)
    values(v_new_id,v_assignment_id,p_studio_id,v_session_id,v_day,v_start_time,v_end_time,v_teacher_id,v_room_id,coalesce(v_session_locked,false),v_status);
  else
    delete from public.assignments a where a.schedule_version_id=v_new_id and a.id=v_assignment_id;
  end if;

  select public.validate_schedule_hard_v25(v_new_id) into v_legacy_validation;
  select count(*)::integer into v_unscheduled
  from public.class_sessions s
  join public.class_definitions c on c.id=s.class_id and c.studio_id=p_studio_id and c.archived_at is null
  where s.studio_id=p_studio_id and s.archived_at is null
    and not exists(select 1 from public.assignments a where a.schedule_version_id=v_new_id and a.session_id=s.id);

  if coalesce((p_draft_status->>'scheduleComplete')::boolean,false) and v_unscheduled<>0 then
    raise exception 'DRAFT_STATUS_MISMATCH: server claimed complete but % active sessions remain unscheduled',v_unscheduled;
  end if;
  if coalesce((p_draft_status->>'publishable')::boolean,false)
     and not coalesce((p_draft_status->>'scheduleComplete')::boolean,false) then
    raise exception 'DRAFT_STATUS_MISMATCH: publishable draft must be complete';
  end if;

  v_validation:=coalesce(v_legacy_validation,'{}'::jsonb) || jsonb_build_object(
    'unscheduledSessions',v_unscheduled,
    'scheduleComplete',coalesce((p_draft_status->>'scheduleComplete')::boolean,false),
    'publishable',coalesce((p_draft_status->>'publishable')::boolean,false),
    'authoritativeConstraintIr',p_application_validation,
    'draftStatus',p_draft_status
  );

  update public.schedule_versions set is_current=false where id=v_current.id;
  update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;
  select to_jsonb(a) into v_after from public.assignments a where a.schedule_version_id=v_new_id and a.id=v_assignment_id;

  insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
  values(p_studio_id,p_actor_user_id,v_actor_label,'SCHEDULE_COMMAND','ASSIGNMENT',v_assignment_id,p_reason,
    jsonb_build_object(
      'operation',v_operation,'sessionId',v_session_id,'before',v_before,'after',v_after,
      'scheduleVersion',v_new_version,'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
      'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
      'planningDatasetVersion',(p_expected_context->>'planningDatasetVersion')::integer,
      'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
      'authority','SERVER_CONSTRAINT_IR_V47','authoritativeConstraintIr',true,
      'expectedSolverContext',p_expected_context,'applicationConstraintIrValidation',p_application_validation,
      'draftStatus',p_draft_status,'legacyValidation',v_legacy_validation,
      'aiProposed',p_ai_proposed,'legacyWriteBypassRetirementTask','T13'
    ));

  return jsonb_build_object(
    'operation',v_operation,'scheduleId',v_new_id,'scheduleVersion',v_new_version,
    'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
    'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
    'planningDatasetVersion',(p_expected_context->>'planningDatasetVersion')::integer,
    'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
    'assignmentId',v_assignment_id,'sessionId',v_session_id,'before',v_before,'after',v_after,
    'validation',v_validation,'unscheduledSessions',v_unscheduled,
    'authority','SERVER_CONSTRAINT_IR_V47','authoritativeConstraintIr',true
  );
end
$function$;

revoke all on function public.apply_authoritative_incremental_command_v47(text,uuid,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.apply_authoritative_incremental_command_v47(text,uuid,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,boolean)
  to service_role;
'''

TEST = r'''import { describe, expect, it } from "vitest";
import type { Assignment, RuleEnforcementMapping, SchedulePatch, StudioRule, StudioState } from "@/lib/domain";
import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import { evaluateAuthoritativeScheduleCommand } from "@/lib/manual-move-command";

const now = "2026-09-07T00:00:00Z";

function rule(id: string): StudioRule {
  return {
    id, category: "Fixture", type: null, title: id, description: id, strength: "HARD", classificationRaw: "HARD",
    status: "ACTIVE", verificationStatus: "VERIFIED", reviewStatus: "VERIFIED", review: { verified: true },
    affectedEntityIds: [], parameters: {}, exceptions: [], source: { type: "SYSTEM_SEED" }, versionIntroduced: 1, updatedAt: now,
  };
}

function state(assignments: Assignment[] = [], withFrequency = false): StudioState {
  const frequency: RuleEnforcementMapping = { ruleId: "FREQ", type: "CLASS_FREQUENCY", parameters: {}, affectedEntityIds: [], exceptions: [] };
  return {
    studioId: "studio", studioName: "Fixture",
    teachers: [{ id: "t1", name: "Teacher", subjects: ["Ballet"] }],
    rooms: [{ id: "wide", name: "Wide", capacity: 99, features: [] }, { id: "small", name: "Small", capacity: 99, features: [] }],
    students: [{ id: "p1", name: "P1", level: "1" }, { id: "p2", name: "P2", level: "1" }], cohorts: [],
    classes: [{ id: "anchor", name: "Anchor", subject: "Ballet", level: "1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["p1", "p2"], eligibleTeacherIds: ["t1"] }],
    sessions: [{ id: "s-anchor", classId: "anchor", ordinal: 1 }],
    rules: withFrequency ? [rule("FREQ")] : [],
    rulebookVersions: [{ id: "rb", version: 1, name: "Fixture", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
    enforcementVersions: withFrequency ? [{ id: "ev", version: 1, rulebookVersion: 1, createdAt: now, actor: "test", reason: "test", changedRuleIds: [], snapshot: [frequency], status: "CURRENT" }] : [],
    planningDatasetVersions: [], enforcementProposals: [], ruleHistory: [],
    scheduleVersions: [{ id: "sv", version: 1, rulebookVersion: 1, enforcementVersion: 1, planningDatasetVersion: 1, createdAt: now, actor: "test", reason: "test", assignments, isCurrent: true }],
    scenarios: [], auditEvents: [],
  };
}

const node = (value: Partial<ConstraintIRNode> & Pick<ConstraintIRNode, "id" | "kind">): ConstraintIRNode => ({
  id: value.id, kind: value.kind, ruleIds: value.ruleIds ?? [value.id], selector: value.selector ?? {}, parameters: value.parameters ?? {}, explanation: value.explanation ?? value.id,
});

function model(includeFixed = true, includeCapacity = true): ConstraintModelSnapshotV1 {
  return {
    schemaVersion: "1.0", compilerVersion: "t11-test", rulebookVersion: 1, planningDatasetVersion: 1, activeRuleCount: 1,
    hardConstraints: [
      node({ id: "teacher-domain", kind: "TEACHER_SUBJECT_DOMAIN", selector: { teacherNames: ["Teacher"] }, parameters: { allowedSubjects: ["Ballet"] } }),
      ...(includeFixed ? [node({ id: "fixed-anchor", kind: "FIXED_ASSIGNMENT", selector: { classNames: ["Anchor"] }, parameters: { day: "Monday", start: "18:00", end: "19:00" } })] : []),
      ...(includeCapacity ? [node({ id: "small-capacity", kind: "ROOM_CAPACITY", selector: { roomNames: ["Small"] }, parameters: { maxDancers: 1, exemptLevels: [] } })] : []),
    ],
    objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,
  };
}

function assign(roomId = "wide"): SchedulePatch {
  return { id: "assign", operation: "ASSIGN", assignmentId: "", changes: { sessionId: "s-anchor", day: "Monday", startTime: "18:00", teacherId: "t1", roomId }, reason: "T11 assign", proposedBy: "USER" };
}
function unassign(): SchedulePatch {
  return { id: "unassign", operation: "UNASSIGN", assignmentId: "a-anchor", changes: {}, reason: "T11 unassign", proposedBy: "USER" };
}
const placed: Assignment = { id: "a-anchor", sessionId: "s-anchor", day: "Monday", startTime: "18:00", endTime: "19:00", teacherId: "t1", roomId: "wide", status: "NORMAL" };

describe("T11 authoritative incremental ASSIGN/UNASSIGN", () => {
  it("rejects a new placement violation even when it replaces an equal-count completeness finding", () => {
    const decision = evaluateAuthoritativeScheduleCommand(state(), assign("small"), model(true, true));
    expect(decision.comparison.constraintIr.beforeHardViolations).toBe(1);
    expect(decision.comparison.constraintIr.afterHardViolations).toBe(1);
    expect(decision.comparison.constraintIr.beforeBlockingHardViolations).toBe(0);
    expect(decision.comparison.constraintIr.newBlockingViolationKeys).toHaveLength(1);
    expect(decision.accepted).toBe(false);
    expect(decision.blocker?.code).toBe("INCREMENTAL_COMMAND_IR_REJECTED");
  });

  it("accepts a legal ASSIGN and derives the canonical interval", () => {
    const decision = evaluateAuthoritativeScheduleCommand(state(), assign("wide"), model(true, true));
    expect(decision.accepted).toBe(true);
    expect(decision.comparison.candidate.after?.endTime).toBe("19:00");
    expect(decision.draftStatus.scheduleComplete).toBe(true);
    expect(decision.draftStatus.publishable).toBe(true);
  });

  it("allows UNASSIGN to create a visible fixed-session completeness obligation instead of blocking construction", () => {
    const decision = evaluateAuthoritativeScheduleCommand(state([placed]), unassign(), model(true, false));
    expect(decision.accepted).toBe(true);
    expect(decision.comparison.constraintIr.afterHardViolations).toBe(1);
    expect(decision.comparison.constraintIr.afterBlockingHardViolations).toBe(0);
    expect(decision.draftStatus.scheduleComplete).toBe(false);
    expect(decision.draftStatus.completenessObligationKeys.length).toBeGreaterThan(0);
    expect(decision.draftStatus.publishable).toBe(false);
  });

  it("treats legacy CLASS_FREQUENCY as completeness rather than an UNASSIGN placement blocker", () => {
    const decision = evaluateAuthoritativeScheduleCommand(state([placed], true), unassign(), model(false, false));
    expect(decision.comparison.legacy.afterHardViolations).toBe(1);
    expect(decision.comparison.legacy.afterBlockingHardViolations).toBe(0);
    expect(decision.comparison.legacy.accepts).toBe(true);
    expect(decision.accepted).toBe(true);
  });

  it("rejects duplicate, unknown-resource, and locked structural commands before persistence", () => {
    expect(() => evaluateAuthoritativeScheduleCommand(state([placed]), assign(), model(false, false))).toThrow(/SESSION_ALREADY_ASSIGNED/);
    expect(() => evaluateAuthoritativeScheduleCommand(state(), { ...assign(), changes: { ...assign().changes, teacherId: "archived-or-unknown" } }, model(false, false))).toThrow(/not part of this studio/);
    expect(() => evaluateAuthoritativeScheduleCommand(state([{ ...placed, locked: true }]), unassign(), model(false, false))).toThrow(/LOCKED_ASSIGNMENT/);
  });

  it("emits a missing DIRECTLY_AFTER counterpart as a non-placement completeness finding", () => {
    const s = state([placed]);
    s.classes.push({ id: "pre", name: "Pre", subject: "Ballet", level: "1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: ["t1"] });
    s.sessions.push({ id: "s-pre", classId: "pre", ordinal: 1 });
    const directModel = model(false, false);
    directModel.hardConstraints.push(node({ id: "direct", kind: "DIRECTLY_AFTER", parameters: { predecessor: "Pre", successor: "Anchor", gapMinutes: 0 }, selector: { classNames: ["Pre", "Anchor"] } }));
    const result = validateConstraintModelSchedule(s, directModel, [placed]);
    const finding = result.violations.find((violation) => violation.constraintId === "direct");
    expect(finding).toBeDefined();
    expect(finding?.assignmentIds).toEqual([]);
  });
});
'''

ROUTE_TEST = r'''import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "app/api/schedule/incremental/route.ts"), "utf8");
const provider = fs.readFileSync(path.join(root, "components/workspace-provider.tsx"), "utf8");
const panel = fs.readFileSync(path.join(root, "components/schedule/schedule-builder-panel.tsx"), "utf8");

describe("T11 incremental server route contract", () => {
  it("uses the coherent pinned snapshot and published deterministic Constraint IR", () => {
    expect(route).toContain("loadCanonicalSolverSnapshot");
    expect(route).toContain("compileConstraintModel");
    expect(route).toContain("constraintModelDefinitionsMatch");
    expect(route).toContain("evaluateAuthoritativeScheduleCommand");
    expect(route).toContain("loadCurrentSolverContextToken");
    expect(route).toContain("solverSnapshotContextTokensMatch");
  });

  it("commits only through the service-role V4.7 transaction", () => {
    expect(route).toContain('admin.rpc("apply_authoritative_incremental_command_v47"');
    expect(route).not.toContain('apply_schedule_command_v25');
  });

  it("removes direct browser ASSIGN/UNASSIGN writes from the schedule builder", () => {
    expect(panel).not.toContain("getBrowserSupabase");
    expect(panel).not.toContain("apply_schedule_command_v25");
    expect(panel).toContain("applySchedulePatch");
    expect(provider).toContain('/api/schedule/incremental');
  });

  it("does not use aggregate client validation as the placement authority", () => {
    expect(panel).not.toContain("hardViolations <= validation.hardViolations");
    expect(panel).not.toContain("placementPreview");
  });
});
'''

MIGRATION_TEST = r'''import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260907150000_authoritative_incremental_commands_v47.sql"), "utf8");

describe("T11 V4.7 authoritative incremental migration", () => {
  it("is service-role-only and rechecks exact tenant/context under advisory locks", () => {
    expect(sql).toMatch(/revoke all[\s\S]+from public,anon,authenticated/i);
    expect(sql).toMatch(/grant execute[\s\S]+to service_role/i);
    expect(sql).toContain("WORKSPACE_SELECTION_MISMATCH");
    expect(sql).toContain("private.build_solver_context_token_v43(p_studio_id)");
    expect(sql).toContain("STALE_INCREMENTAL_CONTEXT");
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("rejects archived/unknown targets, duplicates, and locks before version creation", () => {
    expect(sql).toMatch(/class_sessions[\s\S]+archived_at is null/i);
    expect(sql).toMatch(/class_definitions[\s\S]+archived_at is null/i);
    expect(sql).toMatch(/teachers[\s\S]+archived_at is null/i);
    expect(sql).toMatch(/rooms[\s\S]+archived_at is null/i);
    expect(sql).toContain("SESSION_ALREADY_ASSIGNED");
    expect(sql).toContain("ASSIGNMENT_ID_ALREADY_EXISTS");
    expect(sql).toContain("LOCKED_ASSIGNMENT");
    expect(sql).toContain("LOCKED_SESSION");
  });

  it("keeps completeness separate from placement legality and does not delegate to V2.5 aggregate validation", () => {
    expect(sql).not.toContain("public.apply_schedule_command_v25(");
    expect(sql).toContain("DRAFT_STATUS_MISMATCH");
    expect(sql).toContain("authoritativeConstraintIr");
    expect(sql).toContain("SERVER_CONSTRAINT_IR_V47");
  });
});
'''

DB_SQL = r'''const authoritativeIncrementalSql = String.raw`
set search_path=public,extensions;

-- T10 leaves the current placement locked as its final rejection witness. T11
-- starts by restoring a movable current placement without changing version data.
update public.assignments a set locked=false
from public.schedule_versions sv
where sv.id=a.schedule_version_id
  and sv.studio_id='11111111-1111-4111-8111-111111111111'
  and sv.is_current
  and a.session_id='t04-session';
update public.class_sessions set locked=false where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-session';
update public.rooms set archived_at=null where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-room';

create or replace function public.t11_test_solver_context(p_studio_id uuid)
returns jsonb
language sql
security definer
set search_path=''
as $$ select private.build_solver_context_token_v43(p_studio_id) $$;
revoke all on function public.t11_test_solver_context(uuid) from public,anon,authenticated;
grant execute on function public.t11_test_solver_context(uuid) to service_role;

set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_assignment text;
  v_context jsonb;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_retry_rejected boolean := false;
begin
  select a.id into v_assignment
  from public.assignments a join public.schedule_versions sv on sv.id=a.schedule_version_id
  where sv.studio_id=v_studio and sv.is_current and a.session_id='t04-session';
  if v_assignment is null then raise exception 'T11 fixture current t04 assignment is missing'; end if;
  v_context:=public.t11_test_solver_context(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  v_result:=public.apply_authoritative_incremental_command_v47(
    'UNASSIGN',v_studio,v_owner,v_assignment,'t04-session','{}'::jsonb,
    'T11 valid unassign',v_context,
    '{"valid":true,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
    '{"mode":"NORMAL","scheduleComplete":false,"publishable":false,"unscheduledSessionIds":["t04-session"],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[]}'::jsonb,false
  );
  if (v_result->>'scheduleVersion')::integer<>(v_context->>'scheduleVersion')::integer+1 then raise exception 'T11 UNASSIGN did not advance one version'; end if;
  if exists(select 1 from public.assignments a join public.schedule_versions sv on sv.id=a.schedule_version_id where sv.studio_id=v_studio and sv.is_current and a.session_id='t04-session') then
    raise exception 'T11 UNASSIGN did not remove the current placement';
  end if;
  if coalesce((v_result->'validation'->>'scheduleComplete')::boolean,true) then raise exception 'T11 partial schedule was incorrectly marked complete'; end if;
  begin
    perform public.apply_authoritative_incremental_command_v47(
      'UNASSIGN',v_studio,v_owner,v_assignment,'t04-session','{}'::jsonb,
      'T11 stale retry',v_context,'{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('STALE_INCREMENTAL_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_retry_rejected:=true;
  end;
  if not v_retry_rejected then raise exception 'T11 stale retry was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count+1 then raise exception 'T11 stale retry was not atomic'; end if;
end
$block$;
reset role;

-- Bypass governed archive bookkeeping only inside this disposable fixture so the
-- exact context stays stable and V4.7's active-row defense is exercised directly.
update public.rooms set archived_at=now() where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-room';
set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_context jsonb := public.t11_test_solver_context(v_studio);
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
begin
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_incremental_command_v47(
      'ASSIGN',v_studio,v_owner,'t11-archived-room','t04-session',
      '{"day":"Monday","startTime":"17:15","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T11 archived room rejection',v_context,'{}'::jsonb,
      '{"mode":"NORMAL","scheduleComplete":true,"publishable":true,"unscheduledSessionIds":[],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[]}'::jsonb,false
    );
  exception when others then
    if position('ARCHIVED_OR_UNKNOWN_ROOM' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T11 archived room was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T11 archived-target rejection was not atomic'; end if;
end
$block$;
reset role;
update public.rooms set archived_at=null where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-room';

set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_context jsonb;
  v_result jsonb;
  v_before_count integer;
  v_after_count integer;
  v_duplicate_rejected boolean := false;
  v_unknown_rejected boolean := false;
begin
  v_context:=public.t11_test_solver_context(v_studio);
  v_result:=public.apply_authoritative_incremental_command_v47(
    'ASSIGN',v_studio,v_owner,'t11-assignment','t04-session',
    '{"day":"Monday","startTime":"17:15","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
    'T11 valid assign',v_context,
    '{"valid":true,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
    '{"mode":"NORMAL","scheduleComplete":true,"publishable":true,"unscheduledSessionIds":[],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[]}'::jsonb,false
  );
  if not exists(
    select 1 from public.assignments a join public.schedule_versions sv on sv.id=a.schedule_version_id
    where sv.studio_id=v_studio and sv.is_current and a.id='t11-assignment'
      and a.start_time='17:15'::time and a.end_time='18:45'::time
  ) then raise exception 'T11 ASSIGN did not persist canonical 90-minute interval'; end if;
  if not exists(
    select 1 from public.schedule_versions sv where sv.studio_id=v_studio and sv.is_current
      and sv.constraint_model_version=(v_context->>'constraintModelVersion')::integer
  ) then raise exception 'T11 ASSIGN lost pinned ConstraintModelVersion'; end if;
  if not exists(
    select 1 from public.audit_events e where e.studio_id=v_studio and e.action='SCHEDULE_COMMAND' and e.entity_id='t11-assignment'
      and e.payload->>'authority'='SERVER_CONSTRAINT_IR_V47' and (e.payload->>'authoritativeConstraintIr')::boolean=true
  ) then raise exception 'T11 authoritative audit evidence missing'; end if;

  v_context:=public.t11_test_solver_context(v_studio);
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_incremental_command_v47(
      'ASSIGN',v_studio,v_owner,'t11-duplicate','t04-session',
      '{"day":"Monday","startTime":"18:45","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T11 duplicate session rejection',v_context,'{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('SESSION_ALREADY_ASSIGNED' in sqlerrm)=0 then raise; end if;
    v_duplicate_rejected:=true;
  end;
  if not v_duplicate_rejected then raise exception 'T11 duplicate session was accepted'; end if;

  begin
    perform public.apply_authoritative_incremental_command_v47(
      'ASSIGN',v_studio,v_owner,'t11-unknown','does-not-exist',
      '{"day":"Monday","startTime":"18:45","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}'::jsonb,
      'T11 unknown session rejection',v_context,'{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('ARCHIVED_OR_UNKNOWN_SESSION' in sqlerrm)=0 then raise; end if;
    v_unknown_rejected:=true;
  end;
  if not v_unknown_rejected then raise exception 'T11 unknown session was accepted'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T11 duplicate/unknown rejection was not atomic'; end if;
end
$block$;
reset role;

update public.assignments a set locked=true
from public.schedule_versions sv
where sv.id=a.schedule_version_id and sv.studio_id='11111111-1111-4111-8111-111111111111' and sv.is_current and a.id='t11-assignment';
set role service_role;
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_context jsonb := public.t11_test_solver_context(v_studio);
  v_before_count integer;
  v_after_count integer;
  v_rejected boolean := false;
begin
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_incremental_command_v47(
      'UNASSIGN',v_studio,v_owner,'t11-assignment','t04-session','{}'::jsonb,
      'T11 locked unassign rejection',v_context,'{}'::jsonb,'{}'::jsonb,false
    );
  exception when others then
    if position('LOCKED_ASSIGNMENT' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T11 locked assignment was unassigned'; end if;
  select count(*) into v_after_count from public.schedule_versions where studio_id=v_studio;
  if v_after_count<>v_before_count then raise exception 'T11 locked rejection was not atomic'; end if;
end
$block$;
reset role;
update public.assignments a set locked=false
from public.schedule_versions sv
where sv.id=a.schedule_version_id and sv.studio_id='11111111-1111-4111-8111-111111111111' and sv.is_current and a.id='t11-assignment';

drop function public.t11_test_solver_context(uuid);
select 'T11 PASS: server-authoritative ASSIGN/UNASSIGN persist canonical duration; stale retry, archived/unknown/duplicate targets, and locks reject atomically' as result;
`;

'''


def apply():
    (ROOT / 'lib/constraint-gate-equivalence.ts').write_text(GATE, encoding='utf-8', newline='\n')
    (ROOT / 'lib/manual-move-command.ts').write_text(AUTHORITY, encoding='utf-8', newline='\n')
    route = ROOT / 'app/api/schedule/incremental/route.ts'
    route.parent.mkdir(parents=True, exist_ok=True)
    route.write_text(ROUTE, encoding='utf-8', newline='\n')
    (ROOT / 'supabase/migrations/20260907150000_authoritative_incremental_commands_v47.sql').write_text(MIGRATION, encoding='utf-8', newline='\n')
    (ROOT / 'tests/incremental-schedule-command.test.ts').write_text(TEST, encoding='utf-8', newline='\n')
    (ROOT / 'tests/incremental-route-contract.test.ts').write_text(ROUTE_TEST, encoding='utf-8', newline='\n')
    (ROOT / 'tests/incremental-migration.test.ts').write_text(MIGRATION_TEST, encoding='utf-8', newline='\n')

    engine = ROOT / 'lib/constraint-engine.ts'
    text = engine.read_text(encoding='utf-8')
    old = '''      const before = classAssignments(state, assignments, predecessor, classesBySession);\n      const after = classAssignments(state, assignments, successor, classesBySession);\n      if (!before.length || !after.length) continue;\n'''
    new = '''      const before = classAssignments(state, assignments, predecessor, classesBySession);\n      const after = classAssignments(state, assignments, successor, classesBySession);\n      const predecessorClass = state.classes.find((klass) => normalize(klass.name) === normalize(predecessor));\n      const successorClass = state.classes.find((klass) => normalize(klass.name) === normalize(successor));\n      if (after.length && !before.length) {\n        addViolation(violations, node, `${successor} is placed while ${predecessor} is still unassigned; the direct-after obligation is incomplete.`, [], [predecessorClass?.id, successorClass?.id].filter((id): id is string => Boolean(id)));\n        continue;\n      }\n      if (before.length && !after.length) {\n        addViolation(violations, node, `${predecessor} is placed while ${successor} is still unassigned; the direct-after obligation is incomplete.`, [], [predecessorClass?.id, successorClass?.id].filter((id): id is string => Boolean(id)));\n        continue;\n      }\n      if (!before.length || !after.length) continue;\n'''
    if text.count(old) != 1:
        raise SystemExit(f'DIRECTLY_AFTER replacement count {text.count(old)}')
    engine.write_text(text.replace(old, new, 1), encoding='utf-8', newline='\n')

    provider = ROOT / 'components/workspace-provider.tsx'
    text = provider.read_text(encoding='utf-8')
    old = '''    if (!canEdit) return { ok: false, error: "Editor access is required." };\n    if (patch.operation !== "MOVE") return { ok: false, error: "This T10 command path moves an existing assignment only." };\n    if (!state || !session) return { ok: false, error: "An authenticated workspace is required." };'''
    new = '''    if (!canEdit) return { ok: false, error: "Editor access is required." };\n    if (!state || !session) return { ok: false, error: "An authenticated workspace is required." };'''
    if text.count(old) != 1:
        raise SystemExit('provider operation guard marker missing')
    text = text.replace(old, new, 1)
    old = '''      const response = await fetch("/api/schedule/move", {\n        method: "POST",'''
    new = '''      const endpoint = patch.operation === "MOVE" ? "/api/schedule/move" : "/api/schedule/incremental";\n      const response = await fetch(endpoint, {\n        method: "POST",'''
    if text.count(old) != 1:
        raise SystemExit('provider endpoint marker missing')
    text = text.replace(old, new, 1)
    text = text.replace('The authoritative server MOVE gate rejected this change.', 'The authoritative server schedule gate rejected this change.', 1)
    provider.write_text(text, encoding='utf-8', newline='\n')

    panel = ROOT / 'components/schedule/schedule-builder-panel.tsx'
    text = panel.read_text(encoding='utf-8')
    text = text.replace('import { validateSchedule } from "@/lib/validator";\n', '')
    text = text.replace('import { getBrowserSupabase } from "@/lib/supabase";\n', '')
    text = text.replace('    validation,\n    refresh,\n    canEdit,', '    validation,\n    applySchedulePatch,\n    canEdit,')
    text = re.sub(r'  const placementPreview = candidate \? validateSchedule\(state, \[\.\.\.currentAssignments, candidate\]\) : null;\n  const placementAllowed = Boolean\(placementPreview && placementPreview\.hardViolations <= validation\.hardViolations\);', '  const placementAllowed = Boolean(candidate);', text, count=1)

    place_pattern = re.compile(r'''  async function placeSession\(\) \{.*?\n  \}\n\n  async function unassign\(\) \{.*?\n  \}\n''', re.S)
    replacement = r'''  async function placeSession() {
    if (!editingEnabled || !placing || !placingClass || !candidate || !placementAllowed || scheduleIsStale) return;
    setSaving(true);
    setNotice("");
    const result = await applySchedulePatch({
      id: `assign-${placing.id}-from-tray`,
      operation: "ASSIGN",
      assignmentId: candidate.id,
      changes: {
        sessionId: placing.id,
        day: candidate.day,
        startTime: candidate.startTime,
        teacherId: candidate.teacherId,
        roomId: candidate.roomId,
        status: "NORMAL",
      },
      reason: `Placed ${placingClass.name} from Unscheduled`,
      proposedBy: "USER",
      baseScheduleVersion: currentScheduleVersion,
      baseRulebookVersion: currentRulebookVersion,
      baseEnforcementVersion: currentEnforcementVersion,
    });
    setSaving(false);
    if (!result.ok) {
      setNotice(`Placement blocked: ${result.error || "Authoritative server validation rejected this placement."}`);
      return;
    }
    setPlacing(null);
    const draft = (result.details?.draftStatus || {}) as Record<string, unknown>;
    const suffix = draft.scheduleComplete === false ? " Draft remains incomplete." : "";
    setNotice(`Placed ${placingClass.name}. Saved as Schedule v${Number(result.version || currentScheduleVersion + 1)}.${suffix}`);
  }

  async function unassign() {
    if (!editingEnabled || !pendingUnassign || pendingUnassign.locked || scheduleIsStale) return;
    const currentClass = klassForAssignment(pendingUnassign);
    setSaving(true);
    setNotice("");
    const result = await applySchedulePatch({
      id: `unassign-${pendingUnassign.id}`,
      operation: "UNASSIGN",
      assignmentId: pendingUnassign.id,
      changes: {},
      reason: `Moved ${currentClass?.name || pendingUnassign.sessionId} to Unscheduled`,
      proposedBy: "USER",
      baseScheduleVersion: currentScheduleVersion,
      baseRulebookVersion: currentRulebookVersion,
      baseEnforcementVersion: currentEnforcementVersion,
    });
    setSaving(false);
    if (!result.ok) {
      setNotice(`Unassign blocked: ${result.error || "Authoritative server validation rejected this unassign."}`);
      return;
    }
    setPendingUnassign(null);
    setTab("UNSCHEDULED");
    setNotice(`Moved ${currentClass?.name || "class"} to Unscheduled. Saved as Schedule v${Number(result.version || currentScheduleVersion + 1)}. Draft is incomplete until every required session/relationship is satisfied.`);
  }
'''
    text, count = place_pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit(f'panel function replacement count {count}')
    panel.write_text(text, encoding='utf-8', newline='\n')

    db = ROOT / 'scripts/test-db.mjs'
    text = db.read_text(encoding='utf-8')
    if 'const authoritativeIncrementalSql = String.raw`' not in text:
        marker = '\nfunction psql(container, user, sql, label) {'
        if marker not in text:
            raise SystemExit('test-db psql marker not found')
        text = text.replace(marker, '\n' + DB_SQL + 'function psql(container, user, sql, label) {', 1)
    call_marker = "    const manualMoveOutput = psql(container, 'postgres', authoritativeManualMoveSql, 'T10 authoritative manual MOVE integration tests');\n    process.stdout.write(manualMoveOutput);"
    if call_marker not in text:
        raise SystemExit('test-db T10 call marker not found')
    if "T11 authoritative incremental ASSIGN/UNASSIGN integration tests" not in text:
        text = text.replace(call_marker, call_marker + "\n    const incrementalOutput = psql(container, 'postgres', authoritativeIncrementalSql, 'T11 authoritative incremental ASSIGN/UNASSIGN integration tests');\n    process.stdout.write(incrementalOutput);", 1)
    db.write_text(text, encoding='utf-8', newline='\n')


def finalize():
    readme = ROOT / 'plans/README.md'
    text = readme.read_text(encoding='utf-8')
    text = text.replace('- Current phase: Correctness — T03–T10.', '- Current phase: DWDE completion — T11–T16.')
    text = text.replace('- Current task: **T11 — ASSIGN/UNASSIGN canonical authority**.', '- Current task: **T12 — rebase/undo canonical authority**.')
    text = text.replace('- Next task: T12 after T11 acceptance.', '- Next task: T13 after T12 acceptance.')
    old = '- Implementation progress: T01 through T10 have verified DONE evidence. T10 routes desktop/mobile MOVE through an authenticated explicit-workspace server gate, one coherent pinned context, deterministic/published Constraint IR equality, canonical duration derivation, legacy safety floor, and a service-role-only V4.6 transaction with exact context recheck. Partial drafts remain movable but never claim publishable completeness. T11 is READY; T12 remains NOT_STARTED pending T11.'
    new = '- Implementation progress: T01 through T11 have verified DONE evidence. T11 moves ASSIGN/UNASSIGN off direct browser V2.5 writes and onto the coherent pinned server Constraint IR boundary plus service-role V4.7 transaction. Incremental legality now compares violation identity rather than aggregate HARD counts; CLASS_FREQUENCY and missing fixed/direct-after counterparts are explicit completeness obligations, so partial drafts remain editable but non-publishable. T12 is READY; T13 remains NOT_STARTED pending T12.'
    if old not in text:
        raise SystemExit('README progress marker missing')
    text = text.replace(old, new)
    text = text.replace('- T10: manual MOVE through authoritative IR.\n', '- T12: rebase/undo through canonical authority.\n')
    readme.write_text(text, encoding='utf-8', newline='\n')

    nxt = ROOT / 'plans/NEXT.md'
    text = nxt.read_text(encoding='utf-8')
    text = text.replace('Current Task: T11\nNext Task: T12', 'Current Task: T12\nNext Task: T13')
    text = text.replace('Baseline: `17b3a60`. T10 is DONE. T11 is the next executable task; T12 remains pending T11.', 'Baseline: `17b3a60`. T11 is DONE. T12 is the next executable task; T13 remains pending T12.')
    nxt.write_text(text, encoding='utf-8', newline='\n')

    tasks = ROOT / 'plans/TASKS.md'
    text = tasks.read_text(encoding='utf-8')
    text = text.replace('| [T11](#t11) | ASSIGN/UNASSIGN canonical authority | READY |', '| [T11](#t11) | ASSIGN/UNASSIGN canonical authority | DONE |')
    text = text.replace('| [T12](#t12) | Rebase/undo canonical authority | NOT_STARTED |', '| [T12](#t12) | Rebase/undo canonical authority | READY |')
    t11_start = text.index('<a id="t11"></a>')
    t12_start = text.index('<a id="t12"></a>')
    t11 = text[t11_start:t12_start]
    t11 = t11.replace('| Status | READY |', '| Status | DONE |', 1)
    for old_line, new_line in [
        ('- [ ] ASSIGN/UNASSIGN use the server candidate/validation/transaction boundary established by T10.', '- [x] ASSIGN/UNASSIGN use the server candidate/validation/transaction boundary established by T10.'),
        ('- [ ] Unknown or duplicate sessions, archived targets, and lock violations reject atomically.', '- [x] Unknown or duplicate sessions, archived targets, and lock violations reject atomically.'),
        ('- [ ] Partial schedules can be built and remain visibly incomplete; final completeness is evaluated separately.', '- [x] Partial schedules can be built and remain visibly incomplete; final completeness is evaluated separately.'),
        ('- [ ] No new placement violation can be hidden by removing another assignment or comparing only aggregate counts.', '- [x] No new placement violation can be hidden by removing another assignment or comparing only aggregate counts.'),
    ]:
        t11 = t11.replace(old_line, new_line)
    completion_old = '### Completion evidence\n\nNot yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.'
    completion_new = '''### Completion evidence

Task/child: T11

Starting HEAD: `9aea0eed24e9ef79fd50b58beaa6d7ba9d9cc6be`.

Implemented files: `app/api/schedule/incremental/route.ts`, `lib/constraint-gate-equivalence.ts`, `lib/manual-move-command.ts`, `lib/constraint-engine.ts`, `components/workspace-provider.tsx`, `components/schedule/schedule-builder-panel.tsx`, forward migration `supabase/migrations/20260907150000_authoritative_incremental_commands_v47.sql`, `tests/incremental-schedule-command.test.ts`, `tests/incremental-route-contract.test.ts`, `tests/incremental-migration.test.ts`, and `scripts/test-db.mjs`. Historical migrations and production-ledger bytes were not edited.

Acceptance evidence: ASSIGN/UNASSIGN now POST through the authenticated explicit-studio server boundary, reconstruct the T07 coherent snapshot, require exact current schedule links, recompile and compare the deterministic published ConstraintModelVersion, construct the canonical candidate/duration, evaluate IR plus the legacy safety floor, recheck the context token, and commit only through service-role V4.7. The schedule-builder no longer calls V2.5 directly or treats browser aggregate validation as authority. V4.7 rechecks tenant/context under advisory locks, filters archived session/class/teacher/room targets, rejects duplicate session/assignment identities and locks before creating a version, derives duration transactionally, preserves the pinned ConstraintModelVersion, and records authoritative audit evidence.

Incremental legality now uses stable violation identities. A regression proves a new room-capacity violation is rejected even when assigning the missing fixed anchor removes an equal-count completeness finding, closing the aggregate-count swap hole. Legacy CLASS_FREQUENCY and missing FIXED_ASSIGNMENT/DIRECTLY_AFTER counterparts remain visible completeness obligations rather than placement blockers. UNASSIGN can therefore make a draft incomplete without falsely claiming publishability.

Disposable PostgreSQL lifecycle: valid UNASSIGN creates exactly one new incomplete ScheduleVersion; replay with the reviewed old context rejects atomically; an archived room rejects before version creation; valid ASSIGN persists the canonical 90-minute interval and pinned model/audit evidence; duplicate and unknown sessions reject atomically; and a locked assignment cannot be unassigned. The fixture uses only the disposable T02 database and synthetic T04 identities.

Verification: GitHub Actions T11 run on Ubuntu 24.04 and Windows with Node 22/npm 11.6.0. Ubuntu executed `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:db`; Windows executed lint/typecheck/test/build with the Docker database gate intentionally Linux-only. All required gates passed before the implementation/handoff commit. Lint retained only the pre-existing warnings.

Remaining limitation / T13 bypass register: authenticated callers can still invoke historical `apply_schedule_command_v25` directly until T12 migrates recovery and T13 revokes/delegates superseded entry points. T11 removes the active browser ASSIGN/UNASSIGN callers but does not claim the canonical server authority is yet unavoidable.

Resulting task status: DONE. Newly READY task: T12.'''
    if completion_old not in t11:
        raise SystemExit('T11 completion marker missing')
    t11 = t11.replace(completion_old, completion_new, 1)
    t11 = t11.replace('Dependency T10 is verified DONE. T11 is READY and is now the first executable unfinished task.', 'Dependency T10 is verified DONE. T11 is DONE. T12 is READY and is now the first executable unfinished task.')
    text = text[:t11_start] + t11 + text[t12_start:]
    # T12 dependency note/status only.
    t12_start = text.index('<a id="t12"></a>')
    t13_start = text.index('<a id="t13"></a>')
    t12 = text[t12_start:t13_start]
    t12 = t12.replace('| Status | NOT_STARTED |', '| Status | READY |', 1)
    t12 = t12.replace('Waiting for dependency acceptance: T10, T11. This is normal sequencing, not a BLOCKED status.', 'Dependencies T10 and T11 are verified DONE. T12 is READY and is now the first executable unfinished task.')
    text = text[:t12_start] + t12 + text[t13_start:]
    tasks.write_text(text, encoding='utf-8', newline='\n')

    release = ROOT / 'plans/DWDE_RELEASE_PLAN.md'
    text = release.read_text(encoding='utf-8')
    text = text.replace('| A06 | Every active required session appears once; archived sessions excluded; history preserved | T06, T11, T12 | T06 archive/restore and exact-session-set transaction tests are verified; gate remains open for T11/T12 incremental/recovery authority |', '| A06 | Every active required session appears once; archived sessions excluded; history preserved | T06, T11, T12 | T06 archive/restore and exact-session-set transaction tests plus T11 active-target incremental transaction tests are verified; gate remains open for T12 recovery authority |')
    text = text.replace('| A08 | MOVE/ASSIGN/UNASSIGN/rebase/undo/adoption/revalidation use shared scheduling semantics | T10–T13 | Executed command matrix; direct legacy calls denied |', '| A08 | MOVE/ASSIGN/UNASSIGN/rebase/undo/adoption/revalidation use shared scheduling semantics | T10–T13 | T10 MOVE and T11 ASSIGN/UNASSIGN server-authority matrices are verified; gate remains open for T12 recovery and T13 direct legacy-call denial |')
    text = text.replace('| A09 | Partial editing remains possible; incomplete drafts cannot be published/adopted as complete | T10–T12 | Incremental build and final-completeness tests |', '| A09 | Partial editing remains possible; incomplete drafts cannot be published/adopted as complete | T10–T12 | T10/T11 verify movable/incremental partial drafts, explicit completeness obligations, and non-publishable status; gate remains open for T12 recovery/final-completeness behavior |')
    release.write_text(text, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else 'apply'
    if mode == 'apply':
        apply()
    elif mode == 'finalize':
        finalize()
    else:
        raise SystemExit(f'unknown mode {mode}')

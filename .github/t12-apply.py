from pathlib import Path
import re
import sys
import textwrap

ROOT = Path('.')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(textwrap.dedent(content).lstrip(), encoding='utf-8', newline='\n')


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one marker, found {count}: {old[:120]!r}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8', newline='\n')


def implement() -> None:
    write('lib/schedule-recovery.ts', r'''
        import type { Assignment, StudioState, ValidationResult, ValidationViolation } from "@/lib/domain";
        import type { ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
        import type { ConstraintEngineResult, ConstraintEngineViolation } from "@/lib/constraint-engine";
        import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
        import { placementEndTime, sessionDurationMinutes } from "@/lib/schedule-builder";
        import { validateSchedule } from "@/lib/validator";

        export type ScheduleRecoveryOperation = "REBASE" | "UNDO";

        export interface ScheduleRecoveryDraftStatus {
          mode: ScheduleRecoveryOperation;
          scheduleComplete: boolean;
          publishable: boolean;
          unscheduledSessionIds: string[];
          duplicateSessionIds: string[];
          unknownAssignmentSessionIds: string[];
          completenessObligationKeys: string[];
          retiredAssignmentIds: string[];
        }

        export interface ScheduleRecoveryDecision {
          accepted: boolean;
          candidateAssignments: Assignment[];
          irValidation: ConstraintEngineResult;
          legacyValidation: ValidationResult;
          draftStatus: ScheduleRecoveryDraftStatus;
          blocker: null | {
            code: string;
            message: string;
            ruleIds: string[];
            entityIds: string[];
          };
        }

        type ViolationIdentity = Pick<ValidationViolation, "constraintId" | "assignmentIds" | "affectedEntityIds">;

        function violationKey(violation: ViolationIdentity) {
          return JSON.stringify([
            violation.constraintId,
            [...violation.assignmentIds].sort(),
            [...violation.affectedEntityIds].sort(),
          ]);
        }

        function legacyCompletenessRuleIds(state: StudioState) {
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

        function minutes(value: string) {
          const [hours = "0", mins = "0"] = value.slice(0, 5).split(":");
          return Number(hours) * 60 + Number(mins);
        }

        function samePlacement(left: Assignment, right: Assignment) {
          return left.day === right.day
            && left.startTime === right.startTime
            && left.teacherId === right.teacherId
            && left.roomId === right.roomId;
        }

        function completeness(
          state: StudioState,
          assignments: Assignment[],
          completenessObligationKeys: string[],
          retiredAssignmentIds: string[],
          mode: ScheduleRecoveryOperation,
          irValidation: ConstraintEngineResult,
          legacyValidation: ValidationResult,
        ): ScheduleRecoveryDraftStatus {
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
          const scheduleComplete = unscheduledSessionIds.length === 0
            && duplicateSessionIds.length === 0
            && unknownAssignmentSessionIds.size === 0
            && completenessObligationKeys.length === 0;
          return {
            mode,
            scheduleComplete,
            publishable: scheduleComplete && irValidation.valid && legacyValidation.valid && legacyValidation.fullyValidated,
            unscheduledSessionIds,
            duplicateSessionIds,
            unknownAssignmentSessionIds: [...unknownAssignmentSessionIds].sort(),
            completenessObligationKeys,
            retiredAssignmentIds: [...new Set(retiredAssignmentIds)].sort(),
          };
        }

        function rejected(
          code: string,
          message: string,
          ruleIds: string[],
          entityIds: string[],
        ) {
          return { code, message, ruleIds, entityIds };
        }

        /**
         * T12 recovery treats historical placements as input, never as authority.
         * The source rows are normalized against the current immutable Planning
         * Dataset and then evaluated by the current complete Constraint IR plus
         * the retained legacy safety floor. Historical rows themselves are never
         * modified.
         */
        export function evaluateAuthoritativeScheduleRecovery(
          state: StudioState,
          sourceAssignments: Assignment[],
          operation: ScheduleRecoveryOperation,
          model: ConstraintModelSnapshotV1,
        ): ScheduleRecoveryDecision {
          const current = state.scheduleVersions.find((version) => version.isCurrent);
          if (!current) throw new Error("No current ScheduleVersion exists.");

          const sessionById = new Map(state.sessions.map((session) => [session.id, session]));
          const classById = new Map(state.classes.map((klass) => [klass.id, klass]));
          const teacherIds = new Set(state.teachers.map((teacher) => teacher.id));
          const roomIds = new Set(state.rooms.map((room) => room.id));
          const candidateAssignments: Assignment[] = [];
          const retiredAssignmentIds: string[] = [];
          let structuralBlocker: ScheduleRecoveryDecision["blocker"] = null;

          const seenAssignmentIds = new Set<string>();
          const seenSessionIds = new Set<string>();
          for (const source of sourceAssignments) {
            const session = sessionById.get(source.sessionId);
            const klass = session ? classById.get(session.classId) : null;
            if (!session || !klass) {
              retiredAssignmentIds.push(source.id);
              continue;
            }

            const resourceMissing = !teacherIds.has(source.teacherId) || !roomIds.has(source.roomId);
            if (resourceMissing) {
              if (operation === "REBASE") {
                retiredAssignmentIds.push(source.id);
                continue;
              }
              structuralBlocker ??= rejected(
                "RECOVERY_SOURCE_RESOURCE_INACTIVE",
                `Undo cannot restore assignment ${source.id} because its teacher or room is no longer active.`,
                [],
                [source.id, source.teacherId, source.roomId],
              );
              continue;
            }

            if (seenAssignmentIds.has(source.id)) {
              structuralBlocker ??= rejected(
                "RECOVERY_SOURCE_DUPLICATE_ASSIGNMENT",
                `Recovery source contains duplicate assignment id ${source.id}.`,
                [],
                [source.id],
              );
              continue;
            }
            if (seenSessionIds.has(source.sessionId)) {
              structuralBlocker ??= rejected(
                "RECOVERY_SOURCE_DUPLICATE_SESSION",
                `Recovery source contains more than one assignment for session ${source.sessionId}.`,
                [],
                [source.sessionId],
              );
              continue;
            }
            seenAssignmentIds.add(source.id);
            seenSessionIds.add(source.sessionId);

            const duration = sessionDurationMinutes(session, klass);
            const start = minutes(source.startTime);
            const end = start + duration;
            if (!Number.isFinite(start) || start < 0 || start >= 24 * 60 || end <= start || end >= 24 * 60) {
              structuralBlocker ??= rejected(
                "RECOVERY_INTERVAL_INVALID",
                `Recovery source assignment ${source.id} cannot be normalized to a same-day canonical interval.`,
                [],
                [source.id, source.sessionId],
              );
              continue;
            }

            candidateAssignments.push({
              ...source,
              endTime: placementEndTime(source.startTime, duration),
              status: source.status || "NORMAL",
            });
          }

          const currentBySession = new Map(current.assignments.map((assignment) => [assignment.sessionId, assignment]));
          const candidateBySession = new Map(candidateAssignments.map((assignment) => [assignment.sessionId, assignment]));
          for (const session of state.sessions) {
            const currentAssignment = currentBySession.get(session.id);
            if (!session.locked && !currentAssignment?.locked) continue;
            if (!currentAssignment) {
              structuralBlocker ??= rejected(
                "LOCKED_SESSION_PLACEMENT_UNRESOLVED",
                `Locked session ${session.id} has no current assignment to preserve during recovery.`,
                [],
                [session.id],
              );
              continue;
            }
            const candidate = candidateBySession.get(session.id);
            if (!candidate || !samePlacement(currentAssignment, candidate)) {
              structuralBlocker ??= rejected(
                "LOCKED_SESSION_PLACEMENT_CHANGED",
                `Recovery would change or remove the effective locked placement for session ${session.id}.`,
                [],
                [session.id, currentAssignment.id],
              );
            }
          }

          const legacyValidation = validateSchedule(state, candidateAssignments);
          const irValidation = validateConstraintModelSchedule(state, model, candidateAssignments);
          const legacyCompleteness = legacyCompletenessRuleIds(state);
          const legacyBlocking = legacyValidation.violations.filter(
            (violation) => violation.severity === "HARD" && !legacyCompleteness.has(violation.constraintId),
          );
          const irBlocking = irValidation.violations.filter((violation) => !isIrCompletenessObligation(violation, model));
          const completenessObligationKeys = [...new Set([
            ...legacyValidation.violations
              .filter((violation) => violation.severity === "HARD" && legacyCompleteness.has(violation.constraintId))
              .map(violationKey),
            ...irValidation.violations.filter((violation) => isIrCompletenessObligation(violation, model)).map(violationKey),
          ])].sort();
          const draftStatus = completeness(
            state,
            candidateAssignments,
            completenessObligationKeys,
            retiredAssignmentIds,
            operation,
            irValidation,
            legacyValidation,
          );

          if (structuralBlocker) {
            return { accepted: false, candidateAssignments, irValidation, legacyValidation, draftStatus, blocker: structuralBlocker };
          }
          if (irValidation.unsupportedConstraintIds.length) {
            return {
              accepted: false,
              candidateAssignments,
              irValidation,
              legacyValidation,
              draftStatus,
              blocker: rejected(
                "RECOVERY_IR_UNSUPPORTED",
                `Recovery failed closed because ${irValidation.unsupportedConstraintIds.length} authoritative HARD constraint node(s) are unsupported.`,
                [],
                irValidation.unsupportedConstraintIds,
              ),
            };
          }
          if (irBlocking.length) {
            const first = irBlocking[0];
            return {
              accepted: false,
              candidateAssignments,
              irValidation,
              legacyValidation,
              draftStatus,
              blocker: rejected(
                "RECOVERY_CURRENT_POLICY_REJECTED",
                first.message || "The source placements are incompatible with the current authoritative Constraint IR.",
                first.ruleIds,
                first.affectedEntityIds,
              ),
            };
          }
          if (legacyBlocking.length) {
            const first = legacyBlocking[0];
            return {
              accepted: false,
              candidateAssignments,
              irValidation,
              legacyValidation,
              draftStatus,
              blocker: rejected(
                "RECOVERY_LEGACY_SAFETY_REJECTED",
                first.message || "The source placements violate the retained production safety floor.",
                first.constraintId === "SYSTEM" ? [] : [first.constraintId],
                first.affectedEntityIds,
              ),
            };
          }

          return { accepted: true, candidateAssignments, irValidation, legacyValidation, draftStatus, blocker: null };
        }
    ''')

    write('app/api/schedule/recovery/route.ts', r'''
        import { NextRequest, NextResponse } from "next/server";
        import type { SupabaseClient } from "@supabase/supabase-js";
        import type { Assignment } from "@/lib/domain";
        import { getServerAdminSupabase, getServerSupabase } from "@/lib/supabase";
        import {
          loadCanonicalSolverSnapshot,
          loadCurrentSolverContextToken,
          solverSnapshotContextTokensMatch,
        } from "@/lib/server-studio-state";
        import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
        import { constraintModelDefinition, constraintModelDefinitionsMatch } from "@/lib/constraint-model-version";
        import { evaluateAuthoritativeScheduleRecovery, type ScheduleRecoveryOperation } from "@/lib/schedule-recovery";

        export const runtime = "nodejs";
        export const dynamic = "force-dynamic";

        type AuthorizedWorkspace = {
          supabase: SupabaseClient;
          role: "OWNER" | "EDITOR" | "VIEWER";
          userId: string;
        };

        type RecoveryRequest = {
          studioId?: string;
          operation?: ScheduleRecoveryOperation;
          reason?: string;
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

        function mapAssignment(row: Record<string, unknown>): Assignment {
          return {
            id: String(row.id),
            sessionId: String(row.session_id),
            day: row.day as Assignment["day"],
            startTime: String(row.start_time || "").slice(0, 5),
            endTime: String(row.end_time || "").slice(0, 5),
            teacherId: String(row.teacher_id),
            roomId: String(row.room_id),
            locked: Boolean(row.locked),
            status: row.status as Assignment["status"],
          };
        }

        async function loadPreviousSchedule(
          supabase: SupabaseClient,
          studioId: string,
          currentVersion: number,
        ): Promise<{ id: string; version: number; assignments: Assignment[] } | null> {
          if (currentVersion <= 1) return null;
          const schedule = await supabase
            .from("schedule_versions")
            .select("id,version")
            .eq("studio_id", studioId)
            .eq("version", currentVersion - 1)
            .maybeSingle();
          if (schedule.error) throw schedule.error;
          if (!schedule.data) return null;
          const assignments = await supabase
            .from("assignments")
            .select("*")
            .eq("schedule_version_id", schedule.data.id)
            .order("id");
          if (assignments.error) throw assignments.error;
          return {
            id: String(schedule.data.id),
            version: Number(schedule.data.version),
            assignments: (assignments.data || []).map((row) => mapAssignment(row as Record<string, unknown>)),
          };
        }

        export async function POST(request: NextRequest) {
          try {
            const body = await request.json() as RecoveryRequest;
            const studioId = typeof body.studioId === "string" ? body.studioId.trim() : "";
            const operation = body.operation;
            if (!studioId) return NextResponse.json({ error: "An explicit studioId is required." }, { status: 400 });
            if (operation !== "REBASE" && operation !== "UNDO") {
              return NextResponse.json({ error: "Recovery operation must be REBASE or UNDO." }, { status: 400 });
            }

            const authorized = await authorizeWorkspace(request, studioId);
            if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
            if (authorized.role === "VIEWER") {
              return NextResponse.json({ error: "Editor access is required for schedule recovery." }, { status: 403 });
            }

            const snapshot = await loadCanonicalSolverSnapshot(authorized.supabase, studioId);
            const token = snapshot.contextToken;
            if (token.scheduleVersion === null || token.scheduleId === null
              || token.rulebookVersion === null || token.enforcementVersion === null
              || token.planningDatasetVersion === null || token.constraintModelVersion === null) {
              return blocked("RECOVERY_CONTEXT_INCOMPLETE", "Recovery requires current schedule, policy, planning, and ConstraintModelVersion pointers.");
            }
            if (!token.planningConfirmedForSchedulingAt) {
              return blocked("RECOVERY_PLANNING_NOT_CONFIRMED", "The current PlanningDatasetVersion must be confirmed before recovery can create a new canonical schedule.");
            }

            const model = compileConstraintModel(snapshot.state);
            if (!model.completeHardConstraintCompilation || model.uncompiledConstraintRuleIds.length) {
              return blocked(
                "RECOVERY_CONSTRAINT_MODEL_INCOMPLETE",
                "Recovery failed closed because the current Rulebook does not have a complete authoritative HARD Constraint IR.",
                { uncompiledRuleIds: model.uncompiledConstraintRuleIds },
              );
            }
            const published = snapshot.publishedConstraintModel;
            const definition = constraintModelDefinition(model);
            if (!published || !published.complete
              || published.version !== token.constraintModelVersion
              || !constraintModelDefinitionsMatch(definition, published.snapshot)) {
              return blocked(
                "RECOVERY_CONSTRAINT_MODEL_STALE",
                "The deterministic Constraint IR does not match the current published ConstraintModelVersion. Sync the model before recovery.",
              );
            }

            const currentSchedule = snapshot.state.scheduleVersions.find((version) => version.isCurrent);
            if (!currentSchedule || currentSchedule.id !== token.scheduleId || currentSchedule.version !== token.scheduleVersion) {
              return blocked("RECOVERY_CONTEXT_INVALID", "The coherent snapshot does not contain the pinned current ScheduleVersion.");
            }

            let sourceScheduleId = currentSchedule.id;
            let sourceScheduleVersion = currentSchedule.version;
            let sourceAssignments = currentSchedule.assignments;
            if (operation === "UNDO") {
              const previous = await loadPreviousSchedule(authorized.supabase, studioId, currentSchedule.version);
              if (!previous) {
                return blocked("RECOVERY_NO_PREVIOUS_VERSION", `Schedule v${currentSchedule.version} has no immediately previous version to undo.`);
              }
              sourceScheduleId = previous.id;
              sourceScheduleVersion = previous.version;
              sourceAssignments = previous.assignments;
            }

            const decision = evaluateAuthoritativeScheduleRecovery(snapshot.state, sourceAssignments, operation, model);
            if (!decision.accepted) {
              return blocked(
                decision.blocker?.code || "RECOVERY_REJECTED",
                decision.blocker?.message || "The historical placements are incompatible with the current scheduling authority.",
                {
                  blocker: decision.blocker,
                  sourceScheduleVersion,
                  irValidation: decision.irValidation,
                  legacyValidation: decision.legacyValidation,
                  draftStatus: decision.draftStatus,
                },
              );
            }

            const currentToken = await loadCurrentSolverContextToken(authorized.supabase, studioId);
            if (!solverSnapshotContextTokensMatch(token, currentToken)) {
              return blocked(
                "RECOVERY_CONTEXT_CHANGED_RETRY",
                "Scheduling context changed while recovery was being validated. Retry against the current schedule and policy.",
              );
            }

            let admin: SupabaseClient;
            try {
              admin = getServerAdminSupabase();
            } catch (error) {
              return NextResponse.json({
                error: error instanceof Error ? error.message : String(error),
                code: "RECOVERY_ADMIN_NOT_CONFIGURED",
              }, { status: 503 });
            }

            const reason = typeof body.reason === "string" && body.reason.trim()
              ? body.reason.trim()
              : operation === "REBASE"
                ? `Revalidate Schedule v${currentSchedule.version} against the current scheduling context`
                : `Undo Schedule v${currentSchedule.version} by re-adopting Schedule v${sourceScheduleVersion} placements under current policy`;
            const candidate = decision.candidateAssignments.map((assignment) => ({
              assignmentId: assignment.id,
              sessionId: assignment.sessionId,
              day: assignment.day,
              startTime: assignment.startTime,
              endTime: assignment.endTime,
              teacherId: assignment.teacherId,
              roomId: assignment.roomId,
              status: assignment.status || "NORMAL",
            }));
            const result = await admin.rpc("apply_authoritative_schedule_recovery_v48", {
              p_operation: operation,
              p_studio_id: studioId,
              p_actor_user_id: authorized.userId,
              p_source_schedule_id: sourceScheduleId,
              p_reason: reason,
              p_expected_context: token,
              p_candidate: candidate,
              p_application_validation: decision.irValidation,
              p_draft_status: decision.draftStatus,
            });
            if (result.error) {
              const message = result.error.message || "Schedule recovery transaction failed.";
              if (message.includes("STALE_RECOVERY_CONTEXT")) {
                return blocked("RECOVERY_CONTEXT_CHANGED_RETRY", "Scheduling context changed before recovery commit. Retry the operation.");
              }
              if (message.includes("WORKSPACE_SELECTION_MISMATCH")) {
                return blocked("WORKSPACE_SELECTION_MISMATCH", "The selected workspace is not the legacy active membership context. Full multi-workspace writes arrive in T22/T23.");
              }
              if (message.includes("RECOVERY_") || message.includes("LOCKED_") || message.includes("DRAFT_STATUS_")) {
                return blocked("RECOVERY_TRANSACTION_REJECTED", message);
              }
              throw result.error;
            }

            const mutation = result.data as Record<string, unknown>;
            return NextResponse.json({
              status: operation === "REBASE" ? "REBASED" : "UNDONE",
              scheduleVersion: Number(mutation.scheduleVersion || 0),
              sourceScheduleVersion,
              mutation,
              validation: mutation.validation || null,
              irValidation: decision.irValidation,
              legacyValidation: decision.legacyValidation,
              draftStatus: decision.draftStatus,
              authoritativeConstraintModelVersion: token.constraintModelVersion,
            });
          } catch (error) {
            return NextResponse.json({
              error: error instanceof Error ? error.message : String(error),
              code: "RECOVERY_ERROR",
            }, { status: 500 });
          }
        }
    ''')

    write('supabase/migrations/20260907170000_authoritative_schedule_recovery_v48.sql', r'''
        -- T12 / V4.8 authoritative schedule recovery boundary.
        --
        -- REBASE and one-step UNDO treat historical/current assignments as source
        -- material only. The application server reconstructs one coherent current
        -- policy/planning/model snapshot, normalizes the source placements against
        -- current active facts and durations, evaluates the complete Constraint IR,
        -- then this service-role-only transaction proves the exact context and source
        -- still match before creating a new ScheduleVersion. Historical assignments
        -- are never rewritten. Legacy authenticated recovery remains a tracked T13
        -- bypass until grant retirement.

        create or replace function public.apply_authoritative_schedule_recovery_v48(
          p_operation text,
          p_studio_id uuid,
          p_actor_user_id uuid,
          p_source_schedule_id uuid,
          p_reason text,
          p_expected_context jsonb,
          p_candidate jsonb,
          p_application_validation jsonb,
          p_draft_status jsonb
        )
        returns jsonb
        language plpgsql
        security definer
        set search_path=''
        as $function$
        declare
          v_operation text:=upper(coalesce(p_operation,''));
          v_selected_role text;
          v_actor_context jsonb;
          v_actor_label text;
          v_current_context jsonb;
          v_current public.schedule_versions%rowtype;
          v_source public.schedule_versions%rowtype;
          v_candidate_count integer:=0;
          v_candidate_distinct_ids integer:=0;
          v_candidate_distinct_sessions integer:=0;
          v_source_active_count integer:=0;
          v_source_incompatible integer:=0;
          v_invalid integer:=0;
          v_locked_changed integer:=0;
          v_unresolved_lock integer:=0;
          v_new_id uuid;
          v_new_version integer;
          v_legacy_validation jsonb;
          v_validation jsonb;
          v_unscheduled integer:=0;
          v_unscheduled_ids jsonb:='[]'::jsonb;
          v_retired_ids jsonb:='[]'::jsonb;
          v_complete_expected boolean:=false;
          v_action text;
        begin
          if v_operation not in ('REBASE','UNDO') then raise exception 'Unsupported recovery operation: %',p_operation; end if;
          if p_studio_id is null then raise exception 'Studio is required'; end if;
          if p_actor_user_id is null then raise exception 'Actor is required'; end if;
          if p_source_schedule_id is null then raise exception 'Recovery source ScheduleVersion is required'; end if;
          if coalesce(btrim(p_reason),'')='' then raise exception 'Reason is required'; end if;
          if p_candidate is null or jsonb_typeof(p_candidate)<>'array' then raise exception 'Recovery candidate must be a JSON array'; end if;
          if p_application_validation is null or jsonb_typeof(p_application_validation)<>'object' then
            raise exception 'Authoritative application Constraint IR validation is required';
          end if;
          if p_draft_status is null or jsonb_typeof(p_draft_status)<>'object' then
            raise exception 'Authoritative recovery draft status is required';
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
             or coalesce(p_expected_context->>'rulebookVersion','')=''
             or coalesce(p_expected_context->>'enforcementVersion','')=''
             or coalesce(p_expected_context->>'planningDatasetVersion','')=''
             or coalesce(p_expected_context->>'constraintModelVersion','')=''
             or coalesce(p_expected_context->>'planningConfirmedForSchedulingAt','')='' then
            raise exception 'RECOVERY_CONTEXT_INVALID: exact current schedule/policy/planning/model context is required';
          end if;

          perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,0));
          perform pg_advisory_xact_lock(hashtextextended('planning-dataset:'||p_studio_id::text,0));
          perform pg_advisory_xact_lock(hashtextextended('constraint-model:'||p_studio_id::text,0));

          v_current_context:=private.build_solver_context_token_v43(p_studio_id);
          if v_current_context is distinct from p_expected_context then
            raise exception 'STALE_RECOVERY_CONTEXT: ScheduleVersion/locks/policy/planning/model context changed after server validation';
          end if;

          select * into v_current
          from public.schedule_versions sv
          where sv.id=(p_expected_context->>'scheduleId')::uuid
            and sv.studio_id=p_studio_id
            and sv.is_current;
          if v_current.id is null then raise exception 'STALE_RECOVERY_CONTEXT: pinned current ScheduleVersion is missing'; end if;

          if not exists(
            select 1 from public.constraint_model_versions cm
            where cm.studio_id=p_studio_id and cm.status='CURRENT'
              and cm.version=(p_expected_context->>'constraintModelVersion')::integer
              and cm.complete_hard_constraint_compilation=true
          ) then raise exception 'RECOVERY_CONSTRAINT_MODEL_NOT_CURRENT: pinned complete model is unavailable'; end if;

          if v_operation='REBASE' then
            if p_source_schedule_id is distinct from v_current.id then
              raise exception 'RECOVERY_REBASE_SOURCE_MISMATCH: REBASE source must be the pinned current ScheduleVersion';
            end if;
            v_source:=v_current;
          else
            select * into v_source
            from public.schedule_versions sv
            where sv.id=p_source_schedule_id and sv.studio_id=p_studio_id
              and sv.version=v_current.version-1 and sv.is_current=false;
            if v_source.id is null then
              raise exception 'RECOVERY_UNDO_SOURCE_NOT_PREVIOUS: UNDO may adopt only the immediately previous historical ScheduleVersion';
            end if;
          end if;

          select count(*)::integer into v_invalid
          from jsonb_array_elements(p_candidate) elem
          where jsonb_typeof(elem)<>'object'
             or not (elem ?& array['assignmentId','sessionId','day','startTime','endTime','teacherId','roomId','status'])
             or (elem - array['assignmentId','sessionId','day','startTime','endTime','teacherId','roomId','status'])<>'{}'::jsonb
             or jsonb_typeof(elem->'assignmentId')<>'string'
             or jsonb_typeof(elem->'sessionId')<>'string'
             or jsonb_typeof(elem->'day')<>'string'
             or jsonb_typeof(elem->'startTime')<>'string'
             or jsonb_typeof(elem->'endTime')<>'string'
             or jsonb_typeof(elem->'teacherId')<>'string'
             or jsonb_typeof(elem->'roomId')<>'string'
             or jsonb_typeof(elem->'status')<>'string'
             or btrim(elem->>'assignmentId')=''
             or btrim(elem->>'sessionId')=''
             or btrim(elem->>'teacherId')=''
             or btrim(elem->>'roomId')='';
          if v_invalid>0 then raise exception 'RECOVERY_CANDIDATE_INVALID: % row(s) have a non-canonical shape',v_invalid; end if;

          select count(*)::integer,count(distinct elem->>'assignmentId')::integer,count(distinct elem->>'sessionId')::integer
          into v_candidate_count,v_candidate_distinct_ids,v_candidate_distinct_sessions
          from jsonb_array_elements(p_candidate) elem;
          if v_candidate_count<>v_candidate_distinct_ids then raise exception 'RECOVERY_CANDIDATE_DUPLICATE_ASSIGNMENT_ID'; end if;
          if v_candidate_count<>v_candidate_distinct_sessions then raise exception 'RECOVERY_CANDIDATE_DUPLICATE_SESSION'; end if;

          -- Historical sessions/classes are retired source material and are not
          -- reintroduced. A REBASE also retires current placements whose resource
          -- was archived, leaving the still-active session visibly unscheduled.
          -- UNDO fails instead when an otherwise-active historical placement uses
          -- an inactive resource, because silently skipping it would misrepresent
          -- what was restored.
          select count(*)::integer into v_source_incompatible
          from public.assignments a
          join public.class_sessions s on s.studio_id=p_studio_id and s.id=a.session_id and s.archived_at is null
          join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
          left join public.teachers t on t.studio_id=p_studio_id and t.id=a.teacher_id and t.archived_at is null
          left join public.rooms r on r.studio_id=p_studio_id and r.id=a.room_id and r.archived_at is null
          where a.schedule_version_id=v_source.id and (t.id is null or r.id is null);
          if v_operation='UNDO' and v_source_incompatible>0 then
            raise exception 'RECOVERY_SOURCE_RESOURCE_INACTIVE: % historical active-session placement(s) use an archived/unknown teacher or room',v_source_incompatible;
          end if;

          select count(*)::integer into v_source_active_count
          from public.assignments a
          join public.class_sessions s on s.studio_id=p_studio_id and s.id=a.session_id and s.archived_at is null
          join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
          join public.teachers t on t.studio_id=p_studio_id and t.id=a.teacher_id and t.archived_at is null
          join public.rooms r on r.studio_id=p_studio_id and r.id=a.room_id and r.archived_at is null
          where a.schedule_version_id=v_source.id;
          if v_candidate_count<>v_source_active_count then
            raise exception 'RECOVERY_SOURCE_CANDIDATE_MISMATCH: expected % recoverable source placement(s), received %',v_source_active_count,v_candidate_count;
          end if;

          if exists(
            select 1
            from public.assignments a
            join public.class_sessions s on s.studio_id=p_studio_id and s.id=a.session_id and s.archived_at is null
            join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
            join public.teachers t on t.studio_id=p_studio_id and t.id=a.teacher_id and t.archived_at is null
            join public.rooms r on r.studio_id=p_studio_id and r.id=a.room_id and r.archived_at is null
            where a.schedule_version_id=v_source.id
            group by a.session_id having count(*)>1
          ) then raise exception 'RECOVERY_SOURCE_DUPLICATE_SESSION'; end if;

          select count(*)::integer into v_invalid
          from jsonb_array_elements(p_candidate) elem
          left join public.assignments src
            on src.schedule_version_id=v_source.id
           and src.id=elem->>'assignmentId'
           and src.session_id=elem->>'sessionId'
          left join public.class_sessions s
            on s.studio_id=p_studio_id and s.id=elem->>'sessionId' and s.archived_at is null
          left join public.class_definitions c
            on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
          left join public.teachers t
            on t.studio_id=p_studio_id and t.id=elem->>'teacherId' and t.archived_at is null
          left join public.rooms r
            on r.studio_id=p_studio_id and r.id=elem->>'roomId' and r.archived_at is null
          where src.id is null or s.id is null or c.id is null or t.id is null or r.id is null
             or elem->>'day' not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
             or elem->>'startTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             or elem->>'endTime' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
             or elem->>'status' not in ('NORMAL','WARNING','AI_PROPOSED')
             or elem->>'day' is distinct from src.day
             or (elem->>'startTime')::time is distinct from src.start_time
             or elem->>'teacherId' is distinct from src.teacher_id
             or elem->>'roomId' is distinct from src.room_id
             or elem->>'status' is distinct from src.status
             or mod(extract(minute from (elem->>'startTime')::time)::integer,15)<>0
             or (elem->>'endTime')::time <= (elem->>'startTime')::time
             or (elem->>'endTime')::time is distinct from
                ((elem->>'startTime')::time + make_interval(mins=>coalesce(s.duration_minutes,c.duration_minutes)));
          if v_invalid>0 then
            raise exception 'RECOVERY_CANDIDATE_INVALID: % row(s) differ from recoverable source placement/current duration or fail active canonical validation',v_invalid;
          end if;

          select coalesce(jsonb_agg(a.id order by a.id),'[]'::jsonb) into v_retired_ids
          from public.assignments a
          left join public.class_sessions s on s.studio_id=p_studio_id and s.id=a.session_id and s.archived_at is null
          left join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
          left join public.teachers t on t.studio_id=p_studio_id and t.id=a.teacher_id and t.archived_at is null
          left join public.rooms r on r.studio_id=p_studio_id and r.id=a.room_id and r.archived_at is null
          where a.schedule_version_id=v_source.id
            and (s.id is null or c.id is null or (v_operation='REBASE' and (t.id is null or r.id is null)));

          -- Same effective runtime lock precedence as T09: active session lock OR
          -- current assignment lock. Recovery cannot remove or relocate either.
          select count(*)::integer into v_unresolved_lock
          from public.class_sessions s
          join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
          left join public.assignments current_a on current_a.schedule_version_id=v_current.id and current_a.session_id=s.id
          where s.studio_id=p_studio_id and s.archived_at is null and s.locked=true and current_a.id is null;
          if v_unresolved_lock>0 then
            raise exception 'LOCKED_SESSION_PLACEMENT_UNRESOLVED: % active locked session(s) have no current placement',v_unresolved_lock;
          end if;

          select count(*)::integer into v_locked_changed
          from public.class_sessions s
          join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
          join public.assignments current_a on current_a.schedule_version_id=v_current.id and current_a.session_id=s.id
          left join lateral (
            select elem from jsonb_array_elements(p_candidate) elem where elem->>'sessionId'=s.id limit 1
          ) candidate on true
          where s.studio_id=p_studio_id and s.archived_at is null
            and (s.locked=true or current_a.locked=true)
            and (
              candidate.elem is null
              or candidate.elem->>'day' is distinct from current_a.day
              or (candidate.elem->>'startTime')::time is distinct from current_a.start_time
              or candidate.elem->>'teacherId' is distinct from current_a.teacher_id
              or candidate.elem->>'roomId' is distinct from current_a.room_id
            );
          if v_locked_changed>0 then raise exception 'LOCKED_SESSION_PLACEMENT_CHANGED: % effective locked placement(s) changed',v_locked_changed; end if;

          select count(*)::integer,coalesce(jsonb_agg(s.id order by s.id),'[]'::jsonb)
          into v_unscheduled,v_unscheduled_ids
          from public.class_sessions s
          join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
          where s.studio_id=p_studio_id and s.archived_at is null
            and not exists(select 1 from jsonb_array_elements(p_candidate) elem where elem->>'sessionId'=s.id);

          if jsonb_typeof(coalesce(p_draft_status->'unscheduledSessionIds','[]'::jsonb))<>'array'
             or jsonb_typeof(coalesce(p_draft_status->'duplicateSessionIds','[]'::jsonb))<>'array'
             or jsonb_typeof(coalesce(p_draft_status->'unknownAssignmentSessionIds','[]'::jsonb))<>'array'
             or jsonb_typeof(coalesce(p_draft_status->'completenessObligationKeys','[]'::jsonb))<>'array'
             or jsonb_typeof(coalesce(p_draft_status->'retiredAssignmentIds','[]'::jsonb))<>'array' then
            raise exception 'DRAFT_STATUS_MISMATCH: recovery draft arrays are malformed';
          end if;
          if coalesce(p_draft_status->'unscheduledSessionIds','[]'::jsonb) is distinct from v_unscheduled_ids then
            raise exception 'DRAFT_STATUS_MISMATCH: unscheduled session identity differs from database reconstruction';
          end if;
          if coalesce(p_draft_status->'retiredAssignmentIds','[]'::jsonb) is distinct from v_retired_ids then
            raise exception 'DRAFT_STATUS_MISMATCH: retired source assignment identity differs from database reconstruction';
          end if;
          if jsonb_array_length(coalesce(p_draft_status->'duplicateSessionIds','[]'::jsonb))<>0
             or jsonb_array_length(coalesce(p_draft_status->'unknownAssignmentSessionIds','[]'::jsonb))<>0 then
            raise exception 'DRAFT_STATUS_MISMATCH: canonical recovery candidate cannot contain duplicate/unknown sessions';
          end if;
          v_complete_expected:=v_unscheduled=0
            and jsonb_array_length(coalesce(p_draft_status->'completenessObligationKeys','[]'::jsonb))=0;
          if coalesce((p_draft_status->>'scheduleComplete')::boolean,false) is distinct from v_complete_expected then
            raise exception 'DRAFT_STATUS_MISMATCH: scheduleComplete does not match active-session/completeness reconstruction';
          end if;
          if coalesce((p_draft_status->>'publishable')::boolean,false)
             and not coalesce((p_draft_status->>'scheduleComplete')::boolean,false) then
            raise exception 'DRAFT_STATUS_MISMATCH: publishable recovery must be complete';
          end if;

          select coalesce(max(version),0)+1 into v_new_version from public.schedule_versions where studio_id=p_studio_id;
          insert into public.schedule_versions(
            studio_id,version,rulebook_version,enforcement_version,planning_dataset_version,constraint_model_version,
            actor_user_id,actor_label,reason,is_current
          ) values(
            p_studio_id,v_new_version,(p_expected_context->>'rulebookVersion')::integer,
            (p_expected_context->>'enforcementVersion')::integer,(p_expected_context->>'planningDatasetVersion')::integer,
            (p_expected_context->>'constraintModelVersion')::integer,p_actor_user_id,v_actor_label,p_reason,false
          ) returning id into v_new_id;

          insert into public.assignments(
            schedule_version_id,id,studio_id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status
          )
          select
            v_new_id,elem->>'assignmentId',p_studio_id,elem->>'sessionId',elem->>'day',
            (elem->>'startTime')::time,(elem->>'endTime')::time,elem->>'teacherId',elem->>'roomId',
            (s.locked or coalesce(current_a.locked,false)),elem->>'status'
          from jsonb_array_elements(p_candidate) elem
          join public.class_sessions s on s.studio_id=p_studio_id and s.id=elem->>'sessionId' and s.archived_at is null
          join public.class_definitions c on c.studio_id=p_studio_id and c.id=s.class_id and c.archived_at is null
          join public.teachers t on t.studio_id=p_studio_id and t.id=elem->>'teacherId' and t.archived_at is null
          join public.rooms r on r.studio_id=p_studio_id and r.id=elem->>'roomId' and r.archived_at is null
          left join public.assignments current_a on current_a.schedule_version_id=v_current.id and current_a.session_id=s.id;

          select public.validate_schedule_hard_v25(v_new_id) into v_legacy_validation;
          if coalesce((p_draft_status->>'publishable')::boolean,false)
             and (
               coalesce((p_application_validation->>'valid')::boolean,false) is not true
               or coalesce((p_application_validation->>'hardViolations')::integer,0)<>0
               or coalesce((v_legacy_validation->>'valid')::boolean,false) is not true
               or coalesce((v_legacy_validation->>'fullyValidated')::boolean,false) is not true
             ) then
            raise exception 'RECOVERY_PUBLISHABILITY_MISMATCH: publishable recovery is not independently/legacy valid';
          end if;

          v_validation:=coalesce(v_legacy_validation,'{}'::jsonb) || jsonb_build_object(
            'unscheduledSessions',v_unscheduled,
            'scheduleComplete',coalesce((p_draft_status->>'scheduleComplete')::boolean,false),
            'publishable',coalesce((p_draft_status->>'publishable')::boolean,false),
            'authoritativeConstraintIr',p_application_validation,
            'draftStatus',p_draft_status,
            'recoveryOperation',v_operation,
            'recoverySourceScheduleVersion',v_source.version
          );

          update public.schedule_versions set is_current=false where id=v_current.id;
          update public.schedule_versions set is_current=true,validation_result=v_validation where id=v_new_id;

          v_action:=case when v_operation='REBASE' then 'SCHEDULE_REBASE' else 'SCHEDULE_UNDO' end;
          insert into public.audit_events(studio_id,actor_user_id,actor_label,action,entity_type,entity_id,detail,payload)
          values(p_studio_id,p_actor_user_id,v_actor_label,v_action,'SCHEDULE_VERSION',v_new_id::text,p_reason,
            jsonb_build_object(
              'operation',v_operation,'scheduleVersion',v_new_version,'previousScheduleVersion',v_current.version,
              'sourceScheduleId',v_source.id,'sourceScheduleVersion',v_source.version,
              'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
              'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
              'planningDatasetVersion',(p_expected_context->>'planningDatasetVersion')::integer,
              'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
              'authority','SERVER_CONSTRAINT_IR_V48','authoritativeConstraintIr',true,
              'expectedSolverContext',p_expected_context,'applicationConstraintIrValidation',p_application_validation,
              'draftStatus',p_draft_status,'retiredAssignmentIds',v_retired_ids,'legacyValidation',v_legacy_validation,
              'legacyWriteBypassRetirementTask','T13'
            ));

          return jsonb_build_object(
            'operation',v_operation,'scheduleId',v_new_id,'scheduleVersion',v_new_version,
            'previousScheduleVersion',v_current.version,'sourceScheduleId',v_source.id,'sourceScheduleVersion',v_source.version,
            'rulebookVersion',(p_expected_context->>'rulebookVersion')::integer,
            'enforcementVersion',(p_expected_context->>'enforcementVersion')::integer,
            'planningDatasetVersion',(p_expected_context->>'planningDatasetVersion')::integer,
            'constraintModelVersion',(p_expected_context->>'constraintModelVersion')::integer,
            'validation',v_validation,'unscheduledSessions',v_unscheduled,'retiredAssignmentIds',v_retired_ids,
            'authority','SERVER_CONSTRAINT_IR_V48','authoritativeConstraintIr',true
          );
        end
        $function$;

        revoke all on function public.apply_authoritative_schedule_recovery_v48(
          text,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb
        ) from public,anon,authenticated;
        grant execute on function public.apply_authoritative_schedule_recovery_v48(
          text,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb
        ) to service_role;
    ''')

    write('tests/schedule-recovery.test.ts', r'''
        import { describe, expect, it } from "vitest";
        import type { Assignment, StudioState } from "@/lib/domain";
        import type { ConstraintIRNode, ConstraintModelSnapshotV1 } from "@/lib/constraint-ir";
        import { evaluateAuthoritativeScheduleRecovery } from "@/lib/schedule-recovery";

        const now = "2026-09-07T00:00:00Z";
        const node = (value: Partial<ConstraintIRNode> & Pick<ConstraintIRNode, "id" | "kind">): ConstraintIRNode => ({
          id: value.id, kind: value.kind, ruleIds: value.ruleIds ?? [value.id], selector: value.selector ?? {}, parameters: value.parameters ?? {}, explanation: value.explanation ?? value.id,
        });

        function state(current: Assignment[], durationMinutes = 90): StudioState {
          return {
            studioId: "studio", studioName: "Fixture",
            teachers: [{ id: "t1", name: "Teacher", subjects: ["Ballet"] }],
            rooms: [{ id: "r1", name: "Room", capacity: 99, features: [] }],
            students: [], cohorts: [],
            classes: [{ id: "c1", name: "Ballet 5", subject: "Ballet", level: "5", durationMinutes, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: ["t1"] }],
            sessions: [{ id: "s1", classId: "c1", ordinal: 1 }],
            rules: [], rulebookVersions: [{ id: "rb", version: 1, name: "Fixture", createdAt: now, actor: "test", reason: "test", changedRuleIds: [], status: "CURRENT" }],
            enforcementVersions: [], planningDatasetVersions: [], enforcementProposals: [], ruleHistory: [],
            scheduleVersions: [{ id: "current", version: 4, rulebookVersion: 1, enforcementVersion: 1, planningDatasetVersion: 2, createdAt: now, actor: "test", reason: "test", assignments: current, isCurrent: true }],
            scenarios: [], auditEvents: [],
          };
        }

        function model(extra: ConstraintIRNode[] = []): ConstraintModelSnapshotV1 {
          return {
            schemaVersion: "1.0", compilerVersion: "t12-test", rulebookVersion: 1, planningDatasetVersion: 2, activeRuleCount: extra.length,
            hardConstraints: extra, objectivePrioritySpine: [], readinessRuleIds: [], governanceAssertions: [], uncompiledConstraintRuleIds: [], completeHardConstraintCompilation: true,
          };
        }

        const source: Assignment = { id: "a1", sessionId: "s1", day: "Monday", startTime: "17:15", endTime: "18:45", teacherId: "t1", roomId: "r1", locked: false, status: "NORMAL" };

        describe("T12 authoritative recovery", () => {
          it("normalizes historical end time from the current session duration without mutating the source", () => {
            const historical = { ...source, endTime: "18:15" };
            const decision = evaluateAuthoritativeScheduleRecovery(state([source], 105), [historical], "UNDO", model());
            expect(decision.accepted).toBe(true);
            expect(decision.candidateAssignments[0].endTime).toBe("19:00");
            expect(historical.endTime).toBe("18:15");
            expect(decision.draftStatus.scheduleComplete).toBe(true);
          });

          it("REBASE retires an assignment whose active session no longer has an active resource and leaves a visible draft gap", () => {
            const s = state([source]);
            s.teachers = [];
            const decision = evaluateAuthoritativeScheduleRecovery(s, [source], "REBASE", model());
            expect(decision.accepted).toBe(true);
            expect(decision.candidateAssignments).toEqual([]);
            expect(decision.draftStatus.retiredAssignmentIds).toEqual(["a1"]);
            expect(decision.draftStatus.unscheduledSessionIds).toEqual(["s1"]);
            expect(decision.draftStatus.publishable).toBe(false);
          });

          it("UNDO fails clearly instead of silently skipping an active-session placement whose resource is inactive", () => {
            const s = state([source]);
            s.rooms = [];
            const decision = evaluateAuthoritativeScheduleRecovery(s, [source], "UNDO", model());
            expect(decision.accepted).toBe(false);
            expect(decision.blocker?.code).toBe("RECOVERY_SOURCE_RESOURCE_INACTIVE");
          });

          it("rejects a historical placement that violates current policy", () => {
            const fixed = node({ id: "fixed", kind: "FIXED_ASSIGNMENT", selector: { classNames: ["Ballet 5"] }, parameters: { day: "Tuesday", start: "17:15", end: "18:45" } });
            const decision = evaluateAuthoritativeScheduleRecovery(state([source]), [source], "UNDO", model([fixed]));
            expect(decision.accepted).toBe(false);
            expect(decision.blocker?.code).toBe("RECOVERY_CURRENT_POLICY_REJECTED");
          });

          it("does not let one-step undo remove or relocate an effective current lock", () => {
            const locked = { ...source, locked: true };
            const old = { ...source, day: "Tuesday" as const };
            const decision = evaluateAuthoritativeScheduleRecovery(state([locked]), [old], "UNDO", model());
            expect(decision.accepted).toBe(false);
            expect(decision.blocker?.code).toBe("LOCKED_SESSION_PLACEMENT_CHANGED");
          });

          it("treats an archived source session as historical provenance rather than active schedule truth", () => {
            const s = state([]);
            s.sessions = [];
            s.classes = [];
            const decision = evaluateAuthoritativeScheduleRecovery(s, [source], "REBASE", model());
            expect(decision.accepted).toBe(true);
            expect(decision.candidateAssignments).toEqual([]);
            expect(decision.draftStatus.retiredAssignmentIds).toEqual(["a1"]);
            expect(decision.draftStatus.scheduleComplete).toBe(true);
          });
        });
    ''')

    write('tests/recovery-route-contract.test.ts', r'''
        import { readFileSync } from "node:fs";
        import { describe, expect, it } from "vitest";

        const route = readFileSync("app/api/schedule/recovery/route.ts", "utf8");
        const provider = readFileSync("components/workspace-provider.tsx", "utf8");
        const controls = readFileSync("components/schedule/schedule-edit-controls.tsx", "utf8");

        describe("T12 recovery route contract", () => {
          it("reconstructs coherent current authority and rechecks the exact token before persistence", () => {
            expect(route).toContain("loadCanonicalSolverSnapshot");
            expect(route).toContain("compileConstraintModel(snapshot.state)");
            expect(route).toContain("constraintModelDefinitionsMatch");
            expect(route).toContain("loadCurrentSolverContextToken");
            expect(route).toContain("solverSnapshotContextTokensMatch");
          });

          it("treats immediate previous history as source while evaluating under the current model", () => {
            expect(route).toContain("currentVersion - 1");
            expect(route).toContain("evaluateAuthoritativeScheduleRecovery(snapshot.state, sourceAssignments, operation, model)");
            expect(route).toContain("sourceScheduleVersion");
          });

          it("commits only through the service-role V4.8 transaction", () => {
            expect(route).toContain("getServerAdminSupabase");
            expect(route).toContain('admin.rpc("apply_authoritative_schedule_recovery_v48"');
          });

          it("removes active browser calls to legacy rebase/undo RPCs", () => {
            expect(provider).not.toContain('rpc("rebase_current_schedule_v25"');
            expect(controls).not.toContain('rpc("undo_last_schedule_change_v25"');
            expect(provider).toContain('fetch("/api/schedule/recovery"');
            expect(controls).toContain("undoSchedule");
          });
        });
    ''')

    write('tests/recovery-migration.test.ts', r'''
        import { readFileSync } from "node:fs";
        import { describe, expect, it } from "vitest";

        const sql = readFileSync("supabase/migrations/20260907170000_authoritative_schedule_recovery_v48.sql", "utf8");

        describe("T12 V4.8 recovery migration", () => {
          it("is service-role-only and exact-context bound", () => {
            expect(sql).toContain("STALE_RECOVERY_CONTEXT");
            expect(sql).toContain("private.build_solver_context_token_v43");
            expect(sql).toMatch(/revoke all on function public\.apply_authoritative_schedule_recovery_v48[\s\S]*authenticated/);
            expect(sql).toMatch(/grant execute on function public\.apply_authoritative_schedule_recovery_v48[\s\S]*to service_role/);
          });

          it("limits UNDO to the immediately previous historical ScheduleVersion", () => {
            expect(sql).toContain("sv.version=v_current.version-1");
            expect(sql).toContain("RECOVERY_UNDO_SOURCE_NOT_PREVIOUS");
          });

          it("derives candidate interval validity from current active session/class duration", () => {
            expect(sql).toContain("coalesce(s.duration_minutes,c.duration_minutes)");
            expect(sql).toContain("RECOVERY_CANDIDATE_INVALID");
          });

          it("preserves effective locks and creates a new version instead of rewriting historical assignments", () => {
            expect(sql).toContain("LOCKED_SESSION_PLACEMENT_CHANGED");
            expect(sql).toContain("select coalesce(max(version),0)+1 into v_new_version");
            expect(sql).toContain("insert into public.schedule_versions");
            expect(sql).not.toMatch(/delete\s+from\s+public\.assignments/i);
            expect(sql).not.toMatch(/update\s+public\.assignments\s+set/i);
          });
        });
    ''')

    # WorkspaceProvider: route active recovery through the authenticated server.
    replace_once(
        'components/workspace-provider.tsx',
        '  rebaseSchedule: () => Promise<MutationResult>;\n',
        '  rebaseSchedule: () => Promise<MutationResult>;\n  undoSchedule: () => Promise<MutationResult>;\n',
    )
    old_rebase = '''  async function rebaseSchedule(): Promise<MutationResult> {\n    if (!canEdit) return { ok: false, error: "Editor access is required." };\n    try {\n      const { data, error: rpcError } = await getBrowserSupabase().rpc("rebase_current_schedule_v25", {\n        p_expected_schedule_version: currentScheduleVersion,\n        p_expected_rulebook_version: currentRulebookVersion,\n        p_expected_enforcement_version: currentEnforcementVersion,\n        p_expected_planning_dataset_version: currentPlanningDatasetVersion,\n        p_reason: `Revalidate unchanged assignments against Rulebook v${currentRulebookVersion} / Enforcement v${currentEnforcementVersion} / Planning Dataset v${currentPlanningDatasetVersion}`,\n      });\n      if (rpcError) throw rpcError;\n      const details = object(data); await load();\n      return { ok: true, version: Number(details.scheduleVersion || 0), validation: details.validation as unknown as ValidationResult, details };\n    } catch (caught) { return fail(caught); }\n  }\n'''
    new_rebase = '''  async function runScheduleRecovery(operation: "REBASE" | "UNDO"): Promise<MutationResult> {\n    if (!canEdit) return { ok: false, error: "Editor access is required." };\n    if (!state || !session) return { ok: false, error: "An authenticated workspace is required." };\n    try {\n      const response = await fetch("/api/schedule/recovery", {\n        method: "POST",\n        headers: {\n          Authorization: `Bearer ${session.access_token}`,\n          "Content-Type": "application/json",\n        },\n        body: JSON.stringify({\n          studioId: state.studioId,\n          operation,\n          reason: operation === "REBASE"\n            ? `Revalidate Schedule v${currentScheduleVersion} against the current scheduling context`\n            : `Undo Schedule v${currentScheduleVersion} under the current scheduling context`,\n        }),\n      });\n      const payload = await response.json() as Record<string, unknown>;\n      if (!response.ok) {\n        return {\n          ok: false,\n          error: String(payload.error || "The authoritative recovery gate rejected this operation."),\n          validation: (payload.legacyValidation || payload.validation) as ValidationResult | undefined,\n          details: payload,\n        };\n      }\n      await load();\n      return {\n        ok: true,\n        version: Number(payload.scheduleVersion || 0),\n        validation: payload.validation as ValidationResult | undefined,\n        details: payload,\n      };\n    } catch (caught) { return fail(caught); }\n  }\n\n  async function rebaseSchedule(): Promise<MutationResult> {\n    return runScheduleRecovery("REBASE");\n  }\n\n  async function undoSchedule(): Promise<MutationResult> {\n    return runScheduleRecovery("UNDO");\n  }\n'''
    replace_once('components/workspace-provider.tsx', old_rebase, new_rebase)
    replace_once(
        'components/workspace-provider.tsx',
        '    refresh:()=>load(),signInWithEmail,signOut,applyRulePatch,applySchedulePatch,rebaseSchedule,proposeEnforcementMapping,reviewEnforcementProposal,exportPackage,\n',
        '    refresh:()=>load(),signInWithEmail,signOut,applyRulePatch,applySchedulePatch,rebaseSchedule,undoSchedule,proposeEnforcementMapping,reviewEnforcementProposal,exportPackage,\n',
    )

    # Undo UI is now a thin caller; server determines compatibility.
    controls = (ROOT / 'components/schedule/schedule-edit-controls.tsx').read_text(encoding='utf-8')
    controls = controls.replace('import { getBrowserSupabase } from "@/lib/supabase";\n', '')
    controls = re.sub(r'\nfunction messageOf\(error: unknown\) \{.*?\n\}\n', '\n', controls, count=1, flags=re.S)
    old_destructure = '''    state,\n    canEdit,\n    currentScheduleVersion,\n    currentRulebookVersion,\n    currentEnforcementVersion,\n    currentPlanningDatasetVersion,\n    scheduleIsStale,\n    refresh,\n'''
    new_destructure = '''    state,\n    canEdit,\n    currentScheduleVersion,\n    undoSchedule,\n'''
    if controls.count(old_destructure) != 1:
        raise SystemExit('schedule-edit-controls: destructure marker mismatch')
    controls = controls.replace(old_destructure, new_destructure, 1)
    old_can = '''  const canUndo = Boolean(\n    canEdit\n    && !scheduleIsStale\n    && previous\n    && previous.rulebookVersion === currentRulebookVersion\n    && previous.enforcementVersion === currentEnforcementVersion\n    && previous.planningDatasetVersion === currentPlanningDatasetVersion,\n  );\n'''
    if controls.count(old_can) != 1:
        raise SystemExit('schedule-edit-controls: canUndo marker mismatch')
    controls = controls.replace(old_can, '  const canUndo = Boolean(canEdit && previous);\n', 1)
    old_undo = '''    const { data, error } = await getBrowserSupabase().rpc("undo_last_schedule_change_v25", {\n      p_expected_schedule_version: currentScheduleVersion,\n      p_expected_rulebook_version: currentRulebookVersion,\n      p_expected_enforcement_version: currentEnforcementVersion,\n      p_expected_planning_dataset_version: currentPlanningDatasetVersion,\n      p_reason: `Undo Schedule v${currentScheduleVersion}`,\n    });\n    setUndoing(false);\n    if (error) {\n      setNotice(`Undo unavailable: ${messageOf(error)}`);\n      return;\n    }\n    const result = (data || {}) as Record<string, unknown>;\n    setNotice(`Restored the previous schedule as Schedule v${Number(result.scheduleVersion || currentScheduleVersion + 1)}.`);\n    await refresh();\n'''
    new_undo = '''    const result = await undoSchedule();\n    setUndoing(false);\n    if (!result.ok) {\n      setNotice(`Undo unavailable: ${result.error || "current policy rejected the previous placements."}`);\n      return;\n    }\n    setNotice(`Restored the previous placements under current policy as Schedule v${result.version || currentScheduleVersion + 1}.`);\n'''
    if controls.count(old_undo) != 1:
        raise SystemExit('schedule-edit-controls: undo body marker mismatch')
    controls = controls.replace(old_undo, new_undo, 1)
    controls = controls.replace('title={canUndo ? `Restore Schedule v${currentScheduleVersion - 1} as a new version` : "Nothing compatible to undo under the current scheduling context"}', 'title={canUndo ? `Re-evaluate Schedule v${currentScheduleVersion - 1} placements under current policy and save them as a new version` : "No immediately previous ScheduleVersion is available"}', 1)
    (ROOT / 'components/schedule/schedule-edit-controls.tsx').write_text(controls, encoding='utf-8', newline='\n')

    # Add executed V4.8 recovery lifecycle to the disposable PostgreSQL harness.
    db_path = ROOT / 'scripts/test-db.mjs'
    db = db_path.read_text(encoding='utf-8')
    marker = '\nexport async function main(argv = process.argv.slice(2)) {'
    if db.count(marker) != 1:
        raise SystemExit('scripts/test-db.mjs: main marker mismatch')
    t12_sql = r'''

const authoritativeRecoverySql = String.raw`
set search_path=public,extensions;

create or replace function public.t12_test_solver_context(p_studio uuid)
returns jsonb language sql stable security definer set search_path=''
as $function$ select private.build_solver_context_token_v43(p_studio) $function$;
revoke all on function public.t12_test_solver_context(uuid) from public,anon,authenticated;
grant execute on function public.t12_test_solver_context(uuid) to service_role;

-- Archive the class through the governed inventory path. The current ScheduleVersion
-- remains historical evidence with its assignment, while the current Planning Dataset
-- now excludes the class/session and deliberately makes that schedule context stale.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.set_planning_entity_archive_v40(
  'CLASS','t04-class',true,'T12 archive-before-rebase',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
select public.confirm_current_planning_dataset_v39(
  version,snapshot_hash,'T12 confirmed archive recovery input',
  '{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
reset role;

set role service_role;
do $block$
declare
  v_studio uuid:='11111111-1111-4111-8111-111111111111';
  v_owner uuid:='10000000-0000-4000-8000-000000000001';
  v_context jsonb;
  v_result jsonb;
  v_source uuid;
  v_before_count integer;
  v_rejected boolean:=false;
begin
  v_context:=public.t12_test_solver_context(v_studio);
  v_source:=(v_context->>'scheduleId')::uuid;
  if (v_context->>'schedulePlanningDatasetVersion')=(v_context->>'planningDatasetVersion') then
    raise exception 'T12 fixture expected archive to make the source schedule planning link stale';
  end if;
  if not exists(select 1 from public.assignments where schedule_version_id=v_source and id='t11-assignment') then
    raise exception 'T12 historical source assignment missing before rebase';
  end if;
  v_result:=public.apply_authoritative_schedule_recovery_v48(
    'REBASE',v_studio,v_owner,v_source,'T12 archive-aware rebase',v_context,'[]'::jsonb,
    '{"valid":true,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
    '{"mode":"REBASE","scheduleComplete":true,"publishable":true,"unscheduledSessionIds":[],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[],"retiredAssignmentIds":["t11-assignment"]}'::jsonb
  );
  if exists(select 1 from public.assignments where schedule_version_id=(v_result->>'scheduleId')::uuid) then
    raise exception 'T12 archive-aware rebase reintroduced a retired assignment';
  end if;
  if not exists(select 1 from public.assignments where schedule_version_id=v_source and id='t11-assignment') then
    raise exception 'T12 rebase rewrote historical assignments';
  end if;
  if not exists(
    select 1 from public.schedule_versions sv where sv.id=(v_result->>'scheduleId')::uuid and sv.is_current
      and sv.rulebook_version=(v_context->>'rulebookVersion')::integer
      and sv.enforcement_version=(v_context->>'enforcementVersion')::integer
      and sv.planning_dataset_version=(v_context->>'planningDatasetVersion')::integer
      and sv.constraint_model_version=(v_context->>'constraintModelVersion')::integer
  ) then raise exception 'T12 rebase did not preserve all four current authority links'; end if;
  if not exists(
    select 1 from public.audit_events e where e.studio_id=v_studio and e.action='SCHEDULE_REBASE'
      and e.entity_id=(v_result->>'scheduleId') and e.payload->>'authority'='SERVER_CONSTRAINT_IR_V48'
  ) then raise exception 'T12 rebase audit evidence missing'; end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_schedule_recovery_v48(
      'REBASE',v_studio,v_owner,v_source,'T12 stale rebase replay',v_context,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb
    );
  exception when others then
    if position('STALE_RECOVERY_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T12 stale rebase replay unexpectedly succeeded'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_before_count then
    raise exception 'T12 stale rebase replay persisted a ScheduleVersion';
  end if;
end
$block$;
reset role;

-- Restore the archived class/session, then change the current per-session duration.
-- The old T11 historical assignment remains 90 minutes; T12 UNDO must normalize it
-- to the new 105-minute current planning fact before adoption.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.set_planning_entity_archive_v40(
  'CLASS','t04-class',false,'T12 restore-before-undo',
  (select version from public.planning_dataset_versions where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT')
);
reset role;
update public.class_sessions set duration_minutes=105
where studio_id='11111111-1111-4111-8111-111111111111' and id='t04-session';
select private.ensure_planning_dataset_version_v25(
  '11111111-1111-4111-8111-111111111111',null,'T12 duration recovery fixture','Change active session duration to 105 minutes before undo'
);
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.confirm_current_planning_dataset_v39(
  version,snapshot_hash,'T12 confirmed restored 105-minute duration',
  '{"peopleInventoryReviewed":true,"classSessionCatalogReviewed":true,"classRostersReviewed":true,"sourceAndCompletenessReviewed":true}'::jsonb
)
from public.planning_dataset_versions
where studio_id='11111111-1111-4111-8111-111111111111' and status='CURRENT';
reset role;

set role service_role;
do $block$
declare
  v_studio uuid:='11111111-1111-4111-8111-111111111111';
  v_owner uuid:='10000000-0000-4000-8000-000000000001';
  v_context jsonb;
  v_source uuid;
  v_result jsonb;
  v_before_count integer;
  v_rejected boolean:=false;
begin
  v_context:=public.t12_test_solver_context(v_studio);
  select id into v_source from public.schedule_versions
  where studio_id=v_studio and version=(v_context->>'scheduleVersion')::integer-1;
  if v_source is null then raise exception 'T12 immediate previous undo source missing'; end if;
  if not exists(select 1 from public.assignments where schedule_version_id=v_source and id='t11-assignment' and end_time='18:45'::time) then
    raise exception 'T12 expected immutable 90-minute historical source assignment';
  end if;

  v_result:=public.apply_authoritative_schedule_recovery_v48(
    'UNDO',v_studio,v_owner,v_source,'T12 current-policy undo with duration normalization',v_context,
    '[{"assignmentId":"t11-assignment","sessionId":"t04-session","day":"Monday","startTime":"17:15","endTime":"19:00","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}]'::jsonb,
    '{"valid":true,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
    '{"mode":"UNDO","scheduleComplete":true,"publishable":true,"unscheduledSessionIds":[],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[],"retiredAssignmentIds":[]}'::jsonb
  );
  if not exists(
    select 1 from public.assignments a where a.schedule_version_id=(v_result->>'scheduleId')::uuid
      and a.id='t11-assignment' and a.start_time='17:15'::time and a.end_time='19:00'::time
  ) then raise exception 'T12 undo did not persist current 105-minute canonical duration'; end if;
  if not exists(select 1 from public.assignments where schedule_version_id=v_source and id='t11-assignment' and end_time='18:45'::time) then
    raise exception 'T12 undo mutated historical assignment duration';
  end if;
  if not exists(
    select 1 from public.audit_events e where e.studio_id=v_studio and e.action='SCHEDULE_UNDO'
      and e.entity_id=(v_result->>'scheduleId') and e.payload->>'authority'='SERVER_CONSTRAINT_IR_V48'
  ) then raise exception 'T12 undo audit evidence missing'; end if;

  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  v_rejected:=false;
  begin
    perform public.apply_authoritative_schedule_recovery_v48(
      'UNDO',v_studio,v_owner,v_source,'T12 stale undo replay',v_context,
      '[{"assignmentId":"t11-assignment","sessionId":"t04-session","day":"Monday","startTime":"17:15","endTime":"19:00","teacherId":"t04-teacher","roomId":"t04-room","status":"NORMAL"}]'::jsonb,
      '{}'::jsonb,'{}'::jsonb
    );
  exception when others then
    if position('STALE_RECOVERY_CONTEXT' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T12 stale undo replay unexpectedly succeeded'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_before_count then
    raise exception 'T12 stale undo replay persisted a ScheduleVersion';
  end if;
end
$block$;
reset role;

-- A one-step undo may not remove the just-restored effective lock by reaching back
-- to the immediately previous empty version.
update public.assignments a set locked=true
from public.schedule_versions sv
where sv.id=a.schedule_version_id and sv.studio_id='11111111-1111-4111-8111-111111111111' and sv.is_current and a.id='t11-assignment';
set role service_role;
do $block$
declare
  v_studio uuid:='11111111-1111-4111-8111-111111111111';
  v_owner uuid:='10000000-0000-4000-8000-000000000001';
  v_context jsonb:=public.t12_test_solver_context(v_studio);
  v_source uuid;
  v_before_count integer;
  v_rejected boolean:=false;
begin
  select id into v_source from public.schedule_versions where studio_id=v_studio and version=(v_context->>'scheduleVersion')::integer-1;
  select count(*) into v_before_count from public.schedule_versions where studio_id=v_studio;
  begin
    perform public.apply_authoritative_schedule_recovery_v48(
      'UNDO',v_studio,v_owner,v_source,'T12 locked undo rejection',v_context,'[]'::jsonb,
      '{"valid":false,"hardViolations":0,"violations":[],"unsupportedConstraintIds":[]}'::jsonb,
      '{"mode":"UNDO","scheduleComplete":false,"publishable":false,"unscheduledSessionIds":["t04-session"],"duplicateSessionIds":[],"unknownAssignmentSessionIds":[],"completenessObligationKeys":[],"retiredAssignmentIds":[]}'::jsonb
    );
  exception when others then
    if position('LOCKED_SESSION_PLACEMENT_CHANGED' in sqlerrm)=0 then raise; end if;
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'T12 locked undo unexpectedly succeeded'; end if;
  if (select count(*) from public.schedule_versions where studio_id=v_studio)<>v_before_count then
    raise exception 'T12 locked undo persisted a ScheduleVersion';
  end if;
end
$block$;
reset role;
update public.assignments a set locked=false
from public.schedule_versions sv
where sv.id=a.schedule_version_id and sv.studio_id='11111111-1111-4111-8111-111111111111' and sv.is_current and a.id='t11-assignment';

drop function public.t12_test_solver_context(uuid);
select 'T12 PASS: archive-aware REBASE preserves history; current-policy UNDO normalizes duration; stale replay and effective-lock rollback reject atomically' as result;
`;
'''
    db = db.replace(marker, t12_sql + marker, 1)
    exec_marker = "    const incrementalOutput = psql(container, 'postgres', authoritativeIncrementalSql, 'T11 authoritative incremental ASSIGN/UNASSIGN integration tests');\n    process.stdout.write(incrementalOutput);\n"
    if db.count(exec_marker) != 1:
        raise SystemExit('scripts/test-db.mjs: T11 execution marker mismatch')
    db = db.replace(
        exec_marker,
        exec_marker + "    const recoveryOutput = psql(container, 'postgres', authoritativeRecoverySql, 'T12 authoritative rebase/undo recovery integration tests');\n    process.stdout.write(recoveryOutput);\n",
        1,
    )
    db_path.write_text(db, encoding='utf-8', newline='\n')


def finalize(impl_sha: str, run_id: str) -> None:
    # README navigation.
    readme = ROOT / 'plans/README.md'
    text = readme.read_text(encoding='utf-8')
    text = text.replace('- Current task: **T12 — rebase/undo canonical authority**.\n- Next task: T13 after T12 acceptance.\n', '- Current task: **T13 — close legacy write bypasses**.\n- Next task: T14 after T13 acceptance.\n', 1)
    old_progress = '- Implementation progress: T01 through T11 have verified DONE evidence. T11 moves ASSIGN/UNASSIGN off direct browser V2.5 writes and onto the coherent pinned server Constraint IR boundary plus service-role V4.7 transaction. Incremental legality now compares violation identity rather than aggregate HARD counts; CLASS_FREQUENCY and missing fixed/direct-after counterparts are explicit completeness obligations, so partial drafts remain editable but non-publishable. T12 is READY; T13 remains NOT_STARTED pending T12.\n'
    new_progress = '- Implementation progress: T01 through T12 have verified DONE evidence. T12 moves rebase/undo off direct browser V2.5 recovery RPCs and onto a coherent current-policy server Constraint IR boundary plus service-role V4.8 transaction. Historical placements are source material only: active identities/durations are normalized under current planning facts, retired assignments stay historical, incompatible restores fail, effective locks persist, and recovery always creates a new ScheduleVersion. T13 is READY.\n'
    if old_progress not in text:
        raise SystemExit('plans/README.md progress marker mismatch')
    text = text.replace(old_progress, new_progress, 1)
    text = text.replace('- T12: rebase/undo through canonical authority.\n', '- T13: revoke/delegate superseded canonical write entry points and prove direct legacy-call denial.\n', 1)
    readme.write_text(text, encoding='utf-8', newline='\n')

    tasks = ROOT / 'plans/TASKS.md'
    text = tasks.read_text(encoding='utf-8')
    text = text.replace('| [T12](#t12) | Rebase/undo canonical authority | READY | A | P0 | T10, T11 | M |', '| [T12](#t12) | Rebase/undo canonical authority | DONE | A | P0 | T10, T11 | M |', 1)
    text = text.replace('| [T13](#t13) | Close legacy write bypasses | NOT_STARTED | A | P0 | T10, T11, T12 | S |', '| [T13](#t13) | Close legacy write bypasses | READY | A | P0 | T10, T11, T12 | S |', 1)
    text = text.replace('| Status | READY |\n| Milestone | A |\n| Priority | P0 |\n| Dependencies | T10, T11 |', '| Status | DONE |\n| Milestone | A |\n| Priority | P0 |\n| Dependencies | T10, T11 |', 1)
    text = text.replace('- [ ] Undo, rebase, and revalidation use coherent context and the same deterministic scheduling semantics.\n- [ ] Recovery creates a new version and never rewrites historical assignments or facts.\n- [ ] Incompatible current-policy restores fail clearly; historical inspection remains possible.\n- [ ] Archive/duration changes and stale version tokens cannot corrupt recovered state.\n', '- [x] Undo, rebase, and revalidation use coherent context and the same deterministic scheduling semantics.\n- [x] Recovery creates a new version and never rewrites historical assignments or facts.\n- [x] Incompatible current-policy restores fail clearly; historical inspection remains possible.\n- [x] Archive/duration changes and stale version tokens cannot corrupt recovered state.\n', 1)
    old_evidence = '### Completion evidence\n\nNot yet verified. Record commit SHA, exact commands/exit codes, environment, regression cases, artifact links, manager acceptance where required, and remaining limitations. No implementation task was marked DONE during plan creation.\n\n### Notes/blockers\n\nDependencies T10 and T11 are verified DONE. T12 is READY and is now the first executable unfinished task.\n'
    evidence = f'''### Completion evidence\n\nTask/child: T12\n\nStarting HEAD: `3235a4f37d0b8750a672ec50888d09063e9b4258`.\n\nImplementation commit: `{impl_sha}`. GitHub Actions verification run: `{run_id}`.\n\nImplemented files: `lib/schedule-recovery.ts`, `app/api/schedule/recovery/route.ts`, `components/workspace-provider.tsx`, `components/schedule/schedule-edit-controls.tsx`, forward migration `supabase/migrations/20260907170000_authoritative_schedule_recovery_v48.sql`, `tests/schedule-recovery.test.ts`, `tests/recovery-route-contract.test.ts`, `tests/recovery-migration.test.ts`, and `scripts/test-db.mjs`. Historical V2.5 recovery migrations and production-ledger bytes were not edited.\n\nAcceptance evidence: REBASE and one-step UNDO now enter one authenticated explicit-studio server route. The route reconstructs the T07 coherent snapshot, requires a confirmed current PlanningDatasetVersion and complete current published ConstraintModelVersion, compiles and compares the current deterministic IR, treats current/immediately-previous assignments only as recovery source material, normalizes active placements to current session durations/resources, evaluates current IR plus the legacy safety floor, rechecks the exact context token, and commits only through service-role V4.8. REBASE may retire placements removed from active inventory into an explicit incomplete draft; UNDO fails clearly rather than silently skipping an otherwise-active placement whose teacher/room is no longer active. Effective session/assignment locks cannot be removed or relocated.\n\nV4.8 transaction evidence: exact coherent context is rechecked under schedule/planning/model advisory locks; UNDO is limited to `current.version - 1`; candidate rows must exactly correspond to recoverable source placements while end time matches the current effective duration; archived sessions/classes are excluded; current effective locks are preserved; all four authority links are written to a newly inserted ScheduleVersion; historical assignment rows are never updated/deleted; authoritative IR/draft status and recovery provenance are audited.\n\nDisposable PostgreSQL lifecycle: governed class archive + planning confirmation makes the old schedule stale; authoritative REBASE creates a new current version with the retired assignment excluded while the historical assignment remains queryable; stale replay creates no version. After class restore and a test-only current session-duration change from 90 to 105 minutes plus a new confirmed PlanningDatasetVersion, one-step UNDO re-adopts the immediate historical placement with a canonical 105-minute end while the old 90-minute row remains unchanged. Replaying the stale token and trying to undo away an effective current lock both reject atomically.\n\nVerification: GitHub Actions run `{run_id}` executed `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:db` on Ubuntu; Windows executed lint/typecheck/test/build with Docker DB integration intentionally Linux-only. All required gates passed before implementation/handoff commit. Lint retained only the two pre-existing warnings.\n\nRemaining limitation / T13 bypass register: historical authenticated `rebase_current_schedule_v25`, `undo_last_schedule_change_v25`, and other superseded write RPC grants remain callable until T13 revokes or safely delegates them. T12 removes the active browser callers but does not claim the canonical server authority is yet unavoidable.\n\nResulting task status: DONE. Newly READY task: T13.\n\n### Notes/blockers\n\nDependencies T10 and T11 are verified DONE. T12 is DONE. T13 is READY and is now the first executable unfinished task.\n'''
    # Only replace the T12 completion block, identified after the T12 anchor.
    anchor = text.index('<a id="t12"></a>')
    before, tail = text[:anchor], text[anchor:]
    if old_evidence not in tail:
        raise SystemExit('plans/TASKS.md T12 completion marker mismatch')
    tail = tail.replace(old_evidence, evidence, 1)
    # T13 notes should now reflect completed dependency.
    tail = tail.replace('Waiting for dependency acceptance: T10, T11, T12. This is normal sequencing, not a BLOCKED status.', 'Dependencies T10, T11, and T12 are verified DONE. T13 is READY and is the first executable unfinished task.', 1)
    tasks.write_text(before + tail, encoding='utf-8', newline='\n')

    release = ROOT / 'plans/DWDE_RELEASE_PLAN.md'
    text = release.read_text(encoding='utf-8')
    text = text.replace('| A06 | Every active required session appears once; archived sessions excluded; history preserved | T06, T11, T12 | T06 archive/restore and exact-session-set transaction tests plus T11 active-target incremental transaction tests are verified; gate remains open for T12 recovery authority |', '| A06 | Every active required session appears once; archived sessions excluded; history preserved | T06, T11, T12 | Verified: T06 archive/restore and exact-session-set transactions, T11 active-target incremental transactions, and T12 archive-aware recovery/history-preservation lifecycle. |', 1)
    text = text.replace('| A08 | MOVE/ASSIGN/UNASSIGN/rebase/undo/adoption/revalidation use shared scheduling semantics | T10–T13 | T10 MOVE and T11 ASSIGN/UNASSIGN server-authority matrices are verified; gate remains open for T12 recovery and T13 direct legacy-call denial |', '| A08 | MOVE/ASSIGN/UNASSIGN/rebase/undo/adoption/revalidation use shared scheduling semantics | T10–T13 | T10 MOVE, T11 ASSIGN/UNASSIGN, and T12 rebase/undo server-authority matrices are verified; gate remains open only for T13 direct legacy-call denial. |', 1)
    text = text.replace('| A09 | Partial editing remains possible; incomplete drafts cannot be published/adopted as complete | T10–T12 | T10/T11 verify movable/incremental partial drafts, explicit completeness obligations, and non-publishable status; gate remains open for T12 recovery/final-completeness behavior |', '| A09 | Partial editing remains possible; incomplete drafts cannot be published/adopted as complete | T10–T12 | Verified: T10/T11 command drafts plus T12 recovery drafts preserve explicit unscheduled/completeness obligations and cannot claim publishability unless complete and independently valid. |', 1)
    release.write_text(text, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == 'finalize':
        if len(sys.argv) != 4:
            raise SystemExit('usage: t12-apply.py finalize <implementation-sha> <run-id>')
        finalize(sys.argv[2], sys.argv[3])
    else:
        implement()

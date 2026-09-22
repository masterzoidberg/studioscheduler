"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type {
  Assignment,
  ClassDefinition,
  PlanningDatasetVersion,
  RuleEnforcementMapping,
  RuleEnforcementProposal,
  RuleEnforcementVersion,
  RuleHistoryEntry,
  RulePatch,
  RulebookVersion,
  ReadinessCertificationState,
  Room,
  Scenario,
  SchedulePatch,
  ScheduleVersion,
  StudioInvite,
  StudioMember,
  StudioRule,
  StudioRole,
  StudioState,
  Teacher,
  ValidationResult,
} from "@/lib/domain";
import { emptyValidation, validateSchedule } from "@/lib/validator";
import { getBrowserSupabase } from "@/lib/supabase";
import { applySetupTypedPolicies as applySetupTypedPoliciesClient } from "@/lib/setup-policy-client";
import type { SetupTypedPolicyMutationResult, SetupTypedPolicyPatch } from "@/lib/setup-policy";
import type { SolverSnapshotContextToken } from "@/lib/server-studio-state";
import { parseSolverCandidateReview, type SolverCandidateReview } from "@/lib/solver-candidate-review";
import { applyReviewedCsvImport as applyReviewedCsvImportClient } from "@/lib/reviewed-csv-import-client";
import type { ReviewedPlanningImportRow } from "@/lib/reviewed-csv-intake";

const SELECTED_STUDIO_STORAGE_KEY = "studio-scheduler.selected-studio-id";

type AvailableWorkspace = { id: string; name: string; role: StudioRole };
type CreateWorkspaceResult = { ok: boolean; message: string; requestId: string; studioId?: string };

type MutationResult = { ok: boolean; error?: string; validation?: ValidationResult; version?: number; details?: Record<string, unknown> };
type PlanningConfirmationResponse = { certification?: ReadinessCertificationState | null; error?: string };

interface WorkspaceContextValue {
  loading: boolean;
  error: string | null;
  session: Session | null;
  accessMode: "AUTHENTICATED" | "NONE";
  role: StudioRole | null;
  canEdit: boolean;
  isOwner: boolean;
  state: StudioState | null;
  availableWorkspaces: AvailableWorkspace[];
  selectedStudioId: string | null;
  switchStudio: (studioId: string) => Promise<void>;
  members: StudioMember[];
  invites: StudioInvite[];
  candidateReviews: SolverCandidateReview[];
  currentAssignments: Assignment[];
  currentRulebookVersion: number;
  currentEnforcementVersion: number;
  currentPlanningDatasetVersion: number;
  currentScheduleVersion: number;
  currentScheduleRulebookVersion: number;
  currentScheduleEnforcementVersion: number;
  currentSchedulePlanningDatasetVersion: number;
  solverContextToken: SolverSnapshotContextToken | null;
  scheduleIsStale: boolean;
  validation: ValidationResult;
  refresh: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
  createWorkspace: (name: string, slug: string, requestId?: string) => Promise<CreateWorkspaceResult>;
  applyRulePatch: (patch: RulePatch) => Promise<MutationResult>;
  applySetupTypedPolicies: (policies: SetupTypedPolicyPatch[], reason: string) => Promise<SetupTypedPolicyMutationResult>;
  applySchedulePatch: (patch: SchedulePatch) => Promise<MutationResult>;
  toggleSessionLock: (sessionId: string, locked: boolean, reason: string) => Promise<MutationResult>;
  previewScheduleRecovery: (operation: "REBASE" | "UNDO") => Promise<MutationResult>;
  rebaseSchedule: () => Promise<MutationResult>;
  undoSchedule: () => Promise<MutationResult>;
  proposeEnforcementMapping: (ruleId: string, mapping: RuleEnforcementMapping, rationale: string, source?: "USER" | "AI") => Promise<MutationResult>;
  reviewEnforcementProposal: (proposalId: string, decision: "APPROVE" | "REJECT", reason: string) => Promise<MutationResult>;
  applyReviewedCsvImport: (input: { batchId: string; rows: ReviewedPlanningImportRow[]; reason: string; sourceMetadata?: Record<string, unknown> }) => Promise<MutationResult>;
  exportPackage: () => Record<string, unknown> | null;
  updateTeacher: (teacher: Teacher, reason: string) => Promise<MutationResult>;
  updateRoom: (room: Room, reason: string) => Promise<MutationResult>;
  updateClass: (klass: ClassDefinition, reason: string) => Promise<MutationResult>;
  createScenario: (name: string, rulePatches?: RulePatch[], schedulePatches?: SchedulePatch[]) => Promise<MutationResult>;
  deleteSolverCandidateReview: (candidateId: string) => Promise<MutationResult>;
  inviteMember: (email: string, role: StudioRole) => Promise<MutationResult>;
  setMemberRole: (userId: string, role: StudioRole) => Promise<MutationResult>;
  removeMember: (userId: string) => Promise<MutationResult>;
  cancelInvite: (inviteId: string) => Promise<MutationResult>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const time = (value: string) => value.slice(0, 5);
const object = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const source = (value: unknown) => ({ type: "IMPORT", ...object(value) }) as StudioRule["source"];

function isSolverSnapshotContextToken(value: unknown, studioId: string): value is SolverSnapshotContextToken {
  const token = object(value);
  return token.schemaVersion === "1.0" && token.studioId === studioId;
}

function mapRule(row: Record<string, unknown>): StudioRule {
  const strength = row.strength ? row.strength as StudioRule["strength"] : null;
  const verificationStatus = (row.verification_status || row.review_status || "UNVERIFIED") as StudioRule["verificationStatus"];
  return {
    id: String(row.id), category: String(row.category || ""), type: row.type ? row.type as StudioRule["type"] : null,
    title: String(row.title || ""), description: String(row.description || ""), strength,
    classificationRaw: String(row.classification_raw || strength?.replaceAll("_", " ") || "UNCLASSIFIED"),
    status: row.status as StudioRule["status"], verificationStatus,
    reviewStatus: (row.review_status || verificationStatus) as StudioRule["reviewStatus"], review: object(row.review),
    affectedEntityIds: (row.affected_entity_ids as string[]) || [], parameters: object(row.parameters),
    exceptions: (row.exceptions as StudioRule["exceptions"]) || [], source: source(row.source), sourceRaw: object(row.source_raw),
    enforcementStatus: (row.enforcement_status || "NOT_IMPLEMENTED") as StudioRule["enforcementStatus"],
    versionIntroduced: Number(row.version_introduced || 1), updatedAt: String(row.updated_at || ""),
  };
}

function mapAssignment(row: Record<string, unknown>): Assignment {
  return {
    id: String(row.id), sessionId: String(row.session_id), day: row.day as Assignment["day"],
    startTime: time(String(row.start_time)), endTime: time(String(row.end_time)), teacherId: String(row.teacher_id),
    roomId: String(row.room_id), locked: Boolean(row.locked), status: row.status as Assignment["status"],
  };
}

function mapHistory(row: Record<string, unknown>): RuleHistoryEntry {
  return {
    id: String(row.id), ruleId: String(row.rule_id), rulebookVersion: Number(row.rulebook_version), changedAt: String(row.changed_at),
    actor: String(row.actor_label), reason: String(row.reason), before: row.before_rule ? mapRule(row.before_rule as Record<string, unknown>) : null,
    after: row.after_rule ? mapRule(row.after_rule as Record<string, unknown>) : null, aiProposed: Boolean(row.ai_proposed),
  };
}

function mapEnforcementVersion(row: Record<string, unknown>): RuleEnforcementVersion {
  return {
    id: String(row.id), version: Number(row.version), rulebookVersion: Number(row.rulebook_version), createdAt: String(row.created_at),
    actor: String(row.actor_label || ""), reason: String(row.reason || ""), changedRuleIds: (row.changed_rule_ids as string[]) || [],
    snapshot: (row.snapshot as RuleEnforcementMapping[]) || [], status: row.status as RuleEnforcementVersion["status"],
  };
}

function mapPlanningDatasetVersion(row: Record<string, unknown>): PlanningDatasetVersion {
  return {
    id: String(row.id), version: Number(row.version), createdAt: String(row.created_at), actor: String(row.actor_label || ""),
    reason: String(row.reason || ""), snapshot: row.snapshot as PlanningDatasetVersion["snapshot"], snapshotHash: String(row.snapshot_hash || ""),
    status: row.status as PlanningDatasetVersion["status"],
    ...{
      confirmedForSchedulingAt: row.confirmed_for_scheduling_at ? String(row.confirmed_for_scheduling_at) : null,
      confirmedForSchedulingByLabel: row.confirmed_for_scheduling_by_label ? String(row.confirmed_for_scheduling_by_label) : null,
      schedulingConfirmationNote: row.scheduling_confirmation_note ? String(row.scheduling_confirmation_note) : null,
      certificationRulebookVersion: row.certification_rulebook_version == null ? null : Number(row.certification_rulebook_version),
      certificationConstraintModelVersion: row.certification_constraint_model_version == null ? null : Number(row.certification_constraint_model_version),
      certificationConstraintModelSnapshotHash: row.certification_constraint_model_snapshot_hash ? String(row.certification_constraint_model_snapshot_hash) : null,
      certificationReviewSetFingerprint: row.certification_review_set_fingerprint ? String(row.certification_review_set_fingerprint) : null,
      certificationReviewSchemaVersion: row.certification_review_schema_version == null ? null : Number(row.certification_review_schema_version),
    },
  } as PlanningDatasetVersion;
}

function mapEnforcementProposal(row: Record<string, unknown>): RuleEnforcementProposal {
  return {
    id: String(row.id), ruleId: String(row.rule_id), baseRulebookVersion: Number(row.base_rulebook_version),
    baseEnforcementVersion: Number(row.base_enforcement_version), proposedMapping: row.proposed_mapping as RuleEnforcementMapping,
    rationale: String(row.rationale || ""), proposalSource: row.proposal_source as RuleEnforcementProposal["proposalSource"],
    status: row.status as RuleEnforcementProposal["status"], proposedByUserId: row.proposed_by_user_id ? String(row.proposed_by_user_id) : null,
    reviewedByUserId: row.reviewed_by_user_id ? String(row.reviewed_by_user_id) : null, reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    reviewReason: row.review_reason ? String(row.review_reason) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function fail(error: unknown): MutationResult {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message.replace(/^.*?message[:=]\s*/i, "") };
}

function workspaceCreationMessage(error: unknown): string {
  const record = object(error);
  const raw = String(record.message || (error instanceof Error ? error.message : error));
  const code = raw.match(/STUDIO_CREATION_[A-Z_]+/)?.[0];
  switch (code) {
    case "STUDIO_CREATION_AUTH_REQUIRED": return "Sign in before creating a workspace.";
    case "STUDIO_CREATION_NAME_INVALID": return "Enter a workspace name between 1 and 120 characters.";
    case "STUDIO_CREATION_SLUG_INVALID": return "Use a workspace link with letters, numbers, and single hyphens only.";
    case "STUDIO_CREATION_SLUG_TAKEN": return "That workspace link is already in use. Choose another link and retry.";
    case "STUDIO_CREATION_REQUEST_FORBIDDEN": return "This retry belongs to another account. Start a new workspace request.";
    case "STUDIO_CREATION_REQUEST_ID_REQUIRED": return "The workspace request expired. Submit the form again.";
    case "STUDIO_CREATION_PLANNING_AUTHORITY_INVALID": return "The workspace could not finish setup. Retry the same request.";
    default: return "The workspace could not be created. Your form is still here; check the connection and retry.";
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<StudioRole | null>(null);
  const [state, setState] = useState<StudioState | null>(null);
  const [members, setMembers] = useState<StudioMember[]>([]);
  const [invites, setInvites] = useState<StudioInvite[]>([]);
  const [candidateReviews, setCandidateReviews] = useState<SolverCandidateReview[]>([]);
  const [solverContextToken, setSolverContextToken] = useState<SolverSnapshotContextToken | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<AvailableWorkspace[]>([]);
  const [selectedStudioId, setSelectedStudioId] = useState<string | null>(() => (
    typeof window === "undefined" ? null : window.localStorage.getItem(SELECTED_STUDIO_STORAGE_KEY)
  ));
  const loadGeneration = useRef(0);
  const accessMode: WorkspaceContextValue["accessMode"] = session ? "AUTHENTICATED" : "NONE";
  const canEdit = role === "OWNER" || role === "EDITOR";
  const isOwner = role === "OWNER";

  const load = useCallback(async (activeSession?: Session | null, requestedStudioId?: string) => {
    const generation = ++loadGeneration.current;
    const sess = activeSession === undefined ? session : activeSession;
    if (!sess) {
      setRole(null); setState(null); setMembers([]); setInvites([]); setCandidateReviews([]); setSolverContextToken(null); setAvailableWorkspaces([]); setSelectedStudioId(null); setLoading(false); setError(null); return;
    }
    setLoading(true); setError(null); setSolverContextToken(null);
    try {
      const supabase = getBrowserSupabase();
      const membershipsQ = await supabase.from("studio_members").select("studio_id,role").eq("user_id", sess.user.id).order("studio_id");
      if (membershipsQ.error) throw membershipsQ.error;
      const membershipRows = membershipsQ.data || [];
      const workspaceIds = membershipRows.map((row) => String(row.studio_id));
      const studiosQ = workspaceIds.length
        ? await supabase.from("studios").select("id,name").in("id", workspaceIds)
        : { data: [], error: null };
      if (studiosQ.error) throw studiosQ.error;
      const studioNames = new Map((studiosQ.data || []).map((row) => [String(row.id), String(row.name || "Studio workspace")]));
      const workspaces = membershipRows.map((row) => ({
        id: String(row.studio_id), name: studioNames.get(String(row.studio_id)) || "Studio workspace", role: row.role as StudioRole,
      }));
      if (generation !== loadGeneration.current) return;
      setAvailableWorkspaces(workspaces);
      const persistedStudioId = requestedStudioId
        || (typeof window === "undefined" ? selectedStudioId : window.localStorage.getItem(SELECTED_STUDIO_STORAGE_KEY))
        || (workspaces.length === 1 ? workspaces[0].id : null);
      const selected = workspaces.find((workspace) => workspace.id === persistedStudioId) || null;
      if (!selected) {
        setRole(null); setState(null); setMembers([]); setInvites([]); setCandidateReviews([]); setSolverContextToken(null);
        setSelectedStudioId(null);
        setError(workspaces.length ? "Select a workspace to continue." : "This account is signed in but has not been invited to a studio workspace.");
        return;
      }
      const activeStudioId = selected.id;
      setSelectedStudioId(activeStudioId);
      if (typeof window !== "undefined") window.localStorage.setItem(SELECTED_STUDIO_STORAGE_KEY, activeStudioId);
      const membershipQ = membershipRows.find((row) => String(row.studio_id) === activeStudioId);
      if (!membershipQ) {
        setRole(null); setState(null); setMembers([]); setInvites([]); setCandidateReviews([]); setSolverContextToken(null);
        setError("The selected workspace is no longer available to this account.");
        return;
      }
      const nextRole = membershipQ.role as StudioRole;
      setRole(nextRole);

      const [studioQ, teachersQ, roomsQ, studentsQ, cohortsQ, classesQ, sessionsQ, rulesQ, rbvQ, enforcementQ, planningQ, proposalsQ, historyQ, scheduleQ, scenariosQ, auditQ, memberQ, contextTokenQ] = await Promise.all([
        supabase.from("studios").select("*").eq("id", activeStudioId).single(),
        supabase.from("teachers").select("*").eq("studio_id", activeStudioId).is("archived_at", null).order("name"),
        supabase.from("rooms").select("*").eq("studio_id", activeStudioId).is("archived_at", null).order("name"),
        supabase.from("students").select("*").eq("studio_id", activeStudioId).is("archived_at", null).order("name"),
        supabase.from("cohorts").select("*").eq("studio_id", activeStudioId).order("name"),
        supabase.from("class_definitions").select("*").eq("studio_id", activeStudioId).is("archived_at", null).order("name"),
        supabase.from("class_sessions").select("*").eq("studio_id", activeStudioId).is("archived_at", null).order("id"),
        supabase.from("rules").select("*").eq("studio_id", activeStudioId).order("id"),
        supabase.from("rulebook_versions").select("*").eq("studio_id", activeStudioId).order("version", { ascending: false }),
        supabase.from("rule_enforcement_versions").select("*").eq("studio_id", activeStudioId).order("version", { ascending: false }),
        supabase.from("planning_dataset_versions").select("*").eq("studio_id", activeStudioId).order("version", { ascending: false }),
        supabase.from("rule_enforcement_proposals").select("*").eq("studio_id", activeStudioId).order("created_at", { ascending: false }),
        supabase.from("rule_history").select("*").eq("studio_id", activeStudioId).order("changed_at", { ascending: false }),
        supabase.from("schedule_versions").select("*").eq("studio_id", activeStudioId).order("version", { ascending: false }),
        supabase.from("scenarios").select("*").eq("studio_id", activeStudioId).order("created_at", { ascending: false }),
        supabase.from("audit_events").select("*").eq("studio_id", activeStudioId).order("created_at", { ascending: false }).limit(100),
        supabase.rpc("list_studio_members_v63", { p_studio_id: activeStudioId }),
        supabase.rpc("get_solver_context_token_v43", { p_studio_id: activeStudioId }),
      ]);
      const queryError = [studioQ, teachersQ, roomsQ, studentsQ, cohortsQ, classesQ, sessionsQ, rulesQ, rbvQ, enforcementQ, planningQ, proposalsQ, historyQ, scheduleQ, scenariosQ, auditQ, memberQ, contextTokenQ].find((query) => query.error)?.error;
      if (queryError) throw queryError;
      if (generation !== loadGeneration.current) return;
      if (!isSolverSnapshotContextToken(contextTokenQ.data, activeStudioId)) {
        throw new Error("The current solver context token is missing or malformed.");
      }
      setSolverContextToken(contextTokenQ.data);

      const candidateResponse = await fetch("/api/solver/candidates", {
        headers: { Authorization: `Bearer ${sess.access_token}`, "x-studio-id": activeStudioId },
        cache: "no-store",
      });
      const candidatePayload = await candidateResponse.json().catch(() => ({})) as { candidates?: unknown[]; error?: string };
      if (!candidateResponse.ok) throw new Error(candidatePayload.error || "The server could not load saved solver reviews.");
      const parsedCandidates = (Array.isArray(candidatePayload.candidates) ? candidatePayload.candidates : []).map(parseSolverCandidateReview);
      if (parsedCandidates.some((candidate) => candidate === null)) throw new Error("A saved solver review is malformed and cannot be safely reopened.");

      const currentScheduleRow = (scheduleQ.data || []).find((row) => row.is_current);
      const assignmentQ = currentScheduleRow
        ? await supabase.from("assignments").select("*").eq("schedule_version_id", currentScheduleRow.id).order("start_time")
        : { data: [], error: null };
      if (assignmentQ.error) throw assignmentQ.error;
      const assignments = (assignmentQ.data || []).map((row) => mapAssignment(row as Record<string, unknown>));
      const certificationResponse = await fetch("/api/planning/confirmation", {
        headers: { Authorization: `Bearer ${sess.access_token}`, "x-studio-id": activeStudioId },
        cache: "no-store",
      });
      const certificationPayload = await certificationResponse.json() as PlanningConfirmationResponse;
      if (!certificationResponse.ok) {
        throw new Error(certificationPayload.error || "The server could not load the current readiness certification.");
      }
      const scheduleVersions: ScheduleVersion[] = (scheduleQ.data || []).map((row) => ({
        id: row.id, version: row.version, rulebookVersion: row.rulebook_version, enforcementVersion: Number(row.enforcement_version || 0),
        planningDatasetVersion: row.planning_dataset_version == null ? undefined : Number(row.planning_dataset_version), createdAt: row.created_at,
        actor: row.actor_label, reason: row.reason, assignments: row.id === currentScheduleRow?.id ? assignments : [],
        isCurrent: Boolean(row.is_current), validationResult: row.validation_result as ValidationResult | null,
      }));

      const mapped: StudioState = {
        studioId: activeStudioId, studioName: studioQ.data?.name || "Studio workspace",
        teachers: (teachersQ.data || []).map((row) => ({ id: row.id, name: row.name, subjects: row.subjects || [], notes: row.notes || undefined, displayColor: row.display_color || undefined })),
        rooms: (roomsQ.data || []).map((row) => ({ id: row.id, name: row.name, capacity: row.capacity ?? undefined, features: row.features || [] })),
        students: (studentsQ.data || []).map((row) => ({ id: row.id, name: row.name, level: row.level, cohortIds: row.cohort_ids || [] })),
        cohorts: (cohortsQ.data || []).map((row) => ({ id: row.id, name: row.name, studentIds: row.student_ids || [] })),
        classes: (classesQ.data || []).map((row) => ({
          id: row.id, name: row.name, subject: row.subject, level: row.level, durationMinutes: row.duration_minutes,
          weeklyFrequency: row.weekly_frequency, rosterStudentIds: row.roster_student_ids || [], eligibleTeacherIds: row.eligible_teacher_ids || [], companyOnly: row.company_only,
        })),
        sessions: (sessionsQ.data || []).map((row) => ({
          id: row.id, classId: row.class_id, ordinal: row.ordinal,
          durationMinutes: row.duration_minutes == null ? undefined : Number(row.duration_minutes), locked: row.locked,
        })),
        rules: (rulesQ.data || []).map((row) => mapRule(row as Record<string, unknown>)),
        rulebookVersions: (rbvQ.data || []).map((row) => ({
          id: row.id, version: row.version, name: row.name, createdAt: row.created_at, actor: row.actor_label, reason: row.reason,
          changedRuleIds: row.changed_rule_ids || [], rulebookId: row.rulebook_id || undefined, status: row.status || undefined,
          importedAt: row.imported_at || undefined, sourceHash: row.source_hash || undefined, sourceFileHash: row.source_file_hash || undefined,
          ruleCount: row.rule_count ?? undefined, parentVersion: row.parent_version ?? undefined, formatVersion: row.format_version || undefined,
          documentType: row.document_type || undefined, sourceMetadata: object(row.source_metadata),
        } as RulebookVersion)),
        enforcementVersions: (enforcementQ.data || []).map((row) => mapEnforcementVersion(row as Record<string, unknown>)),
        planningDatasetVersions: (planningQ.data || []).map((row) => mapPlanningDatasetVersion(row as Record<string, unknown>)),
        enforcementProposals: (proposalsQ.data || []).map((row) => mapEnforcementProposal(row as Record<string, unknown>)),
        ruleHistory: (historyQ.data || []).map((row) => mapHistory(row as Record<string, unknown>)),
        scheduleVersions,
        scenarios: (scenariosQ.data || []).map((row) => ({
          id: row.id, name: row.name, baseRulebookVersion: row.base_rulebook_version, baseScheduleVersion: row.base_schedule_version,
          baseEnforcementVersion: row.base_enforcement_version == null ? undefined : Number(row.base_enforcement_version),
          basePlanningDatasetVersion: row.base_planning_dataset_version == null ? undefined : Number(row.base_planning_dataset_version),
          rulePatches: (row.rule_patches || []) as unknown as RulePatch[], schedulePatches: (row.schedule_patches || []) as unknown as SchedulePatch[], createdAt: row.created_at,
        } as Scenario)),
        auditEvents: (auditQ.data || []).map((row) => ({ id: row.id, at: row.created_at, actor: row.actor_label, action: row.action, entityType: row.entity_type, entityId: row.entity_id || undefined, detail: row.detail })),
        readinessCertification: certificationPayload.certification || undefined,
      };
      if (generation !== loadGeneration.current) return;
      setState(mapped);
      setCandidateReviews(parsedCandidates as SolverCandidateReview[]);
      setMembers((memberQ.data || []).map((row: Record<string, unknown>) => ({
        userId: String(row.user_id), role: row.role as StudioRole, displayName: String(row.display_name || ""), email: String(row.email || ""), createdAt: String(row.created_at || ""),
      })));
      if (nextRole === "OWNER") {
        const inviteQ = await supabase.from("studio_invites").select("id,email,role,created_at,accepted_at").eq("studio_id", activeStudioId).order("created_at", { ascending: false });
        if (inviteQ.error) throw inviteQ.error;
        setInvites((inviteQ.data || []).map((row) => ({ id: row.id, email: row.email, role: row.role as StudioRole, createdAt: row.created_at, acceptedAt: row.accepted_at })));
      } else setInvites([]);
    } catch (caught) {
      if (generation !== loadGeneration.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [session, selectedStudioId]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); void load(data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); void load(next); });
    return () => listener.subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchStudio(nextStudioId: string) {
    if (!session || !availableWorkspaces.some((workspace) => workspace.id === nextStudioId)) return;
    if (typeof window !== "undefined") window.localStorage.setItem(SELECTED_STUDIO_STORAGE_KEY, nextStudioId);
    setSelectedStudioId(nextStudioId);
    setState(null); setRole(null); setMembers([]); setInvites([]); setCandidateReviews([]); setSolverContextToken(null); setError(null);
    await load(session, nextStudioId);
  }

  const currentSchedule = useMemo(() => state?.scheduleVersions.find((version) => version.isCurrent) || null, [state]);
  const currentAssignments = useMemo(() => currentSchedule?.assignments || [], [currentSchedule]);
  const currentRulebookVersion = state?.rulebookVersions.find((version) => version.status === "CURRENT")?.version ?? 0;
  const currentEnforcementVersion = state?.enforcementVersions.find((version) => version.status === "CURRENT")?.version ?? 0;
  const currentPlanningDatasetVersion = state?.planningDatasetVersions?.find((version) => version.status === "CURRENT")?.version ?? 0;
  const currentScheduleVersion = currentSchedule?.version ?? 0;
  const currentScheduleRulebookVersion = currentSchedule?.rulebookVersion ?? 0;
  const currentScheduleEnforcementVersion = currentSchedule?.enforcementVersion ?? 0;
  const currentSchedulePlanningDatasetVersion = currentSchedule?.planningDatasetVersion ?? 0;
  const scheduleIsStale = Boolean(currentSchedule && (
    currentScheduleRulebookVersion !== currentRulebookVersion
    || currentScheduleEnforcementVersion !== currentEnforcementVersion
    || currentSchedulePlanningDatasetVersion !== currentPlanningDatasetVersion
  ));
  const validation = useMemo(() => state ? validateSchedule(state, currentAssignments) : emptyValidation(), [state, currentAssignments]);

  async function signInWithEmail(email: string) {
    try {
      const { error: authError } = await getBrowserSupabase().auth.signInWithOtp({
        email, options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined, shouldCreateUser: true },
      });
      if (authError) throw authError;
      return { ok: true, message: "Check your email for the sign-in link." };
    } catch (caught) { return { ok: false, message: caught instanceof Error ? caught.message : String(caught) }; }
  }

  async function signOut() {
    await getBrowserSupabase().auth.signOut();
    setSession(null); setRole(null); setState(null); setMembers([]); setInvites([]); setCandidateReviews([]); setSolverContextToken(null);
  }

  async function createWorkspace(name: string, slug: string, requestId = crypto.randomUUID()): Promise<CreateWorkspaceResult> {
    if (!session) return { ok: false, message: "Sign in before creating a workspace.", requestId };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("create_studio_v64", {
        p_request_id: requestId,
        p_name: name.trim(),
        p_slug: slug.trim() || null,
      });
      if (rpcError) throw rpcError;
      const result = object(data);
      const studioId = typeof result.studioId === "string" ? result.studioId : "";
      if (!studioId) return { ok: false, message: "The workspace response was incomplete. Retry the same request.", requestId };
      if (typeof window !== "undefined") window.localStorage.setItem(SELECTED_STUDIO_STORAGE_KEY, studioId);
      setSelectedStudioId(studioId);
      setState(null); setRole(null); setMembers([]); setInvites([]); setCandidateReviews([]); setSolverContextToken(null); setError(null);
      await load(session, studioId);
      return { ok: true, message: "Workspace created.", requestId, studioId };
    } catch (caught) {
      return { ok: false, message: workspaceCreationMessage(caught), requestId };
    }
  }

  async function applyRulePatch(patch: RulePatch): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("apply_rule_patch_v63", {
        p_studio_id: state?.studioId,
        p_operation: patch.operation, p_rule_id: patch.ruleId || String(patch.changes.id || ""), p_changes: patch.changes,
        p_reason: patch.reason, p_expected_rulebook_version: currentRulebookVersion, p_ai_proposed: patch.proposedBy === "AI",
      });
      if (rpcError) throw rpcError; await load();
      return { ok: true, version: Number((data as Record<string, unknown>)?.version || 0), details: object(data) };
    } catch (caught) { return fail(caught); }
  }

  async function applySetupTypedPolicies(policies: SetupTypedPolicyPatch[], reason: string): Promise<SetupTypedPolicyMutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    const result = await applySetupTypedPoliciesClient({
      studioId: state?.studioId || "",
      policies,
      reason,
      expectedRulebookVersion: currentRulebookVersion,
      expectedEnforcementVersion: currentEnforcementVersion,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
      emptyWorkspace: state?.rulebookVersions.find((version) => version.status === "CURRENT")?.sourceMetadata?.provisioning === "EMPTY_WORKSPACE",
    });
    if (result.ok) await load();
    return result;
  }

  async function applySchedulePatch(patch: SchedulePatch): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    if (!state || !session) return { ok: false, error: "An authenticated workspace is required." };
    if (scheduleIsStale) return {
      ok: false,
      error: `Schedule v${currentScheduleVersion} is linked to Rulebook v${currentScheduleRulebookVersion} / Enforcement v${currentScheduleEnforcementVersion} / Planning Dataset v${currentSchedulePlanningDatasetVersion || "unversioned"}. Revalidate it against Rulebook v${currentRulebookVersion} / Enforcement v${currentEnforcementVersion} / Planning Dataset v${currentPlanningDatasetVersion} first.`,
    };
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ studioId: state.studioId, patch }),
      };
      const response = patch.operation === "MOVE"
        ? await fetch("/api/schedule/move", requestInit)
        : await fetch("/api/schedule/incremental", requestInit);
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        return {
          ok: false,
          error: String(payload.error || "The authoritative server schedule gate rejected this change."),
          validation: (payload.legacyValidation || payload.validation) as ValidationResult | undefined,
          details: payload,
        };
      }
      await load();
      return {
        ok: true,
        version: Number(payload.scheduleVersion || 0),
        validation: payload.validation as ValidationResult | undefined,
        details: payload,
      };
    } catch (caught) { return fail(caught); }
  }

  async function toggleSessionLock(sessionId: string, locked: boolean, reason: string): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    if (!state || !session) return { ok: false, error: "An authenticated workspace is required." };
    if (!solverContextToken) return { ok: false, error: "The current scheduling context is still loading. Refresh and retry." };
    if (!sessionId.trim()) return { ok: false, error: "An explicit session is required." };
    if (!reason.trim()) return { ok: false, error: "A reason is required for a governed lock change." };
    if (scheduleIsStale) return {
      ok: false,
      error: `Schedule v${currentScheduleVersion} needs revalidation before its lock can change. Review the current scheduling context first.`,
    };
    try {
      const response = await fetch("/api/schedule/lock", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          studioId: state.studioId,
          sessionId: sessionId.trim(),
          locked,
          reason: reason.trim(),
          expectedContext: solverContextToken,
        }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        return {
          ok: false,
          error: String(payload.error || "The governed session lock change was rejected."),
          details: payload,
        };
      }
      await load();
      return {
        ok: true,
        version: Number(payload.scheduleVersion || 0),
        details: payload,
      };
    } catch (caught) { return fail(caught); }
  }

  async function runScheduleRecovery(operation: "REBASE" | "UNDO", preview = false): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    if (!state || !session) return { ok: false, error: "An authenticated workspace is required." };
    try {
      const response = await fetch("/api/schedule/recovery", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          studioId: state.studioId,
          operation,
          preview,
          reason: operation === "REBASE"
            ? `Revalidate Schedule v${currentScheduleVersion} against the current scheduling context`
            : `Undo Schedule v${currentScheduleVersion} under the current scheduling context`,
        }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        return {
          ok: false,
          error: String(payload.error || "The authoritative recovery gate rejected this operation."),
          validation: (payload.legacyValidation || payload.validation) as ValidationResult | undefined,
          details: payload,
        };
      }
      if (!preview) await load();
      return {
        ok: true,
        version: Number(payload.scheduleVersion || 0),
        validation: payload.validation as ValidationResult | undefined,
        details: payload,
      };
    } catch (caught) { return fail(caught); }
  }

  async function rebaseSchedule(): Promise<MutationResult> {
    return runScheduleRecovery("REBASE");
  }

  async function undoSchedule(): Promise<MutationResult> {
    return runScheduleRecovery("UNDO");
  }

  async function previewScheduleRecovery(operation: "REBASE" | "UNDO"): Promise<MutationResult> {
    return runScheduleRecovery(operation, true);
  }

  async function proposeEnforcementMapping(ruleId: string, mapping: RuleEnforcementMapping, rationale: string, proposalSource: "USER" | "AI" = "USER"): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("propose_rule_enforcement_mapping_v63", {
        p_studio_id: state?.studioId,
        p_rule_id: ruleId,
        p_mapping: mapping,
        p_rationale: rationale,
        p_expected_rulebook_version: currentRulebookVersion,
        p_expected_enforcement_version: currentEnforcementVersion,
        p_source: proposalSource,
      });
      if (rpcError) throw rpcError; await load();
      return { ok: true, details: object(data) };
    } catch (caught) { return fail(caught); }
  }

  async function reviewEnforcementProposal(proposalId: string, decision: "APPROVE" | "REJECT", reason: string): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("review_rule_enforcement_mapping_v63", {
        p_studio_id: state?.studioId,
        p_proposal_id: proposalId,
        p_decision: decision,
        p_reason: reason,
        p_expected_rulebook_version: currentRulebookVersion,
        p_expected_enforcement_version: currentEnforcementVersion,
      });
      if (rpcError) throw rpcError; await load();
      const details = object(data);
      return { ok: true, version: Number(details.enforcementVersion || currentEnforcementVersion), details };
    } catch (caught) { return fail(caught); }
  }

  async function applyReviewedCsvImport(input: { batchId: string; rows: ReviewedPlanningImportRow[]; reason: string; sourceMetadata?: Record<string, unknown> }): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    if (!state?.studioId) return { ok: false, error: "An authenticated workspace is required." };
    const result = await applyReviewedCsvImportClient({
      studioId: state.studioId,
      batchId: input.batchId,
      rows: input.rows,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
      reason: input.reason,
      sourceMetadata: input.sourceMetadata,
    });
    if (result.ok) await load();
    return {
      ok: result.ok,
      error: result.error,
      version: result.planningDatasetVersion,
      details: result.details,
    };
  }

  function exportPackage(): Record<string, unknown> | null {
    if (!state) return null;
    const current = state.rulebookVersions.find((version) => version.status === "CURRENT") ?? state.rulebookVersions[0];
    const currentEnforcement = state.enforcementVersions.find((version) => version.status === "CURRENT") ?? state.enforcementVersions[0];
    const currentPlanning = state.planningDatasetVersions?.find((version) => version.status === "CURRENT") ?? null;
    const verified = state.rules.filter((rule) => (rule.reviewStatus ?? rule.verificationStatus) === "VERIFIED").length;
    const approved = state.rules.filter((rule) => rule.review?.decision === "APPROVED").length;
    const edited = state.rules.filter((rule) => rule.review?.decision === "EDIT").length;
    return {
      format_version: current?.formatVersion || "2.0", document_type: current?.documentType || "STUDIO_RULEBOOK",
      rulebook: {
        id: current?.rulebookId || "studio-rulebook", name: current?.name || "Studio Rulebook",
        version: currentRulebookVersion, status: current?.sourceHash ? "REVIEWED" : "CURRENT", total_rules: state.rules.length,
        reviewed_rules: verified, approved_without_edit: approved, edited_and_approved: edited, rules_sha256: current?.sourceHash || null,
      },
      source_version: current,
      enforcement: currentEnforcement ? {
        version: currentEnforcement.version,
        rulebook_version: currentEnforcement.rulebookVersion,
        mappings: currentEnforcement.snapshot,
      } : null,
      planning_dataset: currentPlanning ? {
        version: currentPlanning.version,
        snapshot_hash: currentPlanning.snapshotHash,
        schema_version: currentPlanning.snapshot.schemaVersion,
      } : null,
      rules: state.rules.map((rule) => ({
        id: rule.id, category: rule.category, classification: rule.classificationRaw ?? rule.strength?.replaceAll("_", " ") ?? "UNCLASSIFIED",
        title: rule.title, text: rule.description, status: rule.status, review_status: rule.reviewStatus ?? rule.verificationStatus,
        review: rule.review ?? {}, source: rule.sourceRaw ?? rule.source,
      })),
    };
  }

  async function updateTeacher(teacher: Teacher, reason: string): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("update_studio_entity_v63", {
        p_studio_id: state?.studioId,
        p_entity_type: "TEACHER", p_entity_id: teacher.id, p_changes: { name: teacher.name, notes: teacher.notes || "" }, p_reason: reason,
        p_expected_rulebook_version: currentRulebookVersion, p_expected_schedule_version: currentScheduleVersion,
      });
      if (rpcError) throw rpcError; await load(); return { ok: true, details: object(data) };
    } catch (caught) { return fail(caught); }
  }

  async function updateRoom(room: Room, reason: string): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("update_studio_entity_v63", {
        p_studio_id: state?.studioId,
        p_entity_type: "ROOM", p_entity_id: room.id, p_changes: { name: room.name, capacity: room.capacity ?? null, features: room.features || [] }, p_reason: reason,
        p_expected_rulebook_version: currentRulebookVersion, p_expected_schedule_version: currentScheduleVersion,
      });
      if (rpcError) throw rpcError; await load(); return { ok: true, details: object(data) };
    } catch (caught) { return fail(caught); }
  }

  async function updateClass(klass: ClassDefinition, reason: string): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("update_studio_entity_v63", {
        p_studio_id: state?.studioId,
        p_entity_type: "CLASS", p_entity_id: klass.id,
        p_changes: {
          name: klass.name, subject: klass.subject, level: klass.level, durationMinutes: klass.durationMinutes,
          weeklyFrequency: klass.weeklyFrequency, rosterStudentIds: klass.rosterStudentIds, companyOnly: Boolean(klass.companyOnly),
        },
        p_reason: reason, p_expected_rulebook_version: currentRulebookVersion, p_expected_schedule_version: currentScheduleVersion,
      });
      if (rpcError) throw rpcError; await load(); return { ok: true, details: object(data) };
    } catch (caught) { return fail(caught); }
  }

  async function createScenario(name: string, rulePatches: RulePatch[] = [], schedulePatches: SchedulePatch[] = []): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("create_scenario_v63", {
        p_studio_id: state?.studioId,
        p_name: name, p_rule_patches: rulePatches, p_schedule_patches: schedulePatches,
        p_expected_rulebook_version: currentRulebookVersion, p_expected_schedule_version: currentScheduleVersion,
      });
      if (rpcError) throw rpcError; await load(); return { ok: true, details: object(data) };
    } catch (caught) { return fail(caught); }
  }

  async function deleteSolverCandidateReview(candidateId: string): Promise<MutationResult> {
    if (!canEdit) return { ok: false, error: "Editor access is required." };
    if (!state?.studioId || !session) return { ok: false, error: "An authenticated workspace is required." };
    try {
      const response = await fetch("/api/solver/candidates", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ studioId: state.studioId, candidateId }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) return { ok: false, error: String(payload.error || "The solver review could not be deleted."), details: payload };
      await load();
      return { ok: payload.deleted === true, details: payload };
    } catch (caught) { return fail(caught); }
  }

  async function inviteMember(email: string, nextRole: StudioRole): Promise<MutationResult> {
    if (!isOwner) return { ok: false, error: "Owner access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("invite_studio_member_v63", { p_studio_id: state?.studioId, p_email: email, p_role: nextRole });
      if (rpcError) throw rpcError; await load(); return { ok: true, details: object(data) };
    } catch (caught) { return fail(caught); }
  }

  async function setMemberRole(userId: string, nextRole: StudioRole): Promise<MutationResult> {
    if (!isOwner) return { ok: false, error: "Owner access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("set_studio_member_role_v63", { p_studio_id: state?.studioId, p_user_id: userId, p_role: nextRole });
      if (rpcError) throw rpcError; await load(); return { ok: Boolean(data) };
    } catch (caught) { return fail(caught); }
  }

  async function removeMember(userId: string): Promise<MutationResult> {
    if (!isOwner) return { ok: false, error: "Owner access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("remove_studio_member_v63", { p_studio_id: state?.studioId, p_user_id: userId });
      if (rpcError) throw rpcError; await load(); return { ok: Boolean(data) };
    } catch (caught) { return fail(caught); }
  }

  async function cancelInvite(inviteId: string): Promise<MutationResult> {
    if (!isOwner) return { ok: false, error: "Owner access is required." };
    try {
      const { data, error: rpcError } = await getBrowserSupabase().rpc("cancel_studio_invite_v63", { p_studio_id: state?.studioId, p_invite_id: inviteId });
      if (rpcError) throw rpcError; await load(); return { ok: Boolean(data) };
    } catch (caught) { return fail(caught); }
  }

  const value: WorkspaceContextValue = {
    loading,error,session,accessMode,role,canEdit,isOwner,state,members,invites,candidateReviews,currentAssignments,currentRulebookVersion,currentEnforcementVersion,
    availableWorkspaces,selectedStudioId,switchStudio,currentPlanningDatasetVersion,currentScheduleVersion,currentScheduleRulebookVersion,currentScheduleEnforcementVersion,currentSchedulePlanningDatasetVersion,
    solverContextToken,scheduleIsStale,validation,
    refresh:()=>load(),signInWithEmail,signOut,createWorkspace,applyRulePatch,applySetupTypedPolicies,applySchedulePatch,toggleSessionLock,previewScheduleRecovery,rebaseSchedule,undoSchedule,proposeEnforcementMapping,reviewEnforcementProposal,applyReviewedCsvImport,exportPackage,
    updateTeacher,updateRoom,updateClass,createScenario,deleteSolverCandidateReview,inviteMember,setMemberRole,removeMember,cancelInvite,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

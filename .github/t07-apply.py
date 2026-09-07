from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


server_state = r'''import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConstraintModelDefinitionV1 } from "@/lib/constraint-model-version";
import type {
  Assignment,
  PlanningDatasetSnapshotV1,
  PlanningDatasetVersion,
  RuleEnforcementMapping,
  RuleEnforcementVersion,
  RulebookVersion,
  ScheduleVersion,
  StudioRule,
  StudioState,
} from "@/lib/domain";

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const compareCanonicalStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mapRule(row: Record<string, unknown>): StudioRule {
  const strength = row.strength ? row.strength as StudioRule["strength"] : null;
  const verificationStatus = (row.verification_status || row.review_status || "UNVERIFIED") as StudioRule["verificationStatus"];
  return {
    id: String(row.id),
    category: String(row.category || ""),
    type: row.type ? row.type as StudioRule["type"] : null,
    title: String(row.title || ""),
    description: String(row.description || ""),
    strength,
    classificationRaw: String(row.classification_raw || strength?.replaceAll("_", " ") || "UNCLASSIFIED"),
    status: row.status as StudioRule["status"],
    verificationStatus,
    reviewStatus: (row.review_status || verificationStatus) as StudioRule["reviewStatus"],
    review: object(row.review),
    affectedEntityIds: (row.affected_entity_ids as string[]) || [],
    parameters: object(row.parameters),
    exceptions: (row.exceptions as StudioRule["exceptions"]) || [],
    source: ({ type: "IMPORT", ...object(row.source) }) as StudioRule["source"],
    sourceRaw: object(row.source_raw),
    enforcementStatus: (row.enforcement_status || "NOT_IMPLEMENTED") as StudioRule["enforcementStatus"],
    versionIntroduced: Number(row.version_introduced || 1),
    updatedAt: String(row.updated_at || ""),
  };
}

function mapRulebook(row: Record<string, unknown>): RulebookVersion {
  return {
    id: String(row.id),
    version: Number(row.version),
    name: String(row.name || "DWDE Rulebook"),
    createdAt: String(row.created_at || ""),
    actor: String(row.actor_label || ""),
    reason: String(row.reason || ""),
    changedRuleIds: (row.changed_rule_ids as string[]) || [],
    rulebookId: row.rulebook_id ? String(row.rulebook_id) : undefined,
    status: row.status as RulebookVersion["status"],
    importedAt: row.imported_at ? String(row.imported_at) : undefined,
    sourceHash: row.source_hash ? String(row.source_hash) : undefined,
    sourceFileHash: row.source_file_hash ? String(row.source_file_hash) : undefined,
    ruleCount: row.rule_count == null ? undefined : Number(row.rule_count),
    parentVersion: row.parent_version == null ? undefined : Number(row.parent_version),
    formatVersion: row.format_version ? String(row.format_version) : undefined,
    documentType: row.document_type ? String(row.document_type) : undefined,
    sourceMetadata: object(row.source_metadata),
    snapshot: Array.isArray(row.snapshot) ? row.snapshot : undefined,
  };
}

function mapEnforcement(row: Record<string, unknown>): RuleEnforcementVersion {
  return {
    id: String(row.id),
    version: Number(row.version),
    rulebookVersion: Number(row.rulebook_version || 0),
    createdAt: String(row.created_at || ""),
    actor: String(row.actor_label || ""),
    reason: String(row.reason || ""),
    changedRuleIds: (row.changed_rule_ids as string[]) || [],
    snapshot: (row.snapshot as RuleEnforcementMapping[]) || [],
    status: row.status as RuleEnforcementVersion["status"],
  };
}

function mapPlanningDataset(row: Record<string, unknown>): PlanningDatasetVersion {
  return {
    id: String(row.id),
    version: Number(row.version),
    createdAt: String(row.created_at || ""),
    actor: String(row.actor_label || ""),
    reason: String(row.reason || ""),
    snapshot: row.snapshot as PlanningDatasetVersion["snapshot"],
    snapshotHash: String(row.snapshot_hash || ""),
    status: row.status as PlanningDatasetVersion["status"],
    confirmedForSchedulingAt: row.confirmed_for_scheduling_at ? String(row.confirmed_for_scheduling_at) : null,
    confirmedForSchedulingByLabel: row.confirmed_for_scheduling_by_label ? String(row.confirmed_for_scheduling_by_label) : null,
    schedulingConfirmationNote: row.scheduling_confirmation_note ? String(row.scheduling_confirmation_note) : null,
  };
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

function mapSchedule(row: Record<string, unknown>, assignments: Assignment[]): ScheduleVersion {
  return {
    id: String(row.id),
    version: Number(row.version),
    rulebookVersion: Number(row.rulebook_version || 0),
    enforcementVersion: Number(row.enforcement_version || 0),
    planningDatasetVersion: row.planning_dataset_version == null ? undefined : Number(row.planning_dataset_version),
    createdAt: String(row.created_at || ""),
    actor: String(row.actor_label || ""),
    reason: String(row.reason || ""),
    assignments,
    isCurrent: Boolean(row.is_current),
    validationResult: (row.validation_result || null) as ScheduleVersion["validationResult"],
  };
}

export interface SolverSnapshotContextToken {
  schemaVersion: "1.0";
  studioId: string;
  rulebookVersion: number | null;
  rulebookId: string | null;
  rulebookSourceHash: string | null;
  rulebookSnapshotHash: string | null;
  rulesHash: string;
  planningDatasetVersion: number | null;
  planningDatasetId: string | null;
  planningSnapshotHash: string | null;
  planningConfirmedForSchedulingAt: string | null;
  enforcementVersion: number | null;
  enforcementId: string | null;
  constraintModelVersion: number | null;
  constraintModelId: string | null;
  constraintModelSnapshotHash: string | null;
  scheduleVersion: number | null;
  scheduleId: string | null;
  scheduleRulebookVersion: number | null;
  scheduleEnforcementVersion: number | null;
  schedulePlanningDatasetVersion: number | null;
  scheduleConstraintModelVersion: number | null;
  scheduleAssignmentsHash: string;
}

export interface SolverSnapshotPublishedConstraintModel {
  version: number;
  rulebookVersion: number;
  compilerVersion: string;
  snapshotHash: string;
  complete: boolean;
  snapshot: ConstraintModelDefinitionV1;
}

export interface CanonicalSolverSnapshot {
  state: StudioState;
  contextToken: SolverSnapshotContextToken;
  publishedConstraintModel: SolverSnapshotPublishedConstraintModel | null;
}

function immutableName(value: unknown, kind: string, id: string, schemaVersion: string) {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(
    `SOLVER_PLANNING_SNAPSHOT_SCHEMA_UNSUPPORTED: Planning Dataset schema ${schemaVersion} does not contain the immutable ${kind} name for ${id}. `
    + "The current name-bound compiler cannot safely reconstruct that historical snapshot, and mutable live rows are never used as a fallback.",
  );
}

function planningFactsFromSnapshot(snapshot: PlanningDatasetSnapshotV1) {
  if (!["1.0", "1.1", "1.2", "1.3"].includes(snapshot.schemaVersion)) {
    throw new Error(`SOLVER_PLANNING_SNAPSHOT_SCHEMA_UNSUPPORTED: Unsupported Planning Dataset schema ${String(snapshot.schemaVersion)}.`);
  }

  const teacherRows = Array.isArray(snapshot.teachers) ? snapshot.teachers : [];
  const teacherById = new Map(teacherRows.map((teacher) => [String(teacher.id), teacher]));
  const teachers = [...(snapshot.teacherIds || [])]
    .sort(compareCanonicalStrings)
    .map((id) => {
      const teacher = teacherById.get(String(id));
      return {
        id: String(id),
        name: immutableName(teacher?.name, "teacher", String(id), snapshot.schemaVersion),
        subjects: [] as string[],
      };
    });

  const rooms = [...(snapshot.rooms || [])]
    .map((room) => ({
      id: String(room.id),
      name: immutableName(room.name, "room", String(room.id), snapshot.schemaVersion),
      capacity: room.capacity == null ? undefined : Number(room.capacity),
      features: [...(room.features || [])].sort(compareCanonicalStrings),
    }))
    .sort((a, b) => compareCanonicalStrings(a.id, b.id));

  const students = [...(snapshot.students || [])]
    .map((student) => ({
      id: String(student.id),
      name: immutableName(student.name, "student", String(student.id), snapshot.schemaVersion),
      level: String(student.level || ""),
      cohortIds: [...(student.cohortIds || [])].sort(compareCanonicalStrings),
    }))
    .sort((a, b) => compareCanonicalStrings(a.id, b.id));

  const cohorts = [...(snapshot.cohorts || [])]
    .map((cohort) => ({
      id: String(cohort.id),
      name: immutableName(cohort.name, "cohort", String(cohort.id), snapshot.schemaVersion),
      studentIds: [...(cohort.studentIds || [])].sort(compareCanonicalStrings),
    }))
    .sort((a, b) => compareCanonicalStrings(a.id, b.id));

  const classes = [...(snapshot.classes || [])]
    .map((klass) => ({
      id: String(klass.id),
      name: immutableName(klass.name, "class", String(klass.id), snapshot.schemaVersion),
      subject: String(klass.subject || ""),
      level: String(klass.level || ""),
      durationMinutes: Number(klass.durationMinutes || 0),
      weeklyFrequency: Number(klass.weeklyFrequency || 0),
      rosterStudentIds: [...(klass.rosterStudentIds || [])].sort(compareCanonicalStrings),
      eligibleTeacherIds: [] as string[],
      companyOnly: Boolean(klass.companyOnly),
    }))
    .sort((a, b) => compareCanonicalStrings(a.id, b.id));
  const classIds = new Set(classes.map((klass) => klass.id));

  const sessions = [...(snapshot.sessions || [])]
    .map((session) => {
      if (!classIds.has(String(session.classId))) {
        throw new Error(`SOLVER_PLANNING_SNAPSHOT_INVALID: Session ${String(session.id)} references missing class ${String(session.classId)} in the pinned snapshot.`);
      }
      return {
        id: String(session.id),
        classId: String(session.classId),
        ordinal: Number(session.ordinal),
        durationMinutes: session.durationMinutes == null ? undefined : Number(session.durationMinutes),
        locked: Boolean(session.locked),
      };
    })
    .sort((a, b) => compareCanonicalStrings(a.id, b.id));

  return { teachers, rooms, students, cohorts, classes, sessions };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareCanonicalStrings).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function solverSnapshotContextTokensMatch(
  left: SolverSnapshotContextToken,
  right: SolverSnapshotContextToken,
) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function parseCanonicalSolverSnapshotPayload(raw: unknown, studioId: string): CanonicalSolverSnapshot {
  if (!isRecord(raw)) throw new Error("SOLVER_SNAPSHOT_INVALID: Solver snapshot RPC returned a non-object payload.");
  if (!isRecord(raw.contextToken)) throw new Error("SOLVER_SNAPSHOT_INVALID: Solver snapshot context token is missing.");
  const contextToken = raw.contextToken as unknown as SolverSnapshotContextToken;
  if (contextToken.schemaVersion !== "1.0" || contextToken.studioId !== studioId) {
    throw new Error("SOLVER_SNAPSHOT_INVALID: Solver snapshot token does not match the requested studio or schema.");
  }

  const integrity = object(raw.integrity);
  if (integrity.planningSnapshotHashValid !== true) {
    throw new Error("SOLVER_PLANNING_SNAPSHOT_HASH_MISMATCH: Current PlanningDatasetVersion snapshot does not match its stored hash.");
  }

  if (!isRecord(raw.studio) || String(raw.studio.id) !== studioId) {
    throw new Error("SOLVER_SNAPSHOT_INVALID: Requested studio is missing from the coherent snapshot.");
  }
  if (!isRecord(raw.rulebookVersion)) throw new Error("SOLVER_SNAPSHOT_INVALID: No current RulebookVersion exists.");
  if (!isRecord(raw.planningDatasetVersion)) throw new Error("SOLVER_SNAPSHOT_INVALID: No current PlanningDatasetVersion exists.");

  const rulebook = mapRulebook(raw.rulebookVersion);
  const planning = mapPlanningDataset(raw.planningDatasetVersion);
  if (planning.snapshot.studioId !== studioId) {
    throw new Error("SOLVER_PLANNING_SNAPSHOT_INVALID: Pinned Planning Dataset belongs to another studio.");
  }
  if (rulebook.version !== contextToken.rulebookVersion || planning.version !== contextToken.planningDatasetVersion
      || planning.snapshotHash !== contextToken.planningSnapshotHash) {
    throw new Error("SOLVER_SNAPSHOT_INVALID: Version rows and context token disagree inside the coherent snapshot.");
  }

  const planningFacts = planningFactsFromSnapshot(planning.snapshot);
  const rules = asArray(raw.rules).map((row) => {
    if (!isRecord(row)) throw new Error("SOLVER_SNAPSHOT_INVALID: Rule snapshot contains a malformed row.");
    if (String(row.studio_id) !== studioId) throw new Error("SOLVER_SNAPSHOT_TENANT_LEAK: Snapshot contains a rule from another studio.");
    return mapRule(row);
  });

  const enforcementVersions = isRecord(raw.enforcementVersion) ? [mapEnforcement(raw.enforcementVersion)] : [];
  if (enforcementVersions[0] && enforcementVersions[0].version !== contextToken.enforcementVersion) {
    throw new Error("SOLVER_SNAPSHOT_INVALID: EnforcementVersion and context token disagree.");
  }

  const currentScheduleRaw = isRecord(raw.currentSchedule) ? raw.currentSchedule : null;
  const currentAssignmentsRaw = asArray(raw.currentAssignments);
  const currentScheduleId = currentScheduleRaw ? String(currentScheduleRaw.id) : null;
  const assignments = currentAssignmentsRaw.map((row) => {
    if (!isRecord(row)) throw new Error("SOLVER_SNAPSHOT_INVALID: Current assignment snapshot contains a malformed row.");
    if (String(row.studio_id) !== studioId) throw new Error("SOLVER_SNAPSHOT_TENANT_LEAK: Snapshot contains an assignment from another studio.");
    if (!currentScheduleId || String(row.schedule_version_id) !== currentScheduleId) {
      throw new Error("SOLVER_SNAPSHOT_HISTORICAL_ASSIGNMENT_LEAK: Snapshot contains an assignment outside the current ScheduleVersion.");
    }
    return mapAssignment(row);
  });
  const scheduleVersions = currentScheduleRaw ? [mapSchedule(currentScheduleRaw, assignments)] : [];
  if (scheduleVersions[0] && (scheduleVersions[0].version !== contextToken.scheduleVersion || scheduleVersions[0].id !== contextToken.scheduleId)) {
    throw new Error("SOLVER_SNAPSHOT_INVALID: Current ScheduleVersion and context token disagree.");
  }

  let publishedConstraintModel: SolverSnapshotPublishedConstraintModel | null = null;
  if (isRecord(raw.constraintModelVersion)) {
    if (integrity.constraintModelSnapshotHashValid !== true) {
      throw new Error("SOLVER_CONSTRAINT_MODEL_HASH_MISMATCH: Current ConstraintModelVersion snapshot does not match its stored hash.");
    }
    publishedConstraintModel = {
      version: Number(raw.constraintModelVersion.version),
      rulebookVersion: Number(raw.constraintModelVersion.rulebook_version),
      compilerVersion: String(raw.constraintModelVersion.compiler_version),
      snapshotHash: String(raw.constraintModelVersion.snapshot_hash || ""),
      complete: Boolean(raw.constraintModelVersion.complete_hard_constraint_compilation),
      snapshot: raw.constraintModelVersion.snapshot as ConstraintModelDefinitionV1,
    };
    if (publishedConstraintModel.version !== contextToken.constraintModelVersion
        || publishedConstraintModel.snapshotHash !== contextToken.constraintModelSnapshotHash) {
      throw new Error("SOLVER_SNAPSHOT_INVALID: ConstraintModelVersion and context token disagree.");
    }
  } else if (contextToken.constraintModelVersion !== null) {
    throw new Error("SOLVER_SNAPSHOT_INVALID: Context token references a missing ConstraintModelVersion.");
  }

  return {
    contextToken,
    publishedConstraintModel,
    state: {
      studioId,
      studioName: String(raw.studio.name || "DWDE Studio"),
      ...planningFacts,
      rules,
      rulebookVersions: [rulebook],
      enforcementVersions,
      planningDatasetVersions: [planning],
      enforcementProposals: [],
      ruleHistory: [],
      scheduleVersions,
      scenarios: [],
      auditEvents: [],
    },
  };
}

export async function loadCanonicalSolverSnapshot(
  supabase: SupabaseClient,
  studioId: string,
): Promise<CanonicalSolverSnapshot> {
  const result = await supabase.rpc("get_solver_snapshot_v43", { p_studio_id: studioId });
  if (result.error) throw result.error;
  return parseCanonicalSolverSnapshotPayload(result.data, studioId);
}

export async function loadCurrentSolverContextToken(
  supabase: SupabaseClient,
  studioId: string,
): Promise<SolverSnapshotContextToken> {
  const result = await supabase.rpc("get_solver_context_token_v43", { p_studio_id: studioId });
  if (result.error) throw result.error;
  if (!isRecord(result.data) || result.data.schemaVersion !== "1.0" || result.data.studioId !== studioId) {
    throw new Error("SOLVER_SNAPSHOT_INVALID: Current solver context token is malformed.");
  }
  return result.data as unknown as SolverSnapshotContextToken;
}

export async function loadCanonicalSolverStudioState(
  supabase: SupabaseClient,
  studioId: string,
): Promise<StudioState> {
  return (await loadCanonicalSolverSnapshot(supabase, studioId)).state;
}
'''

route = r'''import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase";
import {
  loadCanonicalSolverSnapshot,
  loadCurrentSolverContextToken,
  solverSnapshotContextTokensMatch,
  type CanonicalSolverSnapshot,
} from "@/lib/server-studio-state";
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
  supabase: SupabaseClient,
  problem: FeasibilitySolverProblem,
  published: PublishedConstraintModelRecord | null,
) {
  const decision = constraintModelSyncDecision(problem, published);
  if (decision.action !== "PUBLISH") return false;

  const definition = constraintModelDefinition(problem.constraintModel);
  const result = await supabase.rpc("publish_constraint_model_v30", {
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
  options: { syncPublishedModel?: boolean } = {},
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
  if (options.syncPublishedModel && await publishConstraintModelForSolve(supabase, preparation.problem, published)) {
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
'''

migration = r'''-- T07 / V4.3 coherent solver snapshot boundary.
--
-- Solver preparation must never combine mutable rows read at different moments.
-- The public RPCs below expose one member-authorized, statement-stable snapshot
-- containing immutable PlanningDatasetVersion facts, current policy/model pointers,
-- and only the current ScheduleVersion assignments. Historical rows remain stored
-- and queryable through their normal version/history surfaces, but are not sent to
-- a new feasibility solve.

create or replace function private.build_solver_context_token_v43(p_studio_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  with current_rulebook as (
    select rb.* from public.rulebook_versions rb
    where rb.studio_id=p_studio_id and rb.status='CURRENT'
    order by rb.version desc limit 1
  ),
  current_planning as (
    select pd.* from public.planning_dataset_versions pd
    where pd.studio_id=p_studio_id and pd.status='CURRENT'
    order by pd.version desc limit 1
  ),
  current_enforcement as (
    select ev.* from public.rule_enforcement_versions ev
    where ev.studio_id=p_studio_id and ev.status='CURRENT'
    order by ev.version desc limit 1
  ),
  current_model as (
    select cm.* from public.constraint_model_versions cm
    where cm.studio_id=p_studio_id and cm.status='CURRENT'
    order by cm.version desc limit 1
  ),
  current_schedule as (
    select sv.* from public.schedule_versions sv
    where sv.studio_id=p_studio_id and sv.is_current
    order by sv.version desc limit 1
  ),
  rules_state as (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) as snapshot
    from public.rules r where r.studio_id=p_studio_id
  ),
  assignment_state as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',a.id,'sessionId',a.session_id,'day',a.day,
        'startTime',a.start_time,'endTime',a.end_time,
        'teacherId',a.teacher_id,'roomId',a.room_id,
        'locked',a.locked,'status',a.status
      ) order by a.id
    ), '[]'::jsonb) as snapshot
    from public.assignments a
    where a.studio_id=p_studio_id
      and a.schedule_version_id=(select id from current_schedule)
  )
  select jsonb_build_object(
    'schemaVersion','1.0',
    'studioId',p_studio_id::text,
    'rulebookVersion',(select version from current_rulebook),
    'rulebookId',(select id::text from current_rulebook),
    'rulebookSourceHash',(select source_hash from current_rulebook),
    'rulebookSnapshotHash',(select private.planning_dataset_hash_v25(snapshot) from current_rulebook),
    'rulesHash',private.planning_dataset_hash_v25((select snapshot from rules_state)),
    'planningDatasetVersion',(select version from current_planning),
    'planningDatasetId',(select id::text from current_planning),
    'planningSnapshotHash',(select snapshot_hash from current_planning),
    'planningConfirmedForSchedulingAt',(select confirmed_for_scheduling_at from current_planning),
    'enforcementVersion',(select version from current_enforcement),
    'enforcementId',(select id::text from current_enforcement),
    'constraintModelVersion',(select version from current_model),
    'constraintModelId',(select id::text from current_model),
    'constraintModelSnapshotHash',(select snapshot_hash from current_model),
    'scheduleVersion',(select version from current_schedule),
    'scheduleId',(select id::text from current_schedule),
    'scheduleRulebookVersion',(select rulebook_version from current_schedule),
    'scheduleEnforcementVersion',(select enforcement_version from current_schedule),
    'schedulePlanningDatasetVersion',(select planning_dataset_version from current_schedule),
    'scheduleConstraintModelVersion',(select constraint_model_version from current_schedule),
    'scheduleAssignmentsHash',private.planning_dataset_hash_v25((select snapshot from assignment_state))
  )
$function$;

revoke all on function private.build_solver_context_token_v43(uuid) from public,anon,authenticated;

create or replace function public.get_solver_context_token_v43(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;
  return private.build_solver_context_token_v43(p_studio_id);
end
$function$;

create or replace function public.get_solver_snapshot_v43(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_member(p_studio_id) then raise exception 'Studio membership required'; end if;

  select jsonb_build_object(
    'contextToken',private.build_solver_context_token_v43(p_studio_id),
    'integrity',jsonb_build_object(
      'planningSnapshotHashValid',coalesce((
        select private.planning_dataset_hash_v25(pd.snapshot)=pd.snapshot_hash
        from public.planning_dataset_versions pd
        where pd.studio_id=p_studio_id and pd.status='CURRENT'
        order by pd.version desc limit 1
      ),false),
      'constraintModelSnapshotHashValid',coalesce((
        select private.constraint_model_hash_v27(cm.snapshot)=cm.snapshot_hash
        from public.constraint_model_versions cm
        where cm.studio_id=p_studio_id and cm.status='CURRENT'
        order by cm.version desc limit 1
      ),true)
    ),
    'studio',(select jsonb_build_object('id',s.id,'name',s.name) from public.studios s where s.id=p_studio_id),
    'rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.rules r where r.studio_id=p_studio_id),'[]'::jsonb),
    'rulebookVersion',(select to_jsonb(rb) from public.rulebook_versions rb where rb.studio_id=p_studio_id and rb.status='CURRENT' order by rb.version desc limit 1),
    'enforcementVersion',(select to_jsonb(ev) from public.rule_enforcement_versions ev where ev.studio_id=p_studio_id and ev.status='CURRENT' order by ev.version desc limit 1),
    'planningDatasetVersion',(select to_jsonb(pd) from public.planning_dataset_versions pd where pd.studio_id=p_studio_id and pd.status='CURRENT' order by pd.version desc limit 1),
    'constraintModelVersion',(select to_jsonb(cm) from public.constraint_model_versions cm where cm.studio_id=p_studio_id and cm.status='CURRENT' order by cm.version desc limit 1),
    'currentSchedule',(select to_jsonb(sv) from public.schedule_versions sv where sv.studio_id=p_studio_id and sv.is_current order by sv.version desc limit 1),
    'currentAssignments',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.id)
      from public.assignments a
      where a.studio_id=p_studio_id
        and a.schedule_version_id=(select sv.id from public.schedule_versions sv where sv.studio_id=p_studio_id and sv.is_current order by sv.version desc limit 1)
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end
$function$;

revoke all on function public.get_solver_context_token_v43(uuid) from public,anon;
revoke all on function public.get_solver_snapshot_v43(uuid) from public,anon;
grant execute on function public.get_solver_context_token_v43(uuid) to authenticated,service_role;
grant execute on function public.get_solver_snapshot_v43(uuid) to authenticated,service_role;
'''

test = r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseCanonicalSolverSnapshotPayload,
  solverSnapshotContextTokensMatch,
  type SolverSnapshotContextToken,
} from "@/lib/server-studio-state";

const migration = readFileSync("supabase/migrations/20260907050000_coherent_solver_snapshot_v43.sql", "utf8");
const serverState = readFileSync("lib/server-studio-state.ts", "utf8");
const route = readFileSync("app/api/solver/feasibility/route.ts", "utf8");
const now = "2026-09-07T04:00:00Z";

function token(overrides: Partial<SolverSnapshotContextToken> = {}): SolverSnapshotContextToken {
  return {
    schemaVersion: "1.0",
    studioId: "studio",
    rulebookVersion: 3,
    rulebookId: "rb3",
    rulebookSourceHash: "r".repeat(64),
    rulebookSnapshotHash: "b".repeat(64),
    rulesHash: "c".repeat(64),
    planningDatasetVersion: 7,
    planningDatasetId: "pd7",
    planningSnapshotHash: "d".repeat(64),
    planningConfirmedForSchedulingAt: now,
    enforcementVersion: null,
    enforcementId: null,
    constraintModelVersion: null,
    constraintModelId: null,
    constraintModelSnapshotHash: null,
    scheduleVersion: null,
    scheduleId: null,
    scheduleRulebookVersion: null,
    scheduleEnforcementVersion: null,
    schedulePlanningDatasetVersion: null,
    scheduleConstraintModelVersion: null,
    scheduleAssignmentsHash: "e".repeat(64),
    ...overrides,
  };
}

function payload() {
  return {
    contextToken: token(),
    integrity: { planningSnapshotHashValid: true, constraintModelSnapshotHashValid: true },
    studio: { id: "studio", name: "Pinned Studio" },
    rules: [],
    rulebookVersion: {
      id: "rb3", version: 3, name: "Rulebook v3", created_at: now, actor_label: "test", reason: "test",
      changed_rule_ids: [], status: "CURRENT", snapshot: [], source_hash: "r".repeat(64),
    },
    enforcementVersion: null,
    planningDatasetVersion: {
      id: "pd7", version: 7, created_at: now, actor_label: "test", reason: "test", snapshot_hash: "d".repeat(64), status: "CURRENT",
      confirmed_for_scheduling_at: now,
      snapshot: {
        schemaVersion: "1.3", studioId: "studio", teacherIds: ["teacher-1"],
        teachers: [{ id: "teacher-1", name: "Pinned Teacher" }],
        rooms: [{ id: "room-1", name: "Pinned Room", capacity: 20, features: ["barre"] }],
        students: [{ id: "student-1", name: "Pinned Student", level: "Level 1", cohortIds: ["cohort-1"] }],
        cohorts: [{ id: "cohort-1", name: "Pinned Cohort", studentIds: ["student-1"] }],
        classes: [{ id: "class-1", name: "Pinned Class", subject: "Ballet", level: "Level 1", durationMinutes: 60, weeklyFrequency: 1, rosterStudentIds: ["student-1"], companyOnly: false }],
        sessions: [{ id: "session-1", classId: "class-1", ordinal: 1, durationMinutes: 60, locked: false }],
      },
    },
    constraintModelVersion: null,
    currentSchedule: null,
    currentAssignments: [],
  };
}

describe("coherent solver snapshot", () => {
  it("reconstructs solver-significant planning facts only from the pinned immutable Planning Dataset snapshot", () => {
    const parsed = parseCanonicalSolverSnapshotPayload(payload(), "studio");
    expect(parsed.state.studioName).toBe("Pinned Studio");
    expect(parsed.state.teachers).toEqual([{ id: "teacher-1", name: "Pinned Teacher", subjects: [] }]);
    expect(parsed.state.rooms[0]).toMatchObject({ id: "room-1", name: "Pinned Room", capacity: 20 });
    expect(parsed.state.students[0].name).toBe("Pinned Student");
    expect(parsed.state.classes[0].name).toBe("Pinned Class");
    expect(parsed.state.sessions).toEqual([{ id: "session-1", classId: "class-1", ordinal: 1, durationMinutes: 60, locked: false }]);
  });

  it("fails closed for an older immutable snapshot that lacks names instead of filling from mutable current rows", () => {
    const raw = payload();
    raw.planningDatasetVersion.snapshot = {
      schemaVersion: "1.0", studioId: "studio", teacherIds: ["teacher-1"],
      rooms: [], students: [], cohorts: [], classes: [], sessions: [],
    } as typeof raw.planningDatasetVersion.snapshot;
    expect(() => parseCanonicalSolverSnapshotPayload(raw, "studio")).toThrow(/SOLVER_PLANNING_SNAPSHOT_SCHEMA_UNSUPPORTED/);
  });

  it("rejects historical or cross-schedule assignments inside the current solver snapshot", () => {
    const raw = payload();
    raw.contextToken = token({ scheduleVersion: 9, scheduleId: "schedule-current", scheduleRulebookVersion: 3, schedulePlanningDatasetVersion: 7 });
    raw.currentSchedule = {
      id: "schedule-current", version: 9, rulebook_version: 3, enforcement_version: 0, planning_dataset_version: 7,
      created_at: now, actor_label: "test", reason: "test", is_current: true, validation_result: null,
    } as unknown as null;
    raw.currentAssignments = [{
      id: "historical-assignment", studio_id: "studio", schedule_version_id: "schedule-old", session_id: "session-1",
      day: "Monday", start_time: "17:00", end_time: "18:00", teacher_id: "teacher-1", room_id: "room-1", locked: false, status: "NORMAL",
    }];
    expect(() => parseCanonicalSolverSnapshotPayload(raw, "studio")).toThrow(/SOLVER_SNAPSHOT_HISTORICAL_ASSIGNMENT_LEAK/);
  });

  it("treats any policy/planning/model/schedule token drift as a different solver context", () => {
    const original = token();
    expect(solverSnapshotContextTokensMatch(original, { ...original })).toBe(true);
    expect(solverSnapshotContextTokensMatch(original, token({ rulesHash: "f".repeat(64) }))).toBe(false);
    expect(solverSnapshotContextTokensMatch(original, token({ planningDatasetVersion: 8 }))).toBe(false);
    expect(solverSnapshotContextTokensMatch(original, token({ constraintModelVersion: 2 }))).toBe(false);
    expect(solverSnapshotContextTokensMatch(original, token({ scheduleVersion: 10 }))).toBe(false);
    expect(solverSnapshotContextTokensMatch(original, token({ scheduleAssignmentsHash: "0".repeat(64) }))).toBe(false);
  });

  it("uses one authenticated snapshot RPC and excludes mutable planning-table fan-out", () => {
    expect(serverState).toContain('.rpc("get_solver_snapshot_v43"');
    for (const table of ["teachers", "rooms", "students", "class_definitions", "class_sessions", "assignments"]) {
      expect(serverState).not.toContain(`.from("${table}")`);
    }
    expect(migration).toContain("stable");
    expect(migration).toMatch(/a\.schedule_version_id=\(select id from current_schedule\)/);
    expect(migration).toContain("planningSnapshotHashValid");
    expect(migration).toContain("constraintModelSnapshotHashValid");
  });

  it("rechecks the coherent context immediately before and after the external solve", () => {
    const calls = route.match(/snapshotContextIsCurrent\(/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3); // definition + pre-solve + post-solve
    expect(route).toContain("SOLVER_CONTEXT_CHANGED_RETRY");
    expect(route).toContain("Reload the complete coherent snapshot");
  });
});
'''

t07_db = r'''const coherentSolverSnapshotSql = String.raw`
set search_path=public,extensions;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $block$
declare
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_snapshot jsonb;
  v_before jsonb;
  v_after jsonb;
  v_original_description text;
  v_current_schedule uuid;
  v_current_assignment text;
  v_current_count integer;
  v_all_count integer;
begin
  v_snapshot := public.get_solver_snapshot_v43(v_studio);
  v_before := v_snapshot->'contextToken';

  if (v_snapshot->'integrity'->>'planningSnapshotHashValid')::boolean is distinct from true then
    raise exception 'T07 Planning Dataset snapshot hash did not verify';
  end if;
  if (v_snapshot->'integrity'->>'constraintModelSnapshotHashValid')::boolean is distinct from true then
    raise exception 'T07 Constraint Model snapshot hash did not verify';
  end if;
  if (v_snapshot->'planningDatasetVersion'->>'snapshot_hash') is distinct from (v_before->>'planningSnapshotHash') then
    raise exception 'T07 planning row/hash token mismatch';
  end if;
  if v_snapshot ? 'teachers' or v_snapshot ? 'rooms' or v_snapshot ? 'classes' then
    raise exception 'T07 snapshot RPC leaked mutable planning tables instead of the PlanningDatasetVersion snapshot';
  end if;

  select id into v_current_schedule from public.schedule_versions where studio_id=v_studio and is_current;
  select count(*) into v_current_count from public.assignments where studio_id=v_studio and schedule_version_id=v_current_schedule;
  select count(*) into v_all_count from public.assignments where studio_id=v_studio;
  if jsonb_array_length(v_snapshot->'currentAssignments') <> v_current_count then
    raise exception 'T07 current-assignment snapshot count mismatch';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_snapshot->'currentAssignments') item
    where item->>'schedule_version_id' is distinct from v_current_schedule::text
  ) then
    raise exception 'T07 snapshot included a historical ScheduleVersion assignment';
  end if;
  if v_all_count <= v_current_count then
    raise exception 'T07 fixture did not contain historical assignments needed to prove exclusion';
  end if;

  select description into v_original_description from public.rules where studio_id=v_studio and id='OPS-002';
  update public.rules set description=description||' [T07 transient policy drift]' where studio_id=v_studio and id='OPS-002';
  v_after := public.get_solver_context_token_v43(v_studio);
  if v_after = v_before or v_after->>'rulesHash' = v_before->>'rulesHash' then
    raise exception 'T07 policy mutation did not invalidate the coherent context token';
  end if;
  update public.rules set description=v_original_description where studio_id=v_studio and id='OPS-002';

  select a.id into v_current_assignment
  from public.assignments a where a.studio_id=v_studio and a.schedule_version_id=v_current_schedule
  order by a.id limit 1;
  if v_current_assignment is null then raise exception 'T07 fixture has no current assignment'; end if;
  v_before := public.get_solver_context_token_v43(v_studio);
  update public.assignments set locked=not locked where studio_id=v_studio and id=v_current_assignment;
  v_after := public.get_solver_context_token_v43(v_studio);
  if v_after = v_before or v_after->>'scheduleAssignmentsHash' = v_before->>'scheduleAssignmentsHash' then
    raise exception 'T07 lock/assignment mutation did not invalidate the coherent context token';
  end if;
  update public.assignments set locked=not locked where studio_id=v_studio and id=v_current_assignment;
end
$block$;
reset role;

select 'T07 PASS: one coherent snapshot uses pinned planning facts/current assignments only; policy and lock/schedule drift invalidate the context token' as result;
`;
'''

Path("lib/server-studio-state.ts").write_text(server_state, encoding="utf-8", newline="\n")
Path("app/api/solver/feasibility/route.ts").write_text(route, encoding="utf-8", newline="\n")
Path("supabase/migrations/20260907050000_coherent_solver_snapshot_v43.sql").write_text(migration, encoding="utf-8", newline="\n")
Path("tests/coherent-solver-snapshot.test.ts").write_text(test, encoding="utf-8", newline="\n")

p = Path("scripts/test-db.mjs")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "\nfunction psql(container, user, sql, label) {", "\n" + t07_db + "\nfunction psql(container, user, sql, label) {", "T07 DB fixture insertion")
old_call = "    const archiveAwareOutput = psql(container, 'postgres', archiveAwareAdoptionSql, 'T06 archive-aware adoption integration tests');\n    process.stdout.write(archiveAwareOutput);"
new_call = old_call + "\n    const coherentSnapshotOutput = psql(container, 'postgres', coherentSolverSnapshotSql, 'T07 coherent solver snapshot integration tests');\n    process.stdout.write(coherentSnapshotOutput);"
text = replace_once(text, old_call, new_call, "T07 DB invocation")
p.write_text(text, encoding="utf-8", newline="\n")

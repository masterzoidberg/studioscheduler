import type { SupabaseClient } from "@supabase/supabase-js";
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

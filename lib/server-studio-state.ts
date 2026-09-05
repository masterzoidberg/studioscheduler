import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Assignment,
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

export async function loadCanonicalSolverStudioState(
  supabase: SupabaseClient,
  studioId: string,
): Promise<StudioState> {
  const [studioQ, teachersQ, roomsQ, studentsQ, cohortsQ, classesQ, sessionsQ, rulesQ, rulebookQ, enforcementQ, planningQ, scheduleQ, assignmentsQ] = await Promise.all([
    supabase.from("studios").select("id,name").eq("id", studioId).single(),
    supabase.from("teachers").select("*").eq("studio_id", studioId).is("archived_at", null).order("id"),
    supabase.from("rooms").select("*").eq("studio_id", studioId).is("archived_at", null).order("id"),
    supabase.from("students").select("*").eq("studio_id", studioId).is("archived_at", null).order("id"),
    supabase.from("cohorts").select("*").eq("studio_id", studioId).order("id"),
    supabase.from("class_definitions").select("*").eq("studio_id", studioId).is("archived_at", null).order("id"),
    supabase.from("class_sessions").select("*").eq("studio_id", studioId).is("archived_at", null).order("id"),
    supabase.from("rules").select("*").eq("studio_id", studioId).order("id"),
    supabase.from("rulebook_versions").select("*").eq("studio_id", studioId).eq("status", "CURRENT").order("version", { ascending: false }),
    supabase.from("rule_enforcement_versions").select("*").eq("studio_id", studioId).eq("status", "CURRENT").order("version", { ascending: false }),
    supabase.from("planning_dataset_versions").select("*").eq("studio_id", studioId).eq("status", "CURRENT").order("version", { ascending: false }),
    supabase.from("schedule_versions").select("*").eq("studio_id", studioId).eq("is_current", true).order("version", { ascending: false }),
    supabase.from("assignments").select("*").eq("studio_id", studioId).order("id"),
  ]);

  const firstError = [studioQ, teachersQ, roomsQ, studentsQ, cohortsQ, classesQ, sessionsQ, rulesQ, rulebookQ, enforcementQ, planningQ, scheduleQ, assignmentsQ]
    .find((query) => query.error)?.error;
  if (firstError) throw firstError;

  const assignmentsBySchedule = new Map<string, Assignment[]>();
  for (const row of assignmentsQ.data || []) {
    const scheduleId = String(row.schedule_version_id);
    const items = assignmentsBySchedule.get(scheduleId) || [];
    items.push(mapAssignment(row as Record<string, unknown>));
    assignmentsBySchedule.set(scheduleId, items);
  }

  return {
    studioId,
    studioName: String(studioQ.data?.name || "DWDE Studio"),
    teachers: (teachersQ.data || []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      subjects: row.subjects || [],
      notes: row.notes || undefined,
      displayColor: row.display_color || undefined,
    })),
    rooms: (roomsQ.data || []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      capacity: row.capacity == null ? undefined : Number(row.capacity),
      features: row.features || [],
    })),
    students: (studentsQ.data || []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      level: String(row.level || ""),
      cohortIds: row.cohort_ids || [],
    })),
    cohorts: (cohortsQ.data || []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      studentIds: row.student_ids || [],
    })),
    classes: (classesQ.data || []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      subject: String(row.subject || ""),
      level: String(row.level || ""),
      durationMinutes: Number(row.duration_minutes || 0),
      weeklyFrequency: Number(row.weekly_frequency || 0),
      rosterStudentIds: row.roster_student_ids || [],
      eligibleTeacherIds: row.eligible_teacher_ids || [],
      companyOnly: Boolean(row.company_only),
    })),
    sessions: (sessionsQ.data || []).map((row) => ({
      id: String(row.id),
      classId: String(row.class_id),
      ordinal: Number(row.ordinal),
      durationMinutes: row.duration_minutes == null ? undefined : Number(row.duration_minutes),
      locked: Boolean(row.locked),
    })),
    rules: (rulesQ.data || []).map((row) => mapRule(row as Record<string, unknown>)),
    rulebookVersions: (rulebookQ.data || []).map((row) => mapRulebook(row as Record<string, unknown>)),
    enforcementVersions: (enforcementQ.data || []).map((row) => mapEnforcement(row as Record<string, unknown>)),
    planningDatasetVersions: (planningQ.data || []).map((row) => mapPlanningDataset(row as Record<string, unknown>)),
    enforcementProposals: [],
    ruleHistory: [],
    scheduleVersions: (scheduleQ.data || []).map((row) => {
      const scheduleId = String(row.id);
      return mapSchedule(row as Record<string, unknown>, assignmentsBySchedule.get(scheduleId) || []);
    }),
    scenarios: [],
    auditEvents: [],
  };
}

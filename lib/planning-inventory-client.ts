import { getBrowserSupabase } from "@/lib/supabase";

export type PlanningEntityType = "TEACHER" | "STUDENT" | "ROOM" | "CLASS";
export type PlanningEntityOperation = "CREATE" | "UPDATE";

export interface PlanningInventoryMutationInput {
  studioId: string;
  operation: PlanningEntityOperation;
  entityType: PlanningEntityType;
  entityId?: string | null;
  changes: Record<string, unknown>;
  reason: string;
  expectedPlanningDatasetVersion: number;
}

export interface PlanningInventoryMutationResult {
  ok: boolean;
  error?: string;
  entityId?: string;
  planningDatasetVersion?: number;
  scheduleRequiresRevalidation?: boolean;
  details?: Record<string, unknown>;
}

export interface ReviewedRequiredClassMutationInput {
  studioId: string;
  changes: Record<string, unknown>;
  reason: string;
  expectedPlanningDatasetVersion: number;
  evidence: {
    rosterReviewed: boolean;
    companyScopeReviewed: boolean;
    curriculumFieldsReviewed: boolean;
  };
}

export interface RulebookStructureRepairMutationInput {
  studioId: string;
  classId: string;
  reason: string;
  expectedPlanningDatasetVersion: number;
}

export interface RulebookRosterRepairMutationInput {
  studioId: string;
  classId: string;
  reason: string;
  expectedPlanningDatasetVersion: number;
}

export interface ClassSessionDurationMutationInput {
  studioId: string;
  classId: string;
  /** Session ID -> override minutes. null means inherit the class-level duration. */
  sessionDurations: Record<string, number | null>;
  reason: string;
  expectedPlanningDatasetVersion: number;
}

export interface ClassSessionDurationMutationResult {
  ok: boolean;
  error?: string;
  planningDatasetVersion?: number;
  scheduleRequiresRevalidation?: boolean;
  changedSessions?: number;
  details?: Record<string, unknown>;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

function planningMutationResult(data: unknown): PlanningInventoryMutationResult {
  const details = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return {
    ok: true,
    entityId: details.entityId ? String(details.entityId) : details.classId ? String(details.classId) : undefined,
    planningDatasetVersion: details.planningDatasetVersion == null ? undefined : Number(details.planningDatasetVersion),
    scheduleRequiresRevalidation: Boolean(details.scheduleRequiresRevalidation),
    details,
  };
}

export async function mutatePlanningEntity(input: PlanningInventoryMutationInput): Promise<PlanningInventoryMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("mutate_planning_entity_v63", {
      p_studio_id: input.studioId,
      p_operation: input.operation,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId ?? null,
      p_changes: input.changes,
      p_reason: input.reason,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
    });
    if (error) throw error;
    return planningMutationResult(data);
  } catch (error) {
    return { ok: false, error: message(error).replace(/^.*?message[:=]\s*/i, "") };
  }
}

export async function createReviewedRequiredClass(
  input: ReviewedRequiredClassMutationInput,
): Promise<PlanningInventoryMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("create_reviewed_required_class_v63", {
      p_studio_id: input.studioId,
      p_changes: input.changes,
      p_reason: input.reason,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
      p_evidence: input.evidence,
    });
    if (error) throw error;
    return planningMutationResult(data);
  } catch (error) {
    return { ok: false, error: message(error).replace(/^.*?message[:=]\s*/i, "") };
  }
}

export async function applyRulebookStructureRepair(
  input: RulebookStructureRepairMutationInput,
): Promise<PlanningInventoryMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("apply_rulebook_structure_repair_v63", {
      p_studio_id: input.studioId,
      p_class_id: input.classId,
      p_reason: input.reason,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
    });
    if (error) throw error;
    return planningMutationResult(data);
  } catch (error) {
    return { ok: false, error: message(error).replace(/^.*?message[:=]\s*/i, "") };
  }
}

export async function applyRulebookRosterRepair(
  input: RulebookRosterRepairMutationInput,
): Promise<PlanningInventoryMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("apply_rulebook_roster_repair_v63", {
      p_studio_id: input.studioId,
      p_class_id: input.classId,
      p_reason: input.reason,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
    });
    if (error) throw error;
    return planningMutationResult(data);
  } catch (error) {
    return { ok: false, error: message(error).replace(/^.*?message[:=]\s*/i, "") };
  }
}

export async function updateClassSessionDurations(
  input: ClassSessionDurationMutationInput,
): Promise<ClassSessionDurationMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("update_class_session_durations_v63", {
      p_studio_id: input.studioId,
      p_class_id: input.classId,
      p_session_durations: input.sessionDurations,
      p_reason: input.reason,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
    });
    if (error) throw error;
    const details = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    return {
      ok: true,
      planningDatasetVersion: details.planningDatasetVersion == null ? undefined : Number(details.planningDatasetVersion),
      scheduleRequiresRevalidation: Boolean(details.scheduleRequiresRevalidation),
      changedSessions: details.changedSessions == null ? undefined : Number(details.changedSessions),
      details,
    };
  } catch (error) {
    return { ok: false, error: message(error).replace(/^.*?message[:=]\s*/i, "") };
  }
}

import { getBrowserSupabase } from "@/lib/supabase";

export type PlanningEntityType = "TEACHER" | "STUDENT" | "ROOM" | "CLASS";
export type PlanningEntityOperation = "CREATE" | "UPDATE";

export interface PlanningInventoryMutationInput {
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

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

export async function mutatePlanningEntity(input: PlanningInventoryMutationInput): Promise<PlanningInventoryMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("mutate_planning_entity_v28", {
      p_operation: input.operation,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId ?? null,
      p_changes: input.changes,
      p_reason: input.reason,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
    });
    if (error) throw error;
    const details = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    return {
      ok: true,
      entityId: details.entityId ? String(details.entityId) : undefined,
      planningDatasetVersion: details.planningDatasetVersion == null ? undefined : Number(details.planningDatasetVersion),
      scheduleRequiresRevalidation: Boolean(details.scheduleRequiresRevalidation),
      details,
    };
  } catch (error) {
    return { ok: false, error: message(error).replace(/^.*?message[:=]\s*/i, "") };
  }
}

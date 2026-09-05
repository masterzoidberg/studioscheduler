import { getBrowserSupabase } from "@/lib/supabase";
import type { PlanningEntityType } from "@/lib/planning-inventory-client";

export interface PlanningArchiveMutationInput {
  entityType: PlanningEntityType;
  entityId: string;
  archive: boolean;
  reason: string;
  expectedPlanningDatasetVersion: number;
}

export interface PlanningArchiveMutationResult {
  ok: boolean;
  error?: string;
  entityId?: string;
  planningDatasetVersion?: number;
  scheduleRequiresRevalidation?: boolean;
  changed?: boolean;
  details?: Record<string, unknown>;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

export async function setPlanningEntityArchived(
  input: PlanningArchiveMutationInput,
): Promise<PlanningArchiveMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("set_planning_entity_archive_v40", {
      p_entity_type: input.entityType,
      p_entity_id: input.entityId,
      p_archive: input.archive,
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
      changed: details.changed == null ? undefined : Boolean(details.changed),
      details,
    };
  } catch (error) {
    return { ok: false, error: message(error).replace(/^.*?message[:=]\s*/i, "") };
  }
}

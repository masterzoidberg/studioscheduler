import { getBrowserSupabase } from "@/lib/supabase";
import type { ReviewedPlanningImportRow } from "@/lib/reviewed-csv-intake";

export interface ReviewedCsvImportInput {
  studioId: string;
  batchId: string;
  rows: ReviewedPlanningImportRow[];
  expectedPlanningDatasetVersion: number;
  reason: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface ReviewedCsvImportResult {
  ok: boolean;
  error?: string;
  planningDatasetVersion?: number;
  replayed?: boolean;
  details?: Record<string, unknown>;
}

function rawMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

function friendlyMessage(error: unknown) {
  const raw = rawMessage(error);
  if (raw.includes("STALE_PLANNING_DATASET")) return "The planning inventory changed while this preview was open. Refresh the workspace, review the CSV again, and retry.";
  if (raw.includes("IMPORT_BATCH_ID_REUSE")) return "This import ID was already used for different data. Start a new preview before applying.";
  if (raw.includes("IMPORT_REVIEW_REQUIRED")) return "Review the complete preview before applying the CSV batch.";
  if (raw.includes("MISSING_ROSTER_REFERENCE")) return "The import contains a roster link to a student that is not present by stable ID.";
  if (raw.includes("FORMULA_LIKE_VALUE")) return "Formula-like exported values are not accepted. Replace them with plain text and preview again.";
  if (raw.includes("DUPLICATE_IMPORT_ENTITY") || raw.includes("DUPLICATE_ROSTER_REFERENCE")) return "The reviewed batch contains a duplicate stable ID or roster link.";
  return raw.replace(/^.*?message[:=]\s*/i, "");
}

export async function applyReviewedCsvImport(input: ReviewedCsvImportInput): Promise<ReviewedCsvImportResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("apply_reviewed_csv_import_v67", {
      p_studio_id: input.studioId,
      p_batch_id: input.batchId,
      p_rows: input.rows,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
      p_reason: input.reason,
      p_reviewed: true,
      p_source_metadata: input.sourceMetadata || { format: "CSV", schemaVersion: "1.0" },
    });
    if (error) throw error;
    const details = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    return {
      ok: true,
      planningDatasetVersion: details.planningDatasetVersion == null ? undefined : Number(details.planningDatasetVersion),
      replayed: Boolean(details.replayed),
      details,
    };
  } catch (error) {
    return { ok: false, error: friendlyMessage(error) };
  }
}

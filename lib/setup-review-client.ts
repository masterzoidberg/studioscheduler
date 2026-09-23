import { getBrowserSupabase } from "@/lib/supabase";

export type RoomCapacityReviewState =
  | "MISSING"
  | "NEEDS_REVIEW"
  | "CHANGED_SINCE_REVIEW"
  | "REVIEWED"
  | "BLOCKED";

export interface SetupReviewHistoryEntry {
  id: string;
  outcome: "REVIEWED_VALUE" | "REVIEWED_NO_ADDITIONAL_RESTRICTION" | "NEEDS_REVIEW";
  reviewerUserId: string;
  reviewerLabel: string;
  sourcePlanningDatasetVersion: number | null;
  note: string | null;
  createdAt: string;
}

export interface RoomCapacityReviewStatus {
  roomId: string;
  roomName: string;
  capacity: number | null;
  state: RoomCapacityReviewState;
  reviewSchemaVersion: number;
  currentFingerprint: string;
  planningDatasetVersion: number;
  history: SetupReviewHistoryEntry[];
}

export interface RoomCapacityReviewMutationInput {
  studioId: string;
  roomId: string;
  expectedPlanningDatasetVersion: number;
  expectedFingerprint: string;
  note?: string;
}

export interface RoomCapacityReviewMutationResult {
  ok: boolean;
  error?: string;
  code?: string;
  reviewId?: string;
  planningDatasetVersion?: number;
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? error);
  }
  return String(error);
}

function mapHistory(value: unknown): SetupReviewHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = object(item);
    return {
      id: String(row.id || ""),
      outcome: String(row.outcome || "NEEDS_REVIEW") as SetupReviewHistoryEntry["outcome"],
      reviewerUserId: String(row.reviewerUserId || ""),
      reviewerLabel: String(row.reviewerLabel || "Studio user"),
      sourcePlanningDatasetVersion: row.sourcePlanningDatasetVersion == null
        ? null
        : Number(row.sourcePlanningDatasetVersion),
      note: row.note == null ? null : String(row.note),
      createdAt: String(row.createdAt || ""),
    };
  });
}

export async function listRoomCapacityReviewStatuses(
  studioId: string,
): Promise<{ ok: boolean; data: RoomCapacityReviewStatus[]; error?: string }> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("list_room_capacity_review_status_v51", {
      p_studio_id: studioId,
    });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return {
      ok: true,
      data: rows.map((item) => {
        const row = object(item);
        return {
          roomId: String(row.roomId || ""),
          roomName: String(row.roomName || row.roomId || "Room"),
          capacity: row.capacity == null ? null : Number(row.capacity),
          state: String(row.state || "NEEDS_REVIEW") as RoomCapacityReviewState,
          reviewSchemaVersion: Number(row.reviewSchemaVersion || 1),
          currentFingerprint: String(row.currentFingerprint || ""),
          planningDatasetVersion: Number(row.planningDatasetVersion || 0),
          history: mapHistory(row.history),
        };
      }),
    };
  } catch (error) {
    return { ok: false, data: [], error: message(error).replace(/^.*?message[:=]\s*/i, "") };
  }
}

export async function attestRoomCapacityReview(
  input: RoomCapacityReviewMutationInput,
): Promise<RoomCapacityReviewMutationResult> {
  try {
    const supabase = getBrowserSupabase();
    const sessionResult = await supabase.auth.getSession();
    const token = sessionResult.data.session?.access_token;
    if (sessionResult.error || !token) {
      return { ok: false, error: "An authenticated workspace is required.", code: "SETUP_REVIEW_AUTH_REQUIRED" };
    }

    const response = await fetch("/api/setup/review/room-capacity", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        studioId: input.studioId,
        roomId: input.roomId,
        expectedPlanningDatasetVersion: input.expectedPlanningDatasetVersion,
        expectedFingerprint: input.expectedFingerprint,
        outcome: "REVIEWED_VALUE",
        note: input.note?.trim() || null,
      }),
    });
    const payload = object(await response.json().catch(() => ({})));
    if (!response.ok) {
      return {
        ok: false,
        error: String(payload.error || "Room capacity review could not be saved."),
        code: payload.code ? String(payload.code) : undefined,
      };
    }
    return {
      ok: true,
      reviewId: payload.reviewId ? String(payload.reviewId) : undefined,
      planningDatasetVersion: payload.planningDatasetVersion == null
        ? undefined
        : Number(payload.planningDatasetVersion),
    };
  } catch (error) {
    return { ok: false, error: message(error), code: "SETUP_REVIEW_ERROR" };
  }
}

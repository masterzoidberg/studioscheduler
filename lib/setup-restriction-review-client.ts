import { getBrowserSupabase } from "@/lib/supabase";

export type RoomRestrictionReviewOutcome = "REVIEWED_VALUE" | "REVIEWED_NO_ADDITIONAL_RESTRICTION";
export type RoomRestrictionReviewState = "NEEDS_REVIEW" | "CHANGED_SINCE_REVIEW" | "REVIEWED";

export interface RoomRestrictionReviewHistory {
  id: string;
  outcome: string;
  reviewerUserId?: string;
  reviewerLabel: string;
  sourcePlanningDatasetVersion?: number;
  note?: string | null;
  createdAt: string;
}

export interface RoomRestrictionReviewStatus {
  roomId: string;
  roomName: string;
  state: RoomRestrictionReviewState;
  hasRestriction: boolean;
  currentFingerprint: string;
  rulebookVersion: number;
  planningDatasetVersion: number;
  history: RoomRestrictionReviewHistory[];
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

function statuses(data: unknown): RoomRestrictionReviewStatus[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is RoomRestrictionReviewStatus => Boolean(item && typeof item === "object" && "roomId" in item));
}

export async function listRoomRestrictionReviewStatus(studioId: string) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("list_room_restriction_review_status_v55", { p_studio_id: studioId });
    if (error) throw error;
    return { ok: true as const, items: statuses(data) };
  } catch (error) {
    return { ok: false as const, error: message(error), items: [] };
  }
}

export async function attestRoomRestrictionReview(input: {
  studioId: string;
  roomId: string;
  expectedRulebookVersion: number;
  expectedPlanningDatasetVersion: number;
  expectedFingerprint: string;
  outcome: RoomRestrictionReviewOutcome;
  note?: string;
}) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("attest_room_restriction_review_v55", {
      p_studio_id: input.studioId,
      p_room_id: input.roomId,
      p_expected_rulebook_version: input.expectedRulebookVersion,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
      p_expected_fingerprint: input.expectedFingerprint,
      p_outcome: input.outcome,
      p_note: input.note || null,
    });
    if (error) throw error;
    return { ok: true as const, details: (data && typeof data === "object" ? data : {}) as Record<string, unknown> };
  } catch (error) {
    return { ok: false as const, error: message(error) };
  }
}

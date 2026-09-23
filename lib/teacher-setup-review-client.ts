import { getBrowserSupabase } from "@/lib/supabase";

export type TeacherSetupReviewOutcome = "REVIEWED_VALUE" | "REVIEWED_NO_ADDITIONAL_RESTRICTION";
export type TeacherSetupReviewState = "NEEDS_REVIEW" | "CHANGED_SINCE_REVIEW" | "REVIEWED_VALUE" | "REVIEWED_NO_ADDITIONAL_RESTRICTION" | "BLOCKED";

export interface TeacherSetupReviewHistory {
  id: string;
  outcome: string;
  reviewerUserId?: string;
  reviewerLabel: string;
  sourcePlanningDatasetVersion?: number;
  note?: string | null;
  createdAt: string;
}

export interface TeacherSetupReviewStatus {
  teacherId: string;
  teacherName: string;
  availabilityState: TeacherSetupReviewState;
  qualificationState: TeacherSetupReviewState;
  hasAvailabilityPolicy: boolean;
  hasQualificationPolicy: boolean;
  availabilityFingerprint: string;
  qualificationFingerprint: string;
  rulebookVersion: number;
  planningDatasetVersion: number;
  availabilityHistory: TeacherSetupReviewHistory[];
  qualificationHistory: TeacherSetupReviewHistory[];
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

function statuses(data: unknown): TeacherSetupReviewStatus[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is TeacherSetupReviewStatus => Boolean(item && typeof item === "object" && "teacherId" in item));
}

export async function listTeacherSetupReviewStatus(studioId: string) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("list_teacher_setup_review_status_v56", { p_studio_id: studioId });
    if (error) throw error;
    return { ok: true as const, items: statuses(data) };
  } catch (error) {
    return { ok: false as const, error: message(error), items: [] };
  }
}

export async function attestTeacherSetupReview(input: {
  studioId: string;
  teacherId: string;
  aspect: "availability" | "qualification";
  expectedRulebookVersion: number;
  expectedPlanningDatasetVersion: number;
  expectedFingerprint: string;
  outcome: TeacherSetupReviewOutcome;
  note?: string;
}) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("attest_teacher_setup_review_v56", {
      p_studio_id: input.studioId,
      p_teacher_id: input.teacherId,
      p_aspect: input.aspect,
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

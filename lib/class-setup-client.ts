import { getBrowserSupabase } from "@/lib/supabase";
import type { ClassAssignmentPolicyDraft } from "@/lib/class-setup";

export type ClassSetupReviewState = "NEEDS_REVIEW" | "CHANGED_SINCE_REVIEW" | "REVIEWED" | "BLOCKED";

export interface ClassSetupReviewAspect {
  state: ClassSetupReviewState;
  currentFingerprint: string;
  value: {
    rosterStudentIds?: string[];
    missingRequiredStudentIds?: string[];
    companyOnly?: boolean;
    policyError?: string;
  };
  history: Array<{ id: string; outcome: string; reviewerLabel: string; note?: string | null; createdAt: string }>;
}

export interface ClassSetupReviewStatus {
  classId: string;
  className: string;
  planningDatasetVersion: number;
  structure: ClassSetupReviewAspect;
  roster: ClassSetupReviewAspect;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

export async function listClassSetupReviewStatus(studioId: string) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("list_class_setup_review_status_v57", { p_studio_id: studioId });
    if (error) throw error;
    return { ok: true as const, items: Array.isArray(data) ? data as ClassSetupReviewStatus[] : [] };
  } catch (error) {
    return { ok: false as const, error: message(error), items: [] };
  }
}

export async function attestClassSetupReview(input: {
  studioId: string;
  classId: string;
  aspect: "structure" | "roster";
  expectedPlanningDatasetVersion: number;
  expectedFingerprint: string;
  emptyRosterConfirmed?: boolean;
}) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("attest_class_setup_review_v57", {
      p_studio_id: input.studioId,
      p_class_id: input.classId,
      p_aspect: input.aspect,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
      p_expected_fingerprint: input.expectedFingerprint,
      p_empty_roster_confirmed: Boolean(input.emptyRosterConfirmed),
      p_note: input.aspect === "structure" ? "Reviewed weekly frequency and ordinal durations" : "Reviewed complete class roster and explicit scope",
    });
    if (error) throw error;
    return { ok: true as const, details: (data && typeof data === "object" ? data : {}) as Record<string, unknown> };
  } catch (error) {
    return { ok: false as const, error: message(error) };
  }
}

export async function applyClassAssignmentPolicies(input: {
  studioId: string;
  classId: string;
  draft: ClassAssignmentPolicyDraft;
  reason: string;
  expectedRulebookVersion: number;
  expectedEnforcementVersion: number;
  expectedPlanningDatasetVersion: number;
}) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("apply_class_assignment_policies_v57", {
      p_studio_id: input.studioId,
      p_class_id: input.classId,
      p_required_teacher_id: input.draft.requiredTeacherId || null,
      p_preferred_teacher_id: input.draft.preferredTeacherId || null,
      p_required_room_id: input.draft.requiredRoomId || null,
      p_preferred_room_id: input.draft.preferredRoomId || null,
      p_reason: input.reason,
      p_expected_rulebook_version: input.expectedRulebookVersion,
      p_expected_enforcement_version: input.expectedEnforcementVersion,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
    });
    if (error) throw error;
    const details = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    return { ok: true as const, rulebookVersion: Number(details.rulebookVersion || input.expectedRulebookVersion), details };
  } catch (error) {
    return { ok: false as const, error: message(error) };
  }
}

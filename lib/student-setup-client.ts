import { getBrowserSupabase } from "@/lib/supabase";
import type { SetupTypedPolicyPatch } from "@/lib/setup-policy";

export type Set06ReviewState = "NEEDS_REVIEW" | "CHANGED_SINCE_REVIEW" | "REVIEWED_VALUE" | "REVIEWED_NO_ADDITIONAL_RESTRICTION";
export interface Set06ReviewStatus {
  scopeKind: "STUDENT" | "RULE";
  entityId: string;
  label: string;
  aspect: "restrictions" | "interpretation";
  state: Set06ReviewState;
  currentFingerprint: string;
  rulebookVersion: number;
  planningDatasetVersion: number;
  value: Record<string, unknown>;
  history: Array<{ id: string; outcome: string; reviewerLabel: string; note?: string; createdAt: string }>;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

export async function applySet06Policies(input: { studioId: string; policies: SetupTypedPolicyPatch[]; reason: string; expectedRulebookVersion: number; expectedEnforcementVersion: number; expectedPlanningDatasetVersion: number }) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("apply_set06_policies_v59", {
      p_studio_id: input.studioId, p_policies: input.policies, p_reason: input.reason,
      p_expected_rulebook_version: input.expectedRulebookVersion, p_expected_enforcement_version: input.expectedEnforcementVersion,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
    });
    if (error) throw error;
    const details = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    return { ok: true as const, rulebookVersion: Number(details.rulebookVersion || input.expectedRulebookVersion), details };
  } catch (error) { return { ok: false as const, error: message(error) }; }
}

export async function listSet06ReviewStatus(studioId: string) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("list_set06_review_status_v59", { p_studio_id: studioId });
    if (error) throw error;
    return { ok: true as const, items: Array.isArray(data) ? data as Set06ReviewStatus[] : [] };
  } catch (error) { return { ok: false as const, error: message(error), items: [] }; }
}

export async function attestSet06Review(input: { studioId: string; status: Set06ReviewStatus; outcome: "REVIEWED_VALUE" | "REVIEWED_NO_ADDITIONAL_RESTRICTION" }) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("attest_set06_review_v59", {
      p_studio_id: input.studioId, p_scope_kind: input.status.scopeKind, p_entity_id: input.status.entityId,
      p_aspect: input.status.aspect, p_expected_rulebook_version: input.status.rulebookVersion,
      p_expected_planning_dataset_version: input.status.planningDatasetVersion, p_expected_fingerprint: input.status.currentFingerprint,
      p_outcome: input.outcome, p_note: input.status.scopeKind === "RULE" ? "Reviewed relationship direction, participants and timing" : "Reviewed student scheduling restrictions",
    });
    if (error) throw error;
    return { ok: true as const, details: data };
  } catch (error) { return { ok: false as const, error: message(error) }; }
}

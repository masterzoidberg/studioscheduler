import { getBrowserSupabase } from "@/lib/supabase";
import type { SetupTypedPolicyMutationResult, SetupTypedPolicyPatch } from "@/lib/setup-policy";

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

export async function applySetupTypedPolicies(input: {
  policies: SetupTypedPolicyPatch[];
    reason: string;
    expectedRulebookVersion: number;
    expectedEnforcementVersion: number;
    expectedPlanningDatasetVersion: number;
}): Promise<SetupTypedPolicyMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("apply_setup_typed_policies_v55", {
      p_policies: input.policies,
      p_reason: input.reason,
      p_expected_rulebook_version: input.expectedRulebookVersion,
      p_expected_enforcement_version: input.expectedEnforcementVersion,
      p_expected_planning_dataset_version: input.expectedPlanningDatasetVersion,
    });
    if (error) throw error;
    const details = data && typeof data === "object" ? data as Record<string, unknown> : {};
    return {
      ok: true,
      rulebookVersion: details.rulebookVersion == null ? undefined : Number(details.rulebookVersion),
      enforcementVersion: details.enforcementVersion == null ? undefined : Number(details.enforcementVersion),
      details,
    };
  } catch (error) {
    return { ok: false, error: message(error).replace(/^.*?message[:=]\s*/i, "") };
  }
}

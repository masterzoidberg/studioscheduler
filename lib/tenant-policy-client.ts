import { getBrowserSupabase } from "@/lib/supabase";
import type { TenantPolicyManifestV1 } from "@/lib/tenant-policy";

export interface TenantPolicyMutationError {
  code: string;
  message: string;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

function actionableError(error: unknown): TenantPolicyMutationError {
  const raw = message(error).replace(/\s+/g, " ").trim();
  const match = raw.match(/^([A-Z][A-Z0-9_]*):\s*(.*)$/);
  const code = match?.[1] ?? "TENANT_POLICY_CONVERSION_FAILED";
  const detail = (match?.[2] || "The tenant Rulebook conversion could not be applied.")
    .replace(/[0-9a-f]{64}/gi, "[redacted]")
    .replace(/\b(?:select|insert|update|delete|create|alter|drop)\b[^.]*\.?/gi, "[redacted technical detail]")
    .trim();
  return { code, message: detail };
}

export async function convertReviewedRulebookToTenantRecords(input: {
  studioId: string;
  expectedRulebookVersion: number;
  expectedRulebookSourceHash: string | null;
  manifest: TenantPolicyManifestV1;
  reason: string;
}) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("convert_reviewed_rulebook_to_tenant_records_v63", {
      p_studio_id: input.studioId,
      p_expected_rulebook_version: input.expectedRulebookVersion,
      p_expected_rulebook_source_hash: input.expectedRulebookSourceHash,
      p_manifest: input.manifest,
      p_reason: input.reason,
    });
    if (error) throw error;
    return {
      ok: true as const,
      details: (data && typeof data === "object" ? data : {}) as Record<string, unknown>,
    };
  } catch (error) {
    return { ok: false as const, error: actionableError(error) };
  }
}

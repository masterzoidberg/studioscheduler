export const SUPABASE_PUBLIC_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

type SupabasePublicEnvVar = (typeof SUPABASE_PUBLIC_ENV_VARS)[number];

type SupabasePublicInput = {
  url?: string | null;
  publishableKey?: string | null;
};

export type SupabasePublicConfiguration = {
  configured: boolean;
  url: string;
  publishableKey: string;
  missing: SupabasePublicEnvVar[];
  issue: string | null;
  message: string;
};

function normalized(value: string | null | undefined) {
  return value?.trim() || "";
}

function validHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveSupabasePublicConfiguration(input: SupabasePublicInput): SupabasePublicConfiguration {
  const url = normalized(input.url);
  const publishableKey = normalized(input.publishableKey);
  const missing: SupabasePublicEnvVar[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!publishableKey) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  const issue = url && !validHttpUrl(url)
    ? "NEXT_PUBLIC_SUPABASE_URL must be a valid http:// or https:// URL."
    : null;
  const configured = missing.length === 0 && issue === null;
  const detail = issue || (missing.length
    ? `Missing ${missing.join(" and ")}.`
    : "Supabase public configuration is available.");

  return {
    configured,
    url,
    publishableKey,
    missing,
    issue,
    message: configured
      ? detail
      : `Studio Scheduler is not configured for this environment. ${detail} No Supabase request was attempted.`,
  };
}

export function getSupabasePublicConfiguration(): SupabasePublicConfiguration {
  return resolveSupabasePublicConfiguration({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

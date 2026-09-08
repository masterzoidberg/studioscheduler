import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfiguration, type SupabasePublicConfiguration } from "@/lib/supabase-config";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";

export class SupabaseConfigurationError extends Error {
  readonly code = "SUPABASE_CONFIGURATION_REQUIRED";
  readonly configuration: SupabasePublicConfiguration;

  constructor(configuration: SupabasePublicConfiguration) {
    super(configuration.message);
    this.name = "SupabaseConfigurationError";
    this.configuration = configuration;
  }
}

function requireSupabasePublicConfiguration() {
  const configuration = getSupabasePublicConfiguration();
  if (!configuration.configured) throw new SupabaseConfigurationError(configuration);
  return configuration;
}

let browserClient: SupabaseClient | null = null;
let browserClientIdentity = "";

export function getBrowserSupabase() {
  const configuration = requireSupabasePublicConfiguration();
  const identity = `${configuration.url}\n${configuration.publishableKey}`;
  if (!browserClient || browserClientIdentity !== identity) {
    browserClient = createClient(configuration.url, configuration.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    browserClientIdentity = identity;
  }
  return browserClient;
}

export function getServerSupabase(authHeader?: string | null) {
  const configuration = requireSupabasePublicConfiguration();
  const headers: Record<string, string> = {};
  if (authHeader) headers.Authorization = authHeader;
  return createClient(configuration.url, configuration.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

/**
 * Privileged database access for server-only governance boundaries.
 * Never import this into client components and never expose the key through a
 * NEXT_PUBLIC_ variable. The caller must authorize the human user separately
 * before using this client for a mutation.
 */
export function getServerAdminSupabase() {
  if (typeof window !== "undefined") {
    throw new Error("Supabase admin access is server-only.");
  }
  const configuration = requireSupabasePublicConfiguration();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the application backend.");
  }
  return createClient(configuration.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function beginGoogleSignIn() {
  if (typeof window === "undefined") return { ok: false, message: "Google sign-in is available in the browser." };
  try {
    const supabase = getBrowserSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Opening Google sign-in…" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

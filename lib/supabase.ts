import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kbgzrefivxqoiwumfyui.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JVAvePo40-InAzhD_yPGJg_pefb2eMQ";

let browserClient: SupabaseClient | null = null;

export function getBrowserSupabase() {
  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return browserClient;
}

export function getServerSupabase(authHeader?: string | null) {
  const headers: Record<string, string> = {};
  if (authHeader) headers.Authorization = authHeader;
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

export async function beginGoogleSignIn() {
  if (typeof window === "undefined") return { ok: false, message: "Google sign-in is available in the browser." };
  const supabase = getBrowserSupabase();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Opening Google sign-in…" };
}

export function chatGptAuthAvailable() {
  return process.env.NEXT_PUBLIC_CHATGPT_AUTH_ENABLED === "true";
}

export function beginChatGptSignIn() {
  if (typeof window === "undefined") return;
  if (!chatGptAuthAvailable()) throw new Error("ChatGPT sign-in is not configured for this deployment.");
  const provider = process.env.NEXT_PUBLIC_CHATGPT_AUTH_PROVIDER || "custom:chatgpt";
  const redirectTo = `${window.location.origin}/`;
  window.location.assign(`${SUPABASE_URL}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectTo)}`);
}

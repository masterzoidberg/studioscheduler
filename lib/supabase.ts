import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kbgzrefivxqoiwumfyui.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JVAvePo40-InAzhD_yPGJg_pefb2eMQ";
export const ALPHA_PARAM = "access";
export const ALPHA_STORAGE_KEY = "dwde-alpha-access";

let browserClient: SupabaseClient | null = null;
let browserAlpha = "";

export function captureAlphaAccess(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  const incoming = url.searchParams.get(ALPHA_PARAM);
  if (incoming) {
    localStorage.setItem(ALPHA_STORAGE_KEY, incoming);
    url.searchParams.delete(ALPHA_PARAM);
    window.history.replaceState({}, "", url.toString());
    return incoming;
  }
  return localStorage.getItem(ALPHA_STORAGE_KEY) || "";
}

export function clearAlphaAccess() {
  if (typeof window !== "undefined") localStorage.removeItem(ALPHA_STORAGE_KEY);
  browserClient = null;
  browserAlpha = "";
}

export function getBrowserSupabase(alphaKey?: string) {
  const resolved = alphaKey ?? (typeof window !== "undefined" ? localStorage.getItem(ALPHA_STORAGE_KEY) || "" : "");
  if (!browserClient || browserAlpha !== resolved) {
    browserAlpha = resolved;
    browserClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: resolved ? { headers: { "x-dwde-alpha-key": resolved } } : undefined,
    });
  }
  return browserClient;
}

export function getServerSupabase(authHeader?: string | null, alphaKey?: string | null) {
  const headers: Record<string, string> = {};
  if (authHeader) headers.Authorization = authHeader;
  if (alphaKey) headers["x-dwde-alpha-key"] = alphaKey;
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

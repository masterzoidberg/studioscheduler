"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle, LogIn, Save, Trash2 } from "lucide-react";
import { beginGoogleSignIn, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase";
import { useWorkspace } from "@/components/workspace-provider";

type CredentialStatus = {
  configured: boolean;
  keyHint?: string | null;
  updatedAt?: string | null;
};

async function credentialRequest(accessToken: string, method: "GET" | "PUT" | "DELETE", apiKey?: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/user-openrouter`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: method === "PUT" ? JSON.stringify({ apiKey }) : undefined,
  });
  const data = await response.json() as CredentialStatus & { error?: string };
  if (!response.ok) throw new Error(data.error || "OpenRouter credential request failed.");
  return data;
}

export function OpenRouterAccountCard() {
  const { session } = useWorkspace();
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!session?.access_token) { setStatus(null); return; }
      try {
        const next = await credentialRequest(session.access_token, "GET");
        if (!cancelled) setStatus(next);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [session?.access_token]);

  async function connect() {
    const key = apiKey.trim();
    if (!session?.access_token || !key) return;
    setBusy(true); setMessage("");
    try {
      const next = await credentialRequest(session.access_token, "PUT", key);
      setStatus(next); setApiKey("");
      setMessage("OpenRouter is connected to this account. The saved key will follow this login across devices.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!session?.access_token) return;
    setBusy(true); setMessage("");
    try {
      await credentialRequest(session.access_token, "DELETE");
      setStatus({ configured: false });
      setMessage("OpenRouter key removed from this account.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  if (!session) {
    return <section className="rounded-2xl border border-violet-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><KeyRound className="size-5"/></div><div><h2 className="font-semibold">Save OpenRouter to your account</h2><p className="mt-1 text-sm leading-6 text-slate-600">Sign in with Google first. Then the OpenRouter key can be encrypted in Supabase Vault and tied to your account instead of one browser.</p></div></div>
      <button onClick={()=>void beginGoogleSignIn()} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><LogIn className="size-4"/>Sign in with Google</button>
      <p className="mt-3 text-xs leading-5 text-slate-500">Google is used only for studio identity. Your OpenRouter key is stored separately and is never sent to Google.</p>
    </section>;
  }

  return <section className="rounded-2xl border border-violet-200 bg-white p-5 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><KeyRound className="size-5"/></div><div><h2 className="font-semibold">OpenRouter account connection</h2><p className="mt-1 text-sm leading-6 text-slate-600">Signed in as <strong>{session.user.email || "studio user"}</strong>. Your key is encrypted in Supabase Vault and follows this account across devices.</p></div></div>
      {status?.configured?<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-3.5"/>Saved</span>:null}
    </div>

    {status?.configured?<div className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"><p className="font-semibold">Connected · {status.keyHint || "saved key"}</p><p className="mt-1 text-xs leading-5 text-emerald-800">The full key cannot be read back by the browser. Replace it below to rotate credentials.</p></div>:null}

    <div className="mt-5">
      <label htmlFor="openrouter-key" className="text-sm font-semibold text-slate-800">{status?.configured?"Replace OpenRouter API key":"OpenRouter API key"}</label>
      <input id="openrouter-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-or-v1-…" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm outline-none focus:border-slate-950"/>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button disabled={busy||!apiKey.trim()} onClick={()=>void connect()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy?<LoaderCircle className="size-4 animate-spin"/>:<Save className="size-4"/>}{status?.configured?"Replace saved key":"Save to my account"}</button>
        {status?.configured?<button disabled={busy} onClick={()=>void remove()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:opacity-40"><Trash2 className="size-4"/>Remove</button>:null}
      </div>
      <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900">Create or manage OpenRouter keys<ExternalLink className="size-3.5"/></a>
    </div>

    {message?<div className="mt-4 rounded-xl bg-slate-100 p-3 text-xs leading-5 text-slate-700">{message}</div>:null}
    <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Security boundary: the browser submits a new key once over HTTPS. Supabase Vault stores it encrypted. Later Copilot requests use the decrypted credential only inside the authenticated Supabase Edge Function.</div>
  </section>;
}

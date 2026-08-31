"use client";

import { useState } from "react";
import { ArrowRight, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { beginGoogleSignIn } from "@/lib/supabase";
import { useWorkspace } from "@/components/workspace-provider";

export function LoginScreen() {
  const { signInWithEmail } = useWorkspace();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await signInWithEmail(email.trim());
    setMessage(result.message);
    setBusy(false);
  }

  async function google() {
    setBusy(true); setMessage("");
    const result = await beginGoogleSignIn();
    if (!result.ok) { setMessage(result.message); setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-950 sm:grid sm:place-items-center">
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="bg-slate-900 px-6 py-7 text-white">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-white text-sm font-black text-slate-950">DW</div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">DWDE Studio Scheduler</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">One rulebook. One schedule.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">Sign in to review rules, validate changes, edit the schedule, and collaborate from your phone or desktop.</p>
        </div>
        <div className="p-6">
          <button type="button" disabled={busy} onClick={()=>void google()} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 font-semibold text-slate-800 disabled:opacity-50">
            <span className="grid size-6 place-items-center rounded-full border border-slate-200 text-sm font-bold text-blue-600">G</span>
            Continue with Google
          </button>
          <div className="my-5 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200"/><span className="text-xs font-semibold uppercase tracking-wider text-slate-400">or email</span><div className="h-px flex-1 bg-slate-200"/></div>
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm font-semibold text-slate-800" htmlFor="email">Email address</label>
            <div className="relative"><Mail className="absolute left-3 top-3 size-5 text-slate-400"/><input id="email" type="email" required autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-3 text-base outline-none focus:border-slate-950"/></div>
            <button disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 font-semibold text-white disabled:opacity-50">{busy ? "Working…" : "Email me a sign-in link"}<ArrowRight className="size-4"/></button>
          </form>
          {message ? <div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm leading-5 text-slate-700">{message}</div> : null}

          <div className="mt-6 grid gap-3 rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">
            <div className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0"/><span>Studio data is protected by Supabase Row Level Security.</span></div>
            <div className="flex gap-3"><KeyRound className="mt-0.5 size-4 shrink-0"/><span>OpenRouter credentials can be saved securely to your signed-in account from Settings.</span></div>
          </div>
        </div>
      </div>
    </main>
  );
}

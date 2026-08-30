"use client";

import { useState } from "react";
import { ArrowUp, Bot, CalendarSearch, FileDiff, Info, ShieldCheck, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

const prompts = [
  { icon: CalendarSearch, label: "Why is this class here?" },
  { icon: ShieldCheck, label: "Show hard rules in context" },
  { icon: FileDiff, label: "What changed recently?" },
];

export function CopilotPanel({ mobile = false, onClose }: { mobile?: boolean; onClose?: () => void }) {
  const [message, setMessage] = useState("");
  return (
    <aside aria-label="ChatGPT Copilot" className={cn("flex h-full min-h-0 flex-col bg-white", mobile ? "rounded-t-3xl border border-slate-200 shadow-2xl" : "border-l border-slate-200")}>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-white"><Sparkles className="size-4.5" aria-hidden="true" /></div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950">ChatGPT Copilot</p><div className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Visual prototype</div></div>
        </div>
        {mobile && onClose ? <button type="button" onClick={onClose} aria-label="Close Copilot" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X className="size-4.5" /></button> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-start gap-3"><Bot className="mt-0.5 size-5 shrink-0 text-slate-700" aria-hidden="true" /><div><p className="text-sm font-semibold text-slate-900">Same data, shared view</p><p className="mt-1.5 text-sm leading-6 text-slate-600">In the completed product I&apos;ll reason over the rule, class, teacher, or scenario you are viewing and propose typed changes for preview.</p></div></div></div>
        <div className="mt-6"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Try asking</p><div className="mt-3 space-y-2">{prompts.map(({ icon: Icon, label }) => <button key={label} type="button" onClick={() => setMessage(label)} className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"><Icon className="size-4 shrink-0 text-slate-500" aria-hidden="true" />{label}</button>)}</div></div>
        <div className="mt-6 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 ring-1 ring-inset ring-amber-200"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>AI is not connected in Milestone 1. Future schedule edits will be proposals, never silent database mutations.</p></div>
      </div>
      <div className="border-t border-slate-200 p-4"><div className="rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask about this screen…" rows={3} className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400" /><div className="flex items-center justify-between px-1 pb-1"><span className="text-[11px] text-slate-400">Prototype only</span><button type="button" disabled aria-label="Send message" className="grid size-8 place-items-center rounded-lg bg-slate-200 text-slate-400"><ArrowUp className="size-4" /></button></div></div></div>
    </aside>
  );
}

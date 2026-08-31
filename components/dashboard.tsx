"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, BookOpenCheck, CalendarDays, CheckCircle2, History, ShieldCheck, UsersRound } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

export function Dashboard() {
  const { state, currentRulebookVersion, currentScheduleVersion, currentAssignments, validation, accessMode } = useWorkspace();
  if (!state) return null;
  const verified = state.rules.filter((r)=>r.verificationStatus === "VERIFIED").length;
  const hard = state.rules.filter((r)=>r.strength === "HARD" && r.status === "ACTIVE").length;
  const review = state.rules.filter((r)=>r.status === "NEEDS_REVIEW" || r.verificationStatus !== "VERIFIED").length;
  const cards = [
    { title: "Master Rulebook", value: `v${currentRulebookVersion}`, detail: `${state.rules.length} rules · ${hard} active HARD`, icon: BookOpenCheck, href: "/rulebook" },
    { title: "Current Schedule", value: `v${currentScheduleVersion}`, detail: `${currentAssignments.length} assignments · ${validation.hardViolations} hard`, icon: CalendarDays, href: "/schedule" },
    { title: "Verification", value: `${verified}/${state.rules.length}`, detail: review ? `${review} items still need review` : "All current rules verified", icon: ShieldCheck, href: "/rulebook" },
    { title: "People", value: `${state.teachers.length}`, detail: `${state.students.length} dancers currently loaded`, icon: UsersRound, href: "/people" },
  ];
  return <div className="space-y-6">
    <section className={`rounded-3xl border p-5 sm:p-6 ${validation.valid?"border-emerald-200 bg-emerald-50":"border-red-200 bg-red-50"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">{validation.valid?<CheckCircle2 className="size-4 text-emerald-600"/>:<AlertTriangle className="size-4 text-red-600"/>}Live deterministic validation</div><h2 className="mt-2 text-2xl font-semibold tracking-tight">{validation.valid?"Current schedule passes HARD rules":"Current schedule needs repair"}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{validation.hardViolations} hard violations and {validation.warnings} preference/warning findings against Rulebook v{currentRulebookVersion}. Rule edits may intentionally invalidate a schedule; schedule moves cannot be committed while they create HARD violations.</p></div><Link href="/schedule" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Review schedule<ArrowRight className="size-4"/></Link></div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({title,value,detail,icon:Icon,href})=><Link href={href} key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300"><div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-600">{title}</p><Icon className="size-4 text-slate-400"/></div><p className="mt-5 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p></Link>)}</section>

    <section className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Needs attention</p><h3 className="mt-1 text-lg font-semibold">Validation findings</h3></div><Link href="/schedule" className="text-sm font-semibold text-slate-700">Open all</Link></div><div className="mt-4 divide-y divide-slate-100">{validation.violations.slice(0,6).map((item,index)=><div className="flex gap-3 py-3" key={`${item.constraintId}-${index}`}><span className={`mt-1 size-2 shrink-0 rounded-full ${item.severity === "HARD"?"bg-red-500":"bg-amber-500"}`}/><div><p className="text-sm font-medium text-slate-800">{item.message}</p><p className="mt-1 text-xs text-slate-500">{item.constraintId} · {item.severity}</p></div></div>)}{validation.violations.length === 0?<div className="py-8 text-center text-sm text-slate-500">No current findings. The validator is pleasantly bored.</div>:null}</div></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><History className="size-4 text-slate-400"/><h3 className="text-lg font-semibold">Recent changes</h3></div><div className="mt-4 space-y-4">{state.auditEvents.slice(0,6).map((event)=><div key={event.id}><p className="text-sm font-medium text-slate-800">{event.detail}</p><p className="mt-1 text-xs text-slate-500">{event.actor} · {new Date(event.at).toLocaleString()}</p></div>)}{state.auditEvents.length===0?<p className="text-sm text-slate-500">No changes recorded yet.</p>:null}</div><Link href="/versions" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">View version history<ArrowRight className="size-4"/></Link></div>
    </section>
    {accessMode === "ALPHA" ? <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900"><strong>Shared alpha mode:</strong> this test link uses a revocable access token so another tester can use the real shared database immediately. Normal user authentication is implemented separately and will replace this shortcut for broader release.</div> : null}
  </div>;
}

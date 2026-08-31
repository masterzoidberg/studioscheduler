"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, BookOpenCheck, CalendarDays, CheckCircle2, Cpu, History, ShieldCheck } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { ruleClassification } from "@/lib/validator";

export function Dashboard() {
  const {
    state,currentRulebookVersion,currentEnforcementVersion,currentScheduleVersion,currentScheduleRulebookVersion,
    currentScheduleEnforcementVersion,currentAssignments,validation,scheduleIsStale,rebaseSchedule,canEdit,
  } = useWorkspace();
  if (!state) return null;

  const verified = state.rules.filter((rule) => (rule.reviewStatus ?? rule.verificationStatus) === "VERIFIED").length;
  const hard = state.rules.filter((rule) => ruleClassification(rule).toUpperCase() === "HARD" && rule.status === "ACTIVE").length;
  const pendingMappings = state.enforcementProposals.filter((proposal) => proposal.status === "PROPOSED").length;
  const staleRulebook = currentScheduleRulebookVersion !== currentRulebookVersion;
  const staleEnforcement = currentScheduleEnforcementVersion !== currentEnforcementVersion;

  const cards = [
    { title: "Master Rulebook", value: `v${currentRulebookVersion}`, detail: `${state.rules.length} rules · ${verified}/${state.rules.length} human reviewed`, icon: BookOpenCheck, href: "/rulebook" },
    { title: "Enforcement Policy", value: `v${currentEnforcementVersion}`, detail: `${validation.coverage.implementedHardRules}/${hard} HARD mapped · ${pendingMappings} pending review`, icon: Cpu, href: "/rulebook" },
    { title: "Current Schedule", value: `v${currentScheduleVersion}`, detail: `${currentAssignments.length} assignments · Rulebook v${currentScheduleRulebookVersion} · Enforcement v${currentScheduleEnforcementVersion}`, icon: CalendarDays, href: "/schedule" },
    { title: "Validation Coverage", value: `${validation.coverage.implementedHardRules}/${validation.coverage.applicableHardRules}`, detail: validation.fullyValidated ? "Every applicable HARD rule is enforced" : `${validation.coverage.notImplementedHardRules} HARD rules still unmapped`, icon: ShieldCheck, href: "/versions" },
  ];

  const tone = scheduleIsStale ? "border-amber-200 bg-amber-50" : !validation.valid ? "border-red-200 bg-red-50" : validation.fullyValidated ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50";
  const staleWhy = [staleRulebook ? `Rulebook v${currentRulebookVersion}` : null, staleEnforcement ? `Enforcement v${currentEnforcementVersion}` : null].filter(Boolean).join(" + ");
  const headline = scheduleIsStale
    ? `Schedule v${currentScheduleVersion} needs revalidation against ${staleWhy}`
    : !validation.valid
      ? "Current schedule has detected HARD conflicts"
      : validation.fullyValidated
        ? "Current schedule is fully validated"
        : "Current schedule is partially validated";

  return <div className="space-y-6">
    <section className={`rounded-3xl border p-5 sm:p-6 ${tone}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
            {!scheduleIsStale && validation.fullyValidated ? <CheckCircle2 className="size-4 text-emerald-600"/> : <AlertTriangle className="size-4 text-amber-600"/>}
            Deterministic validation
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{headline}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {validation.hardViolations} detected HARD violation{validation.hardViolations === 1 ? "" : "s"}. Enforcement v{currentEnforcementVersion} covers {validation.coverage.implementedHardRules}/{validation.coverage.applicableHardRules} applicable HARD rules. Human review and machine enforcement remain independently versioned.
          </p>
        </div>
        {scheduleIsStale && canEdit
          ? <button onClick={() => void rebaseSchedule()} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Revalidate unchanged schedule</button>
          : <Link href="/schedule" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Review schedule<ArrowRight className="size-4"/></Link>}
      </div>
    </section>

    {pendingMappings > 0 ? <Link href="/rulebook" className="flex items-center justify-between gap-4 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-950">
      <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-violet-700">Machine mapping review</p><p className="mt-1 text-sm font-medium">{pendingMappings} proposed enforcement mapping{pendingMappings === 1 ? "" : "s"} waiting for explicit review.</p></div>
      <ArrowRight className="size-5 shrink-0"/>
    </Link> : null}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({title,value,detail,icon:Icon,href}) => <Link href={href} key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
        <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-600">{title}</p><Icon className="size-4 text-slate-400"/></div>
        <p className="mt-5 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
      </Link>)}
    </section>

    <section className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Needs attention</p><h3 className="mt-1 text-lg font-semibold">Detected validation findings</h3></div><Link href="/schedule" className="text-sm font-semibold text-slate-700">Open all</Link></div>
        <div className="mt-4 divide-y divide-slate-100">{validation.violations.slice(0,6).map((item,index) => <div className="flex gap-3 py-3" key={`${item.constraintId}-${index}`}><span className={`mt-1 size-2 shrink-0 rounded-full ${item.severity === "HARD" ? "bg-red-500" : "bg-amber-500"}`}/><div><p className="text-sm font-medium text-slate-800">{item.message}</p><p className="mt-1 text-xs text-slate-500">{item.constraintId} · {item.severity}</p></div></div>)}{validation.violations.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">No conflicts were detected by Enforcement v{currentEnforcementVersion}.</div> : null}</div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><History className="size-4 text-slate-400"/><h3 className="text-lg font-semibold">Recent changes</h3></div>
        <div className="mt-4 space-y-4">{state.auditEvents.slice(0,6).map((event) => <div key={event.id}><p className="text-sm font-medium text-slate-800">{event.detail}</p><p className="mt-1 text-xs text-slate-500">{event.actor} · {new Date(event.at).toLocaleString()}</p></div>)}{state.auditEvents.length === 0 ? <p className="text-sm text-slate-500">No changes recorded yet.</p> : null}</div>
        <Link href="/versions" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">View version history<ArrowRight className="size-4"/></Link>
      </div>
    </section>
  </div>;
}

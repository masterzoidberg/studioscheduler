"use client";

import { AlertTriangle, BookOpenCheck, CalendarDays, CheckCircle2, Cpu, History, ShieldCheck } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

export function VersionsView() {
  const {
    state,currentRulebookVersion,currentEnforcementVersion,currentScheduleVersion,currentScheduleRulebookVersion,
    currentScheduleEnforcementVersion,scheduleIsStale,validation,
  } = useWorkspace();
  if (!state) return null;

  const staleRulebook = currentScheduleRulebookVersion !== currentRulebookVersion;
  const staleEnforcement = currentScheduleEnforcementVersion !== currentEnforcementVersion;
  const scheduleState = scheduleIsStale ? "STALE POLICY LINK" : validation.hardViolations ? "NEEDS REPAIR" : validation.fullyValidated ? "FULLY VALIDATED" : "PARTIALLY VALIDATED";

  return <div className="space-y-6">
    <section className={`rounded-2xl border p-4 ${scheduleIsStale ? "border-amber-200 bg-amber-50" : validation.hardViolations ? "border-red-200 bg-red-50" : validation.fullyValidated ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50"}`}>
      <div className="flex items-start gap-3">
        {scheduleIsStale || validation.hardViolations ? <AlertTriangle className="mt-0.5 size-5 shrink-0"/> : validation.fullyValidated ? <CheckCircle2 className="mt-0.5 size-5 shrink-0"/> : <ShieldCheck className="mt-0.5 size-5 shrink-0"/>}
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.12em]">{scheduleState}</p>
          <p className="mt-1 text-sm leading-6">
            Schedule v{currentScheduleVersion} is linked to Rulebook v{currentScheduleRulebookVersion} and Enforcement v{currentScheduleEnforcementVersion}. Current policy is Rulebook v{currentRulebookVersion} + Enforcement v{currentEnforcementVersion}. {scheduleIsStale ? `${staleRulebook ? "Rulebook changed. " : ""}${staleEnforcement ? "Machine enforcement changed. " : ""}The schedule must be explicitly revalidated before another normal edit.` : `${validation.hardViolations} detected HARD violation(s); ${validation.coverage.implementedHardRules}/${validation.coverage.applicableHardRules} applicable HARD rules are mapped.`}
          </p>
        </div>
      </div>
    </section>

    <p className="text-sm leading-6 text-slate-600">DWDE now keeps three independent histories: human Rulebook truth, approved machine-enforcement mappings, and schedule assignments. No layer silently rewrites another.</p>

    <div className="grid gap-5 xl:grid-cols-3">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><BookOpenCheck className="size-5 text-slate-400"/><h2 className="font-semibold">Rulebook versions</h2><span className="ml-auto rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">v{currentRulebookVersion}</span></div>
        <div className="mt-4 divide-y divide-slate-100">{state.rulebookVersions.map((version) => <div key={version.id} className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><strong>v{version.version}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${version.status === "CURRENT" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{version.status || "HISTORICAL"}</span></div><span className="text-xs text-slate-400">{new Date(version.createdAt).toLocaleString()}</span></div>
          <p className="mt-1 text-sm text-slate-700">{version.reason}</p><p className="mt-2 text-xs text-slate-500">{version.actor} · {version.changedRuleIds.length} rule{version.changedRuleIds.length === 1 ? "" : "s"} changed</p>
          {version.sourceHash ? <p className="mt-2 truncate text-[10px] text-slate-400">SHA-256 {version.sourceHash}</p> : null}
        </div>)}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><Cpu className="size-5 text-slate-400"/><h2 className="font-semibold">Enforcement versions</h2><span className="ml-auto rounded-full bg-violet-700 px-2.5 py-1 text-xs font-semibold text-white">v{currentEnforcementVersion}</span></div>
        <div className="mt-4 divide-y divide-slate-100">{state.enforcementVersions.map((version) => <div key={version.id} className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><strong>v{version.version}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${version.status === "CURRENT" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{version.status}</span></div><span className="text-xs text-slate-400">{new Date(version.createdAt).toLocaleString()}</span></div>
          <p className="mt-1 text-sm text-slate-700">{version.reason}</p><p className="mt-2 text-xs text-slate-500">{version.actor} · based on Rulebook v{version.rulebookVersion} · {version.snapshot.length} approved mapping{version.snapshot.length === 1 ? "" : "s"}</p>
          {version.changedRuleIds.length ? <div className="mt-2 flex flex-wrap gap-1">{version.changedRuleIds.slice(0,8).map((id) => <span key={id} className="rounded-md bg-violet-50 px-2 py-1 text-[10px] text-violet-700">{id}</span>)}{version.changedRuleIds.length > 8 ? <span className="rounded-md bg-slate-50 px-2 py-1 text-[10px] text-slate-400">+{version.changedRuleIds.length - 8}</span> : null}</div> : null}
        </div>)}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><CalendarDays className="size-5 text-slate-400"/><h2 className="font-semibold">Schedule versions</h2><span className="ml-auto rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">v{currentScheduleVersion}</span></div>
        <div className="mt-4 divide-y divide-slate-100">{state.scheduleVersions.map((version) => {
          const result = version.validationResult;
          const stale = version.rulebookVersion !== currentRulebookVersion || version.enforcementVersion !== currentEnforcementVersion;
          const status = version.isCurrent ? (stale ? "STALE" : result?.fullyValidated ? "FULLY VALIDATED" : result?.hardViolations ? "NEEDS REPAIR" : "PARTIAL") : "HISTORICAL";
          return <div key={version.id} className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><strong>v{version.version}</strong>{version.isCurrent ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">CURRENT</span> : null}</div><span className="text-xs text-slate-400">{new Date(version.createdAt).toLocaleString()}</span></div>
            <p className="mt-1 text-sm text-slate-700">{version.reason}</p><p className="mt-2 text-xs text-slate-500">{version.actor} · Rulebook v{version.rulebookVersion} · Enforcement v{version.enforcementVersion}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold"><span className={`rounded-md px-2 py-1 ${status === "FULLY VALIDATED" ? "bg-emerald-50 text-emerald-700" : status === "NEEDS REPAIR" ? "bg-red-50 text-red-700" : status === "STALE" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-700"}`}>{status}</span>{result ? <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{result.hardViolations} HARD · {result.coverage.implementedHardRules}/{result.coverage.applicableHardRules} covered</span> : <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">No stored validation snapshot</span>}</div>
          </div>;
        })}</div>
      </section>
    </div>

    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2"><History className="size-5 text-slate-400"/><h2 className="font-semibold">Audit trail</h2></div>
      <div className="mt-4 grid gap-2">{state.auditEvents.slice(0,30).map((event) => <div key={event.id} className="rounded-xl bg-slate-50 p-3"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-white px-2 py-1 text-[10px] font-bold text-slate-500">{event.action}</span><p className="text-sm font-medium text-slate-800">{event.detail}</p></div><p className="mt-1 text-xs text-slate-500">{event.actor} · {new Date(event.at).toLocaleString()}</p></div>)}</div>
    </section>
  </div>;
}

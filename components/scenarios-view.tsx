"use client";

import { Cpu, FlaskConical, ShieldAlert } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

export function ScenariosView() {
  const { state } = useWorkspace();
  if (!state) return null;

  return <div className="space-y-6">
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-amber-800"><ShieldAlert className="size-5"/></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.12em] text-amber-800">Advanced · historical records</p>
          <h2 className="mt-1 font-semibold text-amber-950">Legacy scenarios are read-only</h2>
          <p className="mt-2 text-sm leading-6 text-amber-950/80">These records were created against the older Rulebook / EnforcementVersion / Schedule linkage. They remain visible for audit history, but scenario creation and application are hidden until this surface is rebuilt on the coherent PlanningDatasetVersion + ConstraintModelVersion authority.</p>
        </div>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{state.scenarios.map((scenario) => {
      const baseSchedule = state.scheduleVersions.find((version) => version.version === scenario.baseScheduleVersion);
      const baseEnforcement = scenario.baseEnforcementVersion ?? baseSchedule?.enforcementVersion ?? 0;
      return <article key={scenario.id} className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><FlaskConical className="size-4 text-slate-400"/><h2 className="font-semibold">{scenario.name}</h2></div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold">
          <span className="rounded-md bg-slate-100 px-2 py-1">Rulebook v{scenario.baseRulebookVersion}</span>
          <span className="rounded-md bg-violet-50 px-2 py-1 text-violet-700"><Cpu className="mr-1 inline size-3"/>Legacy Enforcement v{baseEnforcement}</span>
          <span className="rounded-md bg-slate-100 px-2 py-1">Schedule v{scenario.baseScheduleVersion}</span>
        </div>
        <p className="mt-3 text-sm text-slate-600">{scenario.rulePatches.length} historical rule patch{scenario.rulePatches.length === 1 ? "" : "es"} · {scenario.schedulePatches.length} historical schedule patch{scenario.schedulePatches.length === 1 ? "" : "es"}</p>
        {scenario.rulePatches.slice(0, 3).map((item) => <p key={item.id} className="mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">{item.ruleId || "New rule"} · {item.reason}</p>)}
        <p className="mt-3 text-xs text-slate-400">Created {new Date(scenario.createdAt).toLocaleString()}</p>
      </article>;
    })}</section>
    {state.scenarios.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No historical scenarios are stored for this workspace.</div> : null}
  </div>;
}

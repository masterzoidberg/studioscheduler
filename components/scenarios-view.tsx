"use client";

import { useState } from "react";
import { Cpu, FlaskConical, Plus, ShieldCheck } from "lucide-react";
import type { RulePatch } from "@/lib/domain";
import { ruleClassification } from "@/lib/validator";
import { useWorkspace } from "@/components/workspace-provider";

export function ScenariosView() {
  const {state,currentRulebookVersion,currentEnforcementVersion,currentScheduleVersion,createScenario,canEdit,validation}=useWorkspace();
  const [name,setName]=useState("What-if scenario");
  const [ruleId,setRuleId]=useState("");
  const [wording,setWording]=useState("");
  const [classification,setClassification]=useState("");
  const [notice,setNotice]=useState("");
  if(!state)return null;
  const loadedState=state;

  const selected=loadedState.rules.find((rule)=>rule.id===ruleId);
  let patch:RulePatch|null=null;
  if(selected){
    const changes:RulePatch["changes"]={};
    if(wording.trim()&&wording.trim()!==selected.description)changes.description=wording.trim();
    if(classification.trim()&&classification.trim()!==ruleClassification(selected))changes.classificationRaw=classification.trim();
    if(Object.keys(changes).length){
      patch={id:"scenario-draft",ruleId:selected.id,operation:"UPDATE",changes,reason:`What-if human Rulebook change to ${selected.id}: ${selected.title}`,proposedBy:"USER",baseRulebookVersion:currentRulebookVersion,baseEnforcementVersion:currentEnforcementVersion,baseScheduleVersion:currentScheduleVersion};
    }
  }

  const approvedMapping=selected?loadedState.enforcementVersions.find((version)=>version.status==="CURRENT")?.snapshot.find((mapping)=>mapping.ruleId===selected.id):undefined;

  function chooseRule(id:string){
    setRuleId(id);
    const next=loadedState.rules.find((rule)=>rule.id===id);
    setWording(next?.description||"");setClassification(next?ruleClassification(next):"");setNotice("");
  }

  async function create(){
    if(!canEdit){setNotice("Viewer access cannot create scenarios.");return;}
    const result=await createScenario(name.trim()||"What-if scenario",patch?[patch]:[],[]);
    setNotice(result.ok?`Scenario saved against Rulebook v${currentRulebookVersion}, Enforcement v${currentEnforcementVersion}, and Schedule v${currentScheduleVersion} without changing canonical truth.`:result.error||"Could not create scenario.");
    if(result.ok){setName("What-if scenario");chooseRule("");}
  }

  return <div className="space-y-6">
    <div>
      <p className="text-sm leading-6 text-slate-600">Scenarios are isolated thought experiments pinned to the exact human Rulebook, approved machine-enforcement policy, and Schedule version that existed when they were created. A human wording experiment never silently rewrites its machine mapping.</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-950 px-3 py-1.5 font-semibold text-white">Rulebook v{currentRulebookVersion}</span><span className="rounded-full bg-violet-50 px-3 py-1.5 font-semibold text-violet-700">Enforcement v{currentEnforcementVersion}</span><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">Schedule v{currentScheduleVersion}</span></div>
    </div>
    {notice?<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div>:null}

    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2"><Plus className="size-5 text-slate-400"/><h2 className="font-semibold">Create a human Rulebook what-if</h2></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Scenario name<input value={name} onChange={(event)=>setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label><label className="text-xs font-semibold text-slate-600">Rule<select value={ruleId} onChange={(event)=>chooseRule(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">No temporary rule change</option>{loadedState.rules.map((rule)=><option key={rule.id} value={rule.id}>{rule.id} · {rule.title}</option>)}</select></label></div>

      {selected?<div className="mt-4 space-y-3">
        <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><strong>{selected.id}</strong> · {selected.category}<br/>Current machine policy: <strong>{approvedMapping?`mapped as ${approvedMapping.type}`:"not mapped in Enforcement v"+currentEnforcementVersion}</strong></div>
        <label className="block text-xs font-semibold text-slate-600">Temporary human wording<textarea rows={4} value={wording} onChange={(event)=>setWording(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal leading-6"/></label>
        <label className="block text-xs font-semibold text-slate-600">Temporary classification<input value={classification} onChange={(event)=>setClassification(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label>
      </div>:null}

      {patch?<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"><ShieldCheck className="mr-2 inline size-4"/><strong>Human-policy what-if only.</strong> The scenario records the proposed wording/classification without pretending the old Enforcement mapping still represents changed human meaning. Current canonical validation remains {validation.hardViolations} detected HARD violation(s), {validation.coverage.implementedHardRules}/{validation.coverage.applicableHardRules} covered.</div>:null}
      <button disabled={!canEdit||(!name.trim()&&!patch)} onClick={()=>void create()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-40"><FlaskConical className="size-4"/>Save scenario</button>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{loadedState.scenarios.map((scenario)=>{
      const baseSchedule=loadedState.scheduleVersions.find((version)=>version.version===scenario.baseScheduleVersion);
      const baseEnforcement=scenario.baseEnforcementVersion??baseSchedule?.enforcementVersion??0;
      return <article key={scenario.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><FlaskConical className="size-4 text-slate-400"/><h2 className="font-semibold">{scenario.name}</h2></div><div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold"><span className="rounded-md bg-slate-100 px-2 py-1">Rulebook v{scenario.baseRulebookVersion}</span><span className="rounded-md bg-violet-50 px-2 py-1 text-violet-700"><Cpu className="mr-1 inline size-3"/>Enforcement v{baseEnforcement}</span><span className="rounded-md bg-slate-100 px-2 py-1">Schedule v{scenario.baseScheduleVersion}</span></div><p className="mt-3 text-sm text-slate-600">{scenario.rulePatches.length} human rule patch{scenario.rulePatches.length===1?"":"es"} · {scenario.schedulePatches.length} schedule patch{scenario.schedulePatches.length===1?"":"es"}</p>{scenario.rulePatches.slice(0,3).map((item)=><p key={item.id} className="mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">{item.ruleId||"New rule"} · {item.reason}</p>)}<p className="mt-3 text-xs text-slate-400">Created {new Date(scenario.createdAt).toLocaleString()}</p></article>;
    })}</section>
    {loadedState.scenarios.length===0?<div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No scenarios yet. Create one above to test a “what if” without changing reality.</div>:null}
  </div>;
}

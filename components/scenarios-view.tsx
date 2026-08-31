"use client";

import { useState } from "react";
import { FlaskConical, Plus, ShieldCheck } from "lucide-react";
import type { RulePatch } from "@/lib/domain";
import { ruleClassification, validateSchedule } from "@/lib/validator";
import { useWorkspace } from "@/components/workspace-provider";

export function ScenariosView(){
  const {state,currentAssignments,currentRulebookVersion,currentScheduleVersion,createScenario,canEdit}=useWorkspace();
  const [name,setName]=useState("What-if scenario");
  const [ruleId,setRuleId]=useState("");
  const [wording,setWording]=useState("");
  const [classification,setClassification]=useState("");
  const [parameterKey,setParameterKey]=useState("");
  const [parameterValue,setParameterValue]=useState("");
  const [notice,setNotice]=useState("");
  if(!state)return null;
  const loadedState=state;

  const selected=loadedState.rules.find(r=>r.id===ruleId);
  const scalarEntries=selected?Object.entries(selected.parameters).filter(([,v])=>typeof v==="number"||typeof v==="string"):[];
  const selectedScalar=scalarEntries.find(([key])=>key===parameterKey);

  let patch:RulePatch|null=null;
  if(selected){
    const changes:RulePatch["changes"]={};
    if(wording.trim()&&wording.trim()!==selected.description)changes.description=wording.trim();
    if(classification.trim()&&classification.trim()!==ruleClassification(selected))changes.classificationRaw=classification.trim();
    if(selectedScalar&&parameterValue!==""){
      const old=selectedScalar[1];
      const value=typeof old==="number"?Number(parameterValue):parameterValue;
      changes.parameters={...selected.parameters,[parameterKey]:value};
    }
    if(Object.keys(changes).length){
      patch={id:"scenario-draft",ruleId:selected.id,operation:"UPDATE",changes,reason:`What-if change to ${selected.id}: ${selected.title}`,proposedBy:"USER"};
    }
  }

  const preview=patch&&selected?validateSchedule({...loadedState,rules:loadedState.rules.map(r=>r.id===selected.id?{...r,...patch.changes}:r)},currentAssignments):null;
  const machineImpactKnown=Boolean(selected?.type&&selected.enforcementStatus==="IMPLEMENTED");

  function chooseRule(id:string){
    setRuleId(id);setParameterKey("");setParameterValue("");
    const next=loadedState.rules.find(r=>r.id===id);
    setWording(next?.description||"");setClassification(next?ruleClassification(next):"");setNotice("");
  }

  async function create(){
    if(!canEdit){setNotice("Viewer access cannot create scenarios.");return;}
    const result=await createScenario(name.trim()||"What-if scenario",patch?[patch]:[],[]);
    setNotice(result.ok?"Scenario saved without changing canonical truth.":result.error||"Could not create scenario.");
    if(result.ok){setName("What-if scenario");chooseRule("");}
  }

  return <div className="space-y-6">
    <div><p className="text-sm leading-6 text-slate-600">Scenarios branch from specific Rulebook and Schedule versions. They can test reviewed wording or classifications even before a rule has typed machine parameters. Deterministic impact is shown only where machine enforcement exists.</p><div className="mt-2 flex gap-2 text-xs"><span className="rounded-full bg-slate-950 px-3 py-1.5 font-semibold text-white">Rulebook v{currentRulebookVersion}</span><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">Schedule v{currentScheduleVersion}</span></div></div>
    {notice?<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div>:null}

    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2"><Plus className="size-5 text-slate-400"/><h2 className="font-semibold">Create a Rulebook what-if</h2></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Scenario name<input value={name} onChange={e=>setName(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label><label className="text-xs font-semibold text-slate-600">Rule<select value={ruleId} onChange={e=>chooseRule(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">No temporary rule change</option>{loadedState.rules.map(r=><option key={r.id} value={r.id}>{r.id} · {r.title}</option>)}</select></label></div>

      {selected?<div className="mt-4 space-y-3"><div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><strong>{selected.id}</strong> · {selected.category}<br/>Machine enforcement: <strong>{selected.enforcementStatus||"NOT_IMPLEMENTED"}</strong>{selected.type?` · ${selected.type}`:" · not machine-typed"}</div><label className="block text-xs font-semibold text-slate-600">Temporary reviewed wording<textarea rows={4} value={wording} onChange={e=>setWording(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal leading-6"/></label><label className="block text-xs font-semibold text-slate-600">Temporary classification<input value={classification} onChange={e=>setClassification(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label>
      {scalarEntries.length?<div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Optional machine parameter<select value={parameterKey} onChange={e=>{setParameterKey(e.target.value);setParameterValue("")}} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">No parameter change</option>{scalarEntries.map(([key,value])=><option key={key} value={key}>{key} = {String(value)}</option>)}</select></label>{selectedScalar?<label className="text-xs font-semibold text-slate-600">Temporary value<input value={parameterValue} onChange={e=>setParameterValue(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label>:null}</div>:null}</div>:null}

      {patch&&preview?<div className={`mt-4 rounded-xl border p-3 text-sm ${preview.hardViolations?"border-red-200 bg-red-50 text-red-900":machineImpactKnown?"border-emerald-200 bg-emerald-50 text-emerald-900":"border-amber-200 bg-amber-50 text-amber-900"}`}><ShieldCheck className="mr-2 inline size-4"/>{machineImpactKnown?`Deterministic preview: ${preview.hardViolations} detected HARD violation(s), ${preview.warnings} warnings.`:"This rule is not fully machine-enforced yet, so the scenario can preserve the human what-if but cannot claim a complete deterministic impact result."} Canonical truth remains unchanged.</div>:null}
      <button disabled={!canEdit||(!name.trim()&&!patch)} onClick={()=>void create()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-40"><FlaskConical className="size-4"/>Save scenario</button>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{loadedState.scenarios.map(s=><article key={s.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><FlaskConical className="size-4 text-slate-400"/><h2 className="font-semibold">{s.name}</h2></div><p className="mt-3 text-xs text-slate-500">Based on Rulebook v{s.baseRulebookVersion} + Schedule v{s.baseScheduleVersion}</p><p className="mt-3 text-sm text-slate-600">{s.rulePatches.length} rule patch{s.rulePatches.length===1?"":"es"} · {s.schedulePatches.length} schedule patch{s.schedulePatches.length===1?"":"es"}</p>{s.rulePatches.slice(0,3).map(p=><p key={p.id} className="mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">{p.ruleId||"New rule"} · {p.reason}</p>)}<p className="mt-3 text-xs text-slate-400">Created {new Date(s.createdAt).toLocaleString()}</p></article>)}</section>
    {loadedState.scenarios.length===0?<div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No scenarios yet. Create one above to test a “what if” without changing reality.</div>:null}
  </div>;
}

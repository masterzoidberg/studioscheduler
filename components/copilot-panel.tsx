"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bot, Check, Database, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import type { RulePatch, SchedulePatch } from "@/lib/domain";
import { useWorkspace } from "@/components/workspace-provider";

type Result={answer:string;mode:"OPENROUTER"|"LOCAL";model?:string;proposal?:{kind:"RULE_PATCH"|"SCHEDULE_PATCH";title?:string;patch:RulePatch|SchedulePatch}|null};

export function CopilotPanel({mobile=false,onClose}:{mobile?:boolean;onClose?:()=>void}){
  const pathname=usePathname();
  const {
    session,canEdit,applyRulePatch,applySchedulePatch,currentRulebookVersion,currentEnforcementVersion,currentScheduleVersion,
    currentScheduleRulebookVersion,currentScheduleEnforcementVersion,scheduleIsStale,validation,
  }=useWorkspace();
  const [message,setMessage]=useState("");const [result,setResult]=useState<Result|null>(null);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
  const prompts=["What rules affect Karly?","Which HARD rules mention Cami?","What time does Saturday have to end?","Why is this schedule only partially validated?"];

  useEffect(()=>{
    const listener=(event:Event)=>{const detail=(event as CustomEvent<{message?:string}>).detail;const text=detail?.message?.trim();if(text){setMessage(text);void send(text);}};
    window.addEventListener("dwde:copilot",listener);return()=>window.removeEventListener("dwde:copilot",listener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session?.access_token,pathname]);

  async function send(text?:string){
    const value=(text??message).trim();if(!value||!session?.access_token)return;
    setBusy(true);setNotice("");setResult(null);
    try{
      const response=await fetch("/api/copilot",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({message:value,screen:pathname})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Copilot request failed.");setResult(data);setMessage("");
    }catch(e){setNotice(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }

  function proposalIsStale(){
    const patch=result?.proposal?.patch;if(!patch)return false;
    return (patch.baseRulebookVersion!==undefined&&patch.baseRulebookVersion!==currentRulebookVersion)
      ||(patch.baseEnforcementVersion!==undefined&&patch.baseEnforcementVersion!==currentEnforcementVersion)
      ||(patch.baseScheduleVersion!==undefined&&patch.baseScheduleVersion!==currentScheduleVersion);
  }

  async function apply(){
    if(!result?.proposal||!canEdit)return;
    if(proposalIsStale()){
      setNotice(`This proposal was generated against Rulebook v${result.proposal.patch.baseRulebookVersion??"?"} / Enforcement v${result.proposal.patch.baseEnforcementVersion??"?"} / Schedule v${result.proposal.patch.baseScheduleVersion??"?"}, but canonical truth is now Rulebook v${currentRulebookVersion} / Enforcement v${currentEnforcementVersion} / Schedule v${currentScheduleVersion}. Ask Copilot again before applying.`);
      return;
    }
    setBusy(true);
    const outcome=result.proposal.kind==="RULE_PATCH"?await applyRulePatch(result.proposal.patch as RulePatch):await applySchedulePatch(result.proposal.patch as SchedulePatch);
    setBusy(false);
    if(!outcome.ok){setNotice(outcome.error||"Proposal could not be applied.");return;}
    setNotice(`Applied with explicit approval${outcome.version?` · new version ${outcome.version}`:""}.`);setResult({...result,proposal:null});
  }

  const staleProposal=proposalIsStale();
  return <aside className={`flex h-full flex-col border-l border-slate-200 bg-white ${mobile?"rounded-t-[28px] border shadow-2xl sm:rounded-[24px]":""}`}><div className="flex items-center justify-between border-b border-slate-200 p-4"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-slate-950 text-white"><Sparkles className="size-4"/></div><div><p className="text-sm font-semibold">AI Copilot</p><p className="text-[11px] text-slate-500">Rulebook v{currentRulebookVersion} · Enforcement v{currentEnforcementVersion} · Schedule v{currentScheduleVersion}</p></div></div>{onClose?<button onClick={onClose} className="rounded-xl p-2 text-slate-500"><X className="size-5"/></button>:null}</div>
  <div className="flex-1 overflow-y-auto p-4"><div className="rounded-2xl bg-slate-50 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-600"><Database className="size-4"/>Current canonical database</div><p className="mt-2 text-xs leading-5 text-slate-500">Answers use the reviewed human Rulebook, approved EnforcementVersion, and current assignments. Pending mapping proposals are visible but do not enforce.</p><p className="mt-2 text-[11px] text-slate-500">Coverage: {validation.coverage.implementedHardRules}/{validation.coverage.applicableHardRules} applicable HARD rules · {scheduleIsStale?`schedule uses RB v${currentScheduleRulebookVersion} / EV v${currentScheduleEnforcementVersion} and needs revalidation`:"schedule linked to current Rulebook + Enforcement"}</p></div><div className="mt-4 flex flex-wrap gap-2">{prompts.map(p=><button key={p} disabled={busy} onClick={()=>void send(p)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs leading-5 text-slate-600 hover:bg-slate-50">{p}</button>)}</div>{busy?<div className="mt-5 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin"/>Reading current studio data…</div>:null}{result?<div className="mt-5 space-y-3"><div className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-slate-400"><Bot className="size-4"/>{result.mode==="OPENROUTER"?`OpenRouter${result.model?` · ${result.model}`:""}`:"Local database lookup"}</div><div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{result.answer}</div></div>{result.proposal?<div className={`rounded-2xl border p-4 ${staleProposal?"border-amber-200 bg-amber-50":"border-violet-200 bg-violet-50"}`}><p className={`text-xs font-semibold uppercase tracking-[.12em] ${staleProposal?"text-amber-800":"text-violet-700"}`}>{staleProposal?"Stale proposed change · cannot apply":"Proposed change · not applied"}</p><h3 className="mt-2 font-semibold">{result.proposal.title||result.proposal.kind}</h3><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-white/80 p-3 text-[11px] leading-5 text-slate-600">{JSON.stringify(result.proposal.patch,null,2)}</pre><p className="mt-3 text-[11px] leading-5">{staleProposal?"Canonical Rulebook, Enforcement, or Schedule data changed after this proposal was generated. Ask Copilot again to generate a fresh proposal.":"Apply routes through the same version checks and deterministic validation boundary used by human edits. Human Rulebook changes cannot directly alter machine mappings."}</p><div className="mt-3 flex gap-2"><button onClick={()=>setResult({...result,proposal:null})} className="min-h-10 flex-1 rounded-xl border border-slate-300 bg-white text-sm font-semibold">Reject</button><button disabled={busy||!canEdit||staleProposal||(scheduleIsStale&&result.proposal.kind==="SCHEDULE_PATCH")} onClick={()=>void apply()} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-900 text-sm font-semibold text-white disabled:opacity-40"><Check className="size-4"/>{canEdit?staleProposal?"Refresh proposal":"Apply":"Viewer only"}</button></div></div>:null}</div>:null}{notice?<div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">{notice}</div>:null}</div>
  <div className="border-t border-slate-200 p-4"><textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} rows={3} placeholder="Ask about a rule, mapping, conflict, person, or proposed change…" className="w-full resize-none rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950"/><button disabled={busy||!message.trim()||!session} onClick={()=>void send()} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-semibold text-white disabled:opacity-40"><Send className="size-4"/>Send to Copilot</button><p className="mt-2 text-[10px] leading-4 text-slate-400">AI never silently mutates canonical data. Explicit approval and governed server mutations are required.</p></div></aside>;
}

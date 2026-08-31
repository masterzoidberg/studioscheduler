"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Download, ExternalLink, FileJson, KeyRound, LogOut, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import type { CanonicalImportPackage } from "@/lib/domain";
import { diffImportedRules, validateImportPackage } from "@/lib/import-validator";
import { ALPHA_STORAGE_KEY } from "@/lib/supabase";
import { useWorkspace } from "@/components/workspace-provider";

type CopilotStatus =
  | { state: "checking" }
  | { state: "connected"; reasoningModel: string; fastModel: string }
  | { state: "local"; reasoningModel: string; fastModel: string }
  | { state: "error"; message: string };

export function SettingsView(){
  const {state,accessMode,session,currentRulebookVersion,importPackage,exportPackage,signOut}=useWorkspace();
  const [pkg,setPkg]=useState<CanonicalImportPackage|null>(null);
  const [fileName,setFileName]=useState("");
  const [parseError,setParseError]=useState("");
  const [resolutions,setResolutions]=useState<Record<string,"REVIEW"|"KEEP_CURRENT"|"USE_IMPORT">>({});
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [copilotStatus,setCopilotStatus]=useState<CopilotStatus>({state:"checking"});
  const validation=useMemo(()=>pkg?validateImportPackage(pkg):null,[pkg]);
  const diff=useMemo(()=>pkg&&state?diffImportedRules(state.rules,pkg.rules):null,[pkg,state]);

  useEffect(()=>{
    let cancelled=false;
    async function check(){
      try{
        const headers:Record<string,string>={};
        if(session?.access_token)headers.Authorization=`Bearer ${session.access_token}`;
        const alpha=typeof window!=="undefined"?localStorage.getItem(ALPHA_STORAGE_KEY):"";
        if(alpha)headers["x-dwde-alpha-key"]=alpha;
        const response=await fetch("/api/copilot",{headers});
        const data=await response.json() as {openRouterConfigured?:boolean;reasoningModel?:string;fastModel?:string;error?:string};
        if(!response.ok)throw new Error(data.error||"Could not check Copilot connection.");
        const models={reasoningModel:data.reasoningModel||"openai/gpt-5.6-sol",fastModel:data.fastModel||"openai/gpt-5.6-luna"};
        if(!cancelled)setCopilotStatus(data.openRouterConfigured?{state:"connected",...models}:{state:"local",...models});
      }catch(e){if(!cancelled)setCopilotStatus({state:"error",message:e instanceof Error?e.message:String(e)});}
    }
    void check();
    return()=>{cancelled=true;};
  },[session?.access_token,accessMode]);

  if(!state)return null;
  const currentRules=state.rules;

  async function fileChanged(file?:File){
    if(!file)return;
    setFileName(file.name);setParseError("");setNotice("");
    try{
      const parsed=JSON.parse(await file.text()) as CanonicalImportPackage;
      setPkg(parsed);
      const next:Record<string,"REVIEW">={};
      if(parsed.rules)for(const id of diffImportedRules(currentRules,parsed.rules).modified)next[id]="REVIEW";
      setResolutions(next);
    }catch(e){setPkg(null);setParseError(e instanceof Error?e.message:"Could not parse JSON.");}
  }

  const unresolved=diff?.modified.filter(id=>(resolutions[id]||"REVIEW")==="REVIEW")||[];

  async function accept(){
    if(!pkg||!validation?.valid)return;
    if(accessMode==="ALPHA"){setNotice("Canonical import is disabled for shared alpha links. Sign in as a studio user before replacing source-of-truth data.");return;}
    if(unresolved.length){setNotice("Resolve every modified stable ID before importing.");return;}
    const currentMap=new Map(currentRules.map(r=>[r.id,r]));
    const mergedRules=pkg.rules.map(r=>resolutions[r.id]==="KEEP_CURRENT"?(currentMap.get(r.id)||r):r);
    setBusy(true);
    const result=await importPackage({...pkg,rules:mergedRules});
    setBusy(false);
    setNotice(result.ok?`Import accepted as Rulebook v${result.version}. Stable IDs were upserted without duplication.`:result.error||"Import failed and was rolled back.");
    if(result.ok){setPkg(null);setFileName("");}
  }

  function download(){
    const data=exportPackage();if(!data)return;
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`DWDE-Rulebook-v${currentRulebookVersion}.json`;a.click();
    URL.revokeObjectURL(url);
  }

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><Sparkles className="size-5"/></div>
        <div><h2 className="font-semibold">AI connection</h2><p className="mt-1 text-sm leading-6 text-slate-600">OpenRouter powers Copilot reasoning. Studio sign-in and AI billing stay separate.</p></div>
      </div>
      <div className="mt-5 rounded-2xl border border-slate-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2"><Bot className="size-5 text-slate-500"/><h3 className="font-semibold">OpenRouter Copilot</h3></div>
          {copilotStatus.state==="connected"?<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-3.5"/>Connected</span>:copilotStatus.state==="checking"?<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Checking…</span>:<span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">Local mode</span>}
        </div>
        {copilotStatus.state==="connected"?<div className="mt-3 text-sm leading-6 text-slate-600"><p>OpenRouter is connected server-side. The API key never reaches the browser.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Routine questions</span><strong className="mt-1 block text-sm text-slate-800">{copilotStatus.fastModel}</strong></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Changes & reasoning</span><strong className="mt-1 block text-sm text-slate-800">{copilotStatus.reasoningModel}</strong></div></div></div>:copilotStatus.state==="local"?<div className="mt-3 text-sm leading-6 text-slate-600"><p>Copilot is currently limited to deterministic database lookups because <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">OPENROUTER_API_KEY</code> has not been added to Vercel yet.</p><p className="mt-2">Once the key is present, routine questions use <strong>{copilotStatus.fastModel}</strong> and scheduling/rule changes use <strong>{copilotStatus.reasoningModel}</strong>.</p><a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-800">Create OpenRouter key<ExternalLink className="size-4"/></a></div>:copilotStatus.state==="error"?<p className="mt-3 text-sm leading-6 text-red-700">Connection check failed: {copilotStatus.message}</p>:<p className="mt-3 text-sm text-slate-500">Checking the server-side OpenRouter connection…</p>}
        <div className="mt-4 flex gap-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><KeyRound className="mt-0.5 size-4 shrink-0"/><span>OpenRouter can route across providers while the DWDE validator remains deterministic. AI can propose changes, but only the app can validate and commit them.</span></div>
      </div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100"><UploadCloud className="size-5 text-slate-500"/></div><div><h2 className="font-semibold">Import canonical Rulebook</h2><p className="mt-1 text-sm leading-6 text-slate-600">Upload JSON → validate → preview → resolve modified stable IDs → accept transactionally.</p></div></div>
      <label className="mt-5 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 text-center"><FileJson className="size-7 text-slate-400"/><span className="mt-2 text-sm font-semibold">{fileName||"Choose dwde-rulebook-vN.json"}</span><span className="mt-1 text-xs text-slate-500">Canonical format_version 1.0</span><input type="file" accept="application/json,.json" className="hidden" onChange={e=>void fileChanged(e.target.files?.[0])}/></label>
      {parseError?<div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">JSON parse error: {parseError}</div>:null}
      {pkg&&validation?<div className="mt-5 space-y-4">
        <div className={`rounded-2xl border p-4 ${validation.valid?"border-emerald-200 bg-emerald-50":"border-red-200 bg-red-50"}`}><div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4"/>{validation.valid?"Import structure is valid":"Import cannot be accepted"}</div><div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div className="rounded-xl bg-white/70 p-3"><strong className="block text-xl">{validation.summary.teachers}</strong>Teachers</div><div className="rounded-xl bg-white/70 p-3"><strong className="block text-xl">{validation.summary.rooms}</strong>Rooms</div><div className="rounded-xl bg-white/70 p-3"><strong className="block text-xl">{validation.summary.classes}</strong>Classes</div><div className="rounded-xl bg-white/70 p-3"><strong className="block text-xl">{validation.summary.rules}</strong>Rules</div></div></div>
        {validation.errors.length?<div className="rounded-xl border border-red-200 bg-white p-3"><h3 className="text-sm font-semibold text-red-800">Invalid records</h3>{validation.errors.slice(0,20).map((x,i)=><p key={i} className="mt-1 text-xs text-red-700"><strong>{x.path}:</strong> {x.message}</p>)}</div>:null}
        {validation.warnings.length?<div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><h3 className="text-sm font-semibold text-amber-900">Warnings ({validation.warnings.length})</h3>{validation.warnings.slice(0,10).map((x,i)=><p key={i} className="mt-1 text-xs text-amber-800">• {x.message}</p>)}</div>:null}
        {diff?<div className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Stable-ID diff</h3><div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div className="rounded-xl bg-slate-50 p-3"><strong className="block text-xl">{diff.unchanged.length}</strong>Unchanged</div><div className="rounded-xl bg-amber-50 p-3 text-amber-900"><strong className="block text-xl">{diff.modified.length}</strong>Modified</div><div className="rounded-xl bg-emerald-50 p-3 text-emerald-900"><strong className="block text-xl">{diff.added.length}</strong>New</div><div className="rounded-xl bg-slate-50 p-3"><strong className="block text-xl">{diff.missing.length}</strong>Missing</div></div>{diff.modified.length?<div className="mt-4 space-y-2">{diff.modified.map(id=>{const current=state.rules.find(r=>r.id===id);const incoming=pkg.rules.find(r=>r.id===id);return <div key={id} className="rounded-xl border border-slate-200 p-3"><p className="text-sm font-semibold">{current?.title||incoming?.title||id}</p><div className="mt-2 flex flex-wrap gap-2"><button onClick={()=>setResolutions({...resolutions,[id]:"KEEP_CURRENT"})} className={`min-h-9 rounded-lg border px-3 text-xs font-semibold ${resolutions[id]==="KEEP_CURRENT"?"border-slate-950 bg-slate-950 text-white":"border-slate-300"}`}>Keep Current</button><button onClick={()=>setResolutions({...resolutions,[id]:"USE_IMPORT"})} className={`min-h-9 rounded-lg border px-3 text-xs font-semibold ${resolutions[id]==="USE_IMPORT"?"border-blue-700 bg-blue-700 text-white":"border-slate-300"}`}>Use Imported</button></div></div>})}</div>:null}</div>:null}
        <button disabled={!validation.valid||busy||unresolved.length>0} onClick={()=>void accept()} className="min-h-11 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy?"Importing transactionally…":unresolved.length?`Resolve ${unresolved.length} conflict(s) first`:"Accept Import"}</button>
      </div>:null}
    </section>

    <section className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><Download className="size-5 text-slate-400"/><h2 className="mt-3 font-semibold">Export current Rulebook</h2><p className="mt-1 text-sm leading-6 text-slate-600">Exports the current canonical entities, structured rules, sessions, and assignments in re-importable JSON.</p><button onClick={download} className="mt-4 min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">Export DWDE v{currentRulebookVersion}</button></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><ShieldCheck className="size-5 text-slate-400"/><h2 className="mt-3 font-semibold">Connection boundaries</h2><p className="mt-1 text-sm leading-6 text-slate-600">Studio authentication, OpenRouter inference, and deterministic schedule validation are separate. Connecting OpenRouter never grants it direct database mutation.</p></div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Access</h2><p className="mt-2 text-sm text-slate-600">Mode: {accessMode}. {session?.user.email?`Signed in as ${session.user.email}.`:"Shared alpha access is active for this browser."}</p><button onClick={()=>void signOut()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold"><LogOut className="size-4"/>Exit workspace</button></section>
    {notice?<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div>:null}
  </div>;
}

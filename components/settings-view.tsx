"use client";

import { useMemo, useState } from "react";
import { Download, FileJson, Fingerprint, LogOut, ShieldCheck, UploadCloud } from "lucide-react";
import type { CanonicalImportPackage, ReviewedRulebookPackage } from "@/lib/domain";
import { diffImportedRules, validateImportPackage } from "@/lib/import-validator";
import { diffReviewedRules, isReviewedRulebookPackage, sha256Hex, validateReviewedRulebook } from "@/lib/reviewed-rulebook";
import { OpenRouterAccountCard } from "@/components/openrouter-account-card";
import { useWorkspace } from "@/components/workspace-provider";

type Incoming = CanonicalImportPackage | ReviewedRulebookPackage;

function IdList({ title, ids, tone = "slate" }: { title: string; ids: string[]; tone?: "slate" | "amber" | "emerald" | "red" }) {
  const styles = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-950" : tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : tone === "red" ? "border-red-200 bg-red-50 text-red-950" : "border-slate-200 bg-slate-50 text-slate-800";
  return <div className={`rounded-xl border p-3 ${styles}`}><div className="flex items-center justify-between gap-3"><strong className="text-xs uppercase tracking-wider">{title}</strong><span className="text-lg font-semibold">{ids.length}</span></div>{ids.length?<p className="mt-2 text-[11px] leading-5 opacity-80">{ids.slice(0,18).join(", ")}{ids.length>18?` … +${ids.length-18} more`:""}</p>:null}</div>;
}

export function SettingsView(){
  const { state, accessMode, session, currentRulebookVersion, importPackage, importReviewedRulebook, exportPackage, signOut } = useWorkspace();
  const [incoming,setIncoming]=useState<Incoming|null>(null);
  const [fileName,setFileName]=useState("");
  const [sourceFileHash,setSourceFileHash]=useState("");
  const [parseError,setParseError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);

  const reviewed = incoming && isReviewedRulebookPackage(incoming) ? incoming : null;
  const legacy = incoming && !reviewed ? incoming as CanonicalImportPackage : null;
  const reviewedValidation = useMemo(()=>reviewed?validateReviewedRulebook(reviewed):null,[reviewed]);
  const legacyValidation = useMemo(()=>legacy?validateImportPackage(legacy):null,[legacy]);
  const reviewedDiff = useMemo(()=>reviewed&&state?diffReviewedRules(state.rules,reviewed.rules):null,[reviewed,state]);
  const legacyDiff = useMemo(()=>legacy&&state?diffImportedRules(state.rules,legacy.rules):null,[legacy,state]);

  if(!state)return null;

  async function fileChanged(file?:File){
    if(!file)return;
    setFileName(file.name);setParseError("");setNotice("");setIncoming(null);setSourceFileHash("");
    try{
      const raw=await file.text();
      const parsed=JSON.parse(raw) as Incoming;
      setSourceFileHash(await sha256Hex(raw));
      setIncoming(parsed);
    }catch(e){setParseError(e instanceof Error?e.message:"Could not parse JSON.");}
  }

  async function accept(){
    if(!incoming)return;
    if(accessMode!=="AUTHENTICATED"){
      setNotice("Source-of-truth imports require a signed-in studio account. Shared alpha access cannot replace the Rulebook.");
      return;
    }
    setBusy(true);setNotice("");
    try{
      if(reviewed){
        if(!reviewedValidation?.valid){setNotice("Reviewed V2 did not pass structural validation.");return;}
        if(reviewedDiff?.conflicts.length){setNotice(`Import stopped: ${reviewedDiff.conflicts.length} stable ID(s) contain later user/AI edits and require explicit reconciliation.`);return;}
        const result=await importReviewedRulebook(reviewed,sourceFileHash);
        setNotice(result.ok?`Reviewed Rulebook V${result.version} adopted transactionally. ${reviewed.rulebook.total_rules} reviewed rules are now canonical.`:result.error||"Import failed and was rolled back.");
        if(result.ok){setIncoming(null);setFileName("");setSourceFileHash("");}
      }else if(legacy){
        if(!legacyValidation?.valid){setNotice("Legacy import did not pass structural validation.");return;}
        if(legacyDiff?.modified.length){setNotice("Legacy import contains modified stable IDs. Use the reviewed V2 workflow or explicitly reconcile those records first.");return;}
        const result=await importPackage(legacy);
        setNotice(result.ok?`Legacy package accepted as Rulebook v${result.version}.`:result.error||"Import failed and was rolled back.");
      }
    }finally{setBusy(false);}
  }

  function download(){
    const data=exportPackage();if(!data)return;
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download=`DWDE-Rulebook-v${currentRulebookVersion}.json`;a.click();URL.revokeObjectURL(url);
  }

  const canAccept = reviewed ? Boolean(reviewedValidation?.valid && !reviewedDiff?.conflicts.length) : Boolean(legacyValidation?.valid && !legacyDiff?.modified.length);

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100"><UploadCloud className="size-5 text-slate-500"/></div><div><h2 className="font-semibold">Import canonical Rulebook</h2><p className="mt-1 text-sm leading-6 text-slate-600">Upload → parse → validate → stable-ID diff → confirm → one database transaction. A failed import cannot leave half a Rulebook behind.</p></div></div>
      <label className="mt-5 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 text-center">
        <FileJson className="size-7 text-slate-400"/><span className="mt-2 text-sm font-semibold">{fileName||"Choose DWDE Rulebook JSON"}</span><span className="mt-1 text-xs text-slate-500">Reviewed site format 2.0 or legacy canonical format 1.0</span>
        <input type="file" accept="application/json,.json" className="hidden" onChange={e=>void fileChanged(e.target.files?.[0])}/>
      </label>
      {parseError?<div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">JSON parse error: {parseError}</div>:null}

      {reviewed&&reviewedValidation?<div className="mt-5 space-y-4">
        <div className={`rounded-2xl border p-4 ${reviewedValidation.valid?"border-emerald-200 bg-emerald-50":"border-red-200 bg-red-50"}`}>
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4"/>{reviewedValidation.valid?"Reviewed source package is structurally valid":"Reviewed source cannot be adopted"}</div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-xl bg-white/75 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-500">Incoming</span><strong className="mt-1 block text-2xl">V{reviewed.rulebook.version}</strong>{reviewed.rulebook.status}</div>
            <div className="rounded-xl bg-white/75 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-500">Rules</span><strong className="mt-1 block text-2xl">{reviewedValidation.summary.rules}</strong>total</div>
            <div className="rounded-xl bg-white/75 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-500">Reviewed</span><strong className="mt-1 block text-2xl">{reviewedValidation.summary.reviewed}/{reviewedValidation.summary.rules}</strong>verified</div>
            <div className="rounded-xl bg-white/75 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-500">Human review</span><strong className="mt-1 block text-2xl">{reviewedValidation.summary.edited}</strong>edited · {reviewedValidation.summary.approved} unchanged</div>
          </div>
          <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs leading-5 text-slate-700"><strong>Existing Rulebook:</strong> V{currentRulebookVersion}<br/><strong>Import action:</strong> Create/adopt Rulebook V{reviewed.rulebook.version} as current; preserve earlier versions historically.</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600"><div className="flex items-center gap-2 font-semibold text-slate-800"><Fingerprint className="size-4"/>Source fingerprints</div><p className="mt-2 break-all"><strong>Reviewed rules:</strong> {reviewed.rulebook.rules_sha256}</p><p className="mt-1 break-all"><strong>Uploaded file:</strong> {sourceFileHash}</p></div>
        {reviewedValidation.errors.length?<div className="rounded-xl border border-red-200 bg-red-50 p-3"><h3 className="text-sm font-semibold text-red-900">Invalid records</h3>{reviewedValidation.errors.slice(0,20).map((x,i)=><p key={i} className="mt-1 text-xs text-red-800"><strong>{x.path}:</strong> {x.message}</p>)}</div>:null}
        {reviewedValidation.warnings.length?<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{reviewedValidation.warnings.map((x,i)=><p key={i}>• {x.message}</p>)}</div>:null}
        {reviewedDiff?<div className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Stable-ID import preview</h3><p className="mt-1 text-xs leading-5 text-slate-500">Matching is by stable rule ID, never by title. Superseded legacy rows remain in historical V1 snapshots.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><IdList title="Unchanged" ids={reviewedDiff.unchanged}/><IdList title="Updated" ids={reviewedDiff.updated} tone="amber"/><IdList title="New" ids={reviewedDiff.added} tone="emerald"/><IdList title="Superseded" ids={reviewedDiff.superseded}/><IdList title="Conflicts" ids={reviewedDiff.conflicts} tone="red"/></div>{reviewedDiff.conflicts.length?<p className="mt-3 text-xs font-semibold text-red-700">Conflicts are later user/AI edits on an incoming stable ID. They are never silently overwritten.</p>:null}</div>:null}
        <button disabled={!canAccept||busy} onClick={()=>void accept()} className="min-h-11 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy?"Adopting V2 transactionally…":"Adopt Reviewed Rulebook V2"}</button>
      </div>:null}

      {legacy&&legacyValidation?<div className="mt-5 space-y-3"><div className={`rounded-xl border p-4 ${legacyValidation.valid?"border-emerald-200 bg-emerald-50":"border-red-200 bg-red-50"}`}><strong>{legacyValidation.valid?"Legacy package valid":"Legacy package invalid"}</strong><p className="mt-2 text-xs">{legacyValidation.summary.rules} rules · {legacyValidation.errors.length} errors · {legacyValidation.warnings.length} warnings</p></div><button disabled={!canAccept||busy} onClick={()=>void accept()} className="min-h-11 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-40">Accept legacy import</button></div>:null}
    </section>

    <OpenRouterAccountCard/>

    <section className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><Download className="size-5 text-slate-400"/><h2 className="mt-3 font-semibold">Export current Rulebook</h2><p className="mt-1 text-sm leading-6 text-slate-600">Exports reviewed human fields plus any later machine-enforcement metadata without replacing the reviewed wording.</p><button onClick={download} className="mt-4 min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">Export DWDE v{currentRulebookVersion}</button></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><ShieldCheck className="size-5 text-slate-400"/><h2 className="mt-3 font-semibold">Authority boundaries</h2><p className="mt-1 text-sm leading-6 text-slate-600">Human review, machine enforcement coverage, OpenRouter inference, and deterministic validation are tracked separately. AI can propose a rule change but cannot commit it without approval.</p></div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Access</h2><p className="mt-2 text-sm text-slate-600">Mode: {accessMode}. {session?.user.email?`Signed in as ${session.user.email}.`:"Shared alpha access is active for this browser."}</p><button onClick={()=>void signOut()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold"><LogOut className="size-4"/>Exit workspace</button></section>
    {notice?<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div>:null}
  </div>;
}

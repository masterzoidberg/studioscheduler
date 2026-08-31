"use client";

import { useMemo, useState } from "react";
import { Archive, CheckCircle2, Download, History, Plus, Search, ShieldAlert, SlidersHorizontal, X } from "lucide-react";
import type { RulePatch, StudioRule } from "@/lib/domain";
import { validateSchedule } from "@/lib/validator";
import { useWorkspace } from "@/components/workspace-provider";

const strengths: StudioRule["strength"][] = ["HARD","VERY_STRONG","MODERATE","LIGHT","BASELINE"];
const statuses: StudioRule["status"][] = ["ACTIVE","NEEDS_REVIEW","DISABLED","RETIRED"];
const verification: StudioRule["verificationStatus"][] = ["VERIFIED","NEEDS_REVIEW","UNVERIFIED"];
const ruleTypes: StudioRule["type"][] = ["REQUIRED_ROOM","PREFERRED_ROOM","TEACHER_QUALIFICATION","TEACHER_UNAVAILABLE","TEACHER_AVAILABLE_WINDOW","REQUIRED_TEACHER","PREFERRED_TEACHER","MAX_TEACHER_GAP","MAX_TEACHER_WORKDAYS","MAX_STUDENT_GAP","MAX_STUDENT_ATTENDANCE_DAYS","MIN_STUDENT_ATTENDANCE_DAYS","LATEST_FINISH","EARLIEST_START","DIRECTLY_AFTER","NO_OVERLAP","FIXED_ASSIGNMENT","ROOM_CAPACITY","ROOM_CAPACITY_EXCEPTION","REQUIRED_LOWER_LEVEL","NO_DAY","PREFERRED_DAY","AVOID_DAY","RELATIONSHIP_ARRIVAL_WINDOW"];

function strengthClass(value: StudioRule["strength"]) {
  return value === "HARD" ? "bg-red-50 text-red-700 border-red-200" : value === "VERY_STRONG" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-slate-50 text-slate-700 border-slate-200";
}

function parameterFields(rule: StudioRule, setRule: (next: StudioRule)=>void) {
  const params = rule.parameters;
  const set = (key: string, value: unknown) => setRule({ ...rule, parameters: { ...params, [key]: value } });
  const common: Array<[string,string,"text"|"number"|"time"]> = [];
  if (rule.type === "MAX_TEACHER_WORKDAYS") common.push(["max_days","Maximum regular teaching days","number"]);
  if (rule.type === "MAX_TEACHER_GAP" || rule.type === "MAX_STUDENT_GAP" || rule.type === "RELATIONSHIP_ARRIVAL_WINDOW") common.push(["minutes","Minutes","number"]);
  if (rule.type === "LATEST_FINISH" || rule.type === "EARLIEST_START") common.push(["time","Time","time"]);
  if (["TEACHER_UNAVAILABLE","TEACHER_AVAILABLE_WINDOW","NO_DAY","PREFERRED_DAY","AVOID_DAY"].includes(rule.type)) common.push(["day","Day","text"]);
  if (rule.type === "TEACHER_AVAILABLE_WINDOW") common.push(["start","Window start","time"],["end","Window end","time"]);
  if (rule.type === "REQUIRED_ROOM" || rule.type === "PREFERRED_ROOM") common.push(["required_room_id","Room ID","text"]);
  if (["TEACHER_QUALIFICATION","TEACHER_UNAVAILABLE","TEACHER_AVAILABLE_WINDOW","MAX_TEACHER_WORKDAYS","REQUIRED_TEACHER","PREFERRED_TEACHER","RELATIONSHIP_ARRIVAL_WINDOW"].includes(rule.type)) common.push(["teacher_id","Teacher ID","text"]);
  if (rule.type === "ROOM_CAPACITY") common.push(["room_id","Room ID","text"],["capacity","Capacity","number"]);
  if (rule.type === "DIRECTLY_AFTER") common.push(["before_class_id","First class ID","text"],["after_class_id","Following class ID","text"]);
  if (rule.type === "RELATIONSHIP_ARRIVAL_WINDOW") common.push(["student_id","Dancer ID","text"]);
  if (!common.length) return <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">This rule type currently has no simple scalar parameter editor. Its structured values remain preserved; richer type-specific controls can be added without changing the Rule record.</p>;
  return <div className="grid gap-3 sm:grid-cols-2">{common.map(([key,label,type])=><label key={key} className="text-xs font-semibold text-slate-600">{label}<input type={type} value={String(params[key] ?? "")} onChange={(e)=>set(key,type === "number" ? Number(e.target.value) : e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900"/></label>)}</div>;
}

export function RulebookView() {
  const { state, currentAssignments, currentRulebookVersion, applyRulePatch, exportPackage } = useWorkspace();
  const [query,setQuery] = useState("");
  const [strength,setStrength] = useState<string>("ALL");
  const [status,setStatus] = useState<string>("ALL");
  const [editing,setEditing] = useState<StudioRule | null>(null);
  const [original,setOriginal] = useState<StudioRule | null>(null);
  const [historyId,setHistoryId] = useState<string | null>(null);
  const [reason,setReason] = useState("");
  const [saving,setSaving] = useState(false);
  const [notice,setNotice] = useState("");
  if (!state) return null;

  const filtered = useMemo(()=>state.rules.filter((rule)=>{
    const text = `${rule.id} ${rule.title} ${rule.description} ${rule.category} ${rule.type} ${rule.affectedEntityIds.join(" ")}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (strength === "ALL" || rule.strength === strength) && (status === "ALL" || rule.status === status);
  }),[state.rules,query,strength,status]);

  const previewValidation = editing && original ? validateSchedule({ ...state, rules: state.rules.map((r)=>r.id===editing.id?editing:r) }, currentAssignments) : null;
  const currentValidation = validateSchedule(state,currentAssignments);

  function beginEdit(rule: StudioRule) { setEditing(structuredClone(rule)); setOriginal(rule); setReason(""); setNotice(""); }
  function beginCreate() {
    const id = `rule-new-${Date.now()}`;
    const rule: StudioRule = { id, category:"GENERAL", type:"NO_OVERLAP", title:"New scheduling rule", description:"Describe the scheduling policy in plain language.", strength:"MODERATE", status:"NEEDS_REVIEW", verificationStatus:"UNVERIFIED", affectedEntityIds:[], parameters:{}, exceptions:[], source:{type:"USER_EDIT"}, versionIntroduced:currentRulebookVersion+1, updatedAt:new Date().toISOString() };
    setEditing(rule); setOriginal(null); setReason(""); setNotice("");
  }
  async function save() {
    if (!editing) return; setSaving(true);
    const patch: RulePatch = { id:`patch-${Date.now()}`, ruleId: original?.id, operation: original?"UPDATE":"CREATE", changes: editing, reason: reason.trim() || (original ? "Rule edited in Rulebook" : "Rule created in Rulebook"), proposedBy:"USER" };
    const result = await applyRulePatch(patch); setSaving(false);
    if (!result.ok) return setNotice(result.error || "Save failed.");
    setNotice(`Saved as Rulebook v${result.version}.`); setEditing(null); setOriginal(null);
  }
  async function changeStatus(rule: StudioRule, operation: RulePatch["operation"]) {
    const result = await applyRulePatch({ id:`patch-${Date.now()}`, ruleId:rule.id, operation, changes:{}, reason:`${operation.toLowerCase()} ${rule.title}`, proposedBy:"USER" });
    setNotice(result.ok?`Rulebook v${result.version} created.`:result.error || "Change failed.");
  }
  function downloadJson() {
    const pkg = exportPackage(); if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`DWDE-Rulebook-v${currentRulebookVersion}.json`; a.click(); URL.revokeObjectURL(url);
  }

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm leading-6 text-slate-600">Database-backed canonical Rulebook. Every accepted edit creates a new version and before/after history.</p><div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-900 px-3 py-1.5 font-semibold text-white">v{currentRulebookVersion}</span><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">{state.rules.length} rules</span><span className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-red-700">{state.rules.filter(r=>r.strength==="HARD"&&r.status==="ACTIVE").length} active HARD</span><span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800">{state.rules.filter(r=>r.verificationStatus!=="VERIFIED").length} need review</span></div></div><div className="flex gap-2"><button onClick={downloadJson} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"><Download className="size-4"/>Export JSON</button><button onClick={beginCreate} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="size-4"/>Add Rule</button></div></div>
    {notice?<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div>:null}
    <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_180px_180px]"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-slate-400"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search rules, people, classes…" className="min-h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm"/></div><select value={strength} onChange={(e)=>setStrength(e.target.value)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="ALL">All strengths</option>{strengths.map(x=><option key={x}>{x}</option>)}</select><select value={status} onChange={(e)=>setStatus(e.target.value)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="ALL">All statuses</option>{statuses.map(x=><option key={x}>{x}</option>)}</select></div>

    <div className="grid gap-3">{filtered.map(rule=><article key={rule.id} className={`rounded-2xl border bg-white p-4 sm:p-5 ${rule.status==="DISABLED"||rule.status==="RETIRED"?"border-slate-200 opacity-65":"border-slate-200"}`}><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${strengthClass(rule.strength)}`}>{rule.strength}</span><span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{rule.status}</span><span className="text-[11px] font-medium text-slate-400">{rule.type}</span></div><h2 className="mt-3 text-base font-semibold sm:text-lg">{rule.title}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{rule.description}</p><div className="mt-3 flex flex-wrap gap-1.5">{rule.affectedEntityIds.slice(0,8).map(id=><span key={id} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{id}</span>)}</div></div><div className="flex shrink-0 gap-2"><button onClick={()=>setHistoryId(rule.id)} className="grid size-10 place-items-center rounded-xl border border-slate-200" aria-label="History"><History className="size-4"/></button><button onClick={()=>beginEdit(rule)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold"><SlidersHorizontal className="size-4"/>Edit</button></div></div>{rule.status!=="RETIRED"?<div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">{rule.status==="DISABLED"?<button onClick={()=>void changeStatus(rule,"ENABLE")} className="text-xs font-semibold text-emerald-700">Enable rule</button>:<button onClick={()=>void changeStatus(rule,"DISABLE")} className="text-xs font-semibold text-slate-500">Disable temporarily</button>}<button onClick={()=>void changeStatus(rule,"RETIRE")} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><Archive className="size-3"/>Retire</button></div>:null}</article>)}</div>

    {editing?<div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6"><div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{original?"Edit Rule":"Create Rule"}</p><h2 className="mt-1 text-xl font-semibold">{editing.title}</h2></div><button onClick={()=>setEditing(null)} className="rounded-xl p-2 text-slate-500"><X className="size-5"/></button></div><div className="mt-5 grid gap-4">
      <label className="text-xs font-semibold text-slate-600">Stable ID<input disabled={Boolean(original)} value={editing.id} onChange={(e)=>setEditing({...editing,id:e.target.value})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal disabled:bg-slate-50"/></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Title<input value={editing.title} onChange={(e)=>setEditing({...editing,title:e.target.value})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label><label className="text-xs font-semibold text-slate-600">Category<input value={editing.category} onChange={(e)=>setEditing({...editing,category:e.target.value})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label></div>
      <label className="text-xs font-semibold text-slate-600">Plain-language description<textarea value={editing.description} onChange={(e)=>setEditing({...editing,description:e.target.value})} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm font-normal"/></label>
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-semibold text-slate-600">Strength<select value={editing.strength} onChange={(e)=>setEditing({...editing,strength:e.target.value as StudioRule["strength"]})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{strengths.map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Status<select value={editing.status} onChange={(e)=>setEditing({...editing,status:e.target.value as StudioRule["status"]})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{statuses.map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Verification<select value={editing.verificationStatus} onChange={(e)=>setEditing({...editing,verificationStatus:e.target.value as StudioRule["verificationStatus"]})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{verification.map(x=><option key={x}>{x}</option>)}</select></label></div>
      <label className="text-xs font-semibold text-slate-600">Rule type<select value={editing.type} onChange={(e)=>setEditing({...editing,type:e.target.value as StudioRule["type"]})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{ruleTypes.map(x=><option key={x}>{x}</option>)}</select></label>
      <div><p className="mb-2 text-xs font-semibold text-slate-600">Machine-readable parameters</p>{parameterFields(editing,setEditing)}</div>
      {original && editing.strength!==original.strength?<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><ShieldAlert className="mr-2 inline size-4"/>You are changing rule strength from <strong>{original.strength}</strong> to <strong>{editing.strength}</strong>. This can change a requirement into a preference or the reverse.</div>:null}
      {previewValidation?<div className={`rounded-xl border p-4 ${previewValidation.valid?"border-emerald-200 bg-emerald-50":"border-red-200 bg-red-50"}`}><div className="flex items-center gap-2 text-sm font-semibold">{previewValidation.valid?<CheckCircle2 className="size-4 text-emerald-600"/>:<ShieldAlert className="size-4 text-red-600"/>}Current schedule impact</div><p className="mt-2 text-sm text-slate-700">Before: {currentValidation.hardViolations} hard violation(s). After this rule change: {previewValidation.hardViolations}. Rule changes are allowed even when they make the old schedule invalid.</p></div>:null}
      <label className="text-xs font-semibold text-slate-600">Reason for change<input value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Why is this rule changing?" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label>
      {notice?<p className="text-sm text-red-700">{notice}</p>:null}<div className="flex gap-2"><button onClick={()=>setEditing(null)} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Cancel</button><button disabled={saving} onClick={()=>void save()} className="min-h-11 flex-1 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Save as new version"}</button></div>
    </div></div></div>:null}

    {historyId?<div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Rule history</h2><button onClick={()=>setHistoryId(null)} className="rounded-xl p-2"><X className="size-5"/></button></div><div className="mt-5 space-y-3">{state.ruleHistory.filter(h=>h.ruleId===historyId).map(entry=><div key={entry.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><span className="font-semibold">Rulebook v{entry.rulebookVersion}</span><span className="text-xs text-slate-500">{new Date(entry.changedAt).toLocaleString()}</span></div><p className="mt-2 text-sm text-slate-700">{entry.reason}</p><p className="mt-2 text-xs text-slate-500">{entry.actor}{entry.aiProposed?" · AI proposal approved":""}</p>{entry.before&&entry.after?<div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs"><p><strong>Before:</strong> {entry.before.strength} · {entry.before.status} · {JSON.stringify(entry.before.parameters)}</p><p className="mt-1"><strong>After:</strong> {entry.after.strength} · {entry.after.status} · {JSON.stringify(entry.after.parameters)}</p></div>:null}</div>)}{!state.ruleHistory.some(h=>h.ruleId===historyId)?<p className="text-sm text-slate-500">No change history yet beyond the initial snapshot.</p>:null}</div></div></div>:null}
  </div>;
}

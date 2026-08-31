"use client";

import { useMemo, useState } from "react";
import { Archive, Bot, Check, Cpu, Download, History, Plus, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import type { RuleEnforcementMapping, RuleEnforcementProposal, RulePatch, StudioRule } from "@/lib/domain";
import { ruleClassification, validateSchedule } from "@/lib/validator";
import { useWorkspace } from "@/components/workspace-provider";

const statuses: StudioRule["status"][] = ["ACTIVE", "NEEDS_REVIEW", "DISABLED", "RETIRED"];
const reviewStatuses: NonNullable<StudioRule["reviewStatus"]>[] = ["VERIFIED", "NEEDS_REVIEW", "UNVERIFIED"];
const classifications = ["HARD","VERY STRONG","STRONG","MODERATE","LIGHT","PREFERENCE","BASELINE","INFO","FLEXIBLE","NEEDS REVIEW","EXCEPTION","HARD ASSUMPTION","PRIORITY 1","PRIORITY 2","PRIORITY 3","PRIORITY 4","PRIORITY 5","PRIORITY 6","PRIORITY 7","PRIORITY 8","PRIORITY 9"];
type Filter = "ALL" | "HARD" | "PREFERENCES" | "NEEDS_REVIEW" | "MAPPING_REVIEW" | "TEACHER" | "DANCER" | "ROOM" | "CLASS_STRUCTURE" | "SEQUENCING" | "OPTIMIZATION" | "RECENT";
const filters: Array<[Filter,string]> = [["ALL","All"],["HARD","Hard"],["PREFERENCES","Preferences"],["NEEDS_REVIEW","Needs Review"],["MAPPING_REVIEW","Mapping Review"],["TEACHER","Teacher"],["DANCER","Dancer"],["ROOM","Room"],["CLASS_STRUCTURE","Class Structure"],["SEQUENCING","Sequencing"],["OPTIMIZATION","Optimization"],["RECENT","Recently Changed"]];

function badgeClass(value: string) {
  const c = value.toUpperCase();
  if (c === "HARD") return "border-red-200 bg-red-50 text-red-700";
  if (c.includes("STRONG")) return "border-amber-200 bg-amber-50 text-amber-800";
  if (c.startsWith("PRIORITY")) return "border-violet-200 bg-violet-50 text-violet-800";
  if (c === "INFO" || c === "FLEXIBLE") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function humanChanges(rule: StudioRule): Partial<StudioRule> {
  return {
    id: rule.id,
    category: rule.category,
    title: rule.title,
    description: rule.description,
    classificationRaw: rule.classificationRaw,
    strength: rule.strength,
    status: rule.status,
    verificationStatus: rule.verificationStatus,
    reviewStatus: rule.reviewStatus,
    review: rule.review,
    sourceRaw: rule.sourceRaw,
  };
}

function matches(rule: StudioRule, filter: Filter, recent: Set<string>, pending: Set<string>) {
  const c = ruleClassification(rule).toUpperCase();
  const cat = rule.category.toLowerCase();
  if (filter === "HARD") return c === "HARD";
  if (filter === "PREFERENCES") return ["VERY STRONG","STRONG","MODERATE","LIGHT","PREFERENCE","BASELINE"].includes(c) || c.startsWith("PRIORITY");
  if (filter === "NEEDS_REVIEW") return (rule.reviewStatus ?? rule.verificationStatus) !== "VERIFIED";
  if (filter === "MAPPING_REVIEW") return pending.has(rule.id);
  if (filter === "TEACHER") return cat.startsWith("teachers");
  if (filter === "DANCER") return cat.includes("dancer");
  if (filter === "ROOM") return cat.includes("room");
  if (filter === "CLASS_STRUCTURE") return cat.includes("class structure") || cat.includes("curriculum");
  if (filter === "SEQUENCING") return cat.includes("sequencing");
  if (filter === "OPTIMIZATION") return cat.includes("optimization");
  if (filter === "RECENT") return recent.has(rule.id);
  return true;
}

function mappingSummary(mapping: RuleEnforcementMapping, state: NonNullable<ReturnType<typeof useWorkspace>["state"]>) {
  const teacher = typeof mapping.parameters.teacher_id === "string" ? state.teachers.find((item) => item.id === mapping.parameters.teacher_id)?.name : null;
  const room = typeof mapping.parameters.required_room_id === "string" ? state.rooms.find((item) => item.id === mapping.parameters.required_room_id)?.name : null;
  const classes = mapping.affectedEntityIds.map((id) => state.classes.find((item) => item.id === id)?.name ?? id);
  const bits: string[] = [];
  if (mapping.parameters.time) bits.push(String(mapping.parameters.time));
  if (Array.isArray(mapping.parameters.days)) bits.push(mapping.parameters.days.join(", "));
  if (mapping.parameters.minutes !== undefined) bits.push(`${String(mapping.parameters.minutes)} min`);
  if (mapping.parameters.max_days !== undefined) bits.push(`max ${String(mapping.parameters.max_days)} days`);
  if (teacher) bits.push(teacher);
  if (room) bits.push(room);
  if (classes.length) bits.push(classes.join(", "));
  return bits.length ? `${mapping.type} · ${bits.join(" · ")}` : mapping.type;
}

function hypotheticalValidation(state: NonNullable<ReturnType<typeof useWorkspace>["state"]>, proposal: RuleEnforcementProposal, currentAssignments: ReturnType<typeof useWorkspace>["currentAssignments"]) {
  const current = state.enforcementVersions.find((version) => version.status === "CURRENT");
  if (!current) return null;
  const snapshot = [...current.snapshot.filter((mapping) => mapping.ruleId !== proposal.ruleId), proposal.proposedMapping];
  const nextState = {
    ...state,
    enforcementVersions: [
      ...state.enforcementVersions.map((version) => ({ ...version, status: "HISTORICAL" as const })),
      { ...current, id: "preview-enforcement", version: current.version + 1, reason: "Preview", changedRuleIds: [proposal.ruleId], snapshot, status: "CURRENT" as const },
    ],
  };
  return validateSchedule(nextState, currentAssignments);
}

export function RulebookView() {
  const {
    state,currentAssignments,currentRulebookVersion,currentEnforcementVersion,applyRulePatch,exportPackage,canEdit,
    reviewEnforcementProposal,
  } = useWorkspace();
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState<Filter>("ALL");
  const [editing,setEditing] = useState<StudioRule | null>(null);
  const [original,setOriginal] = useState<StudioRule | null>(null);
  const [historyId,setHistoryId] = useState<string | null>(null);
  const [proposalId,setProposalId] = useState<string | null>(null);
  const [reason,setReason] = useState("");
  const [reviewReason,setReviewReason] = useState("");
  const [saving,setSaving] = useState(false);
  const [reviewing,setReviewing] = useState(false);
  const [notice,setNotice] = useState("");

  if (!state) return null;
  const currentVersion = state.rulebookVersions.find((version) => version.status === "CURRENT");
  const currentEnforcement = state.enforcementVersions.find((version) => version.status === "CURRENT");
  const pendingProposals = state.enforcementProposals.filter((proposal) => proposal.status === "PROPOSED");
  const pendingIds = new Set(pendingProposals.map((proposal) => proposal.ruleId));
  const verified = state.rules.filter((rule) => (rule.reviewStatus ?? rule.verificationStatus) === "VERIFIED").length;
  const hard = state.rules.filter((rule) => ruleClassification(rule).toUpperCase() === "HARD" && rule.status === "ACTIVE").length;
  const recentIds = new Set(state.ruleHistory.filter((entry) => entry.rulebookVersion === currentRulebookVersion).map((entry) => entry.ruleId));
  const approvedMappings = new Map((currentEnforcement?.snapshot ?? []).map((mapping) => [mapping.ruleId,mapping]));
  const filtered = state.rules.filter((rule) => `${rule.id} ${rule.title} ${rule.description} ${rule.category} ${ruleClassification(rule)}`.toLowerCase().includes(query.toLowerCase()) && matches(rule,filter,recentIds,pendingIds));
  const historyRule = historyId ? state.rules.find((rule) => rule.id === historyId) : null;
  const history = historyId ? state.ruleHistory.filter((entry) => entry.ruleId === historyId).sort((a,b) => b.rulebookVersion - a.rulebookVersion) : [];
  const proposal = proposalId ? state.enforcementProposals.find((item) => item.id === proposalId) ?? null : null;
  const proposalRule = proposal ? state.rules.find((rule) => rule.id === proposal.ruleId) ?? null : null;
  const proposalPreview = proposal ? hypotheticalValidation(state,proposal,currentAssignments) : null;
  const currentValidation = useMemo(() => validateSchedule(state,currentAssignments), [state,currentAssignments]);

  function beginEdit(rule: StudioRule) {
    if (!canEdit) return;
    setEditing(structuredClone(rule)); setOriginal(rule); setReason(""); setNotice("");
  }

  function beginCreate() {
    if (!canEdit) return;
    const rule: StudioRule = {
      id: `NEW-${String(Date.now()).slice(-3)}`, category: "General", type: null, title: "New scheduling rule",
      description: "Describe the scheduling policy in plain language.", strength: null, classificationRaw: "MODERATE",
      status: "NEEDS_REVIEW", verificationStatus: "UNVERIFIED", reviewStatus: "UNVERIFIED",
      review: { decision: "USER_EDIT", verified: false }, affectedEntityIds: [], parameters: {}, exceptions: [],
      source: { type: "USER_EDIT" }, sourceRaw: {}, enforcementStatus: "NOT_IMPLEMENTED",
      versionIntroduced: currentRulebookVersion + 1, updatedAt: "",
    };
    setEditing(rule); setOriginal(null); setReason(""); setNotice("");
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const patch: RulePatch = {
      id: "rulebook-edit", ruleId: original?.id, operation: original ? "UPDATE" : "CREATE",
      changes: humanChanges(editing), reason: reason.trim() || (original ? "Rule edited in Rulebook" : "Rule created in Rulebook"), proposedBy: "USER",
    };
    const result = await applyRulePatch(patch);
    setSaving(false);
    if (!result.ok) { setNotice(result.error || "Save failed."); return; }
    const invalidated = Boolean(result.details?.mappingInvalidated);
    setNotice(`Saved as Rulebook v${result.version}. Enforcement v${String(result.details?.enforcementVersion ?? currentEnforcementVersion)} created${invalidated ? "; this rule's previous machine mapping was invalidated and must be reviewed again" : ""}.`);
    setEditing(null); setOriginal(null);
  }

  async function changeStatus(rule: StudioRule, operation: RulePatch["operation"]) {
    const result = await applyRulePatch({ id: "rule-status", ruleId: rule.id, operation, changes: {}, reason: `${operation.toLowerCase()} ${rule.title}`, proposedBy: "USER" });
    setNotice(result.ok ? `Rulebook v${result.version} created. Machine policy history was advanced separately.` : result.error || "Change failed.");
  }

  async function reviewProposal(decision: "APPROVE" | "REJECT") {
    if (!proposal || !reviewReason.trim()) return;
    setReviewing(true);
    const result = await reviewEnforcementProposal(proposal.id, decision, reviewReason.trim());
    setReviewing(false);
    if (!result.ok) { setNotice(result.error || "Review failed."); return; }
    setNotice(decision === "APPROVE" ? `Approved into Enforcement v${String(result.details?.enforcementVersion ?? "")}. The current schedule is now stale until revalidated.` : "Enforcement proposal rejected; current machine policy is unchanged.");
    setProposalId(null); setReviewReason("");
  }

  function download() {
    const pkg = exportPackage(); if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg,null,2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `DWDE-Rulebook-v${currentRulebookVersion}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  function ask(rule: StudioRule) {
    window.dispatchEvent(new CustomEvent("dwde:copilot", { detail: { message: `Explain current Rulebook rule ${rule.id} (${rule.title}), including its reviewed wording and whether Enforcement v${currentEnforcementVersion} currently maps it.` } }));
  }

  return <div className="space-y-5">
    <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-slate-500">DWDE 2026–2027 Master Rulebook</p>
          <h2 className="mt-1 text-2xl font-semibold">Rulebook v{currentRulebookVersion} · Enforcement v{currentEnforcementVersion}</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700">{currentVersion?.sourceHash ? "Reviewed human authority" : "Current human authority"}</span>
            <span className="rounded-full border border-slate-200 px-3 py-1.5">{state.rules.length} Rules</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">{verified} Verified</span>
            <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-red-700">{hard} active HARD</span>
            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-violet-700">{approvedMappings.size} mapped · {pendingProposals.length} pending</span>
          </div>
          {currentVersion?.sourceHash ? <p className="mt-3 max-w-3xl break-all text-[11px] leading-5 text-slate-400">Reviewed source fingerprint: {currentVersion.sourceHash}</p> : null}
        </div>
        <div className="flex gap-2"><button onClick={download} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold"><Download className="size-4"/>Export</button>{canEdit ? <button onClick={beginCreate} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="size-4"/>Add Rule</button> : null}</div>
      </div>
      <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900"><ShieldCheck className="mr-1 inline size-4"/><strong>Two independent truths.</strong> Rulebook v{currentRulebookVersion} stores what Cami approved in human language. Enforcement v{currentEnforcementVersion} stores only the machine mappings explicitly approved for deterministic validation.</div>
    </section>

    {pendingProposals.length ? <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4 sm:p-5">
      <div className="flex items-start gap-3"><Cpu className="mt-0.5 size-5 text-violet-700"/><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-violet-700">Mapping review queue</p><h3 className="mt-1 font-semibold text-violet-950">{pendingProposals.length} proposed mapping{pendingProposals.length === 1 ? "" : "s"} waiting for review</h3><p className="mt-1 text-xs leading-5 text-violet-800">Proposals do not affect the schedule until explicitly approved.</p></div></div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{pendingProposals.map((item) => <button key={item.id} onClick={() => { setProposalId(item.id); setReviewReason(""); }} className="min-h-11 shrink-0 rounded-xl bg-white px-3 text-left text-xs font-semibold text-violet-900 shadow-sm"><span className="block">{item.ruleId}</span><span className="mt-0.5 block font-normal text-violet-600">{item.proposedMapping.type}</span></button>)}</div>
    </section> : null}

    {notice ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div> : null}
    {!canEdit ? <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">Viewer access is read-only. You can search, inspect human and machine history, export, and ask Copilot.</div> : null}

    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="relative"><Search className="absolute left-3 top-3 size-4 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Saturday closing, Karly, Tap 1, Aimee…" className="min-h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm"/></div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{filters.map(([value,label]) => <button key={value} onClick={() => setFilter(value)} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold ${filter === value ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{label}{value === "MAPPING_REVIEW" && pendingProposals.length ? ` (${pendingProposals.length})` : ""}</button>)}</div>
    </div>

    <div className="text-xs text-slate-500">Showing {filtered.length} of {state.rules.length} rules</div>
    <div className="grid gap-3">{filtered.map((rule) => {
      const classification = ruleClassification(rule); const reviewStatus = rule.reviewStatus ?? rule.verificationStatus;
      const mapping = approvedMappings.get(rule.id); const pending = pendingProposals.find((item) => item.ruleId === rule.id);
      return <article key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${badgeClass(classification)}`}>{classification}</span><span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{rule.status}</span><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${reviewStatus === "VERIFIED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{reviewStatus}</span>{mapping ? <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">Mapped in Enforcement v{currentEnforcementVersion}</span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500">Not mapped</span>}{pending ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Mapping proposed</span> : null}</div>
            <h3 className="mt-3 text-base font-semibold sm:text-lg">{rule.title}</h3><p className="mt-1 text-sm leading-6 text-slate-700">{rule.description}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500"><span className="rounded-lg bg-slate-100 px-2 py-1">{rule.id}</span><span>{rule.category}</span>{mapping ? <span className="rounded-lg bg-violet-50 px-2 py-1 text-violet-700">{mappingSummary(mapping,state)}</span> : null}</div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex"><button onClick={() => ask(rule)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold"><Bot className="size-4"/>Ask Copilot</button><button onClick={() => setHistoryId(rule.id)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold"><History className="size-4"/>History</button>{pending ? <button onClick={() => { setProposalId(pending.id); setReviewReason(""); }} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-violet-700 px-3 text-xs font-semibold text-white"><Cpu className="size-4"/>Review Mapping</button> : null}{canEdit ? <button onClick={() => beginEdit(rule)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white"><SlidersHorizontal className="size-4"/>Edit Rule</button> : null}</div>
        </div>
        {canEdit && rule.status !== "RETIRED" ? <div className="mt-4 flex gap-4 border-t border-slate-100 pt-3">{rule.status === "DISABLED" ? <button onClick={() => void changeStatus(rule,"ENABLE")} className="text-xs font-semibold text-emerald-700">Enable rule</button> : <button onClick={() => void changeStatus(rule,"DISABLE")} className="text-xs font-semibold text-slate-500">Disable temporarily</button>}<button onClick={() => void changeStatus(rule,"RETIRE")} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><Archive className="size-3"/>Retire</button></div> : null}
      </article>;
    })}</div>

    {editing ? <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6"><div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
      <div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Human Rulebook</p><h2 className="mt-1 text-xl font-semibold">{original ? "Edit reviewed policy" : "Create rule"}</h2></div><button onClick={() => setEditing(null)} className="rounded-xl p-2"><X className="size-5"/></button></div>
      <div className="mt-5 grid gap-4">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900"><strong>This editor changes human Rulebook truth only.</strong> Machine mappings are reviewed separately. If you change a mapped rule's meaning, V2.2 invalidates that mapping automatically.</div>
        <label className="text-xs font-semibold text-slate-600">Stable ID<input disabled={Boolean(original)} value={editing.id} onChange={(event) => setEditing({...editing,id:event.target.value.toUpperCase()})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal disabled:bg-slate-50"/></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Title<input value={editing.title} onChange={(event) => setEditing({...editing,title:event.target.value})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label><label className="text-xs font-semibold text-slate-600">Category<input value={editing.category} onChange={(event) => setEditing({...editing,category:event.target.value})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label></div>
        <label className="text-xs font-semibold text-slate-600">Current wording<textarea value={editing.description} onChange={(event) => setEditing({...editing,description:event.target.value})} rows={5} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm font-normal"/></label>
        <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-semibold text-slate-600">Classification<input list="dwde-classifications" value={editing.classificationRaw || ""} onChange={(event) => setEditing({...editing,classificationRaw:event.target.value})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/><datalist id="dwde-classifications">{classifications.map((item) => <option key={item} value={item}/>)}</datalist></label><label className="text-xs font-semibold text-slate-600">Status<select value={editing.status} onChange={(event) => setEditing({...editing,status:event.target.value as StudioRule["status"]})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{statuses.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Review status<select value={editing.reviewStatus ?? editing.verificationStatus} onChange={(event) => setEditing({...editing,reviewStatus:event.target.value as StudioRule["reviewStatus"],verificationStatus:event.target.value as StudioRule["verificationStatus"]})} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{reviewStatuses.map((item) => <option key={item}>{item}</option>)}</select></label></div>
        {editing.review?.original_text ? <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-950"><strong>Original human review trail</strong><p className="mt-2"><strong>Draft:</strong> {editing.review.original_text}</p>{editing.review.correction_raw ? <p className="mt-1"><strong>Correction:</strong> {editing.review.correction_raw}</p> : null}</div> : null}
        <label className="text-xs font-semibold text-slate-600">Reason for change<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is studio policy changing?" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label>
        <div className="flex gap-2"><button onClick={() => setEditing(null)} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Cancel</button><button disabled={saving} onClick={() => void save()} className="min-h-11 flex-1 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-40">{saving ? "Saving…" : original ? `Save as Rulebook v${currentRulebookVersion + 1}` : "Create rule"}</button></div>
      </div>
    </div></div> : null}

    {proposal && proposalRule ? <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-6"><div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-violet-700">Machine mapping proposal</p><h2 className="mt-1 text-xl font-semibold">{proposalRule.id} · {proposalRule.title}</h2></div><button onClick={() => setProposalId(null)} className="rounded-xl p-2"><X className="size-5"/></button></div>
      <div className="mt-5 grid gap-4">
        <div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reviewed human wording</p><p className="mt-2 text-sm leading-6 text-slate-800">{proposalRule.description}</p></div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4"><div className="flex flex-wrap items-center gap-2"><Cpu className="size-4 text-violet-700"/><strong className="text-sm text-violet-950">Proposed deterministic mapping</strong><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-violet-700">{proposal.proposalSource}</span></div><p className="mt-3 text-sm font-medium text-violet-950">{mappingSummary(proposal.proposedMapping,state)}</p><p className="mt-2 text-xs leading-5 text-violet-800">{proposal.rationale}</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current</p><p className="mt-2 text-2xl font-semibold">{currentValidation.coverage.implementedHardRules}/{currentValidation.coverage.applicableHardRules}</p><p className="mt-1 text-xs text-slate-500">HARD rules mapped · {currentValidation.hardViolations} detected violations</p></div><div className="rounded-xl border border-violet-200 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-violet-700">If approved</p><p className="mt-2 text-2xl font-semibold text-violet-950">{proposalPreview?.coverage.implementedHardRules ?? "—"}/{proposalPreview?.coverage.applicableHardRules ?? "—"}</p><p className="mt-1 text-xs text-violet-700">HARD rules mapped · {proposalPreview?.hardViolations ?? "—"} detected violations</p></div></div>
        {proposalPreview && proposalPreview.hardViolations > currentValidation.hardViolations ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"><strong>Approval would reveal an existing schedule conflict.</strong> That does not block approval, but the current ScheduleVersion will become stale and enter repair mode until violations are reduced to zero.</div> : <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">Approval changes machine policy only. It does not rewrite the reviewed Rulebook wording or silently move any class.</div>}
        <label className="text-xs font-semibold text-slate-600">Review reason<input value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Why are you approving or rejecting this mapping?" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"/></label>
        {canEdit ? <div className="grid grid-cols-2 gap-2"><button disabled={reviewing || !reviewReason.trim()} onClick={() => void reviewProposal("REJECT")} className="min-h-12 rounded-xl border border-slate-300 font-semibold text-slate-700 disabled:opacity-40"><X className="mr-1 inline size-4"/>Reject</button><button disabled={reviewing || !reviewReason.trim()} onClick={() => void reviewProposal("APPROVE")} className="min-h-12 rounded-xl bg-violet-700 font-semibold text-white disabled:opacity-40"><Check className="mr-1 inline size-4"/>{reviewing ? "Saving…" : "Approve Mapping"}</button></div> : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Viewer access can inspect the mapping but cannot approve or reject it.</p>}
      </div>
    </div></div> : null}

    {historyId && historyRule ? <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
      <div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Rule history</p><h2 className="mt-1 text-xl font-semibold">{historyRule.id} · {historyRule.title}</h2></div><button onClick={() => setHistoryId(null)} className="rounded-xl p-2"><X className="size-5"/></button></div>
      {historyRule.review?.original_text ? <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-violet-700">Original human review history</p><p className="mt-3 text-sm"><strong>Draft wording:</strong> {historyRule.review.original_text}</p>{historyRule.review.correction_raw ? <p className="mt-2 text-sm"><strong>Reviewer correction:</strong> {historyRule.review.correction_raw}</p> : null}<p className="mt-2 text-sm"><strong>Reviewed V2:</strong> {historyRule.description}</p></div> : null}
      <div className="mt-5 rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current machine mapping</p><p className="mt-2 text-sm">{approvedMappings.get(historyRule.id) ? mappingSummary(approvedMappings.get(historyRule.id)!,state) : "No approved mapping in current EnforcementVersion."}</p></div>
      <div className="mt-5 space-y-3">{history.map((entry) => <div key={entry.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><strong className="text-sm">Rulebook v{entry.rulebookVersion}</strong><span className="text-xs text-slate-400">{new Date(entry.changedAt).toLocaleString()}</span></div><p className="mt-2 text-xs text-slate-600">{entry.reason}</p>{entry.before?.description && entry.before.description !== entry.after?.description ? <div className="mt-3 grid gap-2 text-xs"><p className="rounded-lg bg-red-50 p-2"><strong>Before:</strong> {entry.before.description}</p><p className="rounded-lg bg-emerald-50 p-2"><strong>After:</strong> {entry.after?.description}</p></div> : null}<p className="mt-2 text-[11px] text-slate-400">{entry.actor}{entry.aiProposed ? " · AI proposal approved" : ""}</p></div>)}</div>
    </div></div> : null}
  </div>;
}

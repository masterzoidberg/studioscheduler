"use client";

import { useState } from "react";
import { Archive, Bot, Check, Cpu, Database, Download, History, Plus, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import type { RulePatch, StudioRule } from "@/lib/domain";
import { ruleClassification } from "@/lib/validator";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { useWorkspace } from "@/components/workspace-provider";

const classifications = [
  "HARD", "HARD ASSUMPTION", "VERY STRONG", "STRONG", "MODERATE", "LIGHT", "PREFERENCE", "BASELINE", "INFO", "FLEXIBLE", "NEEDS REVIEW", "EXCEPTION",
  "PRIORITY 1", "PRIORITY 2", "PRIORITY 3", "PRIORITY 4", "PRIORITY 5", "PRIORITY 6", "PRIORITY 7", "PRIORITY 8", "PRIORITY 9",
];

type Filter = "ALL" | "HARD" | "PREFERENCES" | "NEEDS_REVIEW" | "TEACHER" | "DANCER" | "ROOM" | "CLASS_STRUCTURE" | "SEQUENCING" | "OPTIMIZATION" | "RECENT";
const filters: Array<[Filter, string]> = [
  ["ALL", "All"], ["HARD", "Hard"], ["PREFERENCES", "Preferences"], ["NEEDS_REVIEW", "Needs Review"], ["TEACHER", "Teacher"],
  ["DANCER", "Dancer"], ["ROOM", "Room"], ["CLASS_STRUCTURE", "Class Structure"], ["SEQUENCING", "Sequencing"], ["OPTIMIZATION", "Optimization"], ["RECENT", "Recently Changed"],
];

function badgeClass(value: string) {
  const classification = value.toUpperCase();
  if (classification.startsWith("HARD")) return "border-red-200 bg-red-50 text-red-700";
  if (classification.includes("STRONG")) return "border-amber-200 bg-amber-50 text-amber-800";
  if (classification.startsWith("PRIORITY")) return "border-violet-200 bg-violet-50 text-violet-800";
  if (classification === "INFO" || classification === "FLEXIBLE") return "border-blue-200 bg-blue-50 text-blue-800";
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

function matches(rule: StudioRule, filter: Filter, recent: Set<string>) {
  const classification = ruleClassification(rule).toUpperCase();
  const category = rule.category.toLowerCase();
  if (filter === "HARD") return classification.startsWith("HARD");
  if (filter === "PREFERENCES") return ["VERY STRONG", "STRONG", "MODERATE", "LIGHT", "PREFERENCE", "BASELINE"].includes(classification) || classification.startsWith("PRIORITY");
  if (filter === "NEEDS_REVIEW") return (rule.reviewStatus ?? rule.verificationStatus) !== "VERIFIED" || classification === "NEEDS REVIEW";
  if (filter === "TEACHER") return category.startsWith("teachers");
  if (filter === "DANCER") return category.includes("dancer");
  if (filter === "ROOM") return category.includes("room");
  if (filter === "CLASS_STRUCTURE") return category.includes("class structure") || category.includes("curriculum");
  if (filter === "SEQUENCING") return category.includes("sequencing");
  if (filter === "OPTIMIZATION") return category.includes("optimization");
  if (filter === "RECENT") return recent.has(rule.id);
  return true;
}

export function RulebookView() {
  const { state, currentRulebookVersion, currentPlanningDatasetVersion, applyRulePatch, exportPackage, canEdit } = useWorkspace();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [editing, setEditing] = useState<StudioRule | null>(null);
  const [original, setOriginal] = useState<StudioRule | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  if (!state) return null;

  const currentVersion = state.rulebookVersions.find((version) => version.status === "CURRENT");
  const model = compileConstraintModel(state);
  const verified = state.rules.filter((rule) => (rule.reviewStatus ?? rule.verificationStatus) === "VERIFIED").length;
  const hard = state.rules.filter((rule) => rule.status === "ACTIVE" && ruleClassification(rule).toUpperCase().startsWith("HARD")).length;
  const recentIds = new Set(state.ruleHistory.filter((entry) => entry.rulebookVersion === currentRulebookVersion).map((entry) => entry.ruleId));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = state.rules.filter((rule) => {
    const haystack = `${rule.id} ${rule.title} ${rule.description} ${rule.category} ${ruleClassification(rule)}`.toLowerCase();
    return (!normalizedQuery || haystack.includes(normalizedQuery)) && matches(rule, filter, recentIds);
  });
  const historyRule = historyId ? state.rules.find((rule) => rule.id === historyId) : null;
  const history = historyId ? state.ruleHistory.filter((entry) => entry.ruleId === historyId).sort((a, b) => b.rulebookVersion - a.rulebookVersion) : [];

  function beginEdit(rule: StudioRule) {
    if (!canEdit) return;
    setEditing(structuredClone(rule));
    setOriginal(rule);
    setReason("");
    setNotice("");
  }

  function beginCreate() {
    if (!canEdit) return;
    setEditing({
      id: `NEW-${String(Date.now()).slice(-6)}`,
      category: "General",
      type: null,
      title: "New scheduling rule",
      description: "Describe the scheduling policy in plain language.",
      strength: null,
      classificationRaw: "MODERATE",
      status: "NEEDS_REVIEW",
      verificationStatus: "UNVERIFIED",
      reviewStatus: "UNVERIFIED",
      review: { decision: "USER_EDIT", verified: false },
      affectedEntityIds: [],
      parameters: {},
      exceptions: [],
      source: { type: "USER_EDIT" },
      sourceRaw: {},
      enforcementStatus: "NOT_IMPLEMENTED",
      versionIntroduced: currentRulebookVersion + 1,
      updatedAt: "",
    });
    setOriginal(null);
    setReason("");
    setNotice("");
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const result = await applyRulePatch({
      id: "rulebook-edit",
      ruleId: original?.id,
      operation: original ? "UPDATE" : "CREATE",
      changes: humanChanges(editing),
      reason: reason.trim() || (original ? "Rule edited in Rulebook" : "Rule created in Rulebook"),
      proposedBy: "USER",
    });
    setSaving(false);
    if (!result.ok) {
      setNotice(result.error || "Save failed.");
      return;
    }
    setNotice(`Saved as Rulebook v${result.version}. The Constraint Model must be compiled and published from this new Rulebook before automatic scheduling can use the change.`);
    setEditing(null);
    setOriginal(null);
  }

  async function changeStatus(rule: StudioRule, operation: RulePatch["operation"]) {
    const result = await applyRulePatch({
      id: "rule-status",
      ruleId: rule.id,
      operation,
      changes: {},
      reason: `${operation.toLowerCase()} ${rule.title}`,
      proposedBy: "USER",
    });
    setNotice(result.ok ? `Rulebook v${result.version} created. The Constraint Model is now expected to be recompiled from the new Rulebook.` : result.error || "Change failed.");
  }

  function download() {
    const pkg = exportPackage();
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `DWDE-Rulebook-v${currentRulebookVersion}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function ask(rule: StudioRule) {
    window.dispatchEvent(new CustomEvent("dwde:copilot", {
      detail: {
        message: `Explain current Rulebook rule ${rule.id} (${rule.title}), preserving its reviewed wording. Then explain how it should affect scheduling and whether it belongs in the deterministic Constraint Model, a data precondition, an optimization objective, or has no runtime effect.`,
      },
    }));
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-slate-500">DWDE 2026–2027 Master Rulebook</p>
            <h2 className="mt-1 text-2xl font-semibold">Rulebook v{currentRulebookVersion}</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700">{currentVersion?.sourceHash ? "Reviewed human authority" : "Current human authority"}</span>
              <span className="rounded-full border border-slate-200 px-3 py-1.5">{state.rules.length} Rules</span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">{verified} Verified</span>
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-red-700">{hard} HARD / HARD assumption</span>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-violet-700">{model.hardConstraints.length} compiled HARD/fixed nodes</span>
            </div>
            {currentVersion?.sourceHash ? <p className="mt-3 max-w-3xl break-all text-[11px] leading-5 text-slate-400">Reviewed source fingerprint: {currentVersion.sourceHash}</p> : null}
          </div>
          <div className="flex gap-2">
            <button onClick={download} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold"><Download className="size-4" />Export</button>
            {canEdit ? <button onClick={beginCreate} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="size-4" />Add Rule</button> : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900"><ShieldCheck className="mr-1 inline size-4" /><strong>Rulebook = human policy.</strong> This is the reviewed source of scheduling requirements and priorities.</div>
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900"><Cpu className="mr-1 inline size-4" /><strong>Constraint Model = compiled meaning.</strong> Engineering compiles deterministic semantics from this Rulebook. Cami does not approve code mappings separately.</div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700"><Database className="mr-1 inline size-4" /><strong>Planning Dataset v{currentPlanningDatasetVersion} = current facts.</strong> Teachers, dancers, rooms, classes and rosters can change without rewriting policy history.</div>
        </div>
      </section>

      {notice ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div> : null}
      {!canEdit ? <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">Viewer access is read-only. You can search, inspect history, export, and ask Copilot.</div> : null}

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <label className="relative block min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rule ID, title, wording, category…" className="min-h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm" />
        </label>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 xl:max-w-[65%]">
          <SlidersHorizontal className="size-4 shrink-0 text-slate-400" />
          {filters.map(([id, label]) => <button key={id} onClick={() => setFilter(id)} className={`min-h-10 shrink-0 rounded-xl px-3 text-xs font-semibold ${filter === id ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{label}</button>)}
        </div>
      </div>

      <p className="text-xs text-slate-500">Showing {filtered.length} of {state.rules.length} rules.</p>

      <section className="space-y-3">
        {filtered.map((rule) => {
          const classification = ruleClassification(rule);
          const reviewStatus = rule.reviewStatus ?? rule.verificationStatus;
          return (
            <article key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-500">{rule.id}</span>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${badgeClass(classification)}`}>{classification}</span>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${reviewStatus === "VERIFIED" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{reviewStatus}</span>
                    <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500">{rule.status}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-slate-950">{rule.title}</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{rule.description}</p>
                  <p className="mt-3 text-xs text-slate-500">{rule.category}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button onClick={() => setHistoryId(rule.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold"><History className="size-4" />History</button>
                  <button onClick={() => ask(rule)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold"><Bot className="size-4" />Ask</button>
                  {canEdit ? <button onClick={() => beginEdit(rule)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white">Edit</button> : null}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {editing ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-6">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">{original ? "Edit Rule" : "New Rule"}</p><h2 className="mt-1 text-xl font-semibold">{editing.id}</h2></div>
              <button onClick={() => { setEditing(null); setOriginal(null); }} className="grid size-10 place-items-center rounded-xl"><X className="size-5" /></button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">Rule ID<input disabled={Boolean(original)} value={editing.id} onChange={(event) => setEditing({ ...editing, id: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm font-normal disabled:bg-slate-50" /></label>
              <label className="text-xs font-semibold text-slate-600">Category<input value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              <label className="sm:col-span-2 text-xs font-semibold text-slate-600">Title<input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              <label className="text-xs font-semibold text-slate-600">Classification<select value={editing.classificationRaw || "MODERATE"} onChange={(event) => setEditing({ ...editing, classificationRaw: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal">{classifications.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="text-xs font-semibold text-slate-600">Status<select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as StudioRule["status"] })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"><option>ACTIVE</option><option>NEEDS_REVIEW</option><option>DISABLED</option><option>RETIRED</option></select></label>
              <label className="sm:col-span-2 text-xs font-semibold text-slate-600">Rule wording<textarea rows={7} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm font-normal leading-6" /></label>
              <label className="sm:col-span-2 text-xs font-semibold text-slate-600">Reason for change<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this policy changing?" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
            </div>

            <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900">Rulebook edits change human authority. They do not directly edit executable mappings. The deterministic Constraint Model must be regenerated and published from the new Rulebook version.</div>

            <div className="mt-5 flex flex-wrap gap-2">
              {original?.status === "ACTIVE" ? <button onClick={() => void changeStatus(original, "DISABLE")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 px-4 text-sm font-semibold text-amber-800"><Archive className="size-4" />Disable</button> : null}
              {original && ["DISABLED", "NEEDS_REVIEW"].includes(original.status) ? <button onClick={() => void changeStatus(original, "ENABLE")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300 px-4 text-sm font-semibold text-emerald-800"><Check className="size-4" />Enable</button> : null}
              {original && original.status !== "RETIRED" ? <button onClick={() => void changeStatus(original, "RETIRE")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700">Retire</button> : null}
              <div className="ml-auto flex gap-2"><button onClick={() => { setEditing(null); setOriginal(null); }} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">Cancel</button><button disabled={saving || !editing.id.trim() || !editing.title.trim() || !editing.description.trim()} onClick={() => void save()} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save Rulebook version"}</button></div>
            </div>
          </div>
        </div>
      ) : null}

      {historyId ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Rule history</p><h2 className="mt-1 text-xl font-semibold">{historyRule?.id} · {historyRule?.title}</h2></div><button onClick={() => setHistoryId(null)} className="grid size-10 place-items-center rounded-xl"><X className="size-5" /></button></div>
            <div className="mt-5 space-y-3">
              {history.map((entry) => (
                <article key={entry.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="font-semibold text-slate-800">Rulebook v{entry.rulebookVersion}</span><span>·</span><span>{entry.actor}</span><span>·</span><span>{new Date(entry.changedAt).toLocaleString()}</span></div>
                  <p className="mt-2 text-sm font-medium text-slate-800">{entry.reason}</p>
                  {entry.before?.description !== entry.after?.description ? <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div className="rounded-lg bg-red-50 p-3"><p className="font-semibold text-red-700">Before</p><p className="mt-1 whitespace-pre-wrap leading-5 text-red-900">{entry.before?.description || "None"}</p></div><div className="rounded-lg bg-emerald-50 p-3"><p className="font-semibold text-emerald-700">After</p><p className="mt-1 whitespace-pre-wrap leading-5 text-emerald-900">{entry.after?.description || "None"}</p></div></div> : null}
                </article>
              ))}
              {!history.length ? <p className="py-8 text-center text-sm text-slate-500">No version history recorded for this rule.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

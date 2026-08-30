"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, BookOpenCheck, ChevronRight, Clock3, Filter, History, MessageCircle, Pencil, Search, SlidersHorizontal } from "lucide-react";
import { ruleCategories, rules } from "@/lib/mock-data";
import type { RuleCategory, RuleStrength } from "@/lib/types";
import { cn, strengthLabel } from "@/lib/utils";

type QuickFilter = "all" | "hard" | "review" | "teacher" | "room" | "class" | "dancer" | "recent";

const quickFilters: Array<{ id: QuickFilter; label: string }> = [
  { id: "all", label: "All rules" },
  { id: "hard", label: "Hard only" },
  { id: "review", label: "Needs review" },
  { id: "teacher", label: "Teacher" },
  { id: "room", label: "Room" },
  { id: "class", label: "Class" },
  { id: "dancer", label: "Dancer level" },
  { id: "recent", label: "Recently changed" },
];

const strengthStyles: Record<RuleStrength, string> = {
  HARD: "bg-rose-50 text-rose-800 ring-rose-200",
  VERY_STRONG: "bg-amber-50 text-amber-800 ring-amber-200",
  MODERATE: "bg-blue-50 text-blue-800 ring-blue-200",
  LIGHT: "bg-slate-100 text-slate-700 ring-slate-200",
  BASELINE: "bg-slate-50 text-slate-600 ring-slate-200",
};

function ruleMatchesQuickFilter(rule: (typeof rules)[number], filter: QuickFilter) {
  if (filter === "all") return true;
  if (filter === "hard") return rule.strength === "HARD";
  if (filter === "review") return rule.status !== "VERIFIED";
  if (filter === "teacher") return rule.category === "Teachers";
  if (filter === "room") return rule.category === "Rooms" || rule.relatedEntities.some((item) => item.includes("Studio"));
  if (filter === "class") return rule.category === "Classes" || rule.category === "Sequencing";
  if (filter === "dancer") return rule.category === "Dancers / Cohorts" || rule.category === "Attendance";
  if (filter === "recent") return rule.lastModified.includes("Aug 30");
  return true;
}

export function RulebookView() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<RuleCategory | "All">("All");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [selectedRule, setSelectedRule] = useState<(typeof rules)[number] | null>(null);

  const filteredRules = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rules.filter((rule) => {
      const categoryMatch = category === "All" || rule.category === category;
      const quickMatch = ruleMatchesQuickFilter(rule, quickFilter);
      const searchMatch = !normalized || [rule.id, rule.title, rule.description, rule.category, rule.source, ...rule.relatedEntities].join(" ").toLowerCase().includes(normalized);
      return categoryMatch && quickMatch && searchMatch;
    });
  }, [category, query, quickFilter]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><BookOpenCheck className="size-4.5 text-emerald-700" />Rulebook review progress</div><div className="mt-3 flex items-end gap-3"><span className="text-3xl font-semibold tracking-tight text-slate-950">82 / 86</span><span className="mb-1 text-sm text-slate-500">rules verified</span></div><div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100"><div className="h-full w-[95%] rounded-full bg-emerald-500" /></div></div>
          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">Review unresolved rules<ChevronRight className="size-4" /></button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="border-b border-slate-200 p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <label className="relative min-w-0 flex-1"><span className="sr-only">Search rules</span><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search “Cami”, “Studio C”, “Friday”, “Pointe”…' className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100" /></label>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 xl:max-w-[58%] xl:pb-0"><SlidersHorizontal className="size-4 shrink-0 text-slate-400" />{quickFilters.map((filter) => <button key={filter.id} type="button" onClick={() => setQuickFilter(filter.id)} className={cn("shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition", quickFilter === filter.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>{filter.label}</button>)}</div>
          </div>
        </div>

        <div className="grid min-h-[620px] lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r"><div className="flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500"><Filter className="size-3.5" />Categories</div><div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0"><button type="button" onClick={() => setCategory("All")} className={cn("shrink-0 rounded-lg px-3 py-2 text-left text-sm font-medium transition lg:w-full", category === "All" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>All categories</button>{ruleCategories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={cn("shrink-0 rounded-lg px-3 py-2 text-left text-sm font-medium transition lg:w-full", category === item ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{item}</button>)}</div></aside>

          <div className="min-w-0 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{filteredRules.length} representative rules</p><p className="mt-0.5 text-xs text-slate-500">Prototype shows seeded DWDE data, not the full 86-rule record yet.</p></div><div className="hidden text-xs text-slate-400 sm:block">Master Rulebook v3</div></div>
            <div className="space-y-3">
              {filteredRules.map((rule) => (
                <article key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-[0_4px_16px_rgba(15,23,42,0.05)] sm:p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset", strengthStyles[rule.strength])}>{strengthLabel[rule.strength]}</span><span className="text-xs font-semibold text-slate-400">{rule.id}</span>{rule.status !== "VERIFIED" ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-800 ring-1 ring-inset ring-amber-200"><AlertTriangle className="size-3" />{rule.status === "NEEDS_REVIEW" ? "Needs review" : "Needs discussion"}</span> : <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><BadgeCheck className="size-3.5" />Verified</span>}</div><h3 className="mt-3 text-base font-semibold tracking-tight text-slate-950 sm:text-lg">{rule.title}</h3><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{rule.description}</p>{rule.reason ? <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600"><span className="font-semibold text-slate-800">Reason:</span> {rule.reason}</div> : null}<div className="mt-4 flex flex-wrap gap-2">{rule.relatedEntities.slice(0, 6).map((entity) => <span key={entity} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{entity}</span>)}{rule.relatedEntities.length > 6 ? <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">+{rule.relatedEntities.length - 6}</span> : null}</div></div>
                    <div className="flex shrink-0 items-center gap-1 xl:flex-col xl:items-stretch"><button type="button" onClick={() => setSelectedRule(rule)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="size-3.5" />Edit</button><button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"><MessageCircle className="size-3.5" />Ask ChatGPT</button><button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><History className="size-3.5" />History</button></div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-400"><span>{rule.category}</span><span>{rule.source}</span><span>Modified {rule.lastModified}</span><span>Introduced {rule.versionIntroduced}</span></div>
                </article>
              ))}
              {filteredRules.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center"><Search className="mx-auto size-6 text-slate-400" /><p className="mt-3 text-sm font-semibold text-slate-800">No rules match this view</p><p className="mt-1 text-sm text-slate-500">Try a broader search or clear the category/filter.</p></div> : null}
            </div>
          </div>
        </div>
      </section>

      {selectedRule ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/25 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={`Edit ${selectedRule.title}`}>
          <button className="absolute inset-0" aria-label="Close rule editor" onClick={() => setSelectedRule(null)} />
          <div className="relative h-full w-full max-w-lg overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">Proposed rule edit · Prototype</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{selectedRule.id}</h2></div><button type="button" onClick={() => setSelectedRule(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">Close</button></div>
            <div className="mt-6 space-y-5"><label className="block"><span className="text-xs font-semibold text-slate-700">Rule name</span><input readOnly value={selectedRule.title} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800" /></label><label className="block"><span className="text-xs font-semibold text-slate-700">Plain-English description</span><textarea readOnly rows={5} value={selectedRule.description} className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-800" /></label><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Strength</p><p className="mt-1 text-sm font-semibold text-slate-900">{strengthLabel[selectedRule.strength]}</p></div><div className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Category</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedRule.category}</p></div></div><div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4"><div className="flex gap-3"><Clock3 className="mt-0.5 size-4.5 shrink-0 text-slate-500" /><div><p className="text-sm font-semibold text-slate-800">Full editing arrives in Milestone 2</p><p className="mt-1 text-sm leading-6 text-slate-500">Saving will create a proposed patch, calculate schedule impact, show old/new values, and require confirmation before a new Rulebook version exists.</p></div></div></div></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

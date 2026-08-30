import type { LucideIcon } from "lucide-react";
import { ArrowRight, Construction, Sparkles } from "lucide-react";

export function FeaturePreview({ eyebrow, title, description, icon: Icon, items }: { eyebrow: string; title: string; description: string; icon: LucideIcon; items: Array<{ title: string; detail: string }> }) {
  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="max-w-2xl"><p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">{eyebrow}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-3xl">{title}</h2><p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">{description}</p></div><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white"><Icon className="size-5.5" /></div></div>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item, index) => <section key={item.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"><div className="flex items-center justify-between gap-3"><span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">{String(index + 1).padStart(2, "0")}</span><ArrowRight className="size-4 text-slate-300" /></div><h3 className="mt-5 text-base font-semibold text-slate-900">{item.title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{item.detail}</p></section>)}</div>
      <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><Construction className="mt-0.5 size-5 shrink-0 text-slate-500" /><div><p className="text-sm font-semibold text-slate-800">Deliberately staged after visual approval</p><p className="mt-1 text-sm leading-6 text-slate-500">The route is real; mutation and persistence workflows are not being faked in Milestone 1.</p></div></div><span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200"><Sparkles className="size-3.5" />Next milestone</span></section>
    </div>
  );
}

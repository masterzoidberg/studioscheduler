import Link from "next/link";
import { ArrowRight, BookOpenText, CalendarDays, Check, CircleAlert, Clock3, History, ShieldCheck } from "lucide-react";
import { recentChanges } from "@/lib/mock-data";

function MetricRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className="flex items-center justify-between gap-4 py-2 text-sm"><span className="text-slate-500">{label}</span><span className={good ? "font-semibold text-emerald-700" : "font-semibold text-slate-900"}>{value}</span></div>;
}

function SummaryCard({ icon: Icon, eyebrow, title, children }: { icon: typeof BookOpenText; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">{eyebrow}</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{title}</h2></div><div className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-700"><Icon className="size-5" aria-hidden="true" /></div></div>
      <div className="mt-4 divide-y divide-slate-100">{children}</div>
    </section>
  );
}

export function Dashboard() {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="grid lg:grid-cols-[1.45fr_0.85fr]">
          <div className="p-6 sm:p-8 lg:p-9">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200"><ShieldCheck className="size-3.5" />Current schedule passes hard constraints</div>
            <h2 className="mt-5 max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">One place to understand the rules and shape the week.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">Review unresolved rules, inspect Monday&apos;s room plan, and keep every future human or AI change tied to the same structured source of truth.</p>
            <div className="mt-6 flex flex-wrap gap-3"><Link href="/schedule" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">Continue schedule review<ArrowRight className="size-4" /></Link><Link href="/rulebook" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Review 2 open rules</Link></div>
          </div>
          <div className="border-t border-slate-200 bg-slate-950 p-6 text-white lg:border-l lg:border-t-0 lg:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Schedule health</p><div className="mt-4 flex items-end gap-3"><span className="text-5xl font-semibold tracking-tight">PASS</span><span className="mb-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">0 hard</span></div>
            <div className="mt-7 space-y-3 text-sm">{["Hard constraints", "Teacher conflicts", "Room conflicts", "Student conflicts"].map((item, index) => <div key={item} className="flex items-center justify-between border-b border-white/10 pb-3 last:border-none"><span className="text-slate-300">{item}</span><span className="flex items-center gap-2 font-semibold"><Check className="size-4 text-emerald-400" />{index === 0 ? "PASS" : "0"}</span></div>)}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <SummaryCard icon={BookOpenText} eyebrow="Master Rulebook" title="Version v3"><MetricRow label="Rules" value="86" /><MetricRow label="Hard rules" value="31" /><MetricRow label="Needs review" value="2" /></SummaryCard>
        <SummaryCard icon={CalendarDays} eyebrow="Current Schedule" title="Version v7"><MetricRow label="Class sessions" value="57" /><MetricRow label="Hard violations" value="0" good /><MetricRow label="Warnings" value="4" /></SummaryCard>
        <SummaryCard icon={CircleAlert} eyebrow="Open Questions" title="2 need confirmation"><MetricRow label="Karly arrival rule" value="Review" /><MetricRow label="Studio C capacity" value="Review" /><MetricRow label="Verified" value="82 / 86" /></SummaryCard>
        <SummaryCard icon={Clock3} eyebrow="Monday Load" title="3 studios active"><MetricRow label="Studio A" value="3 sessions" /><MetricRow label="Studio B" value="4 sessions" /><MetricRow label="Studio C" value="4 sessions" /></SummaryCard>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6"><div><p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">Audit trail</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Recent changes</h2></div><History className="size-5 text-slate-400" aria-hidden="true" /></div>
        <div className="divide-y divide-slate-100">{recentChanges.map((change) => <div key={change.title} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:px-6"><div><p className="text-sm font-semibold text-slate-900">{change.title}</p><p className="mt-1 text-sm leading-6 text-slate-500">{change.detail}</p></div><div className="text-left sm:text-right"><p className="text-xs font-medium text-slate-600">{change.timestamp}</p><p className="mt-1 text-xs text-slate-400">{change.actor}</p></div></div>)}</div>
      </section>
    </div>
  );
}

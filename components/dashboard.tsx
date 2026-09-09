"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, History, SlidersHorizontal, UsersRound, GraduationCap } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { buildSetupProgress } from "@/lib/setup-progress";

export function Dashboard() {
  const {
    state,
    currentAssignments,
    validation,
    scheduleIsStale,
    rebaseSchedule,
    canEdit,
  } = useWorkspace();
  if (!state) return null;

  const setup = buildSetupProgress(state);
  const next = setup.nextAction;
  const headline = next
    ? `Next setup step: ${next.title}`
    : scheduleIsStale
      ? "The schedule needs review after setup changes"
      : validation.hardViolations > 0
        ? `${validation.hardViolations} schedule conflict${validation.hardViolations === 1 ? " needs" : "s need"} attention`
        : "Studio setup is caught up for now";
  const detail = next
    ? next.description
    : scheduleIsStale
      ? "Your studio information changed after this schedule was last checked. The schedule has not been silently reinterpreted."
      : validation.hardViolations > 0
        ? "Open the schedule to review the affected placements. Detailed diagnostic information remains under Settings → Advanced."
        : "No current setup action or schedule conflict is detected. Sections that are not implemented yet remain clearly marked in Setup.";
  const tone = next || scheduleIsStale
    ? "border-amber-200 bg-amber-50"
    : validation.hardViolations > 0
      ? "border-red-200 bg-red-50"
      : "border-emerald-200 bg-emerald-50";

  const attention = [
    ...setup.actionableSections.map((section) => ({
      id: `setup-${section.id}`,
      message: section.description,
      detail: section.title,
      href: section.href ?? "/setup",
    })),
    ...(scheduleIsStale ? [{ id: "schedule-stale", message: "The current schedule needs to be checked against the latest setup changes.", detail: "Schedule", href: "/schedule" }] : []),
    ...validation.violations.slice(0, 4).map((item, index) => ({
      id: `schedule-${index}`,
      message: item.message,
      detail: "Schedule conflict",
      href: "/schedule",
    })),
  ].slice(0, 8);

  return (
    <div className="space-y-6">
      <section className={`rounded-3xl border p-5 sm:p-6 ${tone}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              {!next && !scheduleIsStale && validation.hardViolations === 0
                ? <CheckCircle2 className="size-4 text-emerald-600" />
                : <AlertTriangle className="size-4 text-amber-600" />}
              Studio overview
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{headline}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{detail}</p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <Link href="/setup" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">
              Open setup
              <ArrowRight className="size-4" />
            </Link>
            {scheduleIsStale && canEdit ? (
              <button onClick={() => void rebaseSchedule()} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900">
                Recheck unchanged schedule
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/setup" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
          <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-600">Setup</p><SlidersHorizontal className="size-4 text-slate-400" /></div>
          <p className="mt-5 text-3xl font-semibold tracking-tight">{setup.actionableSections.length}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">setup section{setup.actionableSections.length === 1 ? "" : "s"} need attention now</p>
        </Link>
        <Link href="/people" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
          <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-600">People & rooms</p><UsersRound className="size-4 text-slate-400" /></div>
          <p className="mt-5 text-3xl font-semibold tracking-tight">{state.teachers.length + state.students.length + state.rooms.length}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">{state.teachers.length} teachers · {state.students.length} students · {state.rooms.length} rooms</p>
        </Link>
        <Link href="/classes" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
          <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-600">Classes</p><GraduationCap className="size-4 text-slate-400" /></div>
          <p className="mt-5 text-3xl font-semibold tracking-tight">{state.classes.length}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">weekly classes in the working catalog</p>
        </Link>
        <Link href="/schedule" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
          <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-600">Schedule</p><CalendarDays className="size-4 text-slate-400" /></div>
          <p className="mt-5 text-3xl font-semibold tracking-tight">{currentAssignments.length}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">class placements in the current weekly schedule</p>
        </Link>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Needs attention</p><h3 className="mt-1 text-lg font-semibold">What to do next</h3></div>
            <Link href="/setup" className="text-sm font-semibold text-slate-700">Open setup</Link>
          </div>
          <div className="mt-4 divide-y divide-slate-100">
            {attention.map((item) => (
              <Link href={item.href} className="flex gap-3 py-3" key={item.id}>
                <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" />
                <div><p className="text-sm font-medium text-slate-800">{item.message}</p><p className="mt-1 text-xs text-slate-500">{item.detail}</p></div>
              </Link>
            ))}
            {attention.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">Nothing needs attention right now.</div> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2"><History className="size-4 text-slate-400" /><h3 className="text-lg font-semibold">Recent changes</h3></div>
          <div className="mt-4 space-y-4">
            {state.auditEvents.slice(0, 6).map((event) => (
              <div key={event.id}><p className="text-sm font-medium text-slate-800">{event.detail}</p><p className="mt-1 text-xs text-slate-500">{event.actor} · {new Date(event.at).toLocaleString()}</p></div>
            ))}
            {state.auditEvents.length === 0 ? <p className="text-sm text-slate-500">No changes recorded yet.</p> : null}
          </div>
          <Link href="/settings#advanced-diagnostics" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">Open history & diagnostics<ArrowRight className="size-4" /></Link>
        </div>
      </section>
    </div>
  );
}

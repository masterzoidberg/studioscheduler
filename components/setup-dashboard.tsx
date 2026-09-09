"use client";

import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  HeartHandshake,
  ListChecks,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { buildSetupProgress, type SetupSectionId, type SetupSectionStatus } from "@/lib/setup-progress";

const icons: Record<SetupSectionId, typeof Building2> = {
  studio: Building2,
  teachers: HeartHandshake,
  classes: GraduationCap,
  students: UsersRound,
  requirements: ListChecks,
  preferences: SlidersHorizontal,
  review: ClipboardCheck,
};

function statusMeta(status: SetupSectionStatus) {
  if (status === "NEEDS_ACTION") {
    return { label: "Needs attention", pill: "bg-amber-100 text-amber-900", border: "border-amber-200" };
  }
  if (status === "COMING_LATER") {
    return { label: "Coming later", pill: "bg-slate-100 text-slate-600", border: "border-slate-200" };
  }
  return { label: "Ready for now", pill: "bg-emerald-100 text-emerald-800", border: "border-emerald-200" };
}

export function SetupDashboard() {
  const { state } = useWorkspace();
  if (!state) return null;

  const progress = buildSetupProgress(state);
  const next = progress.nextAction;
  const heroTitle = progress.firstEntry
    ? "Start with the studio basics"
    : next
      ? `Continue with ${next.title}`
      : "You're caught up with today's setup tools";
  const heroDetail = progress.firstEntry
    ? "Add the rooms, teachers and classes that make up this season. Setup will keep pointing to the next concrete item instead of asking you to understand the scheduling engine."
    : next
      ? next.description
      : "Everything that can be configured in the current manager workflow is represented. Sections marked Coming later are intentionally unavailable rather than pretending to be complete.";
  const heroHref = next?.href ?? "/schedule";
  const heroAction = progress.firstEntry
    ? "Start setup"
    : next?.actionLabel ?? "Open schedule";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <Sparkles className="size-4" />
              Studio setup
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{heroTitle}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{heroDetail}</p>
            {!progress.firstEntry && progress.actionableSections.length > 1 ? (
              <p className="mt-3 text-xs font-medium text-amber-800">
                {progress.actionableSections.length} setup sections currently need attention. They are listed below in the order to review them.
              </p>
            ) : null}
          </div>
          <Link
            href={heroHref}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white"
          >
            {heroAction}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {progress.actionableSections.length > 0 && !progress.firstEntry ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">Outstanding now</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {progress.actionableSections.map((section) => (
              <div key={section.id} className="rounded-xl border border-amber-100 bg-white/80 p-3">
                <p className="text-sm font-semibold text-slate-950">{section.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{section.description}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">One setup journey</p>
            <h3 className="mt-1 text-xl font-semibold">Studio → Review</h3>
          </div>
          <p className="hidden max-w-md text-right text-xs leading-5 text-slate-500 sm:block">
            Existing editors remain the source of truth. Setup is the manager-facing map through them.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {progress.sections.map((section, index) => {
            const Icon = icons[section.id];
            const meta = statusMeta(section.status);
            return (
              <article key={section.id} id={`setup-${section.id}`} className={`rounded-2xl border bg-white p-5 shadow-sm ${meta.border}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-700"><Icon className="size-5" /></div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${meta.pill}`}>{meta.label}</span>
                </div>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Step {index + 1}</p>
                <h4 className="mt-1 text-lg font-semibold">{section.title}</h4>
                <p className="mt-2 min-h-16 text-sm leading-6 text-slate-600">{section.description}</p>
                {section.href && section.actionLabel ? (
                  <Link href={section.href} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-900 hover:bg-slate-50">
                    {section.actionLabel}
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <div className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-50 px-3 text-xs font-medium text-slate-500">
                    <CheckCircle2 className="size-3.5" />
                    Nothing to enter here yet
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600 sm:p-5">
        <strong className="text-slate-900">What moved?</strong> Setup is now the normal entry point. The existing People, Classes and Planning Repairs screens remain available as deep links while their editing controls are folded into these sections over the next setup tasks. Detailed Rulebook, readiness and version diagnostics live under Settings → Advanced.
      </section>
    </div>
  );
}

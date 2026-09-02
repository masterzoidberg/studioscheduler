"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, BookOpenCheck, CalendarDays, CheckCircle2, Cpu, Database, History } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine-v2";
import { evaluateScheduleReadiness } from "@/lib/schedule-readiness";

export function Dashboard() {
  const {
    state,
    currentRulebookVersion,
    currentEnforcementVersion,
    currentPlanningDatasetVersion,
    currentScheduleVersion,
    currentScheduleRulebookVersion,
    currentScheduleEnforcementVersion,
    currentSchedulePlanningDatasetVersion,
    currentAssignments,
    validation,
    scheduleIsStale,
    rebaseSchedule,
    canEdit,
  } = useWorkspace();
  if (!state) return null;

  const verified = state.rules.filter((rule) => (rule.reviewStatus ?? rule.verificationStatus) === "VERIFIED").length;
  const model = compileConstraintModel(state);
  const readiness = evaluateScheduleReadiness(state);
  const engine = validateConstraintModelSchedule(state, model, currentAssignments);

  const staleParts = [
    currentScheduleRulebookVersion !== currentRulebookVersion ? `Rulebook v${currentRulebookVersion}` : null,
    currentSchedulePlanningDatasetVersion !== currentPlanningDatasetVersion ? `Planning Dataset v${currentPlanningDatasetVersion}` : null,
    currentScheduleEnforcementVersion !== currentEnforcementVersion ? `legacy validation policy v${currentEnforcementVersion}` : null,
  ].filter(Boolean);

  const headline = scheduleIsStale
    ? `Schedule v${currentScheduleVersion} needs revalidation against current planning truth`
    : readiness.blockers.length > 0
      ? `${readiness.blockers.length} scheduling-readiness blocker${readiness.blockers.length === 1 ? "" : "s"} remain`
      : !engine.valid
        ? `Current candidate has ${engine.hardViolations} Constraint IR finding${engine.hardViolations === 1 ? "" : "s"}`
        : "No detected conflict under current machine coverage";

  const tone = scheduleIsStale || readiness.blockers.length > 0
    ? "border-amber-200 bg-amber-50"
    : !engine.valid
      ? "border-red-200 bg-red-50"
      : "border-emerald-200 bg-emerald-50";

  const cards = [
    {
      title: "Master Rulebook",
      value: `v${currentRulebookVersion}`,
      detail: `${state.rules.length} rules · ${verified}/${state.rules.length} human reviewed · ${readiness.ruleCoverage.accountedRules}/${readiness.ruleCoverage.activeRules} execution-registry accounted`,
      icon: BookOpenCheck,
      href: "/rulebook",
    },
    {
      title: "Planning Dataset",
      value: `v${currentPlanningDatasetVersion}`,
      detail: `${state.teachers.length} teachers · ${state.students.length} students · ${state.rooms.length} rooms · ${state.classes.length} classes`,
      icon: Database,
      href: "/people",
    },
    {
      title: "Constraint Model",
      value: model.completeHardConstraintCompilation ? "Compiled" : "Incomplete",
      detail: `${model.hardConstraints.length} typed HARD/fixed nodes · ${model.uncompiledConstraintRuleIds.length} uncompiled constraint rules`,
      icon: Cpu,
      href: "/readiness",
    },
    {
      title: "Current Schedule",
      value: `v${currentScheduleVersion}`,
      detail: `${currentAssignments.length} assignments · Rulebook v${currentScheduleRulebookVersion} · Planning Dataset v${currentSchedulePlanningDatasetVersion || "unversioned"}`,
      icon: CalendarDays,
      href: "/schedule",
    },
  ];

  const readinessFindings = readiness.blockers.map((item) => ({
    id: item.code,
    message: item.message,
    detail: item.ruleIds.length ? item.ruleIds.join(", ") : "Planning data",
    tone: "bg-red-500",
  }));
  const engineFindings = engine.violations.map((item) => ({
    id: item.constraintId,
    message: item.message,
    detail: item.ruleIds.join(", ") || "Constraint IR",
    tone: "bg-red-500",
  }));
  const findings = [...readinessFindings, ...engineFindings].slice(0, 8);

  return (
    <div className="space-y-6">
      <section className={`rounded-3xl border p-5 sm:p-6 ${tone}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              {!scheduleIsStale && readiness.blockers.length === 0 && engine.valid
                ? <CheckCircle2 className="size-4 text-emerald-600" />
                : <AlertTriangle className="size-4 text-amber-600" />}
              Scheduling control plane
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{headline}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Rulebook v{currentRulebookVersion}, Planning Dataset v{currentPlanningDatasetVersion}, and compiler {model.compilerVersion} are the current scheduling inputs. The old Enforcement v{currentEnforcementVersion} validator remains a compatibility safety net while the Constraint IR runtime is being proven against golden fixtures.
            </p>
            {scheduleIsStale && staleParts.length ? <p className="mt-2 text-xs font-medium text-amber-800">Current schedule differs from: {staleParts.join(" + ")}.</p> : null}
          </div>
          {scheduleIsStale && canEdit ? (
            <button
              onClick={() => void rebaseSchedule()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"
            >
              Revalidate unchanged schedule
            </button>
          ) : (
            <Link href="/readiness" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">
              Open readiness
              <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ title, value, detail, icon: Icon, href }) => (
          <Link href={href} key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
            <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-600">{title}</p><Icon className="size-4 text-slate-400" /></div>
            <p className="mt-5 text-3xl font-semibold tracking-tight">{value}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Needs attention</p><h3 className="mt-1 text-lg font-semibold">Readiness + Constraint IR findings</h3></div>
            <Link href="/readiness" className="text-sm font-semibold text-slate-700">Open all</Link>
          </div>
          <div className="mt-4 divide-y divide-slate-100">
            {findings.map((item, index) => (
              <div className="flex gap-3 py-3" key={`${item.id}-${index}`}>
                <span className={`mt-1 size-2 shrink-0 rounded-full ${item.tone}`} />
                <div><p className="text-sm font-medium text-slate-800">{item.message}</p><p className="mt-1 text-xs text-slate-500">{item.id} · {item.detail}</p></div>
              </div>
            ))}
            {findings.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">No readiness or Constraint IR conflict is currently detected.</div> : null}
          </div>
          {validation.hardViolations > 0 ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              Compatibility validator: {validation.hardViolations} detected HARD violation{validation.hardViolations === 1 ? "" : "s"} under Enforcement v{currentEnforcementVersion}. This remains a safety cross-check, not the future source of scheduling semantics.
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2"><History className="size-4 text-slate-400" /><h3 className="text-lg font-semibold">Recent changes</h3></div>
          <div className="mt-4 space-y-4">
            {state.auditEvents.slice(0, 6).map((event) => (
              <div key={event.id}><p className="text-sm font-medium text-slate-800">{event.detail}</p><p className="mt-1 text-xs text-slate-500">{event.actor} · {new Date(event.at).toLocaleString()}</p></div>
            ))}
            {state.auditEvents.length === 0 ? <p className="text-sm text-slate-500">No changes recorded yet.</p> : null}
          </div>
          <Link href="/versions" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">View version history<ArrowRight className="size-4" /></Link>
        </div>
      </section>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Printer } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { evaluateScheduleReadiness } from "@/lib/schedule-readiness";
import {
  buildScheduleExportModel,
  exportScheduleCsv,
  scheduleExportStatusLabel,
  type ScheduleExportView,
} from "@/lib/schedule-export";
import { SchedulePrintView } from "@/components/schedule/schedule-print-view";

const viewOptions: Array<{ value: ScheduleExportView; label: string; detail: string }> = [
  { value: "WEEK", label: "Weekly", detail: "One printable section per day, with every room." },
  { value: "TEACHER", label: "By teacher", detail: "One printable section per teacher, with each day." },
  { value: "ROOM", label: "By room", detail: "One printable section per room, with each day." },
];

function statusClasses(status: "DRAFT" | "STALE" | "REVIEWED_FINAL") {
  return status === "REVIEWED_FINAL"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : status === "STALE"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : "border-slate-200 bg-slate-100 text-slate-800";
}

export function ScheduleExportPanel() {
  const {
    state,
    currentAssignments,
    currentRulebookVersion,
    currentEnforcementVersion,
    currentPlanningDatasetVersion,
    scheduleIsStale,
    validation,
    solverContextToken,
  } = useWorkspace();
  const [view, setView] = useState<ScheduleExportView>("WEEK");
  const [notice, setNotice] = useState("");

  const readiness = useMemo(() => state ? evaluateScheduleReadiness(state) : null, [state]);
  const currentSchedule = useMemo(
    () => state?.scheduleVersions.find((version) => version.isCurrent) ?? null,
    [state],
  );
  const model = useMemo(() => {
    if (!state || !readiness) return null;
    return buildScheduleExportModel({
      state,
      assignments: currentAssignments,
      currentSchedule,
      currentRulebookVersion,
      currentEnforcementVersion,
      currentPlanningDatasetVersion,
      scheduleIsStale,
      validation,
      readiness,
      contextToken: solverContextToken,
    });
  }, [currentAssignments, currentEnforcementVersion, currentPlanningDatasetVersion, currentRulebookVersion, currentSchedule, readiness, scheduleIsStale, solverContextToken, state, validation]);

  if (!state || !model) return null;
  const exportModel = model;

  function printCurrentView() {
    setNotice("");
    window.print();
  }

  function printReviewedFinal() {
    if (!exportModel.finalReady) {
      setNotice("Reviewed final export is unavailable until the current schedule passes certification, completeness, legality, and context checks.");
      return;
    }
    setNotice("");
    window.print();
  }

  function downloadCsv(reviewedFinal: boolean) {
    try {
      const csv = exportScheduleCsv(exportModel, view, reviewedFinal);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const status = reviewedFinal ? "reviewed-final" : exportModel.status.toLowerCase();
      anchor.href = url;
      anchor.download = `dwde-schedule-v${exportModel.scheduleVersion}-${view.toLowerCase()}-${status}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(`${reviewedFinal ? "Reviewed final" : scheduleExportStatusLabel(exportModel.status)} CSV downloaded. Student rosters were omitted.`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "The schedule CSV could not be created.");
    }
  }

  const selected = viewOptions.find((option) => option.value === view) ?? viewOptions[0];
  return (
    <section className="schedule-export-panel rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div data-print-hide>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500"><FileText className="size-4" />Print & export</div>
            <h2 className="mt-1 text-lg font-semibold">Make a readable schedule artifact</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Choose a review layout, print it from the browser, or download CSV. Empty days and rooms remain visible so a quiet cell is not mistaken for missing data.</p>
          </div>
          <span className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${statusClasses(exportModel.status)}`}>
            {exportModel.status === "REVIEWED_FINAL" ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {scheduleExportStatusLabel(exportModel.status)}
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3" role="tablist" aria-label="Schedule export layout">
          {viewOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={view === option.value}
              onClick={() => { setView(option.value); setNotice(""); }}
              className={`min-h-11 rounded-xl border px-3 py-2 text-left ${view === option.value ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className={`mt-0.5 block text-[11px] leading-4 ${view === option.value ? "text-slate-300" : "text-slate-500"}`}>{option.detail}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={printCurrentView} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><Printer className="size-4" />Print {selected.label.toLowerCase()} view</button>
          <button type="button" onClick={() => downloadCsv(false)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"><Download className="size-4" />Download schedule CSV</button>
          <button type="button" onClick={printReviewedFinal} disabled={!exportModel.finalReady} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:opacity-45"><Printer className="size-4" />Print reviewed final</button>
          <button type="button" onClick={() => downloadCsv(true)} disabled={!exportModel.finalReady} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:opacity-45"><Download className="size-4" />Download reviewed final CSV</button>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          <p><strong className="text-slate-800">Current export:</strong> Schedule v{exportModel.scheduleVersion} · {exportModel.days.length}-day horizon · {exportModel.rooms.length} configured room{exportModel.rooms.length === 1 ? "" : "s"} · {exportModel.assignments.length} placed session{exportModel.assignments.length === 1 ? "" : "s"}.</p>
          <p className="mt-1">Student rosters are redacted by default. Privileged planning-data exports stay separate from the schedule artifact.</p>
        </div>

        {!exportModel.finalReady ? (
          <div className={`mt-3 rounded-xl border p-3 text-sm ${exportModel.status === "STALE" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-800"}`}>
            <p className="font-semibold">Reviewed final export is unavailable.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-5">{exportModel.finalBlockers.slice(0, 4).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            {exportModel.finalBlockers.length > 4 ? <p className="mt-1 text-xs">+ {exportModel.finalBlockers.length - 4} additional check{exportModel.finalBlockers.length - 4 === 1 ? "" : "s"} must pass.</p> : null}
          </div>
        ) : null}
        {notice ? <p role="status" className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</p> : null}

        <details className="mt-3 rounded-xl border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">Advanced export context</summary>
          <p className="border-t border-slate-200 px-3 py-2 text-[11px] leading-5 text-slate-500">ScheduleVersion {exportModel.scheduleVersionId || "not available"} · Schedule v{exportModel.scheduleVersion} · Planning Dataset v{exportModel.planningDatasetVersion} · Rulebook v{exportModel.rulebookVersion} · Enforcement v{exportModel.enforcementVersion} · horizon {exportModel.days.join(", ")}</p>
        </details>
      </div>

      <SchedulePrintView model={exportModel} view={view} />
    </section>
  );
}

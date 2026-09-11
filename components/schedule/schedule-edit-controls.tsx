"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, LockKeyhole, RefreshCw, RotateCcw, UnlockKeyhole, X } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { useScheduleEditMode } from "@/components/schedule/schedule-edit-mode";
import { scheduleVersionLabel } from "@/lib/schedule-editing";
import type { ScheduleRecoveryOperation } from "@/lib/schedule-recovery";

type RecoveryPreview = {
  operation: ScheduleRecoveryOperation;
  sourceScheduleVersion: number;
  details: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function ScheduleEditControls() {
  const {
    state,
    canEdit,
    currentScheduleVersion,
    currentRulebookVersion,
    scheduleIsStale,
    previewScheduleRecovery,
    undoSchedule,
    rebaseSchedule,
  } = useWorkspace();
  const { editingEnabled, toggleEditing } = useScheduleEditMode();
  const [previewing, setPreviewing] = useState<ScheduleRecoveryOperation | null>(null);
  const [committing, setCommitting] = useState(false);
  const [recoveryPreview, setRecoveryPreview] = useState<RecoveryPreview | null>(null);
  const [notice, setNotice] = useState("");

  const previous = state?.scheduleVersions.find((version) => version.version === currentScheduleVersion - 1);
  const versions = [...(state?.scheduleVersions || [])].sort((left, right) => right.version - left.version).slice(0, 8);
  const canUndo = Boolean(canEdit && previous && !previewing && !committing);

  async function previewRecovery(operation: ScheduleRecoveryOperation) {
    if (!canEdit || previewing || committing) return;
    setPreviewing(operation);
    setNotice("");
    const result = await previewScheduleRecovery(operation);
    setPreviewing(null);
    if (!result.ok) {
      setNotice(`${operation === "UNDO" ? "Undo" : "Revalidation"} unavailable: ${result.error || "current policy rejected the source placements."}`);
      return;
    }
    const details = result.details || {};
    setRecoveryPreview({
      operation,
      sourceScheduleVersion: Number(details.sourceScheduleVersion || currentScheduleVersion),
      details,
    });
  }

  async function commitRecovery() {
    if (!recoveryPreview || committing) return;
    const operation = recoveryPreview.operation;
    setCommitting(true);
    const result = operation === "UNDO" ? await undoSchedule() : await rebaseSchedule();
    setCommitting(false);
    if (!result.ok) {
      setNotice(`${operation === "UNDO" ? "Undo" : "Revalidation"} unavailable: ${result.error || "the current context rejected this recovery."}`);
      setRecoveryPreview(null);
      return;
    }
    setRecoveryPreview(null);
    setNotice(operation === "UNDO"
      ? `Restored the previous placements under current policy as Schedule v${result.version || currentScheduleVersion + 1}.`
      : `Revalidated the unchanged placements as Schedule v${result.version || currentScheduleVersion + 1}.`);
  }

  const previewDetails = recoveryPreview ? recoveryPreview.details : null;
  const draftStatus = record(previewDetails?.draftStatus);
  const validation = record(previewDetails?.legacyValidation || previewDetails?.validation);
  const missing = numberList(draftStatus.unscheduledSessionIds);
  const retired = numberList(draftStatus.retiredAssignmentIds);

  return (
    <section className={`rounded-2xl border p-3 sm:p-4 ${editingEnabled ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {editingEnabled ? <UnlockKeyhole className="size-4 text-amber-700" /> : <LockKeyhole className="size-4 text-slate-600" />}
            <h2 className="font-semibold text-slate-950">{editingEnabled ? "Editing mode" : "Review mode"}</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {editingEnabled
              ? "Drag, place, unassign, and edit schedule assignments. Changes still validate and create a new ScheduleVersion. Locked placements stay protected during recovery."
              : "The schedule is protected from accidental changes. You can still browse days, rooms, classes, and details."
            }
          </p>
        </div>
        <div className="flex gap-2">
          {scheduleIsStale && canEdit ? <button type="button" onClick={() => void previewRecovery("REBASE")} disabled={Boolean(previewing || committing)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900 disabled:opacity-40"><RefreshCw className="size-4" />{previewing === "REBASE" ? "Reviewing…" : "Review revalidation"}</button> : null}
          <button
            type="button"
            onClick={() => void previewRecovery("UNDO")}
            disabled={!canUndo}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
            title={canUndo ? `Re-evaluate Schedule v${currentScheduleVersion - 1} placements under current policy and save them as a new version` : "No immediately previous ScheduleVersion is available"}
          >
            <RotateCcw className="size-4" />{previewing === "UNDO" ? "Reviewing…" : "Review undo"}
          </button>
          <button
            type="button"
            onClick={toggleEditing}
            disabled={!canEdit}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-40 ${editingEnabled ? "bg-slate-950 text-white" : "bg-amber-600 text-white"}`}
          >
            {editingEnabled ? <LockKeyhole className="size-4" /> : <UnlockKeyhole className="size-4" />}
            {editingEnabled ? "Lock editing" : "Enable editing"}
          </button>
        </div>
      </div>
      {notice ? <div className={`mt-3 rounded-xl border p-3 text-sm ${notice.includes("unavailable") ? "border-red-200 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>{notice}</div> : null}
      <details className="mt-3 rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">Version history</summary>
        <div className="border-t border-slate-200 px-3 py-2">
          {versions.length ? <ol className="space-y-2">{versions.map((version) => (
            <li key={version.id} className="flex items-start justify-between gap-3 text-xs">
              <div className="min-w-0"><p className="font-semibold text-slate-800">{scheduleVersionLabel(version, currentScheduleVersion, version.version)} · Schedule v{version.version}</p><p className="truncate text-slate-500">{version.reason || "No change note recorded"}</p></div>
              <time className="shrink-0 text-slate-400" dateTime={version.createdAt}>{version.createdAt ? new Date(version.createdAt).toLocaleDateString() : ""}</time>
            </li>
          ))}</ol> : <p className="text-xs text-slate-500">No schedule versions are available yet.</p>}
        </div>
      </details>

      {recoveryPreview ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-6">
          <section role="dialog" aria-modal="true" aria-labelledby="recovery-preview-title" className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Review changes</p><h2 id="recovery-preview-title" className="mt-1 text-xl font-semibold">{recoveryPreview.operation === "UNDO" ? "Review undo" : "Review revalidation"}</h2></div><button type="button" onClick={() => setRecoveryPreview(null)} className="grid size-10 place-items-center rounded-xl" aria-label="Close recovery preview"><X className="size-5" /></button></div>
            <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-950">This is a preview. The current Schedule v{currentScheduleVersion} remains unchanged until you confirm.</p>
            <div className="mt-4 grid gap-2 text-sm"><div className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-500">Source placements</span><strong>Schedule v{recoveryPreview.sourceScheduleVersion}</strong></div><div className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-500">Current policy</span><strong>Rulebook v{currentRulebookVersion}</strong></div></div>
            <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm"><div className="flex items-center gap-2 font-semibold">{draftStatus.publishable === false || Number(validation.hardViolations || 0) > 0 ? <AlertTriangle className="size-4 text-amber-700" /> : <CheckCircle2 className="size-4 text-emerald-700" />}{draftStatus.publishable === false ? "This recovery leaves a draft to finish" : "This recovery is ready to save"}</div>{missing.length ? <p className="mt-2 text-slate-700">{missing.length} session{missing.length === 1 ? "" : "s"} still need placement after recovery.</p> : null}{retired.length ? <p className="mt-2 text-slate-700">{retired.length} retired placement{retired.length === 1 ? "" : "s"} will stay out of the active schedule.</p> : null}{Number(validation.hardViolations || 0) > 0 ? <p className="mt-2 text-red-800">{Number(validation.hardViolations)} HARD conflict{Number(validation.hardViolations) === 1 ? "" : "s"} remain under the current policy.</p> : null}<p className="mt-2 text-slate-600">Locked placements are preserved when present, and the source will be checked again at commit.</p></div>
            <div className="mt-5 flex gap-2"><button type="button" onClick={() => setRecoveryPreview(null)} disabled={committing} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Keep current schedule</button><button type="button" onClick={() => void commitRecovery()} disabled={committing} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-40"><Clock3 className="size-4" />{committing ? "Saving…" : recoveryPreview.operation === "UNDO" ? "Restore as new schedule version" : "Revalidate as new schedule version"}</button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

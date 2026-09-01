"use client";

import { useState } from "react";
import { LockKeyhole, RotateCcw, UnlockKeyhole } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase";
import { useWorkspace } from "@/components/workspace-provider";
import { useScheduleEditMode } from "@/components/schedule/schedule-edit-mode";

function messageOf(error: unknown) {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message || "Unknown error");
  return String(error || "Unknown error");
}

export function ScheduleEditControls() {
  const {
    canEdit,
    currentScheduleVersion,
    currentRulebookVersion,
    currentEnforcementVersion,
    scheduleIsStale,
    refresh,
  } = useWorkspace();
  const { editingEnabled, toggleEditing } = useScheduleEditMode();
  const [undoing, setUndoing] = useState(false);
  const [notice, setNotice] = useState("");

  async function undoLastChange() {
    if (!canEdit || scheduleIsStale || undoing) return;
    setUndoing(true);
    setNotice("");
    const { data, error } = await getBrowserSupabase().rpc("undo_last_schedule_change_v23", {
      p_expected_schedule_version: currentScheduleVersion,
      p_expected_rulebook_version: currentRulebookVersion,
      p_expected_enforcement_version: currentEnforcementVersion,
      p_reason: `Undo Schedule v${currentScheduleVersion}`,
    });
    setUndoing(false);
    if (error) {
      setNotice(`Undo unavailable: ${messageOf(error)}`);
      return;
    }
    const result = (data || {}) as Record<string, unknown>;
    setNotice(`Restored the previous schedule as Schedule v${Number(result.scheduleVersion || currentScheduleVersion + 1)}.`);
    await refresh();
  }

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
              ? "Drag, place, unassign, and edit schedule assignments. Changes still validate and create a new ScheduleVersion."
              : "The schedule is protected from accidental changes. You can still browse days, rooms, classes, and details."}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void undoLastChange()}
            disabled={!canEdit || scheduleIsStale || undoing}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
            title="Restore the immediately previous compatible schedule as a new version"
          >
            <RotateCcw className="size-4" />{undoing ? "Undoing…" : "Undo last change"}
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
      {notice ? <div className={`mt-3 rounded-xl border p-3 text-sm ${notice.startsWith("Undo unavailable") ? "border-red-200 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>{notice}</div> : null}
    </section>
  );
}

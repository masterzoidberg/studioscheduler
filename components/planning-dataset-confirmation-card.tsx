"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Database, RefreshCw } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { getBrowserSupabase } from "@/lib/supabase";

type ConfirmationRow = {
  version: number;
  snapshot_hash: string;
  confirmed_for_scheduling_at: string | null;
  confirmed_for_scheduling_by_label: string | null;
  scheduling_confirmation_note: string | null;
};

export function PlanningDatasetConfirmationCard() {
  const { state, canEdit, currentPlanningDatasetVersion } = useWorkspace();
  const [row, setRow] = useState<ConfirmationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!state) return;
    let active = true;
    void getBrowserSupabase()
      .from("planning_dataset_versions")
      .select("version,snapshot_hash,confirmed_for_scheduling_at,confirmed_for_scheduling_by_label,scheduling_confirmation_note")
      .eq("studio_id", state.studioId)
      .eq("status", "CURRENT")
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setNotice(error.message);
        else setRow(data as ConfirmationRow | null);
        setLoading(false);
      });
    return () => { active = false; };
  }, [state, currentPlanningDatasetVersion]);

  async function refreshConfirmation() {
    if (!state) return;
    const { data, error } = await getBrowserSupabase()
      .from("planning_dataset_versions")
      .select("version,snapshot_hash,confirmed_for_scheduling_at,confirmed_for_scheduling_by_label,scheduling_confirmation_note")
      .eq("studio_id", state.studioId)
      .eq("status", "CURRENT")
      .maybeSingle();
    if (error) setNotice(error.message);
    else setRow(data as ConfirmationRow | null);
  }

  async function confirm() {
    if (!canEdit || saving) return;
    setSaving(true);
    setNotice("");
    const { data, error } = await getBrowserSupabase().rpc("confirm_current_planning_dataset_v32", {
      p_expected_planning_dataset_version: currentPlanningDatasetVersion,
      p_note: "Reviewed the current fluid teacher, student, room, class, session, and roster data for automatic scheduling.",
    });
    if (error) setNotice(`Confirmation failed: ${error.message}`);
    else {
      const result = (data || {}) as Record<string, unknown>;
      setNotice(`Planning Dataset v${String(result.planningDatasetVersion || currentPlanningDatasetVersion)} confirmed for scheduling.`);
      await refreshConfirmation();
    }
    setSaving(false);
  }

  if (!state) return null;
  const confirmed = Boolean(row?.confirmed_for_scheduling_at);

  return (
    <section className={`rounded-2xl border p-5 ${confirmed ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
            {confirmed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Database className="size-4 text-amber-600" />}
            Fluid planning-data checkpoint
          </div>
          <h3 className="mt-2 text-lg font-semibold">
            {confirmed ? `Planning Dataset v${row?.version} is confirmed` : `Review Planning Dataset v${currentPlanningDatasetVersion}`}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Teachers, students, rooms, classes and rosters may change throughout scheduling. Every meaningful edit creates a new immutable Planning Dataset version. Confirm the current version after the working inventory is reviewed; the next planning edit automatically creates a new, unconfirmed version.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            External roster/source manifests are optional provenance baselines, not a freeze on current enrollment.
          </p>
          {confirmed ? (
            <p className="mt-3 text-xs font-medium text-emerald-800">
              Confirmed {new Date(row!.confirmed_for_scheduling_at!).toLocaleString()} by {row?.confirmed_for_scheduling_by_label || "an editor"}.
            </p>
          ) : null}
          {notice ? <p className="mt-3 text-xs font-medium text-slate-700">{notice}</p> : null}
        </div>
        {canEdit ? (
          <button
            disabled={loading || saving || confirmed}
            onClick={() => void confirm()}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${saving ? "animate-spin" : ""}`} />
            {saving ? "Confirming…" : confirmed ? "Confirmed" : "Confirm current data"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

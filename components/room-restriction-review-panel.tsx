"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCheck, RotateCcw } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import {
  attestRoomRestrictionReview,
  listRoomRestrictionReviewStatus,
  type RoomRestrictionReviewState,
  type RoomRestrictionReviewStatus,
} from "@/lib/setup-restriction-review-client";

function stateLabel(state: RoomRestrictionReviewState) {
  if (state === "CHANGED_SINCE_REVIEW") return "Changed since review";
  if (state === "REVIEWED") return "Reviewed";
  return "Needs review";
}

function StateIcon({ state }: { state: RoomRestrictionReviewState }) {
  if (state === "REVIEWED") return <CheckCircle2 className="size-4" />;
  if (state === "CHANGED_SINCE_REVIEW") return <RotateCcw className="size-4" />;
  return <AlertTriangle className="size-4" />;
}

function stateClasses(state: RoomRestrictionReviewState) {
  if (state === "REVIEWED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "CHANGED_SINCE_REVIEW") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

export function RoomRestrictionReviewPanel() {
  const { state, canEdit, currentRulebookVersion, currentPlanningDatasetVersion } = useWorkspace();
  const [items, setItems] = useState<RoomRestrictionReviewStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    if (!state) return;
    setLoading(true);
    setError("");
    const result = await listRoomRestrictionReviewStatus(state.studioId);
    if (!result.ok) setError(result.error || "Room restriction review status could not be loaded.");
    else setItems(result.items);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    if (!state) return () => { cancelled = true; };
    void listRoomRestrictionReviewStatus(state.studioId).then((result) => {
      if (cancelled) return;
      if (!result.ok) setError(result.error || "Room restriction review status could not be loaded.");
      else setItems(result.items);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [state, currentRulebookVersion, currentPlanningDatasetVersion]);

  async function review(item: RoomRestrictionReviewStatus, outcome: "REVIEWED_VALUE" | "REVIEWED_NO_ADDITIONAL_RESTRICTION") {
    if (!canEdit || savingRoomId) return;
    setSavingRoomId(item.roomId);
    setError("");
    setNotice("");
    const result = await attestRoomRestrictionReview({
      studioId: state!.studioId,
      roomId: item.roomId,
      expectedRulebookVersion: item.rulebookVersion,
      expectedPlanningDatasetVersion: item.planningDatasetVersion,
      expectedFingerprint: item.currentFingerprint,
      outcome,
      note: outcome === "REVIEWED_VALUE" ? "Reviewed room restriction setup" : "No additional room restriction applies",
    });
    if (!result.ok) setError(result.error || "Room restriction review was not saved. Refresh and check the current setup.");
    else {
      setNotice(`${item.roomName} is reviewed for the current room restrictions.`);
      await load();
    }
    setSavingRoomId(null);
  }

  if (!state) return null;
  const reviewedCount = items.filter((item) => item.state === "REVIEWED").length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="room-restriction-review-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Setup review</p>
          <h2 id="room-restriction-review-heading" className="mt-1 text-xl font-semibold text-slate-950">Room restrictions</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Check each active room&apos;s unavailable periods and required-feature rules. Choose Review value when a restriction applies, or Review no additional restriction when the room has none. A policy, room feature, or current dataset change requires a fresh review.</p>
        </div>
        {!loading ? <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{reviewedCount} of {items.length} reviewed</div> : null}
      </div>

      {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-900" role="alert">{error}<button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button></div> : null}
      {loading ? <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500" role="status">Loading room restriction review…</div> : items.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">Add a room in <Link href="/people" className="font-semibold underline">room facts</Link> before reviewing restrictions.</div> : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {items.map((item) => {
            const saving = savingRoomId === item.roomId;
            const needsReview = item.state !== "REVIEWED";
            return <article key={item.roomId} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-950">{item.roomName}</h3><p className="mt-1 text-sm text-slate-600">{item.hasRestriction ? "A typed room restriction is present." : "No typed room restriction is present."}</p></div><div className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${stateClasses(item.state)}`}><StateIcon state={item.state} />{stateLabel(item.state)}</div></div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.state === "REVIEWED" ? "The current room facts and policy match the latest review." : item.state === "CHANGED_SINCE_REVIEW" ? "Review the current room facts and policy again before building a schedule." : "Review the current room facts and policy before building a schedule."}</p>
              {needsReview && canEdit ? <div className="mt-3 flex flex-col gap-2 sm:flex-row"><button type="button" disabled={Boolean(savingRoomId)} onClick={() => void review(item, "REVIEWED_VALUE")} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-50"><ClipboardCheck className="size-4" />{saving ? "Saving…" : "Review value"}</button><button type="button" disabled={Boolean(savingRoomId)} onClick={() => void review(item, "REVIEWED_NO_ADDITIONAL_RESTRICTION")} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-800 disabled:opacity-50">Review no additional restriction</button></div> : null}
              {needsReview ? <Link href="#setup-room-restrictions" className="mt-3 inline-flex text-xs font-semibold text-sky-800 underline">Open the responsible Setup form</Link> : null}
              {item.history.length ? <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Review history ({item.history.length})</summary><div className="mt-2 space-y-2">{item.history.slice(0, 5).map((entry) => <p key={entry.id} className="text-xs leading-5 text-slate-500">{entry.outcome === "REVIEWED_VALUE" ? "Reviewed value" : "No additional restriction"} · {entry.reviewerLabel}{entry.note ? ` · ${entry.note}` : ""}</p>)}</div></details> : null}
            </article>;
          })}
        </div>
      )}
    </section>
  );
}

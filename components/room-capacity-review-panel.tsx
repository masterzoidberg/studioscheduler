"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, History, RefreshCw } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import {
  attestRoomCapacityReview,
  listRoomCapacityReviewStatuses,
  type RoomCapacityReviewState,
  type RoomCapacityReviewStatus,
} from "@/lib/setup-review-client";

function stateLabel(state: RoomCapacityReviewState) {
  switch (state) {
    case "REVIEWED": return "Reviewed";
    case "MISSING": return "Capacity missing";
    case "CHANGED_SINCE_REVIEW": return "Changed since review";
    case "BLOCKED": return "Review blocked";
    default: return "Needs review";
  }
}

function stateClasses(state: RoomCapacityReviewState) {
  switch (state) {
    case "REVIEWED": return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "MISSING": return "border-rose-200 bg-rose-50 text-rose-800";
    case "CHANGED_SINCE_REVIEW": return "border-amber-200 bg-amber-50 text-amber-900";
    case "BLOCKED": return "border-rose-200 bg-rose-50 text-rose-800";
    default: return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function StateIcon({ state }: { state: RoomCapacityReviewState }) {
  if (state === "REVIEWED") return <CheckCircle2 className="size-4" aria-hidden="true" />;
  if (state === "CHANGED_SINCE_REVIEW") return <RefreshCw className="size-4" aria-hidden="true" />;
  if (state === "MISSING" || state === "BLOCKED") return <CircleAlert className="size-4" aria-hidden="true" />;
  return <Clock3 className="size-4" aria-hidden="true" />;
}

function ReviewHistory({ item }: { item: RoomCapacityReviewStatus }) {
  if (!item.history.length) return null;
  return (
    <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 font-semibold text-slate-700">
        <History className="size-3.5" aria-hidden="true" />
        Review history ({item.history.length})
      </summary>
      <div className="space-y-2 border-t border-slate-200 pt-2">
        {item.history.map((history) => (
          <div key={history.id} className="rounded-lg bg-white p-2">
            <div className="font-medium text-slate-800">
              {history.outcome === "REVIEWED_VALUE" ? "Capacity reviewed" : history.outcome.replaceAll("_", " ").toLowerCase()}
            </div>
            <div className="mt-0.5">
              {history.reviewerLabel}
              {history.createdAt ? ` · ${new Date(history.createdAt).toLocaleString()}` : ""}
            </div>
            {history.sourcePlanningDatasetVersion != null ? (
              <div className="mt-0.5 text-slate-500">Setup version {history.sourcePlanningDatasetVersion}</div>
            ) : null}
            {history.note ? <div className="mt-1 text-slate-700">{history.note}</div> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

export function RoomCapacityReviewPanel() {
  const { state, canEdit, currentPlanningDatasetVersion } = useWorkspace();
  const [items, setItems] = useState<RoomCapacityReviewStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!state) return;
    setLoading(true);
    setError("");
    const result = await listRoomCapacityReviewStatuses(state.studioId);
    if (result.ok) setItems(result.data);
    else setError(result.error || "Room capacity review status could not be loaded.");
    setLoading(false);
  }, [state]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, currentPlanningDatasetVersion]);

  const reviewedCount = useMemo(
    () => items.filter((item) => item.state === "REVIEWED").length,
    [items],
  );

  async function review(item: RoomCapacityReviewStatus) {
    if (!state || !canEdit || savingRoomId) return;
    setSavingRoomId(item.roomId);
    setError("");
    setNotice("");
    const result = await attestRoomCapacityReview({
      studioId: state.studioId,
      roomId: item.roomId,
      expectedPlanningDatasetVersion: item.planningDatasetVersion,
      expectedFingerprint: item.currentFingerprint,
    });
    if (!result.ok) {
      setError(result.error || "Room capacity review could not be saved.");
      setSavingRoomId(null);
      return;
    }
    setNotice(`${item.roomName} capacity is reviewed for the current setup.`);
    setSavingRoomId(null);
    await load();
  }

  if (!state) return null;

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="room-capacity-review-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Setup review</p>
          <h2 id="room-capacity-review-heading" className="mt-1 text-lg font-semibold text-slate-950">Room capacity</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Confirm each room&apos;s current capacity after checking the value above. A later capacity change automatically requires a fresh review; unrelated setup edits do not.
          </p>
        </div>
        {!loading ? (
          <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            {reviewedCount} of {items.length} reviewed
          </div>
        ) : null}
      </div>

      {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div> : null}
      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
          <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500" role="status">Loading room review status…</div>
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">
          Add a room before reviewing capacity.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {items.map((item) => {
            const missing = item.state === "MISSING";
            const blocked = item.state === "BLOCKED";
            const alreadyReviewed = item.state === "REVIEWED";
            const saving = savingRoomId === item.roomId;
            return (
              <article key={item.roomId} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-950">{item.roomName}</h3>
                    <p className="mt-1 text-sm text-slate-600">Capacity {item.capacity ?? "not set"}</p>
                  </div>
                  <div className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${stateClasses(item.state)}`}>
                    <StateIcon state={item.state} />
                    {stateLabel(item.state)}
                  </div>
                </div>

                {missing ? (
                  <p className="mt-3 text-sm text-rose-700">Enter a positive capacity in the Rooms editor before reviewing this item.</p>
                ) : blocked ? (
                  <p className="mt-3 text-sm text-rose-700">This review cannot be confirmed until the blocking setup issue is resolved.</p>
                ) : alreadyReviewed ? (
                  <p className="mt-3 text-sm text-slate-600">The current capacity matches the latest valid review.</p>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">
                    {item.state === "CHANGED_SINCE_REVIEW"
                      ? "The capacity changed after its last review. Check the current value and confirm it again."
                      : "Check the current capacity, then confirm that this value has been reviewed."}
                  </p>
                )}

                {canEdit && !missing && !blocked && !alreadyReviewed ? (
                  <button
                    type="button"
                    onClick={() => void review(item)}
                    disabled={Boolean(savingRoomId)}
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {saving ? "Saving review…" : item.state === "CHANGED_SINCE_REVIEW" ? "Review again" : "Confirm capacity reviewed"}
                  </button>
                ) : null}

                <ReviewHistory item={item} />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

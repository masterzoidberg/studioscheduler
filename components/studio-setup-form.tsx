"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Link2, Plus, Save, Trash2 } from "lucide-react";
import type { Day } from "@/lib/domain";
import type { PolicyTimeWindowV1 } from "@/lib/typed-policy";
import {
  buildSetupTypedPolicyPatches,
  DEFAULT_STUDIO_OPERATING_WINDOWS,
  SETUP_DAYS,
  setupPolicyDraftFromRules,
  type SetupPolicyDraft,
} from "@/lib/setup-policy";
import { useWorkspace } from "@/components/workspace-provider";

function emptyWindow(day: Day): PolicyTimeWindowV1 {
  return { day, start: "09:00", end: "10:00" };
}

function windowLabel(window: PolicyTimeWindowV1) {
  return `${window.day} ${window.start}–${window.end}`;
}

export function StudioSetupForm() {
  const { state, canEdit, applySetupTypedPolicies } = useWorkspace();
  const initializedStudioId = useRef<string | null>(null);
  const [draftState, setDraft] = useState<SetupPolicyDraft | null>(null);
  const [reason, setReason] = useState("Updated studio setup policies");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!state) {
      initializedStudioId.current = null;
      return;
    }
    if (initializedStudioId.current === state.studioId) return;
    initializedStudioId.current = state.studioId;
    setDraft(setupPolicyDraftFromRules(state.rules));
  }, [state]);

  if (!state || !draftState) return null;
  const draft = draftState;
  const roomUnavailable = draft.roomUnavailable;

  function updateDraft(next: Partial<SetupPolicyDraft>) {
    setDraft((current) => current ? { ...current, ...next } : current);
    setError("");
    setNotice("");
  }

  function updateOperatingWindow(index: number, changes: Partial<PolicyTimeWindowV1>) {
    updateDraft({ operatingWindows: draft.operatingWindows.map((window, itemIndex) => itemIndex === index ? { ...window, ...changes } : window) });
  }

  function toggleClosedDay(day: Day, closed: boolean) {
    const closedDays = closed
      ? [...new Set([...draft.closedDays, day])]
      : draft.closedDays.filter((item) => item !== day);
    const operatingWindows = closed
      ? draft.operatingWindows.filter((window) => window.day !== day)
      : draft.operatingWindows.length > 0 ? draft.operatingWindows : [{ ...DEFAULT_STUDIO_OPERATING_WINDOWS[0], day }];
    updateDraft({ closedDays, operatingWindows });
  }

  function addOperatingWindow() {
    const day = SETUP_DAYS.find((item) => !draft.closedDays.includes(item)) || "Monday";
    updateDraft({ operatingWindows: [...draft.operatingWindows, emptyWindow(day)] });
  }

  function removeOperatingWindow(index: number) {
    if (draft.operatingWindows.length <= 1) return;
    updateDraft({ operatingWindows: draft.operatingWindows.filter((_window, itemIndex) => itemIndex !== index) });
  }

  function updateRoomWindow(index: number, changes: Partial<PolicyTimeWindowV1>) {
    if (!draft.roomUnavailable) return;
    updateDraft({ roomUnavailable: { ...draft.roomUnavailable, windows: draft.roomUnavailable.windows.map((window, itemIndex) => itemIndex === index ? { ...window, ...changes } : window) } });
  }

  function addRoomWindow() {
    if (!draft.roomUnavailable) return;
    updateDraft({ roomUnavailable: { ...draft.roomUnavailable, windows: [...draft.roomUnavailable.windows, emptyWindow("Monday")] } });
  }

  function removeRoomWindow(index: number) {
    if (!draft.roomUnavailable || draft.roomUnavailable.windows.length <= 1) return;
    updateDraft({ roomUnavailable: { ...draft.roomUnavailable, windows: draft.roomUnavailable.windows.filter((_window, itemIndex) => itemIndex !== index) } });
  }

  async function save() {
    if (saving || !canEdit) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const patches = buildSetupTypedPolicyPatches(draft);
      const result = await applySetupTypedPolicies(patches, reason.trim() || "Updated studio setup policies");
      if (!result.ok) {
        setError(result.error || "Setup changes were not saved. Check the highlighted values and try again.");
        return;
      }
      setNotice(`Setup saved in Rulebook v${result.rulebookVersion ?? "?"}. Review the current setup before building a schedule.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="setup-studio" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="studio-setup-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Studio setup</p>
          <h2 id="studio-setup-heading" className="mt-1 text-xl font-semibold text-slate-950">Must happen before you build a schedule</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Set the days and hours the studio can run, then record room periods that cannot be used and room features a class must have. These choices become versioned Rulebook policy; they do not change room identity, capacity or features in the planning inventory.</p>
        </div>
        <Link href="/people" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-800">
          <Link2 className="size-3.5" />
          Edit room facts
        </Link>
      </div>

      {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-900" role="alert">{error} Your entries are still here so you can correct them and try again.</div> : null}

      <form className="mt-5 space-y-6" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-950">Operating days and hours</legend>
          <p className="text-xs leading-5 text-slate-500">Use same-day 15-minute intervals. Sunday is intentionally outside the currently supported setup days.</p>
          <div className="space-y-2">
            {SETUP_DAYS.map((day) => {
              const windows = draft.operatingWindows.filter((window) => window.day === day);
              const closed = draft.closedDays.includes(day);
              return (
                <div key={day} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-800">
                      <input type="checkbox" checked={closed} onChange={(event) => toggleClosedDay(day, event.target.checked)} className="size-4" />
                      {day}
                    </label>
                    <span className="text-xs text-slate-500">{closed ? "Closed" : windows.length ? windows.map(windowLabel).join(", ") : "No hours entered"}</span>
                  </div>
                  {!closed ? (
                    <div className="mt-2 space-y-2">
                      {windows.map((window) => {
                        const index = draft.operatingWindows.indexOf(window);
                        return (
                          <div key={`${day}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                            <label className="text-xs font-medium text-slate-600">Opens<input aria-label={`${day} opens`} type="time" step="900" value={window.start} onChange={(event) => updateOperatingWindow(index, { start: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label>
                            <label className="text-xs font-medium text-slate-600">Closes<input aria-label={`${day} closes`} type="time" step="900" value={window.end} onChange={(event) => updateOperatingWindow(index, { end: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label>
                            <button type="button" onClick={() => removeOperatingWindow(index)} disabled={draft.operatingWindows.length <= 1} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-3 text-xs font-semibold disabled:opacity-40" aria-label={`Remove ${day} operating window`}><Trash2 className="size-4" /></button>
                          </div>
                        );
                      })}
                      {windows.length === 0 ? <p className="text-xs text-amber-700">Add an interval below or mark this day closed.</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={addOperatingWindow} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-800"><Plus className="size-4" />Add operating interval</button>
        </fieldset>

        <fieldset id="setup-room-restrictions" className="space-y-3 border-t border-slate-100 pt-5">
          <legend className="text-sm font-semibold text-slate-950">Room unavailable periods</legend>
          <p className="text-xs leading-5 text-slate-500">Use this for a room that cannot be used during a same-day period. Leave it off when no room-specific unavailable period applies; that choice is reviewable below.</p>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" checked={Boolean(draft.roomUnavailable)} onChange={(event) => updateDraft({ roomUnavailable: event.target.checked ? { roomId: state.rooms[0]?.id || "", windows: [emptyWindow("Monday")] } : null })} className="size-4" />
            Set an unavailable period
          </label>
          {roomUnavailable ? (
            <div className="space-y-2 rounded-xl border border-slate-200 p-3">
              <label className="block text-xs font-medium text-slate-600">Room<select value={roomUnavailable.roomId} onChange={(event) => updateDraft({ roomUnavailable: { ...roomUnavailable, roomId: event.target.value } })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950"><option value="">Choose a room</option>{state.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
              {roomUnavailable.windows.map((window, index) => <div key={`room-window-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><label className="text-xs font-medium text-slate-600">Day<select value={window.day} onChange={(event) => updateRoomWindow(index, { day: event.target.value as Day })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950">{SETUP_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Starts<input aria-label="Room unavailable starts" type="time" step="900" value={window.start} onChange={(event) => updateRoomWindow(index, { start: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label><label className="text-xs font-medium text-slate-600">Ends<input aria-label="Room unavailable ends" type="time" step="900" value={window.end} onChange={(event) => updateRoomWindow(index, { end: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label><button type="button" onClick={() => removeRoomWindow(index)} disabled={roomUnavailable.windows.length <= 1} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-3 text-xs font-semibold disabled:opacity-40" aria-label="Remove unavailable period"><Trash2 className="size-4" /></button></div>)}
              <button type="button" onClick={addRoomWindow} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold"><Plus className="size-4" />Add unavailable period</button>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-3 border-t border-slate-100 pt-5">
          <legend className="text-sm font-semibold text-slate-950">Room features classes require</legend>
          <p className="text-xs leading-5 text-slate-500">Choose the classes and list the room features they must have. Feature values are matched against the current Planning Dataset.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {state.classes.map((klass) => {
              const selected = draft.roomRequiredFeatures?.classIds.includes(klass.id) ?? false;
              return <label key={klass.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-800"><input type="checkbox" checked={selected} onChange={(event) => { const current = draft.roomRequiredFeatures?.classIds || []; const classIds = event.target.checked ? [...new Set([...current, klass.id])] : current.filter((id) => id !== klass.id); updateDraft({ roomRequiredFeatures: classIds.length || (draft.roomRequiredFeatures?.requiredFeatures.length ?? 0) ? { classIds, requiredFeatures: draft.roomRequiredFeatures?.requiredFeatures || [] } : null }); }} className="size-4" />{klass.name}</label>;
            })}
          </div>
          <label className="block text-xs font-medium text-slate-600">Required features, comma separated<input value={draft.roomRequiredFeatures?.requiredFeatures.join(", ") || ""} onChange={(event) => { const requiredFeatures = event.target.value.split(",").map((value) => value.trim()).filter(Boolean); const classIds = draft.roomRequiredFeatures?.classIds || []; updateDraft({ roomRequiredFeatures: classIds.length || requiredFeatures.length ? { classIds, requiredFeatures } : null }); }} placeholder="Example: mirrors, sprung floor" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label>
        </fieldset>

        <div className="border-t border-slate-100 pt-5">
          <label className="block text-xs font-medium text-slate-600">Why are you changing Setup?<input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label>
          <button type="submit" disabled={!canEdit || saving} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Save className="size-4" />{saving ? "Saving setup…" : canEdit ? "Save Setup" : "Editor access required"}</button>
        </div>
      </form>
    </section>
  );
}

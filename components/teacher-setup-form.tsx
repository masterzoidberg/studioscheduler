"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Plus, Save, Trash2 } from "lucide-react";
import type { Day, StudioState } from "@/lib/domain";
import type { PolicyTimeWindowV1 } from "@/lib/typed-policy";
import {
  buildSetupTypedPolicyPatches,
  SETUP_DAYS,
  setupPolicyDraftFromRules,
  type SetupPolicyDraft,
  type TeacherAvailabilityDraft,
  type SetupTypedPolicyMutationResult,
  type SetupTypedPolicyPatch,
} from "@/lib/setup-policy";
import { useWorkspace } from "@/components/workspace-provider";
import {
  attestTeacherSetupReview,
  listTeacherSetupReviewStatus,
  type TeacherSetupReviewState,
  type TeacherSetupReviewStatus,
} from "@/lib/teacher-setup-review-client";

function emptyWindow(day: Day = "Monday"): PolicyTimeWindowV1 {
  return { day, start: "17:00", end: "18:00" };
}

function stateLabel(state: TeacherSetupReviewState) {
  if (state === "REVIEWED_VALUE") return "Reviewed value";
  if (state === "REVIEWED_NO_ADDITIONAL_RESTRICTION") return "Reviewed unrestricted";
  if (state === "CHANGED_SINCE_REVIEW") return "Changed since review";
  if (state === "BLOCKED") return "Blocked";
  return "Needs review";
}

function stateClasses(state: TeacherSetupReviewState) {
  if (state === "REVIEWED_VALUE" || state === "REVIEWED_NO_ADDITIONAL_RESTRICTION") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "BLOCKED") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export function TeacherSetupForm() {
  const workspace = useWorkspace();
  if (!workspace.state) return null;
  return <TeacherSetupFormContent key={workspace.state.studioId} state={workspace.state} canEdit={workspace.canEdit} applySetupTypedPolicies={workspace.applySetupTypedPolicies} />;
}

function TeacherSetupFormContent({ state, canEdit, applySetupTypedPolicies }: {
  state: StudioState;
  canEdit: boolean;
  applySetupTypedPolicies: (policies: SetupTypedPolicyPatch[], reason: string) => Promise<SetupTypedPolicyMutationResult>;
}) {
  const [draft, setDraft] = useState<SetupPolicyDraft>(() => setupPolicyDraftFromRules(state.rules, state.teachers.map((teacher) => teacher.id)));
  const [reviews, setReviews] = useState<TeacherSetupReviewStatus[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reason, setReason] = useState("Updated teacher setup policies");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void listTeacherSetupReviewStatus(state.studioId).then((result) => {
      if (cancelled) return;
      if (!result.ok) setError(result.error || "Teacher setup review status could not be loaded.");
      else setReviews(result.items);
      setLoadingReviews(false);
    });
    return () => { cancelled = true; };
  }, [state.studioId, state.rulebookVersions, state.planningDatasetVersions]);

  const reviewByTeacher = new Map(reviews.map((item) => [item.teacherId, item]));

  function updateDraft(next: Partial<SetupPolicyDraft>) {
    setDraft((current) => current ? { ...current, ...next } : current);
    setError("");
    setNotice("");
  }

  function updateAvailability(teacherId: string, next: Partial<TeacherAvailabilityDraft>) {
    const current = draft!.teacherAvailability || [];
    updateDraft({ teacherAvailability: current.map((item) => item.teacherId === teacherId ? { ...item, ...next } : item) });
  }

  function setAvailabilityMode(teacherId: string, unrestricted: boolean) {
    const item = (draft!.teacherAvailability || []).find((entry) => entry.teacherId === teacherId);
    if (!item) return;
    updateAvailability(teacherId, unrestricted ? { unrestricted: true } : { unrestricted: false, allowedDays: undefined, windows: item.windows?.length ? item.windows : [emptyWindow()] });
  }

  function updateWindow(teacherId: string, index: number, changes: Partial<PolicyTimeWindowV1>) {
    const item = (draft!.teacherAvailability || []).find((entry) => entry.teacherId === teacherId);
    if (!item) return;
    updateAvailability(teacherId, { windows: (item.windows || []).map((window, itemIndex) => itemIndex === index ? { ...window, ...changes } : window) });
  }

  function updateUnavailableDay(teacherId: string, day: Day, selected: boolean) {
    const item = (draft!.teacherAvailability || []).find((entry) => entry.teacherId === teacherId);
    if (!item) return;
    const days = item.unavailableDays || [];
    updateAvailability(teacherId, { unavailableDays: selected ? [...new Set([...days, day])] : days.filter((value) => value !== day) });
  }

  function toggleQualification(teacherId: string, classId: string, selected: boolean) {
    const item = (draft!.teacherQualifications || []).find((entry) => entry.teacherId === teacherId);
    if (!item) return;
    updateDraft({ teacherQualifications: (draft!.teacherQualifications || []).map((entry) => entry.teacherId === teacherId ? { ...entry, classIds: selected ? [...new Set([...entry.classIds, classId])] : entry.classIds.filter((id) => id !== classId) } : entry) });
  }

  async function loadReviews() {
    const result = await listTeacherSetupReviewStatus(state!.studioId);
    if (!result.ok) setError(result.error || "Teacher setup review status could not be loaded.");
    else setReviews(result.items);
  }

  async function review(item: TeacherSetupReviewStatus, aspect: "availability" | "qualification") {
    if (!canEdit || reviewing) return;
    const isAvailability = aspect === "availability";
    const hasPolicy = isAvailability ? item.hasAvailabilityPolicy : item.hasQualificationPolicy;
    const fingerprint = isAvailability ? item.availabilityFingerprint : item.qualificationFingerprint;
    setReviewing(`${item.teacherId}:${aspect}`);
    setError("");
    setNotice("");
    const result = await attestTeacherSetupReview({
      studioId: state!.studioId,
      teacherId: item.teacherId,
      aspect,
      expectedRulebookVersion: item.rulebookVersion,
      expectedPlanningDatasetVersion: item.planningDatasetVersion,
      expectedFingerprint: fingerprint,
      outcome: hasPolicy ? "REVIEWED_VALUE" : "REVIEWED_NO_ADDITIONAL_RESTRICTION",
      note: isAvailability ? (hasPolicy ? "Reviewed teacher availability" : "No additional availability restriction applies") : "Reviewed explicit teacher class domain",
    });
    if (!result.ok) setError(result.error || "Teacher setup review was not saved. Refresh and try again.");
    else {
      setNotice(`${item.teacherName} ${aspect} is reviewed for the current setup.`);
      await loadReviews();
    }
    setReviewing(null);
  }

  async function save() {
    if (saving || !canEdit) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await applySetupTypedPolicies(buildSetupTypedPolicyPatches(draft!), reason.trim() || "Updated teacher setup policies");
      if (!result.ok) {
        setError(result.error || "Teacher setup changes were not saved. Your entries are still here.");
        return;
      }
      setNotice(`Teacher setup saved in Rulebook v${result.rulebookVersion ?? "?"}. Review each teacher before building a schedule.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="setup-teacher-policies" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="teacher-setup-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Teacher setup</p>
        <h2 id="teacher-setup-heading" className="mt-1 text-xl font-semibold text-slate-950">Availability and qualifications</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Use explicit same-day windows and unavailable days for availability. Choose the classes each teacher is qualified to teach by stable class record; notes, subjects and names do not create scheduling authority.</p>
      </div>

      {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-900" role="alert">{error} Your entries are still here so you can correct them and try again.</div> : null}

      {state.teachers.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">Add a teacher in People before setting availability or qualifications.</div> : (
        <div className="mt-5 space-y-4">
          {state.teachers.map((teacher) => {
            const availability = (draft.teacherAvailability || []).find((item) => item.teacherId === teacher.id);
            const qualification = (draft.teacherQualifications || []).find((item) => item.teacherId === teacher.id);
            const reviewStatus = reviewByTeacher.get(teacher.id);
            if (!availability || !qualification) return null;
            return <article key={teacher.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-semibold text-slate-950">{teacher.name}</h3><p className="mt-1 text-xs text-slate-500">Stable teacher record: {teacher.id}</p></div>
                {reviewStatus ? <div className="flex flex-wrap gap-2 text-[11px] font-semibold"><span className={`rounded-full border px-2.5 py-1 ${stateClasses(reviewStatus.availabilityState)}`}>Availability: {stateLabel(reviewStatus.availabilityState)}</span><span className={`rounded-full border px-2.5 py-1 ${stateClasses(reviewStatus.qualificationState)}`}>Qualifications: {stateLabel(reviewStatus.qualificationState)}</span></div> : null}
              </div>

              <fieldset className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                <legend className="text-sm font-semibold text-slate-950">Availability</legend>
                <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800"><input type="checkbox" checked={Boolean(availability.unrestricted)} onChange={(event) => setAvailabilityMode(teacher.id, event.target.checked)} className="size-4" />No additional availability restriction (review explicitly)</label>
                {!availability.unrestricted ? (
                  <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                    {availability.allowedDays ? <div><p className="text-xs font-medium text-slate-600">Available all day on</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{SETUP_DAYS.map((day) => <label key={day} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs text-slate-800"><input type="checkbox" checked={availability.allowedDays?.includes(day) || false} onChange={(event) => updateAvailability(teacher.id, { allowedDays: event.target.checked ? [...new Set([...(availability.allowedDays || []), day])] : (availability.allowedDays || []).filter((value) => value !== day) })} className="size-4" />{day}</label>)}</div></div> : <div className="space-y-2"><p className="text-xs font-medium text-slate-600">Allowed windows (15-minute grid)</p>{(availability.windows || []).map((window, index) => <div key={`${teacher.id}-window-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><label className="text-xs font-medium text-slate-600">Day<select value={window.day} onChange={(event) => updateWindow(teacher.id, index, { day: event.target.value as Day })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950">{SETUP_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Starts<input aria-label={`${teacher.name} window ${index + 1} starts`} type="time" step="900" value={window.start} onChange={(event) => updateWindow(teacher.id, index, { start: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label><label className="text-xs font-medium text-slate-600">Ends<input aria-label={`${teacher.name} window ${index + 1} ends`} type="time" step="900" value={window.end} onChange={(event) => updateWindow(teacher.id, index, { end: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label><button type="button" onClick={() => updateAvailability(teacher.id, { windows: (availability.windows || []).filter((_value, itemIndex) => itemIndex !== index) })} disabled={(availability.windows || []).length <= 1} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-3 text-xs disabled:opacity-40" aria-label={`Remove ${teacher.name} availability window`}><Trash2 className="size-4" /></button></div>)}<button type="button" onClick={() => updateAvailability(teacher.id, { windows: [...(availability.windows || []), emptyWindow()] })} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold"><Plus className="size-4" />Add availability window</button></div>}
                    {!availability.allowedDays ? <div><p className="text-xs font-medium text-slate-600">Unavailable days</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{SETUP_DAYS.map((day) => <label key={day} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs text-slate-800"><input type="checkbox" checked={availability.unavailableDays?.includes(day) || false} onChange={(event) => updateUnavailableDay(teacher.id, day, event.target.checked)} className="size-4" />{day}</label>)}</div></div> : null}
                  </div>
                ) : null}
                {reviewStatus && reviewStatus.availabilityState !== "REVIEWED_VALUE" && reviewStatus.availabilityState !== "REVIEWED_NO_ADDITIONAL_RESTRICTION" && canEdit ? <button type="button" disabled={Boolean(reviewing)} onClick={() => void review(reviewStatus, "availability")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-50"><ClipboardCheck className="size-4" />{reviewing === `${teacher.id}:availability` ? "Saving…" : "Review availability"}</button> : null}
                {reviewStatus?.availabilityState !== "REVIEWED_VALUE" && reviewStatus?.availabilityState !== "REVIEWED_NO_ADDITIONAL_RESTRICTION" ? <a href="#setup-teacher-policies" className="ml-3 text-xs font-semibold text-sky-800 underline">Review the current teacher setup here</a> : null}
              </fieldset>

              <fieldset className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                <legend className="text-sm font-semibold text-slate-950">Qualified classes</legend>
                <p className="text-xs leading-5 text-slate-500">An empty selection is an explicit default-deny domain until classes are selected and reviewed.</p>
                <div className="grid gap-2 sm:grid-cols-2">{state.classes.map((klass) => <label key={klass.id} className="flex min-h-11 items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800"><input type="checkbox" checked={qualification.classIds.includes(klass.id)} onChange={(event) => toggleQualification(teacher.id, klass.id, event.target.checked)} className="mt-0.5 size-4" /><span><span className="font-semibold">{klass.name}</span><span className="block text-slate-500">{klass.subject} · {klass.id}</span></span></label>)}</div>
                {reviewStatus?.qualificationState === "BLOCKED" ? <p className="text-xs font-semibold text-rose-800">Select an explicit class domain, then review it. Notes and subject labels are not used.</p> : null}
                {reviewStatus && reviewStatus.qualificationState !== "REVIEWED_VALUE" && canEdit && reviewStatus.hasQualificationPolicy ? <button type="button" disabled={Boolean(reviewing)} onClick={() => void review(reviewStatus, "qualification")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-50"><ClipboardCheck className="size-4" />{reviewing === `${teacher.id}:qualification` ? "Saving…" : "Review qualifications"}</button> : null}
                {reviewStatus?.qualificationState !== "REVIEWED_VALUE" ? <a href="#setup-teacher-policies" className="ml-3 text-xs font-semibold text-sky-800 underline">Review the current teacher setup here</a> : null}
              </fieldset>
            </article>;
          })}
        </div>
      )}

      <form className="mt-5 border-t border-slate-100 pt-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="block text-xs font-medium text-slate-600">Why are you changing teacher setup?<input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label>
        <button type="submit" disabled={!canEdit || saving || state.teachers.length === 0} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Save className="size-4" />{saving ? "Saving teacher setup…" : canEdit ? "Save teacher setup" : "Editor access required"}</button>
      </form>
      {!loadingReviews && reviews.length === 0 ? <p className="mt-3 text-xs text-slate-500"><CheckCircle2 className="mr-1 inline size-3.5" />Teacher review status is unavailable until a current Planning Dataset exists.</p> : null}
    </section>
  );
}

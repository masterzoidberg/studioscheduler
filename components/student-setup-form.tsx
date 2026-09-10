"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import type { StudioState } from "@/lib/domain";
import { buildStudentPolicyPatches, studentPolicyDraftFromRules, type StudentPolicyDraft } from "@/lib/student-setup";
import { applySet06Policies, attestSet06Review, listSet06ReviewStatus, type Set06ReviewStatus } from "@/lib/student-setup-client";

function reviewLabel(state: Set06ReviewStatus["state"]) {
  if (state === "REVIEWED_VALUE") return "Reviewed value";
  if (state === "REVIEWED_NO_ADDITIONAL_RESTRICTION") return "Reviewed unrestricted";
  if (state === "CHANGED_SINCE_REVIEW") return "Changed since review";
  return "Needs review";
}

export function StudentSetupForm() {
  const workspace = useWorkspace();
  if (!workspace.state) return null;
  return <StudentSetupFormContent state={workspace.state} canEdit={workspace.canEdit} currentRulebookVersion={workspace.currentRulebookVersion} currentEnforcementVersion={workspace.currentEnforcementVersion} currentPlanningDatasetVersion={workspace.currentPlanningDatasetVersion} refresh={workspace.refresh} />;
}

function StudentSetupFormContent({ state, canEdit, currentRulebookVersion, currentEnforcementVersion, currentPlanningDatasetVersion, refresh }: {
  state: StudioState;
  canEdit: boolean;
  currentRulebookVersion: number;
  currentEnforcementVersion: number;
  currentPlanningDatasetVersion: number;
  refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<StudentPolicyDraft>(() => studentPolicyDraftFromRules(state.rules, state.students.map((student) => student.id)));
  const [reviews, setReviews] = useState<Set06ReviewStatus[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState("");
  const [reason, setReason] = useState("Updated student restrictions and scheduling relationships");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void listSet06ReviewStatus(state.studioId).then((result) => {
      if (cancelled) return;
      if (result.ok) setReviews(result.items); else setError(result.error || "Student review status could not be loaded.");
      setLoadingReviews(false);
    });
    return () => { cancelled = true; };
  }, [state]);

  const currentState = state;
  const currentDraft = draft;
  const sessionLabel = (id: string) => {
    const session = state.sessions.find((item) => item.id === id);
    const klass = state.classes.find((item) => item.id === session?.classId);
    return session && klass ? `${klass.name} — session ${session.ordinal}` : id;
  };

  function update(next: Partial<StudentPolicyDraft>) { setDraft((current) => current ? { ...current, ...next } : current); setError(""); setNotice(""); }

  async function save() {
    if (!canEdit || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await applySet06Policies({ studioId: currentState.studioId, policies: buildStudentPolicyPatches(currentDraft), reason: reason.trim() || "Updated student scheduling policy", expectedRulebookVersion: currentRulebookVersion, expectedEnforcementVersion: currentEnforcementVersion, expectedPlanningDatasetVersion: currentPlanningDatasetVersion });
      if (!result.ok) { setError(result.error || "Student setup was not saved."); return; }
      await refresh(); setNotice(`Student requirements saved in Rulebook v${result.rulebookVersion}. Review each changed value before building a schedule.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  }

  async function review(item: Set06ReviewStatus) {
    if (!canEdit || reviewing) return;
    setReviewing(`${item.scopeKind}:${item.entityId}`); setError(""); setNotice("");
    const policies = Array.isArray(item.value.policies) ? item.value.policies : [];
    const outcome = item.scopeKind === "STUDENT" && policies.length === 0 ? "REVIEWED_NO_ADDITIONAL_RESTRICTION" : "REVIEWED_VALUE";
    const result = await attestSet06Review({ studioId: currentState.studioId, status: item, outcome });
    if (!result.ok) setError(`${result.error || "Review was not saved."} Your entries are still here; reload current Setup before retrying a stale review.`);
    else {
      const refreshed = await listSet06ReviewStatus(currentState.studioId);
      if (refreshed.ok) setReviews(refreshed.items);
      setNotice(item.scopeKind === "RULE" ? "Relationship interpretation reviewed." : "Student restrictions reviewed.");
    }
    setReviewing("");
  }

  return (
    <section id="setup-student-policies" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="student-policy-heading">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Students and relationships</p>
      <h2 id="student-policy-heading" className="mt-1 text-xl font-semibold text-slate-950">Restrictions and scheduling relationships</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Use explicit people and sessions. A household or sibling group in student records creates no Must happen rule by itself. Unsupported narratives stay outside automatic scheduling.</p>
      {notice ? <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div> : null}
      {error ? <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}
      {state.students.length === 0 ? <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Add students and class rosters before entering student restrictions.</div> : (
        <form className="mt-5 space-y-6" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-950">Must happen for individual students</legend>
            <div className="grid gap-3 sm:grid-cols-2">{state.students.map((student) => <article key={student.id} className="rounded-xl border border-slate-200 p-3"><h3 className="font-semibold text-slate-900">{student.name}</h3><div className="mt-3 grid gap-3"><label className="text-xs font-medium text-slate-600">Latest finish<input aria-label={`${student.name} latest finish`} type="time" step="900" value={draft.latestFinishByStudent[student.id] || ""} onChange={(event) => update({ latestFinishByStudent: { ...draft.latestFinishByStudent, [student.id]: event.target.value } })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label><label className="text-xs font-medium text-slate-600">Maximum attendance days<select aria-label={`${student.name} maximum attendance days`} value={draft.maxAttendanceDaysByStudent[student.id] ?? ""} onChange={(event) => update({ maxAttendanceDaysByStudent: { ...draft.maxAttendanceDaysByStudent, [student.id]: event.target.value ? Number(event.target.value) : "" } })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">No additional limit</option>{[1,2,3,4,5,6].map((day) => <option key={day} value={day}>{day}</option>)}</select></label></div></article>)}</div>
          </fieldset>
          <fieldset className="space-y-3 border-t border-slate-100 pt-5"><legend className="text-sm font-semibold text-slate-950">No-overlap participant group</legend><p className="text-xs leading-5 text-slate-500">Select at least two participants only when their attended sessions must never overlap.</p><div className="grid gap-2 sm:grid-cols-2">{state.students.map((student) => <label key={student.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm"><input type="checkbox" checked={draft.noOverlapParticipantIds.includes(student.id)} onChange={(event) => update({ noOverlapParticipantIds: event.target.checked ? [...draft.noOverlapParticipantIds, student.id] : draft.noOverlapParticipantIds.filter((id) => id !== student.id) })} />{student.name}</label>)}</div></fieldset>
          <fieldset className="space-y-3 border-t border-slate-100 pt-5"><legend className="text-sm font-semibold text-slate-950">Directly after</legend><p className="text-xs leading-5 text-slate-500">The successor starts exactly when the predecessor ends, on the same day. Direction matters and session duration determines the allowed start.</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.directAfter)} onChange={(event) => update({ directAfter: event.target.checked ? { predecessorSessionId: state.sessions[0]?.id || "", successorSessionId: state.sessions[1]?.id || "" } : null })} />Set a direct-after requirement</label>{draft.directAfter ? <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">First session<select aria-label="Direct-after predecessor session" value={draft.directAfter.predecessorSessionId} onChange={(event) => update({ directAfter: { ...draft.directAfter!, predecessorSessionId: event.target.value } })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{state.sessions.map((session) => <option key={session.id} value={session.id}>{sessionLabel(session.id)}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Then session<select aria-label="Direct-after successor session" value={draft.directAfter.successorSessionId} onChange={(event) => update({ directAfter: { ...draft.directAfter!, successorSessionId: event.target.value } })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{state.sessions.map((session) => <option key={session.id} value={session.id}>{sessionLabel(session.id)}</option>)}</select></label></div> : null}</fieldset>
          <fieldset className="space-y-3 border-t border-slate-100 pt-5"><legend className="text-sm font-semibold text-slate-950">Linked arrival and attendance</legend><p className="text-xs leading-5 text-slate-500">On every day the selected teacher works, the selected participant must attend. The signed interval is teacher first start minus participant first start, inclusive.</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.linkedArrival)} onChange={(event) => update({ linkedArrival: event.target.checked ? { teacherId: state.teachers[0]?.id || "", participantId: state.students[0]?.id || "", minOffsetMinutes: 0, maxOffsetMinutes: 30 } : null })} />Set linked attendance</label>{draft.linkedArrival ? <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Teacher<select aria-label="Linked teacher" value={draft.linkedArrival.teacherId} onChange={(event) => update({ linkedArrival: { ...draft.linkedArrival!, teacherId: event.target.value } })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{state.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Participant<select aria-label="Linked participant" value={draft.linkedArrival.participantId} onChange={(event) => update({ linkedArrival: { ...draft.linkedArrival!, participantId: event.target.value } })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{state.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Minimum offset minutes<input aria-label="Minimum linked offset" type="number" step="15" value={draft.linkedArrival.minOffsetMinutes} onChange={(event) => update({ linkedArrival: { ...draft.linkedArrival!, minOffsetMinutes: Number(event.target.value) } })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label><label className="text-xs font-medium text-slate-600">Maximum offset minutes<input aria-label="Maximum linked offset" type="number" step="15" value={draft.linkedArrival.maxOffsetMinutes} onChange={(event) => update({ linkedArrival: { ...draft.linkedArrival!, maxOffsetMinutes: Number(event.target.value) } })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label></div> : null}</fieldset>
          <label className="block border-t border-slate-100 pt-5 text-xs font-medium text-slate-600">Why are you changing these requirements?<input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label><button type="submit" disabled={!canEdit || saving} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="size-4" />{saving ? "Saving requirements…" : canEdit ? "Save student requirements" : "Editor access required"}</button>
        </form>
      )}
      <div className="mt-6 border-t border-slate-100 pt-5" aria-label="Student and relationship reviews"><h3 className="text-sm font-semibold text-slate-950">Review changes</h3>{loadingReviews ? <p role="status" className="mt-3 text-sm text-slate-500">Loading student reviews…</p> : reviews.length === 0 ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Save a relationship or review each student as having no additional restriction.</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2">{reviews.map((item) => { const key=`${item.scopeKind}:${item.entityId}`; return <article key={key} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-slate-900">{item.label}</p><p className="mt-1 text-xs text-slate-500">{item.scopeKind === "RULE" ? "Relationship interpretation" : "Student restrictions"}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold">{reviewLabel(item.state)}</span></div><button type="button" disabled={!canEdit || Boolean(reviewing)} onClick={() => void review(item)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 text-xs font-semibold disabled:opacity-50"><CheckCircle2 className="size-4" />{reviewing===key ? "Reviewing…" : item.scopeKind === "RULE" ? "Review relationship" : "Review restrictions"}</button></article>; })}</div>}</div>
    </section>
  );
}

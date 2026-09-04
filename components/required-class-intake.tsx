"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardPenLine, X } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { createReviewedRequiredClass } from "@/lib/planning-inventory-client";
import { requiredClassIntakeCandidates, type RequiredClassIntakeCandidate } from "@/lib/required-class-intake";

type Draft = {
  subject: string;
  level: string;
  duration: string;
  frequency: string;
  companyScope: "" | "STANDARD" | "COMPANY_ONLY";
  rosterStudentIds: string[];
  rosterReviewed: boolean;
};

function uniformExpectedDuration(candidate: RequiredClassIntakeCandidate) {
  if (!candidate.expectedDurations?.length) return null;
  const first = candidate.expectedDurations[0];
  return candidate.expectedDurations.every((value) => value === first) ? first : null;
}

function hasDistinctExpectedDurations(candidate: RequiredClassIntakeCandidate) {
  return Boolean(candidate.expectedDurations?.length && new Set(candidate.expectedDurations).size > 1);
}

function draftFor(candidate: RequiredClassIntakeCandidate): Draft {
  const expectedDuration = uniformExpectedDuration(candidate);
  return {
    subject: "",
    level: "",
    duration: expectedDuration == null ? "" : String(expectedDuration),
    frequency: candidate.expectedFrequency == null ? "" : String(candidate.expectedFrequency),
    companyScope: "",
    rosterStudentIds: [...candidate.requiredStudentIds],
    rosterReviewed: false,
  };
}

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function RequiredClassIntake() {
  const { state, canEdit, currentPlanningDatasetVersion, refresh } = useWorkspace();
  const [active, setActive] = useState<RequiredClassIntakeCandidate | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const candidates = useMemo(
    () => state ? requiredClassIntakeCandidates({ classes: state.classes, sessions: state.sessions, students: state.students }) : [],
    [state],
  );

  if (!state) return null;
  const workspaceState = state;
  const requiredSet = new Set(active?.requiredStudentIds ?? []);
  const activeExpectedDuration = active ? uniformExpectedDuration(active) : null;
  const activeDistinctDurations = active ? hasDistinctExpectedDurations(active) : false;

  function open(candidate: RequiredClassIntakeCandidate) {
    setActive(candidate);
    setDraft(draftFor(candidate));
    setNotice("");
  }

  function close() {
    setActive(null);
    setDraft(null);
  }

  function toggleRosterStudent(studentId: string) {
    if (!active || !draft || requiredSet.has(studentId)) return;
    const selected = draft.rosterStudentIds.includes(studentId);
    setDraft({
      ...draft,
      rosterStudentIds: selected
        ? draft.rosterStudentIds.filter((id) => id !== studentId)
        : [...draft.rosterStudentIds, studentId],
      rosterReviewed: false,
    });
  }

  async function createRequiredClass() {
    if (!active || !draft || !canEdit || saving) return;
    if (hasDistinctExpectedDurations(active)) {
      setNotice("This required class needs different durations across its weekly sessions. The single-duration intake is intentionally blocked rather than guessing an intermediate class structure.");
      return;
    }

    const subject = draft.subject.trim();
    const level = draft.level.trim();
    const duration = Number(draft.duration);
    const frequency = Number(draft.frequency);

    if (!subject || !level) {
      setNotice("Subject and level must be entered from current studio curriculum facts.");
      return;
    }
    if (!Number.isInteger(duration) || duration <= 0 || duration > 1440) {
      setNotice("Enter the verified class duration as a positive whole number of minutes.");
      return;
    }
    if (!Number.isInteger(frequency) || frequency <= 0 || frequency > 14) {
      setNotice("Enter the verified weekly frequency as a positive whole number no greater than 14.");
      return;
    }
    if (active.expectedFrequency != null && frequency !== active.expectedFrequency) {
      setNotice(`The reviewed Rulebook establishes ${active.expectedFrequency} session${active.expectedFrequency === 1 ? "" : "s"} per week for ${active.className}; that value cannot be changed during intake.`);
      return;
    }
    const expectedDuration = uniformExpectedDuration(active);
    if (expectedDuration != null && duration !== expectedDuration) {
      setNotice(`The reviewed Rulebook establishes ${expectedDuration} minutes for ${active.className}; that value cannot be changed during intake.`);
      return;
    }
    if (!draft.companyScope) {
      setNotice("Choose whether this is standard curriculum or company-only curriculum.");
      return;
    }
    if (!draft.rosterReviewed) {
      setNotice("Review and confirm the complete current class roster before creating this class.");
      return;
    }

    const currentStudentIds = new Set(workspaceState.students.map((student) => student.id));
    const missingRequired = active.requiredStudentIds.filter((id) => !currentStudentIds.has(id));
    const unknownSelected = draft.rosterStudentIds.filter((id) => !currentStudentIds.has(id));
    const omittedRequired = active.requiredStudentIds.filter((id) => !draft.rosterStudentIds.includes(id));
    if (missingRequired.length || unknownSelected.length || omittedRequired.length) {
      setNotice("Student data changed while this intake was open. Close it, refresh planning data, and review the roster again.");
      return;
    }
    if (workspaceState.classes.some((klass) => normalizeName(klass.name) === normalizeName(active.className))) {
      setNotice("That class now exists in planning data. Refresh and use the existing-class repair workflow instead of creating a duplicate.");
      return;
    }

    setSaving(true);
    setNotice("");
    const result = await createReviewedRequiredClass({
      changes: {
        name: active.className,
        subject,
        level,
        durationMinutes: duration,
        weeklyFrequency: frequency,
        rosterStudentIds: draft.rosterStudentIds,
        companyOnly: draft.companyScope === "COMPANY_ONLY",
      },
      reason: `Created reviewed required class ${active.className} (${active.ruleIds.join(", ")}); manager reviewed curriculum fields, scope, and complete current roster`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
      evidence: {
        rosterReviewed: true,
        companyScopeReviewed: true,
        curriculumFieldsReviewed: true,
      },
    });
    setSaving(false);

    if (!result.ok) {
      setNotice(result.error || "Required class creation failed.");
      return;
    }

    const createdName = active.className;
    close();
    await refresh();
    setNotice(
      `${createdName} created through reviewed intake. Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}; continue reviewing the remaining planning repairs before confirmation.`,
    );
  }

  return (
    <section className={`rounded-2xl border p-5 ${candidates.length ? "border-sky-200 bg-sky-50/40" : "border-emerald-200 bg-emerald-50/50"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${candidates.length ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"}`}><ClipboardPenLine className="size-5" /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Missing required classes</p>
            <h2 className="mt-1 text-lg font-semibold">Reviewed class intake</h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">Every missing class that the reviewed Rulebook requires is created here. Rulebook-established frequency and durations are locked; descriptive curriculum fields, curriculum scope, and the complete current roster still require explicit manager review.</p>
          </div>
        </div>
        {candidates.length ? <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900">{candidates.length} intake{candidates.length === 1 ? "" : "s"}</span> : null}
      </div>

      {notice ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div> : null}

      {candidates.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {candidates.map((candidate) => {
            const distinctDurations = hasDistinctExpectedDurations(candidate);
            return (
              <article key={candidate.className} className="rounded-xl border border-sky-200 bg-white p-4">
                <h3 className="font-semibold text-slate-950">{candidate.className}</h3>
                {candidate.expectedFrequency != null ? (
                  <p className="mt-1 text-xs leading-5 text-slate-600"><strong>Rulebook structure:</strong> {candidate.expectedFrequency}/week{candidate.expectedDurations?.length ? ` · ${candidate.expectedDurations.join("/")} min` : " · duration requires verified studio input"}</p>
                ) : (
                  <p className="mt-1 text-xs leading-5 text-slate-600">The Rulebook establishes that this class must exist through an explicit enrollment relationship, but its curriculum structure requires manager input.</p>
                )}
                {candidate.requiredStudentNames.length ? (
                  <p className="mt-2 text-xs text-slate-500"><strong>Rulebook-required roster members:</strong> {candidate.requiredStudentNames.join(", ")}</p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">No individual roster member is established for this class by the current Rulebook evidence. The manager must still review the complete current roster.</p>
                )}
                <p className="mt-1 font-mono text-[10px] text-slate-400">{candidate.ruleIds.join(" · ")}</p>
                {distinctDurations ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-4 text-amber-900">This class needs distinct weekly durations and is intentionally blocked from single-duration creation until an atomic multi-duration intake is available.</p> : null}
                {canEdit ? <button type="button" disabled={distinctDurations} onClick={() => open(candidate)} className="mt-4 min-h-10 rounded-xl bg-sky-950 px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{distinctDurations ? "Multi-duration intake required" : "Review & create"}</button> : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-sm font-medium text-emerald-900"><CheckCircle2 className="size-5 shrink-0" />No Rulebook-required classes are waiting to be created.</div>
      )}

      {active && draft ? (
        <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-6">
          <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">Reviewed required-class intake</p><h2 className="mt-1 text-xl font-semibold">Create {active.className}</h2></div>
              <button type="button" onClick={close} aria-label="Close required class intake"><X className="size-5" /></button>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><AlertTriangle className="mr-2 inline size-4" /><strong>No descriptive scheduling facts are inferred from the class name.</strong> Subject and level suggestions are placeholders only. Curriculum scope and the complete roster require explicit review.</div>

            {active.expectedFrequency != null ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
                <strong>Established by reviewed Rulebook:</strong> {active.expectedFrequency} session{active.expectedFrequency === 1 ? "" : "s"} per week{active.expectedDurations?.length ? `, ${active.expectedDurations.join("/")} minutes` : "; duration is not established and must be entered from current studio facts"}. These established values cannot be overridden during intake.
              </div>
            ) : null}

            {activeDistinctDurations ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"><strong>Creation blocked.</strong> This class requires distinct weekly durations. The single-duration class-create RPC cannot represent that truth atomically, so the system refuses to create a plausible-but-wrong intermediate record.</div>
            ) : null}

            <div className="mt-5 grid gap-4">
              <label className="text-xs font-semibold text-slate-600">Class name<input readOnly value={active.className} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-700" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">Subject<input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} placeholder={active.subjectPlaceholder} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
                <label className="text-xs font-semibold text-slate-600">Level<input value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value })} placeholder={active.levelPlaceholder} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">Duration (minutes)<input type="number" min={1} max={1440} step={1} readOnly={activeExpectedDuration != null} value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: event.target.value })} placeholder={active.expectedDurations == null ? "Enter verified minutes" : "Rulebook established"} className={`mt-1 min-h-11 w-full rounded-xl border px-3 text-sm font-normal ${activeExpectedDuration != null ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-300"}`} /></label>
                <label className="text-xs font-semibold text-slate-600">Weekly frequency<input type="number" min={1} max={14} step={1} readOnly={active.expectedFrequency != null} value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value })} placeholder="Enter verified sessions/week" className={`mt-1 min-h-11 w-full rounded-xl border px-3 text-sm font-normal ${active.expectedFrequency != null ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-300"}`} /></label>
              </div>
              <label className="text-xs font-semibold text-slate-600">Curriculum scope<select value={draft.companyScope} onChange={(event) => setDraft({ ...draft, companyScope: event.target.value as Draft["companyScope"] })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">Choose explicitly</option><option value="STANDARD">Standard curriculum</option><option value="COMPANY_ONLY">Company-only curriculum</option></select></label>

              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-950">Complete current class roster</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Rulebook-required students are locked on when the Rulebook establishes them. Select every additional dancer currently enrolled in this class before confirming the roster.</p>
                <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                  {workspaceState.students.slice().sort((a, b) => a.name.localeCompare(b.name)).map((student) => {
                    const required = requiredSet.has(student.id);
                    const selected = draft.rosterStudentIds.includes(student.id);
                    return (
                      <label key={student.id} className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${selected ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"}`}>
                        <input type="checkbox" checked={selected} disabled={required} onChange={() => toggleRosterStudent(student.id)} />
                        <span className="min-w-0 flex-1"><strong className="block truncate font-semibold">{student.name}</strong><span className="text-xs text-slate-500">{student.level}</span></span>
                        {required ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-800">Required</span> : null}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-slate-500">Selected roster: <strong>{draft.rosterStudentIds.length}</strong> student{draft.rosterStudentIds.length === 1 ? "" : "s"}.</p>
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4 text-sm leading-6 text-slate-700"><input type="checkbox" className="mt-1" checked={draft.rosterReviewed} onChange={(event) => setDraft({ ...draft, rosterReviewed: event.target.checked })} /><span>I have reviewed the full current enrollment for {active.className}, and the selected roster above is complete to the best of current studio knowledge.</span></label>

              <div className="rounded-xl border border-slate-200 p-3 text-xs leading-5 text-slate-500"><strong>Rulebook basis:</strong> {active.ruleIds.join(", ")}<br /><strong>Evidence lanes:</strong> {active.relationshipLabels.join(" · ")}</div>

              <div className="flex gap-2"><button type="button" onClick={close} className="min-h-11 flex-1 rounded-xl border border-slate-300 text-sm font-semibold">Cancel</button><button type="button" disabled={saving || activeDistinctDurations || !draft.subject.trim() || !draft.level.trim() || !draft.duration || !draft.frequency || !draft.companyScope || !draft.rosterReviewed} onClick={() => void createRequiredClass()} className="min-h-11 flex-1 rounded-xl bg-sky-950 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Creating…" : "Create reviewed class"}</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, ClipboardCheck, Clock3, Pencil, Plus, Search, UsersRound, Wrench, X } from "lucide-react";
import { PlanningArchivePanel } from "@/components/planning-archive-panel";
import { setPlanningEntityArchived } from "@/lib/planning-archive-client";
import type { ClassDefinition, ClassSession } from "@/lib/domain";
import { useWorkspace } from "@/components/workspace-provider";
import { applyRulebookStructureRepair, mutatePlanningEntity, updateClassSessionDurations } from "@/lib/planning-inventory-client";
import {
  rulebookClassStructureRepairs,
  rulebookRepairDraft,
  type RulebookClassStructureRepair,
} from "@/lib/planning-structure-repair";
import { sessionDurationMinutes } from "@/lib/schedule-builder";
import {
  classAssignmentPolicyDraftFromRules,
  classEligibleTeacherIds,
  type ClassAssignmentPolicyDraft,
} from "@/lib/class-setup";
import {
  applyClassAssignmentPolicies,
  attestClassSetupReview,
  listClassSetupReviewStatus,
  type ClassSetupReviewStatus,
} from "@/lib/class-setup-client";
import { currentTenantPolicyRequirements } from "@/lib/tenant-policy";

function newClass(): ClassDefinition {
  return {
    id: "",
    name: "",
    subject: "",
    level: "",
    durationMinutes: 60,
    weeklyFrequency: 1,
    rosterStudentIds: [],
    eligibleTeacherIds: [],
    companyOnly: false,
  };
}

function durationDrafts(sessions: ClassSession[]) {
  return Object.fromEntries(
    sessions.map((session) => [session.id, session.durationMinutes == null ? "" : String(session.durationMinutes)]),
  );
}

function expectedStructure(repair: RulebookClassStructureRepair) {
  const durations = repair.expectedDurations?.length ? ` · ${repair.expectedDurations.join("/")} min` : " · duration requires verified planning input";
  return `${repair.expectedFrequency}/week${durations}`;
}

export function ClassesView() {
  const { state, currentAssignments, canEdit, currentRulebookVersion, currentEnforcementVersion, currentPlanningDatasetVersion, refresh } = useWorkspace();
  const [editing, setEditing] = useState<ClassDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeRepair, setActiveRepair] = useState<RulebookClassStructureRepair | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingSessions, setSavingSessions] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, string>>({});
  const [scopeDraft, setScopeDraft] = useState<"" | "STANDARD" | "COMPANY_ONLY">("");
  const [policyDraft, setPolicyDraft] = useState<ClassAssignmentPolicyDraft | null>(null);
  const [reviews, setReviews] = useState<ClassSetupReviewStatus[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [reviewing, setReviewing] = useState<"structure" | "roster" | null>(null);
  const [savingPolicies, setSavingPolicies] = useState(false);
  const [emptyRosterConfirmed, setEmptyRosterConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!state) return () => { cancelled = true; };
    void listClassSetupReviewStatus(state.studioId).then((result) => {
      if (cancelled) return;
      if (!result.ok) setNotice(result.error || "Class review status could not be loaded.");
      else setReviews(result.items);
      setLoadingReviews(false);
    });
    return () => { cancelled = true; };
  }, [state, currentPlanningDatasetVersion, currentRulebookVersion]);

  const students = useMemo(() => {
    if (!state) return [];
    const q = studentSearch.trim().toLowerCase();
    return state.students
      .filter((student) => !q || `${student.name} ${student.level}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state, studentSearch]);

  const structureRepairs = useMemo(
    () => state ? rulebookClassStructureRepairs({
      classes: state.classes,
      sessions: state.sessions,
      requirements: currentTenantPolicyRequirements(state).structure,
    }) : [],
    [state],
  );

  if (!state) return null;

  const sessionMap = new Map(state.sessions.map((session) => [session.id, session]));
  const assignmentsFor = (id: string) => currentAssignments.filter((assignment) => sessionMap.get(assignment.sessionId)?.classId === id);
  const original = editing && !creating ? state.classes.find((klass) => klass.id === editing.id) : null;
  const durationImpact = editing && original && original.durationMinutes !== editing.durationMinutes ? assignmentsFor(editing.id) : [];
  const editingSessions = editing && !creating
    ? state.sessions.filter((session) => session.classId === editing.id).sort((a, b) => a.ordinal - b.ordinal)
    : [];
  const classFieldsDirty = Boolean(original && editing && (
    original.name !== editing.name
    || original.subject !== editing.subject
    || original.level !== editing.level
    || original.durationMinutes !== editing.durationMinutes
    || original.weeklyFrequency !== editing.weeklyFrequency
    || original.companyOnly !== (scopeDraft === "COMPANY_ONLY")
    || original.rosterStudentIds.length !== editing.rosterStudentIds.length
    || original.rosterStudentIds.some((id) => !editing.rosterStudentIds.includes(id))
  ));
  const activeReview = editing && !creating ? reviews.find((item) => item.classId === editing.id) ?? null : null;
  const eligibleTeacherIds = editing ? classEligibleTeacherIds(editing.id, state.rules) : [];

  function beginAdd() {
    setCreating(true);
    setActiveRepair(null);
    setStudentSearch("");
    setSessionDrafts({});
    setScopeDraft("");
    setPolicyDraft(null);
    setEmptyRosterConfirmed(false);
    setEditing(newClass());
  }

  function beginEdit(klass: ClassDefinition) {
    if (!state) return;
    const sessions = state.sessions.filter((session) => session.classId === klass.id).sort((a, b) => a.ordinal - b.ordinal);
    setCreating(false);
    setActiveRepair(null);
    setStudentSearch("");
    setSessionDrafts(durationDrafts(sessions));
    setScopeDraft(klass.companyOnly ? "COMPANY_ONLY" : "STANDARD");
    setPolicyDraft(classAssignmentPolicyDraftFromRules(klass.id, state.rules));
    setEmptyRosterConfirmed(false);
    setEditing({ ...klass, rosterStudentIds: [...klass.rosterStudentIds], eligibleTeacherIds: [...klass.eligibleTeacherIds] });
  }

  function beginRulebookRepair(repair: RulebookClassStructureRepair) {
    if (!state) return;
    if (repair.status === "MISSING") {
      window.location.assign("/planning-repairs");
      return;
    }
    if (repair.status === "AMBIGUOUS") {
      setNotice(`${repair.className} has duplicate class records (${repair.duplicateClassIds.join(", ")}). Resolve the duplicate inventory before applying Rulebook structure changes.`);
      return;
    }

    const existing = repair.classId ? state.classes.find((klass) => klass.id === repair.classId) ?? null : null;
    const sessions = existing
      ? state.sessions.filter((session) => session.classId === existing.id).sort((a, b) => a.ordinal - b.ordinal)
      : [];
    setCreating(!existing);
    setActiveRepair(repair);
    setStudentSearch("");
    setSessionDrafts(durationDrafts(sessions));
    setScopeDraft(existing?.companyOnly ? "COMPANY_ONLY" : "STANDARD");
    setPolicyDraft(existing ? classAssignmentPolicyDraftFromRules(existing.id, state.rules) : null);
    setEmptyRosterConfirmed(false);
    setEditing(rulebookRepairDraft(repair, existing));
  }

  function closeEditor() {
    setEditing(null);
    setCreating(false);
    setActiveRepair(null);
    setSessionDrafts({});
    setPolicyDraft(null);
    setScopeDraft("");
  }

  function toggleStudent(id: string) {
    if (!editing) return;
    const selected = editing.rosterStudentIds.includes(id);
    setEditing({
      ...editing,
      rosterStudentIds: selected ? editing.rosterStudentIds.filter((studentId) => studentId !== id) : [...editing.rosterStudentIds, id],
    });
  }

  function selectVisibleStudents(selected: boolean) {
    if (!editing || activeRepair) return;
    const visible = new Set(students.map((student) => student.id));
    setEditing({
      ...editing,
      rosterStudentIds: selected
        ? [...new Set([...editing.rosterStudentIds, ...visible])]
        : editing.rosterStudentIds.filter((id) => !visible.has(id)),
    });
    setEmptyRosterConfirmed(false);
  }

  async function save() {
    if (!state || !editing || !canEdit || saving) return;

    if (activeRepair && !creating) {
      if (!original || activeRepair.classId !== editing.id) {
        setNotice("The Rulebook repair target changed while the editor was open. Refresh and review the repair again.");
        return;
      }
      const firstExpectedDuration = activeRepair.expectedDurations?.[0] ?? null;
      const uniformExpectedDuration = firstExpectedDuration != null
        && activeRepair.expectedDurations?.every((value) => value === firstExpectedDuration)
        ? firstExpectedDuration
        : null;
      const unrelatedFieldsChanged = original.name !== editing.name
        || original.subject !== editing.subject
        || original.level !== editing.level
        || original.companyOnly !== editing.companyOnly
        || original.rosterStudentIds.length !== editing.rosterStudentIds.length
        || original.rosterStudentIds.some((id) => !editing.rosterStudentIds.includes(id))
        || (uniformExpectedDuration == null && original.durationMinutes !== editing.durationMinutes);
      if (unrelatedFieldsChanged) {
        setNotice("A Rulebook structure repair cannot be mixed with curriculum, roster, scope, or unrelated duration edits. Cancel and make those changes separately.");
        return;
      }
      if (editing.weeklyFrequency !== activeRepair.expectedFrequency
        || (uniformExpectedDuration != null && editing.durationMinutes !== uniformExpectedDuration)) {
        setNotice("The reviewed repair values were changed in the editor. Restore the Rulebook-established structure or cancel the repair.");
        return;
      }

      setSaving(true);
      setNotice("");
      const result = await applyRulebookStructureRepair({
        studioId: state.studioId,
        classId: editing.id,
        reason: `Applied atomic reviewed Rulebook structure repair for ${editing.name} (${activeRepair.ruleIds.join(", ")})`,
        expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
      });
      setSaving(false);
      if (!result.ok) {
        setNotice(result.error || "Rulebook structure repair failed.");
        return;
      }
      await refresh();
      closeEditor();
      setNotice(`Applied the complete Rulebook structure repair atomically. Planning Dataset is now v${result.planningDatasetVersion ?? currentPlanningDatasetVersion}; the existing schedule needs revalidation.`);
      return;
    }
    if (!editing.name.trim() || !editing.subject.trim() || !editing.level.trim()) {
      setNotice("Name, subject, and level are required before class planning data can be saved.");
      return;
    }
    if (!scopeDraft) {
      setNotice("Choose the class scope explicitly before saving.");
      return;
    }
    if (!Number.isInteger(editing.durationMinutes) || editing.durationMinutes <= 0 || editing.durationMinutes > 1440) {
      setNotice("Default class duration must be a positive whole number of minutes. Rulebook repair drafts never guess a duration that has not been established.");
      return;
    }
    if (!Number.isInteger(editing.weeklyFrequency) || editing.weeklyFrequency <= 0 || editing.weeklyFrequency > 14) {
      setNotice("Weekly frequency must be a positive whole number no greater than 14.");
      return;
    }

    setSaving(true);
    setNotice("");
    const result = await mutatePlanningEntity({
      studioId: state.studioId,
      operation: creating ? "CREATE" : "UPDATE",
      entityType: "CLASS",
      entityId: creating ? null : editing.id,
      changes: {
        name: editing.name,
        subject: editing.subject,
        level: editing.level,
        durationMinutes: editing.durationMinutes,
        weeklyFrequency: editing.weeklyFrequency,
        rosterStudentIds: editing.rosterStudentIds,
        companyOnly: scopeDraft === "COMPANY_ONLY",
      },
      reason: activeRepair
        ? `Reviewed Rulebook structure repair for ${editing.name} (${activeRepair.ruleIds.join(", ")})`
        : `${creating ? "Added" : "Updated"} class ${editing.name}`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });

    if (result.ok) {
      await refresh();
      closeEditor();
      setNotice(
        `Class ${creating ? "added" : "updated"}. Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}. Weekly session rows were reconciled automatically and the existing schedule now needs revalidation.`,
      );
    } else setNotice(result.error || "Class save failed.");
    setSaving(false);
  }

  async function saveAssignmentPolicies() {
    if (!state || !editing || creating || !policyDraft || !canEdit || savingPolicies || classFieldsDirty) return;
    setSavingPolicies(true);
    setNotice("");
    const result = await applyClassAssignmentPolicies({
      studioId: state.studioId,
      classId: editing.id,
      draft: policyDraft,
      reason: `Updated required and preferred assignments for ${editing.name}`,
      expectedRulebookVersion: currentRulebookVersion,
      expectedEnforcementVersion: currentEnforcementVersion,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });
    setSavingPolicies(false);
    if (!result.ok) {
      setNotice(`${result.error || "Class assignment policies were not saved."} Your selections are still here.`);
      return;
    }
    await refresh();
    setNotice(`Must happen and Prefer choices saved in Rulebook v${result.rulebookVersion}.`);
  }

  async function reviewClassAspect(item: ClassSetupReviewStatus, aspect: "structure" | "roster") {
    if (!state || !editing || !canEdit || reviewing || classFieldsDirty) return;
    setReviewing(aspect);
    setNotice("");
    const review = item[aspect];
    const result = await attestClassSetupReview({
      studioId: state.studioId,
      classId: editing.id,
      aspect,
      expectedPlanningDatasetVersion: item.planningDatasetVersion,
      expectedFingerprint: review.currentFingerprint,
      emptyRosterConfirmed: aspect === "roster" && emptyRosterConfirmed,
    });
    setReviewing(null);
    if (!result.ok) {
      setNotice(`${result.error || `The ${aspect} review was not saved.`} Your class draft is still here.`);
      return;
    }
    const loaded = await listClassSetupReviewStatus(state.studioId);
    if (loaded.ok) setReviews(loaded.items);
    setNotice(`${editing.name} ${aspect} is reviewed for the current setup.`);
  }

  async function archiveClass() {
    if (!state || !editing || creating || activeRepair || !canEdit || saving) return;
    if (!window.confirm(`Archive ${editing.name} and its weekly sessions from active planning? Historical schedule records will be preserved and the class can be restored later.`)) return;
    setSaving(true);
    setNotice("");
    const result = await setPlanningEntityArchived({
      studioId: state.studioId,
      entityType: "CLASS", entityId: editing.id, archive: true,
      reason: `Archived class ${editing.name} from active planning inventory`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });
    setSaving(false);
    if (!result.ok) { setNotice(result.error || `Could not archive ${editing.name}.`); return; }
    const name = editing.name;
    await refresh();
    closeEditor();
    setNotice(`${name} archived with its weekly sessions. Historical schedules retain their original identities; Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}.`);
  }

  async function saveSessionDurations() {
    if (!state || !editing || creating || !canEdit || savingSessions || !editingSessions.length) return;
    if (classFieldsDirty) {
      setNotice("Save or discard the class/roster changes first. Session-duration overrides are a separate atomic planning-data change so they cannot be mixed with unsaved class edits.");
      return;
    }

    const payload: Record<string, number | null> = {};
    for (const session of editingSessions) {
      const raw = (sessionDrafts[session.id] ?? "").trim();
      if (!raw) {
        payload[session.id] = null;
        continue;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0 || value > 1440) {
        setNotice(`Session ${session.ordinal} duration must be a positive whole number of minutes, or blank to inherit ${editing.durationMinutes} minutes.`);
        return;
      }
      payload[session.id] = value;
    }

    setSavingSessions(true);
    setNotice("");
    const result = await updateClassSessionDurations({
      studioId: state.studioId,
      classId: editing.id,
      sessionDurations: payload,
      reason: `Updated weekly session durations for ${editing.name}`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });
    setSavingSessions(false);

    if (!result.ok) {
      setNotice(result.error || "Session duration save failed.");
      return;
    }

    await refresh();
    closeEditor();
    setNotice(
      result.changedSessions
        ? `Updated ${result.changedSessions} session duration${result.changedSessions === 1 ? "" : "s"}. Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}; the existing schedule now needs revalidation.`
        : `No session-duration values changed. Planning Dataset remains v${result.planningDatasetVersion ?? currentPlanningDatasetVersion}.`,
    );
  }

  return (
    <div id="setup-class-details" className="scroll-mt-6 space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
        <strong className="text-slate-950">Classes, rosters, and weekly session durations are live planning data.</strong> The catalog below starts with our current understanding and can be expanded as enrollment and programming change. Teacher qualification remains Rulebook truth and is never inferred from the legacy eligibility array.
      </div>

      {notice ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div> : null}

      <section className={`rounded-2xl border p-4 ${structureRepairs.length ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
        <div className="flex items-start gap-3">
          <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${structureRepairs.length ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}><Wrench className="size-4" /></div>
          <div>
            <h2 className="font-semibold text-slate-950">Rulebook structure repair</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              These actions come only from verified Ballet/Pointe structure rules. They can prefill class frequency and established durations, but they never invent roster enrollment or teacher eligibility. Every change still opens the normal editor and requires review before a new Planning Dataset version is written.
            </p>
          </div>
        </div>

        {structureRepairs.length ? (
          <div className="mt-4 grid gap-2">
            {structureRepairs.map((repair) => {
              const current = repair.status === "MISMATCH"
                ? `${repair.currentFrequency ?? "?"}/week${repair.currentDurations ? ` · ${repair.currentDurations.join("/")} min` : ""}`
                : repair.status === "MISSING"
                  ? "Not in current inventory"
                  : `${repair.duplicateClassIds.length} matching class records`;
              return (
                <div key={`${repair.status}-${repair.className}`} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-950">{repair.className}</span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">{repair.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">Current: {current}</p>
                    <p className="text-xs text-slate-600">Rulebook: {expectedStructure(repair)}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">{repair.ruleIds.join(" · ")}</p>
                  </div>
                  {canEdit && repair.status !== "AMBIGUOUS" ? (
                    <button type="button" onClick={() => beginRulebookRepair(repair)} className="min-h-10 shrink-0 rounded-xl border border-amber-300 bg-amber-100 px-3 text-xs font-semibold text-amber-950">{repair.status === "MISSING" ? "Use reviewed intake" : "Review repair"}</button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm font-medium text-emerald-900">All verified Ballet/Pointe class structure requirements are represented in the working inventory.</p>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <div><h2 className="font-semibold">Class catalog</h2><p className="text-xs text-slate-500">{state.classes.length} currently in the working inventory</p></div>
        {canEdit ? <button onClick={beginAdd} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="size-4" />Add class</button> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {state.classes.map((klass) => {
          const list = assignmentsFor(klass.id);
          const sessions = state.sessions.filter((session) => session.classId === klass.id).sort((a, b) => a.ordinal - b.ordinal);
          const effectiveDurations = sessions.map((session) => sessionDurationMinutes(session, klass));
          return (
            <article key={klass.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-400">{klass.subject} · {klass.level}</p><h2 className="mt-1 font-semibold">{klass.name}</h2><p className="mt-1 text-[11px] text-slate-400">{klass.id}</p></div>
                {canEdit ? <button onClick={() => beginEdit(klass)} className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200" aria-label={`Edit ${klass.name}`}><Pencil className="size-4" /></button> : null}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-slate-50 p-2"><Clock3 className="mx-auto mb-1 size-4 text-slate-400" /><strong>{effectiveDurations.length ? [...new Set(effectiveDurations)].join("/") : klass.durationMinutes}</strong> min</div>
                <div className="rounded-xl bg-slate-50 p-2"><UsersRound className="mx-auto mb-1 size-4 text-slate-400" /><strong>{klass.rosterStudentIds.length}</strong> roster</div>
                <div className="rounded-xl bg-slate-50 p-2"><strong className="block text-base">{klass.weeklyFrequency}</strong>/week</div>
              </div>
              <p className="mt-3 text-xs text-slate-500">{list.length} current assignment{list.length === 1 ? "" : "s"} · {sessions.length} session row{sessions.length === 1 ? "" : "s"}</p>
            </article>
          );
        })}
      </div>

      <PlanningArchivePanel entityTypes={["CLASS"]} />

      {editing ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6">
          <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6">
            <div className="flex justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Class inventory</p><h2 className="mt-1 text-xl font-semibold">{creating ? "Add class" : `Edit ${editing.name}`}</h2></div><button onClick={closeEditor}><X className="size-5" /></button></div>

            {activeRepair ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950">
                <p className="font-semibold">Reviewing Rulebook structure repair · {activeRepair.ruleIds.join(", ")}</p>
                <p className="mt-1">Expected structure: {expectedStructure(activeRepair)}. Verify all visible planning fields before saving.</p>
                {activeRepair.status === "MISSING" ? <p className="mt-1"><strong>Roster is intentionally blank.</strong> Enrollment is not derived from the Rulebook; add only students supported by current roster facts.</p> : null}
                {!activeRepair.expectedDurations ? <p className="mt-1"><strong>Duration was not prefilled.</strong> Enter the verified class duration before saving; the repair workflow will not guess one.</p> : null}
                {activeRepair.expectedDurations && new Set(activeRepair.expectedDurations).size > 1 ? <p className="mt-1">This class requires distinct weekly durations ({activeRepair.expectedDurations.join("/")} minutes). The reviewed repair will create/reconcile every required session and duration in one atomic transaction.</p> : null}
              </div>
            ) : null}

            <div className="mt-5 grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">Name<input readOnly={Boolean(activeRepair)} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
                <label className="text-xs font-semibold text-slate-600">Subject<input readOnly={Boolean(activeRepair)} value={editing.subject} onChange={(event) => setEditing({ ...editing, subject: event.target.value })} placeholder="Ballet, Jazz, Tap…" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold text-slate-600">Level<input readOnly={Boolean(activeRepair)} value={editing.level} onChange={(event) => setEditing({ ...editing, level: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-2 text-sm font-normal" /></label>
                <label className="text-xs font-semibold text-slate-600">Default minutes<input type="number" min={1} readOnly={Boolean(activeRepair)} value={editing.durationMinutes || ""} onChange={(event) => setEditing({ ...editing, durationMinutes: Number(event.target.value) })} placeholder="Required" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-2 text-sm font-normal" /></label>
                <label className="text-xs font-semibold text-slate-600">Per week<input type="number" min={1} readOnly={Boolean(activeRepair)} value={editing.weeklyFrequency} onChange={(event) => setEditing({ ...editing, weeklyFrequency: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-2 text-sm font-normal" /></label>
              </div>

              {!activeRepair && !creating && editingSessions.length ? (
                <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Weekly session durations</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">Use an override only when a weekly meeting differs from the class default. Leave a field blank to inherit {editing.durationMinutes} minutes.</p>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {editingSessions.map((session) => {
                      const draft = sessionDrafts[session.id] ?? "";
                      const effective = draft.trim() ? Number(draft) : editing.durationMinutes;
                      return (
                        <label key={session.id} className="rounded-xl border border-violet-100 bg-white p-3 text-xs font-semibold text-slate-600">
                          Session {session.ordinal}
                          <div className="mt-1 flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={1440}
                              step={1}
                              value={draft}
                              onChange={(event) => setSessionDrafts({ ...sessionDrafts, [session.id]: event.target.value })}
                              placeholder={`Inherit ${editing.durationMinutes}`}
                              className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm font-normal"
                            />
                            <span className="whitespace-nowrap text-[11px] font-normal text-slate-500">{Number.isFinite(effective) ? `${effective} min` : "Invalid"}</span>
                          </div>
                          <span className="mt-1 block font-mono text-[10px] font-normal text-slate-400">{session.id}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] leading-4 text-slate-500">If you change the class default or weekly frequency above, save that class change first. Session overrides are saved atomically against the current Planning Dataset version.</p>
                    <button disabled={savingSessions || classFieldsDirty} onClick={() => void saveSessionDurations()} className="min-h-10 shrink-0 rounded-xl bg-violet-950 px-4 text-xs font-semibold text-white disabled:opacity-40">{savingSessions ? "Saving sessions…" : "Save session durations"}</button>
                  </div>
                </div>
              ) : null}

              {creating ? <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900">New weekly session rows are created when you save the class. If different meetings need different durations, reopen the class afterward and set the per-session overrides.</div> : null}

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">Class roster</p><p className="text-xs text-slate-500">{editing.rosterStudentIds.length} selected. Add missing students on the People → Students screen first.</p></div><label className="relative block min-w-52 flex-1 sm:max-w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search students" className="min-h-10 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-sm" /></label></div>
                {!activeRepair ? <div className="mt-3 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => selectVisibleStudents(true)} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-3 text-xs font-semibold">Select all matching</button><button type="button" onClick={() => selectVisibleStudents(false)} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-3 text-xs font-semibold">Clear matching</button></div> : null}
                <div className="mt-3 grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">
                  {students.map((item) => {
                    const selected = editing.rosterStudentIds.includes(item.id);
                    return <label key={item.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${selected ? "border-slate-950 bg-slate-50" : "border-slate-200"}`}><input type="checkbox" disabled={Boolean(activeRepair)} checked={selected} onChange={() => toggleStudent(item.id)} /><span><strong className="block font-semibold">{item.name}</strong><span className="text-xs text-slate-500">{item.level}</span></span></label>;
                  })}
                  {!students.length ? <p className="text-sm text-slate-500">No students match that search.</p> : null}
                </div>
              </div>

              <label className="text-xs font-semibold text-slate-600">Class scope<select disabled={Boolean(activeRepair)} value={scopeDraft} onChange={(event) => setScopeDraft(event.target.value as typeof scopeDraft)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">Choose explicitly</option><option value="STANDARD">Standard curriculum</option><option value="COMPANY_ONLY">Company-only curriculum</option></select></label>

              {!creating && !activeRepair && policyDraft ? <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
                <p className="text-sm font-semibold text-blue-950">Must happen and Prefer</p>
                <p className="mt-1 text-xs leading-5 text-blue-900">These choices write typed Rulebook policy. Eligibility is read-only here and comes from reviewed teacher qualification policy.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-700">Must happen · teacher<select value={policyDraft.requiredTeacherId} onChange={(event) => setPolicyDraft({ ...policyDraft, requiredTeacherId: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">No required teacher</option>{state.teachers.filter((teacher) => eligibleTeacherIds.includes(teacher.id)).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
                  <label className="text-xs font-semibold text-slate-700">Prefer · teacher<select value={policyDraft.preferredTeacherId} onChange={(event) => setPolicyDraft({ ...policyDraft, preferredTeacherId: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">No preferred teacher</option>{state.teachers.filter((teacher) => eligibleTeacherIds.includes(teacher.id)).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
                  <label className="text-xs font-semibold text-slate-700">Must happen · room<select value={policyDraft.requiredRoomId} onChange={(event) => setPolicyDraft({ ...policyDraft, requiredRoomId: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">No required room</option>{state.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
                  <label className="text-xs font-semibold text-slate-700">Prefer · room<select value={policyDraft.preferredRoomId} onChange={(event) => setPolicyDraft({ ...policyDraft, preferredRoomId: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">No preferred room</option>{state.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
                </div>
                <p className="mt-3 text-xs text-blue-900"><strong>Eligible from qualifications:</strong> {eligibleTeacherIds.length ? eligibleTeacherIds.map((id) => state.teachers.find((teacher) => teacher.id === id)?.name ?? id).join(", ") : "No teacher currently has this class in an explicit qualification domain."}</p>
                <button type="button" disabled={savingPolicies || classFieldsDirty} onClick={() => void saveAssignmentPolicies()} className="mt-3 min-h-11 w-full rounded-xl bg-blue-950 px-4 text-xs font-semibold text-white disabled:opacity-40">{savingPolicies ? "Saving policy…" : "Save Must happen and Prefer"}</button>
              </div> : <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"><strong>Teacher eligibility is not editable here.</strong> It is derived from reviewed teacher qualification policy; no eligibleTeacherIds value is written.</div>}

              {!creating && !activeRepair && activeReview ? <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-950">Review changes</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Review structure and roster separately. Changing an ordinal duration invalidates structure only; roster review remains stable.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(["structure", "roster"] as const).map((aspect) => <div key={aspect} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-2"><strong className="capitalize">{aspect}</strong><span className="text-[10px] font-semibold uppercase text-slate-500">{activeReview[aspect].state.replaceAll("_", " ")}</span></div>{activeReview[aspect].value.policyError ? <p className="mt-2 text-xs leading-5 text-amber-800">{activeReview[aspect].value.policyError}</p> : null}{aspect === "roster" && editing.rosterStudentIds.length === 0 ? <label className="mt-3 flex min-h-11 items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1 size-4" checked={emptyRosterConfirmed} onChange={(event) => setEmptyRosterConfirmed(event.target.checked)} />I confirm this class has no current enrolled dancers for the selected scope.</label> : null}{activeReview[aspect].state !== "REVIEWED" && canEdit ? <button type="button" disabled={Boolean(reviewing) || classFieldsDirty || (aspect === "roster" && editing.rosterStudentIds.length === 0 && !emptyRosterConfirmed)} onClick={() => void reviewClassAspect(activeReview, aspect)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-40"><ClipboardCheck className="size-4" />{reviewing === aspect ? "Saving…" : `Review ${aspect}`}</button> : null}{activeReview[aspect].history.length ? <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Review history ({activeReview[aspect].history.length})</summary></details> : null}</div>)}
                </div>
              </div> : null}
              {loadingReviews && !creating ? <p className="text-xs text-slate-500" role="status">Loading class review…</p> : null}
              <div className={`rounded-xl border p-3 text-sm ${durationImpact.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}><strong>Schedule impact:</strong> {durationImpact.length ? `${durationImpact.length} current assignment(s) retain their old scheduled duration until the schedule is repaired/revalidated.` : "Saving scheduling-significant changes advances the Planning Dataset and marks the existing schedule stale for revalidation."}</div>
              {!creating && original && editing.weeklyFrequency < original.weeklyFrequency ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Reducing weekly frequency is protected. If a session being removed appears anywhere in schedule history, the save will be blocked rather than deleting historical identity.</div> : null}
              <div className="flex flex-col gap-2 sm:flex-row">{!creating && !activeRepair ? <button disabled={saving} onClick={() => void archiveClass()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-300 px-3 font-semibold text-amber-900 disabled:opacity-50"><Archive className="size-4" />Archive</button> : null}<button onClick={closeEditor} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Cancel</button><button disabled={saving || !scopeDraft || !editing.name.trim() || !editing.subject.trim() || !editing.level.trim() || editing.durationMinutes <= 0 || editing.weeklyFrequency <= 0} onClick={() => void save()} className="min-h-11 flex-1 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : activeRepair ? "Apply reviewed repair" : creating ? "Add class" : "Save class"}</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

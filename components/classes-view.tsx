"use client";

import { useMemo, useState } from "react";
import { Clock3, Pencil, Plus, Search, UsersRound, X } from "lucide-react";
import type { ClassDefinition } from "@/lib/domain";
import { useWorkspace } from "@/components/workspace-provider";
import { mutatePlanningEntity } from "@/lib/planning-inventory-client";

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

export function ClassesView() {
  const { state, currentAssignments, canEdit, currentPlanningDatasetVersion, refresh } = useWorkspace();
  const [editing, setEditing] = useState<ClassDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");

  const students = useMemo(() => {
    if (!state) return [];
    const q = studentSearch.trim().toLowerCase();
    return state.students
      .filter((student) => !q || `${student.name} ${student.level}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state, studentSearch]);

  if (!state) return null;

  const sessionMap = new Map(state.sessions.map((session) => [session.id, session]));
  const assignmentsFor = (id: string) => currentAssignments.filter((assignment) => sessionMap.get(assignment.sessionId)?.classId === id);
  const original = editing && !creating ? state.classes.find((klass) => klass.id === editing.id) : null;
  const durationImpact = editing && original && original.durationMinutes !== editing.durationMinutes ? assignmentsFor(editing.id) : [];

  function beginAdd() {
    setCreating(true);
    setStudentSearch("");
    setEditing(newClass());
  }

  function beginEdit(klass: ClassDefinition) {
    setCreating(false);
    setStudentSearch("");
    setEditing({ ...klass, rosterStudentIds: [...klass.rosterStudentIds], eligibleTeacherIds: [...klass.eligibleTeacherIds] });
  }

  function toggleStudent(id: string) {
    if (!editing) return;
    const selected = editing.rosterStudentIds.includes(id);
    setEditing({
      ...editing,
      rosterStudentIds: selected ? editing.rosterStudentIds.filter((studentId) => studentId !== id) : [...editing.rosterStudentIds, id],
    });
  }

  async function save() {
    if (!editing || !canEdit || saving) return;
    setSaving(true);
    setNotice("");
    const result = await mutatePlanningEntity({
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
        companyOnly: Boolean(editing.companyOnly),
      },
      reason: `${creating ? "Added" : "Updated"} class ${editing.name}`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });

    if (result.ok) {
      await refresh();
      setEditing(null);
      setCreating(false);
      setNotice(
        `Class ${creating ? "added" : "updated"}. Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}. Weekly session rows were reconciled automatically and the existing schedule now needs revalidation.`,
      );
    } else setNotice(result.error || "Class save failed.");
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
        <strong className="text-slate-950">Classes and rosters are live planning data.</strong> The catalog below starts with our current understanding and can be expanded as enrollment and programming change. Teacher qualification remains Rulebook truth and is never inferred from the legacy eligibility array.
      </div>

      {notice ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div> : null}

      <div className="flex items-center justify-between gap-3">
        <div><h2 className="font-semibold">Class catalog</h2><p className="text-xs text-slate-500">{state.classes.length} currently in the working inventory</p></div>
        {canEdit ? <button onClick={beginAdd} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="size-4" />Add class</button> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {state.classes.map((klass) => {
          const list = assignmentsFor(klass.id);
          return (
            <article key={klass.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-400">{klass.subject} · {klass.level}</p><h2 className="mt-1 font-semibold">{klass.name}</h2><p className="mt-1 text-[11px] text-slate-400">{klass.id}</p></div>
                {canEdit ? <button onClick={() => beginEdit(klass)} className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200" aria-label={`Edit ${klass.name}`}><Pencil className="size-4" /></button> : null}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-slate-50 p-2"><Clock3 className="mx-auto mb-1 size-4 text-slate-400" /><strong>{klass.durationMinutes}</strong> min</div>
                <div className="rounded-xl bg-slate-50 p-2"><UsersRound className="mx-auto mb-1 size-4 text-slate-400" /><strong>{klass.rosterStudentIds.length}</strong> roster</div>
                <div className="rounded-xl bg-slate-50 p-2"><strong className="block text-base">{klass.weeklyFrequency}</strong>/week</div>
              </div>
              <p className="mt-3 text-xs text-slate-500">{list.length} current assignment{list.length === 1 ? "" : "s"}</p>
            </article>
          );
        })}
      </div>

      {editing ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6">
          <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6">
            <div className="flex justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Class inventory</p><h2 className="mt-1 text-xl font-semibold">{creating ? "Add class" : `Edit ${editing.name}`}</h2></div><button onClick={() => { setEditing(null); setCreating(false); }}><X className="size-5" /></button></div>
            <div className="mt-5 grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
                <label className="text-xs font-semibold text-slate-600">Subject<input value={editing.subject} onChange={(event) => setEditing({ ...editing, subject: event.target.value })} placeholder="Ballet, Jazz, Tap…" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="text-xs font-semibold text-slate-600">Level<input value={editing.level} onChange={(event) => setEditing({ ...editing, level: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-2 text-sm font-normal" /></label>
                <label className="text-xs font-semibold text-slate-600">Minutes<input type="number" min={1} value={editing.durationMinutes} onChange={(event) => setEditing({ ...editing, durationMinutes: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-2 text-sm font-normal" /></label>
                <label className="text-xs font-semibold text-slate-600">Per week<input type="number" min={1} value={editing.weeklyFrequency} onChange={(event) => setEditing({ ...editing, weeklyFrequency: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-2 text-sm font-normal" /></label>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">Class roster</p><p className="text-xs text-slate-500">{editing.rosterStudentIds.length} selected. Add missing students on the People → Students screen first.</p></div><label className="relative block min-w-52 flex-1 sm:max-w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search students" className="min-h-10 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-sm" /></label></div>
                <div className="mt-3 grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">
                  {students.map((item) => {
                    const selected = editing.rosterStudentIds.includes(item.id);
                    return <label key={item.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${selected ? "border-slate-950 bg-slate-50" : "border-slate-200"}`}><input type="checkbox" checked={selected} onChange={() => toggleStudent(item.id)} /><span><strong className="block font-semibold">{item.name}</strong><span className="text-xs text-slate-500">{item.level}</span></span></label>;
                  })}
                  {!students.length ? <p className="text-sm text-slate-500">No students match that search.</p> : null}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(editing.companyOnly)} onChange={(event) => setEditing({ ...editing, companyOnly: event.target.checked })} />Company-only curriculum flag</label>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"><strong>Teacher eligibility is not editable here.</strong> Required, allowed, preferred and prohibited teachers belong to versioned Rulebook policy. New classes begin with no invented eligibility.</div>
              <div className={`rounded-xl border p-3 text-sm ${durationImpact.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}><strong>Schedule impact:</strong> {durationImpact.length ? `${durationImpact.length} current assignment(s) retain their old scheduled duration until the schedule is repaired/revalidated.` : "Saving changes advances the Planning Dataset and marks the existing schedule stale for revalidation."}</div>
              {!creating && original && editing.weeklyFrequency < original.weeklyFrequency ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Reducing weekly frequency is protected. If a session being removed appears anywhere in schedule history, the save will be blocked rather than deleting historical identity.</div> : null}
              <div className="flex gap-2"><button onClick={() => { setEditing(null); setCreating(false); }} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Cancel</button><button disabled={saving || !editing.name.trim() || !editing.subject.trim() || !editing.level.trim() || editing.durationMinutes <= 0 || editing.weeklyFrequency <= 0} onClick={() => void save()} className="min-h-11 flex-1 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : creating ? "Add class" : "Save class"}</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

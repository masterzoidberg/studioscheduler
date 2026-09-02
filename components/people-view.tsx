"use client";

import { useState } from "react";
import { Building2, GraduationCap, Palette, Pencil, Plus, UserRound, UsersRound, X } from "lucide-react";
import type { Room, Student, Teacher } from "@/lib/domain";
import { useWorkspace } from "@/components/workspace-provider";
import { mutatePlanningEntity } from "@/lib/planning-inventory-client";
import { safeTeacherColor } from "@/lib/schedule-visuals";

const colorChoices = [
  "#2563EB", "#DB2777", "#7C3AED", "#EA580C", "#059669", "#0891B2", "#D97706", "#4F46E5", "#DC2626",
];

function SaveNotice({ text }: { text: string }) {
  if (!text) return null;
  return <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{text}</div>;
}

function InventoryHeader({
  title,
  count,
  action,
  onAdd,
}: {
  title: string;
  count: number;
  action: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold text-slate-950">{title}</h2>
        <p className="text-xs text-slate-500">{count} currently in the working inventory</p>
      </div>
      {onAdd ? (
        <button onClick={onAdd} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">
          <Plus className="size-4" />
          {action}
        </button>
      ) : null}
    </div>
  );
}

export function PeopleView() {
  const { state, currentAssignments, canEdit, currentPlanningDatasetVersion, refresh } = useWorkspace();
  const [tab, setTab] = useState<"TEACHERS" | "STUDENTS" | "ROOMS">("TEACHERS");
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [creatingTeacher, setCreatingTeacher] = useState(false);
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  if (!state) return null;

  const sessionMap = new Map(state.sessions.map((session) => [session.id, session]));
  const classMap = new Map(state.classes.map((klass) => [klass.id, klass]));
  const assignmentClass = (sessionId: string) => classMap.get(sessionMap.get(sessionId)?.classId || "");
  const teacherAssignments = (id: string) => currentAssignments.filter((assignment) => assignment.teacherId === id);
  const studentAssignments = (id: string) =>
    currentAssignments.filter((assignment) => (assignmentClass(assignment.sessionId)?.rosterStudentIds || []).includes(id));
  const teacherRules = (item: Teacher) =>
    state.rules.filter(
      (rule) =>
        rule.affectedEntityIds.includes(item.id) ||
        rule.parameters.teacher_id === item.id ||
        `${rule.title} ${rule.description} ${rule.category}`.toLowerCase().includes(item.name.toLowerCase()),
    );
  const teacherColor = (item: Teacher) => safeTeacherColor(item.displayColor, item.id || "new-teacher");

  function beginTeacher() {
    setCreatingTeacher(true);
    setTeacher({ id: "", name: "", subjects: [], notes: "", displayColor: colorChoices[0] });
  }
  function beginStudent() {
    setCreatingStudent(true);
    setStudent({ id: "", name: "", level: "", cohortIds: [] });
  }
  function beginRoom() {
    setCreatingRoom(true);
    setRoom({ id: "", name: "", capacity: undefined, features: [] });
  }

  async function saveTeacher() {
    if (!teacher || !canEdit || saving) return;
    setSaving(true);
    setNotice("");
    const operation = creatingTeacher ? "CREATE" : "UPDATE";
    const result = await mutatePlanningEntity({
      operation,
      entityType: "TEACHER",
      entityId: creatingTeacher ? null : teacher.id,
      changes: {
        name: teacher.name,
        notes: teacher.notes || "",
        displayColor: safeTeacherColor(teacher.displayColor, teacher.id || teacher.name || "new-teacher"),
      },
      reason: `${creatingTeacher ? "Added" : "Updated"} teacher ${teacher.name}`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });
    if (result.ok) {
      await refresh();
      setTeacher(null);
      setCreatingTeacher(false);
      setNotice(
        `Teacher ${creatingTeacher ? "added" : "updated"}. Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}; the existing schedule now needs revalidation. Teacher qualification is not guessed and remains Rulebook-controlled.`,
      );
    } else setNotice(result.error || "Teacher save failed.");
    setSaving(false);
  }

  async function saveStudent() {
    if (!student || !canEdit || saving) return;
    setSaving(true);
    setNotice("");
    const operation = creatingStudent ? "CREATE" : "UPDATE";
    const result = await mutatePlanningEntity({
      operation,
      entityType: "STUDENT",
      entityId: creatingStudent ? null : student.id,
      changes: { name: student.name, level: student.level, cohortIds: student.cohortIds || [] },
      reason: `${creatingStudent ? "Added" : "Updated"} student ${student.name}`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });
    if (result.ok) {
      await refresh();
      setStudent(null);
      setCreatingStudent(false);
      setNotice(`Student ${creatingStudent ? "added" : "updated"}. Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}; class rosters can now include this student and the existing schedule needs revalidation.`);
    } else setNotice(result.error || "Student save failed.");
    setSaving(false);
  }

  async function saveRoom() {
    if (!room || !canEdit || saving) return;
    setSaving(true);
    setNotice("");
    const operation = creatingRoom ? "CREATE" : "UPDATE";
    const result = await mutatePlanningEntity({
      operation,
      entityType: "ROOM",
      entityId: creatingRoom ? null : room.id,
      changes: { name: room.name, capacity: room.capacity ?? null, features: room.features || [] },
      reason: `${creatingRoom ? "Added" : "Updated"} room ${room.name}`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });
    if (result.ok) {
      await refresh();
      setRoom(null);
      setCreatingRoom(false);
      setNotice(`Room ${creatingRoom ? "added" : "updated"}. Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}; the existing schedule now needs revalidation.`);
    } else setNotice(result.error || "Room save failed.");
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
        <strong className="text-slate-950">This is a live working inventory.</strong> The current teachers, students and rooms are preloaded from our present understanding, but they are not frozen. Every scheduling-significant change creates a new Planning Dataset version and makes the current schedule stale until it is revalidated.
      </div>
      <SaveNotice text={notice} />

      <div className="flex gap-2 overflow-x-auto">
        {([
          ["TEACHERS", "Teachers", UserRound],
          ["STUDENTS", "Students", UsersRound],
          ["ROOMS", "Rooms", Building2],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${tab === id ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "TEACHERS" ? (
        <div className="space-y-3">
          <InventoryHeader title="Teachers" count={state.teachers.length} action="Add teacher" onAdd={canEdit ? beginTeacher : undefined} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {state.teachers.map((item) => {
              const assignments = teacherAssignments(item.id);
              const rules = teacherRules(item);
              const color = teacherColor(item);
              return (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="h-2" style={{ backgroundColor: color }} />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid size-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white" style={{ backgroundColor: color }}>{item.name.slice(0, 1).toUpperCase()}</div>
                        <div className="min-w-0"><h2 className="truncate font-semibold">{item.name}</h2><p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Palette className="size-3.5" />{color}</p></div>
                      </div>
                      {canEdit ? <button onClick={() => { setCreatingTeacher(false); setTeacher({ ...item, subjects: [...item.subjects], displayColor: color }); }} className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200" aria-label={`Edit ${item.name}`}><Pencil className="size-4" /></button> : null}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
                      <div className="rounded-xl bg-slate-50 p-3"><strong className="block text-lg">{assignments.length}</strong>sessions</div>
                      <div className="rounded-xl bg-slate-50 p-3"><strong className="block text-lg">{new Set(assignments.map((assignment) => assignment.day)).size}</strong>workdays</div>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">{rules.length} Rulebook item{rules.length === 1 ? "" : "s"} mention or target this teacher</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "STUDENTS" ? (
        <div className="space-y-3">
          <InventoryHeader title="Students" count={state.students.length} action="Add student" onAdd={canEdit ? beginStudent : undefined} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {state.students.map((item) => {
              const list = studentAssignments(item.id).sort((a, b) => a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime));
              const rosterCount = state.classes.filter((klass) => klass.rosterStudentIds.includes(item.id)).length;
              return (
                <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-slate-100"><GraduationCap className="size-5 text-slate-500" /></div><div><h2 className="font-semibold">{item.name}</h2><p className="text-xs text-slate-500">{item.level}</p></div></div>
                    {canEdit ? <button onClick={() => { setCreatingStudent(false); setStudent({ ...item, cohortIds: [...(item.cohortIds || [])] }); }} className="grid size-10 place-items-center rounded-xl border border-slate-200" aria-label={`Edit ${item.name}`}><Pencil className="size-4" /></button> : null}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs"><div className="rounded-xl bg-slate-50 p-3"><strong className="block text-lg">{rosterCount}</strong>class rosters</div><div className="rounded-xl bg-slate-50 p-3"><strong className="block text-lg">{list.length}</strong>scheduled</div></div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "ROOMS" ? (
        <div className="space-y-3">
          <InventoryHeader title="Rooms" count={state.rooms.length} action="Add room" onAdd={canEdit ? beginRoom : undefined} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {state.rooms.map((item) => {
              const list = currentAssignments.filter((assignment) => assignment.roomId === item.id);
              return (
                <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between"><div><h2 className="font-semibold">{item.name}</h2><p className="mt-1 text-xs text-slate-500">Capacity {item.capacity ?? "not set"}</p></div>{canEdit ? <button onClick={() => { setCreatingRoom(false); setRoom({ ...item, features: [...(item.features || [])] }); }} className="grid size-10 place-items-center rounded-xl border border-slate-200" aria-label={`Edit ${item.name}`}><Pencil className="size-4" /></button> : null}</div>
                  <p className="mt-4 text-sm text-slate-600">{list.length} current assignment{list.length === 1 ? "" : "s"}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">{item.features?.map((feature) => <span key={feature} className="rounded-lg bg-slate-100 px-2 py-1 text-xs">{feature}</span>)}</div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {teacher ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6">
          <div className="w-full max-w-lg rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6">
            <div className="flex justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Teacher inventory</p><h2 className="mt-1 text-xl font-semibold">{creatingTeacher ? "Add teacher" : `Edit ${teacher.name}`}</h2></div><button onClick={() => { setTeacher(null); setCreatingTeacher(false); }} className="grid size-10 place-items-center rounded-xl"><X className="size-5" /></button></div>
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-slate-600">Name<input value={teacher.name} onChange={(event) => setTeacher({ ...teacher, name: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              <div><p className="text-xs font-semibold text-slate-600">Schedule color</p><div className="mt-2 flex flex-wrap items-center gap-2">{colorChoices.map((color) => <button key={color} type="button" onClick={() => setTeacher({ ...teacher, displayColor: color })} className={`size-10 rounded-xl border-2 ${teacher.displayColor === color ? "border-slate-950" : "border-white ring-1 ring-slate-200"}`} style={{ backgroundColor: color }} aria-label={`Use ${color}`} />)}<label className="ml-1 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600">Custom<input type="color" value={safeTeacherColor(teacher.displayColor, teacher.id || "new-teacher")} onChange={(event) => setTeacher({ ...teacher, displayColor: event.target.value.toUpperCase() })} className="size-7 cursor-pointer border-0 bg-transparent p-0" /></label></div></div>
              <label className="block text-xs font-semibold text-slate-600">Notes<textarea value={teacher.notes || ""} onChange={(event) => setTeacher({ ...teacher, notes: event.target.value })} rows={4} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm font-normal" /></label>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"><strong>Adding a teacher does not invent qualifications.</strong> Availability, allowed subjects/levels, and required or prohibited classes remain Rulebook truth. A newly added teacher will not become automatically eligible merely because they exist in inventory.</div>
              <div className="flex gap-2"><button onClick={() => { setTeacher(null); setCreatingTeacher(false); }} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Cancel</button><button disabled={saving || !teacher.name.trim()} onClick={() => void saveTeacher()} className="min-h-11 flex-1 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : creatingTeacher ? "Add teacher" : "Save teacher"}</button></div>
            </div>
          </div>
        </div>
      ) : null}

      {student ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6">
          <div className="w-full max-w-lg rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6">
            <div className="flex justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Student inventory</p><h2 className="mt-1 text-xl font-semibold">{creatingStudent ? "Add student" : `Edit ${student.name}`}</h2></div><button onClick={() => { setStudent(null); setCreatingStudent(false); }}><X className="size-5" /></button></div>
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-slate-600">Name<input value={student.name} onChange={(event) => setStudent({ ...student, name: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              <label className="block text-xs font-semibold text-slate-600">Level<input value={student.level} onChange={(event) => setStudent({ ...student, level: event.target.value })} placeholder="Example: Level 3" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Add the student here first. Then use the Classes screen to place them on one or more class rosters.</p>
              <div className="flex gap-2"><button onClick={() => { setStudent(null); setCreatingStudent(false); }} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Cancel</button><button disabled={saving || !student.name.trim() || !student.level.trim()} onClick={() => void saveStudent()} className="min-h-11 flex-1 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : creatingStudent ? "Add student" : "Save student"}</button></div>
            </div>
          </div>
        </div>
      ) : null}

      {room ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6">
          <div className="w-full max-w-lg rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6">
            <div className="flex justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Room inventory</p><h2 className="mt-1 text-xl font-semibold">{creatingRoom ? "Add room" : `Edit ${room.name}`}</h2></div><button onClick={() => { setRoom(null); setCreatingRoom(false); }}><X className="size-5" /></button></div>
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-slate-600">Name<input value={room.name} onChange={(event) => setRoom({ ...room, name: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              <label className="block text-xs font-semibold text-slate-600">Capacity<input type="number" min={1} value={room.capacity ?? ""} onChange={(event) => setRoom({ ...room, capacity: event.target.value ? Number(event.target.value) : undefined })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              <label className="block text-xs font-semibold text-slate-600">Features<input value={(room.features || []).join(", ")} onChange={(event) => setRoom({ ...room, features: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
              <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Room-use rules remain separate Rulebook truth. Adding a room creates inventory capacity, not permission to ignore required-room policies.</p>
              <div className="flex gap-2"><button onClick={() => { setRoom(null); setCreatingRoom(false); }} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Cancel</button><button disabled={saving || !room.name.trim()} onClick={() => void saveRoom()} className="min-h-11 flex-1 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : creatingRoom ? "Add room" : "Save room"}</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

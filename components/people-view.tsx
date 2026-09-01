"use client";

import { useEffect, useState } from "react";
import { Building2, GraduationCap, Palette, Pencil, UserRound, UsersRound, X } from "lucide-react";
import type { Room, Teacher } from "@/lib/domain";
import { useWorkspace } from "@/components/workspace-provider";
import { getBrowserSupabase } from "@/lib/supabase";
import { safeTeacherColor } from "@/lib/schedule-visuals";

const colorChoices = [
  "#2563EB",
  "#DB2777",
  "#7C3AED",
  "#EA580C",
  "#059669",
  "#0891B2",
  "#D97706",
  "#4F46E5",
  "#DC2626",
];

export function PeopleView() {
  const {
    state,
    currentAssignments,
    updateRoom,
    canEdit,
    currentRulebookVersion,
    currentScheduleVersion,
    refresh,
  } = useWorkspace();
  const [tab, setTab] = useState<"TEACHERS" | "DANCERS" | "ROOMS">("TEACHERS");
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [notice, setNotice] = useState("");
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [teacherColors, setTeacherColors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!state) return;
    let active = true;
    void getBrowserSupabase()
      .from("teachers")
      .select("id,display_color")
      .eq("studio_id", state.studioId)
      .then(({ data }) => {
        if (!active) return;
        const next: Record<string, string> = {};
        for (const row of data || []) {
          next[String(row.id)] = safeTeacherColor(row.display_color, String(row.id));
        }
        setTeacherColors(next);
      });
    return () => {
      active = false;
    };
  }, [state]);

  if (!state) return null;

  const sessionMap = new Map(state.sessions.map((session) => [session.id, session]));
  const classMap = new Map(state.classes.map((klass) => [klass.id, klass]));
  const assignmentClass = (sessionId: string) => classMap.get(sessionMap.get(sessionId)?.classId || "");
  const teacherAssignments = (id: string) => currentAssignments.filter((assignment) => assignment.teacherId === id);
  const dancerAssignments = (id: string) =>
    currentAssignments.filter((assignment) => (assignmentClass(assignment.sessionId)?.rosterStudentIds || []).includes(id));
  const teacherRules = (item: Teacher) =>
    state.rules.filter(
      (rule) =>
        rule.affectedEntityIds.includes(item.id) ||
        rule.parameters.teacher_id === item.id ||
        `${rule.title} ${rule.description} ${rule.category}`.toLowerCase().includes(item.name.toLowerCase()),
    );
  const teacherColor = (item: Teacher) => safeTeacherColor(teacherColors[item.id] || item.displayColor, item.id);

  async function saveTeacher() {
    if (!teacher || !canEdit) return;
    setSavingTeacher(true);
    setNotice("");
    try {
      const color = safeTeacherColor(teacher.displayColor, teacher.id);
      const { error } = await getBrowserSupabase().rpc("update_studio_entity_v21", {
        p_entity_type: "TEACHER",
        p_entity_id: teacher.id,
        p_changes: { name: teacher.name, notes: teacher.notes || "", displayColor: color },
        p_reason: `Updated ${teacher.name} profile and schedule color`,
        p_expected_rulebook_version: currentRulebookVersion,
        p_expected_schedule_version: currentScheduleVersion,
      });
      if (error) throw error;
      setTeacherColors((current) => ({ ...current, [teacher.id]: color }));
      await refresh();
      setNotice("Teacher profile and schedule color saved.");
      setTeacher(null);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Teacher save failed.");
    } finally {
      setSavingTeacher(false);
    }
  }

  async function saveRoom() {
    if (!room) return;
    const result = await updateRoom(room, `Updated ${room.name}`);
    setNotice(result.ok ? "Room saved through the governed mutation boundary." : result.error || "Save failed.");
    if (result.ok) setRoom(null);
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm leading-6 text-slate-600">
          Teacher colors are visual aids for the schedule. <strong>Qualifications and availability still live in the Rulebook</strong>, so changing a color cannot change what the scheduler is allowed to do.
        </p>
      </div>

      {notice ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div> : null}

      <div className="flex gap-2 overflow-x-auto">
        {([
          ["TEACHERS", "Teachers", UserRound],
          ["DANCERS", "Dancers", UsersRound],
          ["ROOMS", "Rooms", Building2],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${
              tab === id ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "TEACHERS" ? (
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
                      <div
                        className="grid size-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white"
                        style={{ backgroundColor: color }}
                        aria-hidden="true"
                      >
                        {item.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold">{item.name}</h2>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                          <Palette className="size-3.5" />
                          {color}
                        </p>
                      </div>
                    </div>
                    {canEdit ? (
                      <button
                        onClick={() => setTeacher({ ...item, subjects: [...item.subjects], displayColor: color })}
                        className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200"
                        aria-label={`Edit ${item.name}`}
                      >
                        <Pencil className="size-4" />
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Legacy descriptive tags · not scheduling authority
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.subjects.map((subject) => (
                        <span key={subject} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500">
                          {subject}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <strong className="block text-lg">{assignments.length}</strong>
                      sessions
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <strong className="block text-lg">{new Set(assignments.map((assignment) => assignment.day)).size}</strong>
                      workdays
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {rules.length} current Rulebook item{rules.length === 1 ? "" : "s"} mention or target this teacher
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {tab === "DANCERS" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {state.students.map((student) => {
            const list = dancerAssignments(student.id).sort((a, b) => a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime));
            return (
              <article key={student.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-slate-100">
                    <GraduationCap className="size-5 text-slate-500" />
                  </div>
                  <div>
                    <h2 className="font-semibold">{student.name}</h2>
                    <p className="text-xs text-slate-500">{student.level}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {list.map((assignment) => (
                    <div key={assignment.id} className="rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="font-semibold">{assignmentClass(assignment.sessionId)?.name}</p>
                      <p className="mt-1 text-slate-500">
                        {assignment.day} · {assignment.startTime.slice(0, 5)}–{assignment.endTime.slice(0, 5)}
                      </p>
                    </div>
                  ))}
                  {!list.length ? <p className="text-xs text-slate-500">No scheduled classes in the current assignment set.</p> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {tab === "ROOMS" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {state.rooms.map((item) => {
            const list = currentAssignments.filter((assignment) => assignment.roomId === item.id);
            return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold">{item.name}</h2>
                    <p className="mt-1 text-xs text-slate-500">Capacity {item.capacity ?? "not set"}</p>
                  </div>
                  {canEdit ? (
                    <button
                      onClick={() => setRoom({ ...item, features: [...(item.features || [])] })}
                      className="grid size-10 place-items-center rounded-xl border border-slate-200"
                      aria-label={`Edit ${item.name}`}
                    >
                      <Pencil className="size-4" />
                    </button>
                  ) : null}
                </div>
                <p className="mt-4 text-sm text-slate-600">{list.length} current assignment{list.length === 1 ? "" : "s"}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.features?.map((feature) => (
                    <span key={feature} className="rounded-lg bg-slate-100 px-2 py-1 text-xs">
                      {feature}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {teacher ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6">
          <div className="w-full max-w-lg rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6">
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Teacher profile</p>
                <h2 className="mt-1 text-xl font-semibold">Edit {teacher.name}</h2>
              </div>
              <button onClick={() => setTeacher(null)} className="grid size-10 place-items-center rounded-xl">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-slate-600">
                Name
                <input
                  value={teacher.name}
                  onChange={(event) => setTeacher({ ...teacher, name: event.target.value })}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                />
              </label>

              <div>
                <p className="text-xs font-semibold text-slate-600">Schedule color</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {colorChoices.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setTeacher({ ...teacher, displayColor: color })}
                      className={`size-10 rounded-xl border-2 ${teacher.displayColor === color ? "border-slate-950" : "border-white ring-1 ring-slate-200"}`}
                      style={{ backgroundColor: color }}
                      aria-label={`Use ${color} for ${teacher.name}`}
                    />
                  ))}
                  <label className="ml-1 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600">
                    Custom
                    <input
                      type="color"
                      value={safeTeacherColor(teacher.displayColor, teacher.id)}
                      onChange={(event) => setTeacher({ ...teacher, displayColor: event.target.value.toUpperCase() })}
                      className="size-7 cursor-pointer border-0 bg-transparent p-0"
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-slate-500">Used as the teacher stripe on schedule cards. Teacher name remains visible too.</p>
              </div>

              <label className="block text-xs font-semibold text-slate-600">
                Notes
                <textarea
                  value={teacher.notes || ""}
                  onChange={(event) => setTeacher({ ...teacher, notes: event.target.value })}
                  rows={4}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm font-normal"
                />
              </label>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                <strong>Qualifications are not edited here.</strong> Availability, required/prohibited classes, subjects and levels remain versioned Rulebook truth.
              </div>

              <div className="flex gap-2">
                <button onClick={() => setTeacher(null)} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">
                  Cancel
                </button>
                <button
                  disabled={savingTeacher}
                  onClick={() => void saveTeacher()}
                  className="min-h-11 flex-1 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-50"
                >
                  {savingTeacher ? "Saving…" : "Save profile"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {room ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6">
          <div className="w-full max-w-lg rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6">
            <div className="flex justify-between">
              <h2 className="text-xl font-semibold">Edit {room.name}</h2>
              <button onClick={() => setRoom(null)}>
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-slate-600">
                Name
                <input
                  value={room.name}
                  onChange={(event) => setRoom({ ...room, name: event.target.value })}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Capacity
                <input
                  type="number"
                  min={1}
                  value={room.capacity ?? ""}
                  onChange={(event) => setRoom({ ...room, capacity: event.target.value ? Number(event.target.value) : undefined })}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Features
                <input
                  value={(room.features || []).join(", ")}
                  onChange={(event) =>
                    setRoom({ ...room, features: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })
                  }
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                />
              </label>
              <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                This update is transactional, versioned in entity history, and audited. Rules that govern room use remain separate Rulebook truth.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setRoom(null)} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">
                  Cancel
                </button>
                <button onClick={() => void saveRoom()} className="min-h-11 flex-1 rounded-xl bg-slate-950 font-semibold text-white">
                  Save room
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

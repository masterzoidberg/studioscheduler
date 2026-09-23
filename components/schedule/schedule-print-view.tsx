import type { Assignment } from "@/lib/domain";
import type { ScheduleExportModel, ScheduleExportView } from "@/lib/schedule-export";
import { scheduleExportStatusLabel } from "@/lib/schedule-export";

function pretty(value: string | null) {
  if (!value) return "—";
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

function viewLabel(view: ScheduleExportView) {
  return view === "WEEK" ? "Weekly schedule" : view === "TEACHER" ? "Teacher schedule" : "Room schedule";
}

function durationFor(model: ScheduleExportModel, assignment: Assignment) {
  const session = model.sessions.find((item) => item.id === assignment.sessionId);
  const klass = session ? model.classes.find((item) => item.id === session.classId) : null;
  return session && klass ? session.durationMinutes ?? klass.durationMinutes : null;
}

function classNameFor(model: ScheduleExportModel, assignment: Assignment) {
  const session = model.sessions.find((item) => item.id === assignment.sessionId);
  return session ? model.classes.find((item) => item.id === session.classId)?.name || session.classId : assignment.sessionId;
}

function assignmentRows(model: ScheduleExportModel, assignments: Assignment[], includeRoom: boolean) {
  const teachers = new Map(model.teachers.map((teacher) => [teacher.id, teacher.name]));
  const rooms = new Map(model.rooms.map((room) => [room.id, room.name]));
  return [...assignments]
    .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.id.localeCompare(right.id))
    .map((assignment) => (
      <tr key={assignment.id} className="border-t border-slate-200">
        <td className="px-2 py-1.5 align-top font-medium">{pretty(assignment.startTime)}–{pretty(assignment.endTime)}</td>
        <td className="px-2 py-1.5 align-top">{classNameFor(model, assignment)}</td>
        <td className="px-2 py-1.5 align-top">{teachers.get(assignment.teacherId) || assignment.teacherId}</td>
        {includeRoom ? <td className="px-2 py-1.5 align-top">{rooms.get(assignment.roomId) || assignment.roomId}</td> : null}
        <td className="px-2 py-1.5 align-top text-right">{durationFor(model, assignment) ?? "—"} min</td>
        <td className="px-2 py-1.5 align-top text-right text-slate-600">{assignment.locked || model.sessions.find((session) => session.id === assignment.sessionId)?.locked ? "Locked" : "Open"}</td>
      </tr>
    ));
}

function AssignmentTable({ model, assignments, includeRoom = true }: { model: ScheduleExportModel; assignments: Assignment[]; includeRoom?: boolean }) {
  if (!assignments.length) return <p className="px-2 py-2 text-xs italic text-slate-500">No scheduled sessions.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-[11px] leading-4">
        <thead className="bg-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-2 py-1.5 font-semibold">Time</th>
            <th className="px-2 py-1.5 font-semibold">Class</th>
            <th className="px-2 py-1.5 font-semibold">Teacher</th>
            {includeRoom ? <th className="px-2 py-1.5 font-semibold">Room</th> : null}
            <th className="px-2 py-1.5 text-right font-semibold">Length</th>
            <th className="px-2 py-1.5 text-right font-semibold">Lock</th>
          </tr>
        </thead>
        <tbody>{assignmentRows(model, assignments, includeRoom)}</tbody>
      </table>
    </div>
  );
}

function unassigned(model: ScheduleExportModel) {
  const assigned = new Set(model.assignments.map((assignment) => assignment.sessionId));
  return model.sessions.filter((session) => !assigned.has(session.id));
}

function UnassignedSection({ model }: { model: ScheduleExportModel }) {
  const sessions = unassigned(model);
  if (!sessions.length) return null;
  return (
    <section className="schedule-print-unassigned rounded-lg border border-amber-300 bg-amber-50 p-3">
      <h2 className="text-sm font-semibold text-amber-950">Unassigned sessions</h2>
      <p className="mt-1 text-xs text-amber-900">These sessions remain in the current ScheduleVersion but have no placement.</p>
      <ul className="mt-2 grid gap-1 text-xs text-amber-950 sm:grid-cols-2">
        {sessions.map((session) => <li key={session.id}>{classNameFor(model, { sessionId: session.id } as Assignment)} · Session {session.ordinal}</li>)}
      </ul>
    </section>
  );
}

function WeeklyPages({ model }: { model: ScheduleExportModel }) {
  return (
    <div className="space-y-4">
      {model.days.map((day) => (
        <section key={day} className="schedule-print-page rounded-xl border border-slate-300 bg-white p-4">
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-300 pb-2">
            <h2 className="text-lg font-semibold">{day}</h2>
            <span className="text-xs text-slate-600">{model.assignments.filter((assignment) => assignment.day === day).length} scheduled sessions</span>
          </div>
          <div className="mt-3 space-y-3">
            {model.rooms.length ? model.rooms.map((room) => {
              const assignments = model.assignments.filter((assignment) => assignment.day === day && assignment.roomId === room.id);
              return <section key={room.id} className="schedule-print-room rounded-lg border border-slate-200 p-2"><div className="mb-1 flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{room.name}</h3><span className="text-[10px] text-slate-500">{assignments.length} session{assignments.length === 1 ? "" : "s"}</span></div><AssignmentTable model={model} assignments={assignments} /></section>;
            }) : <p className="text-sm text-slate-500">No rooms are configured.</p>}
          </div>
        </section>
      ))}
      <UnassignedSection model={model} />
    </div>
  );
}

function TeacherPages({ model }: { model: ScheduleExportModel }) {
  if (!model.teachers.length) return <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No teachers are configured.</p>;
  return (
    <div className="space-y-4">
      {model.teachers.map((teacher) => (
        <section key={teacher.id} className="schedule-print-page rounded-xl border border-slate-300 bg-white p-4">
          <h2 className="border-b border-slate-300 pb-2 text-lg font-semibold">{teacher.name}</h2>
          <div className="mt-3 space-y-3">
            {model.days.map((day) => {
              const assignments = model.assignments.filter((assignment) => assignment.day === day && assignment.teacherId === teacher.id);
              return <section key={day} className="schedule-print-day"><div className="mb-1 flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{day}</h3><span className="text-[10px] text-slate-500">{assignments.length} session{assignments.length === 1 ? "" : "s"}</span></div><AssignmentTable model={model} assignments={assignments} /></section>;
            })}
          </div>
        </section>
      ))}
      <UnassignedSection model={model} />
    </div>
  );
}

function RoomPages({ model }: { model: ScheduleExportModel }) {
  if (!model.rooms.length) return <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No rooms are configured.</p>;
  return (
    <div className="space-y-4">
      {model.rooms.map((room) => (
        <section key={room.id} className="schedule-print-page rounded-xl border border-slate-300 bg-white p-4">
          <h2 className="border-b border-slate-300 pb-2 text-lg font-semibold">{room.name}</h2>
          <div className="mt-3 space-y-3">
            {model.days.map((day) => {
              const assignments = model.assignments.filter((assignment) => assignment.day === day && assignment.roomId === room.id);
              return <section key={day} className="schedule-print-day"><div className="mb-1 flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{day}</h3><span className="text-[10px] text-slate-500">{assignments.length} session{assignments.length === 1 ? "" : "s"}</span></div><AssignmentTable model={model} assignments={assignments} /></section>;
            })}
          </div>
        </section>
      ))}
      <UnassignedSection model={model} />
    </div>
  );
}

export function SchedulePrintView({ model, view }: { model: ScheduleExportModel; view: ScheduleExportView }) {
  return (
    <div className="schedule-export-print-root" data-schedule-print data-schedule-print-status={model.status} data-schedule-print-view={view} aria-label={`${viewLabel(view)} export`}>
      <header className="schedule-print-header mb-4 border-b-2 border-slate-950 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">{model.studioName}</p><h1 className="mt-1 text-2xl font-bold">{viewLabel(view)}</h1><p className="mt-1 text-xs text-slate-600">Schedule v{model.scheduleVersion} · {model.days.join(" · ")}</p></div>
          <span className={`schedule-print-status rounded-md border px-2 py-1 text-xs font-bold ${model.status === "REVIEWED_FINAL" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : model.status === "STALE" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-300 bg-slate-100 text-slate-800"}`}>{scheduleExportStatusLabel(model.status)}</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-700">{model.status === "REVIEWED_FINAL" ? "Reviewed final schedule export. Current Rulebook, Planning Dataset, Constraint Model, certification, completeness, and legality checks passed." : model.status === "STALE" ? "STALE export. This artifact is retained for review only and must not be treated as the current reviewed schedule." : "DRAFT export. This artifact is retained for planning review only and is not a reviewed final schedule."}</p>
      </header>
      {view === "WEEK" ? <WeeklyPages model={model} /> : view === "TEACHER" ? <TeacherPages model={model} /> : <RoomPages model={model} />}
      <footer className="schedule-print-footer mt-5 border-t border-slate-300 pt-2 text-[10px] text-slate-500">Planning Dataset v{model.planningDatasetVersion} · Rulebook v{model.rulebookVersion} · Enforcement v{model.enforcementVersion} · Student rosters redacted by default.</footer>
    </div>
  );
}

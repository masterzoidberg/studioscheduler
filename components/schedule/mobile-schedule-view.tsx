"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, GripVertical, LockKeyhole, X } from "lucide-react";
import type { Assignment, Day, Room, SchedulePatch } from "@/lib/domain";
import { applyAssignmentChanges, validateSchedule } from "@/lib/validator";
import { safeTeacherColor, subjectMarker, translucentHex } from "@/lib/schedule-visuals";
import { useWorkspace } from "@/components/workspace-provider";

const days: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type MobileViewMode = 1 | 2 | 3 | "week";
type RoomFilter = "ALL" | string;

type DragState = {
  assignment: Assignment;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  candidate: Assignment;
};

const toMinutes = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
};

const asTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const pretty = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
};

const samePlacement = (a: Assignment, b: Assignment) =>
  a.day === b.day && a.startTime === b.startTime && a.endTime === b.endTime && a.roomId === b.roomId;

function windowFor(day: Day) {
  return day === "Saturday" ? { start: 9 * 60, end: 15 * 60 } : { start: 16 * 60 + 15, end: 22 * 60 };
}

export function MobileScheduleView() {
  const {
    state,
    currentAssignments,
    currentScheduleVersion,
    scheduleIsStale,
    validation,
    applySchedulePatch,
    canEdit,
  } = useWorkspace();
  const [focusDay, setFocusDay] = useState<Day>("Monday");
  const [viewMode, setViewMode] = useState<MobileViewMode>(1);
  const [roomFilter, setRoomFilter] = useState<RoomFilter>("ALL");
  const [notice, setNotice] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<Assignment | null>(null);
  const [savingMove, setSavingMove] = useState(false);
  const [details, setDetails] = useState<Assignment | null>(null);
  const dragRef = useRef<DragState | null>(null);

  if (!state) return null;

  const sessionMap = new Map(state.sessions.map((item) => [item.id, item]));
  const classMap = new Map(state.classes.map((item) => [item.id, item]));
  const teacherMap = new Map(state.teachers.map((item) => [item.id, item]));
  const roomMap = new Map(state.rooms.map((item) => [item.id, item]));
  const klass = (assignment: Assignment) => classMap.get(sessionMap.get(assignment.sessionId)?.classId || "");
  const teacherColor = (teacherId: string) => safeTeacherColor(teacherMap.get(teacherId)?.displayColor, teacherId);
  const assignmentsFor = (day: Day, roomId?: string) => currentAssignments
    .filter((item) => item.day === day && (!roomId || item.roomId === roomId))
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  const focusIndex = days.indexOf(focusDay);
  const detailCount = viewMode === "week" ? 6 : viewMode;
  const visibleDays = viewMode === "week"
    ? days
    : days.slice(Math.min(focusIndex, Math.max(0, days.length - detailCount)), Math.min(focusIndex, Math.max(0, days.length - detailCount)) + detailCount);
  const visibleRooms: Room[] = roomFilter === "ALL" ? state.rooms : state.rooms.filter((room) => room.id === roomFilter);
  const slotHeight = 20;

  const dragValidation = dragPreview
    ? validateSchedule(state, applyAssignmentChanges(currentAssignments, dragPreview.id, dragPreview))
    : null;
  const dragAllowed = dragValidation
    ? validation.hardViolations === 0
      ? dragValidation.hardViolations === 0
      : dragValidation.hardViolations < validation.hardViolations
    : false;

  function stepDay(delta: number) {
    const index = days.indexOf(focusDay);
    setFocusDay(days[Math.max(0, Math.min(days.length - 1, index + delta))]);
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, assignment: Assignment) {
    if (!canEdit || scheduleIsStale || assignment.locked || savingMove) {
      setDetails(assignment);
      return;
    }
    event.stopPropagation();
    dragRef.current = {
      assignment,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      candidate: { ...assignment },
    };
    setDraggingId(assignment.id);
    setDragPreview({ ...assignment });
    setNotice("");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
    drag.moved = true;

    const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const drop = hit?.closest<HTMLElement>("[data-mobile-drop-day][data-mobile-drop-room]");
    if (!drop) return;

    const day = drop.dataset.mobileDropDay as Day | undefined;
    const roomId = drop.dataset.mobileDropRoom;
    const start = Number(drop.dataset.gridStart);
    const rowHeight = Number(drop.dataset.slotHeight);
    if (!day || !roomId || !Number.isFinite(start) || !Number.isFinite(rowHeight) || rowHeight <= 0) return;

    const rect = drop.getBoundingClientRect();
    const operating = windowFor(day);
    const duration = toMinutes(drag.assignment.endTime) - toMinutes(drag.assignment.startTime);
    const slot = Math.round((event.clientY - rect.top) / rowHeight);
    const requested = start + slot * 15;
    const latest = Math.max(operating.start, operating.end - duration);
    const nextStart = Math.max(operating.start, Math.min(latest, requested));
    const candidate: Assignment = {
      ...drag.assignment,
      day,
      roomId,
      startTime: asTime(nextStart),
      endTime: asTime(nextStart + duration),
    };
    if (samePlacement(candidate, drag.candidate)) return;
    drag.candidate = candidate;
    setDragPreview(candidate);
  }

  async function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDraggingId(null);

    if (!drag.moved) {
      setDragPreview(null);
      setDetails(drag.assignment);
      return;
    }

    const candidate = drag.candidate;
    setDragPreview(null);
    if (samePlacement(candidate, drag.assignment)) return;

    const nextValidation = validateSchedule(state!, applyAssignmentChanges(currentAssignments, candidate.id, candidate));
    const allowed = validation.hardViolations === 0
      ? nextValidation.hardViolations === 0
      : nextValidation.hardViolations < validation.hardViolations;
    if (!allowed) {
      const message = nextValidation.violations.find((item) => item.severity === "HARD")?.message;
      setNotice(`Move blocked: ${message || "that placement creates or fails to reduce a detected HARD conflict."}`);
      return;
    }

    setSavingMove(true);
    const result = await applySchedulePatch({
      id: `mobile-drag-${candidate.id}`,
      operation: "MOVE",
      assignmentId: candidate.id,
      changes: {
        day: candidate.day,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        roomId: candidate.roomId,
      },
      reason: `Mobile drag: ${klass(candidate)?.name || candidate.id} to ${candidate.day} ${pretty(candidate.startTime)} in ${roomMap.get(candidate.roomId)?.name || candidate.roomId}`,
      proposedBy: "USER",
    } as SchedulePatch);
    setSavingMove(false);
    if (!result.ok) {
      const message = result.validation?.violations.find((item) => item.severity === "HARD")?.message;
      setNotice(`Move blocked: ${message || result.error || "server validation rejected the drop."}`);
      return;
    }
    setFocusDay(candidate.day);
    setNotice(`Moved ${klass(candidate)?.name || candidate.id}. Saved as Schedule v${result.version}.`);
  }

  function cancelDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
    setDragPreview(null);
  }

  function classCard(assignment: Assignment, operatingStart: number) {
    const currentClass = klass(assignment);
    const color = teacherColor(assignment.teacherId);
    const duration = toMinutes(assignment.endTime) - toMinutes(assignment.startTime);
    const top = ((toMinutes(assignment.startTime) - operatingStart) / 15) * slotHeight;
    const height = (duration / 15) * slotHeight;
    const isDragging = draggingId === assignment.id;
    return (
      <button
        key={assignment.id}
        type="button"
        onPointerDown={(event) => startDrag(event, assignment)}
        onPointerMove={moveDrag}
        onPointerUp={(event) => void finishDrag(event)}
        onPointerCancel={cancelDrag}
        className={`absolute left-1.5 right-1.5 overflow-hidden rounded-xl border border-slate-200 border-l-[5px] p-2 text-left shadow-sm ${isDragging ? "opacity-25" : "opacity-100"}`}
        style={{
          top: Math.max(0, top),
          height: Math.max(40, height),
          borderLeftColor: color,
          backgroundColor: translucentHex(color),
          touchAction: assignment.locked || !canEdit || scheduleIsStale ? "auto" : "none",
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {assignment.locked ? <LockKeyhole className="size-3 shrink-0 text-slate-500" /> : <GripVertical className="size-3 shrink-0 text-slate-400" />}
          <span className="shrink-0 text-sm" aria-hidden="true">{subjectMarker(currentClass?.subject, currentClass?.name)}</span>
          <span className="truncate text-xs font-bold text-slate-900">{currentClass?.name || assignment.sessionId}</span>
        </div>
        {height >= 60 ? <p className="mt-1 truncate text-[11px] font-medium text-slate-700">{teacherMap.get(assignment.teacherId)?.name}</p> : null}
        {height >= 80 ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{pretty(assignment.startTime)}–{pretty(assignment.endTime)}</p> : null}
      </button>
    );
  }

  function roomTimeline(day: Day, room: Room) {
    const operating = windowFor(day);
    const rows = Math.ceil((operating.end - operating.start) / 15);
    const gridHeight = rows * slotHeight;
    const list = assignmentsFor(day, room.id);
    return (
      <section key={`${day}-${room.id}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
          <strong className="text-sm">{room.name}</strong>
          <span className="text-[11px] text-slate-500">{list.length} class{list.length === 1 ? "" : "es"}</span>
        </div>
        <div className="grid grid-cols-[54px_minmax(0,1fr)]">
          <div className="border-r border-slate-200 bg-slate-50">
            {Array.from({ length: rows }, (_, index) => {
              const total = operating.start + index * 15;
              const showLabel = index % 2 === 0;
              return <div key={total} className="border-b border-slate-200/70 px-1 pt-1 text-[8px] text-slate-500" style={{ height: slotHeight }}>{showLabel ? pretty(asTime(total)) : ""}</div>;
            })}
          </div>
          <div
            data-mobile-drop-day={day}
            data-mobile-drop-room={room.id}
            data-grid-start={operating.start}
            data-slot-height={slotHeight}
            className="relative"
            style={{
              height: gridHeight,
              backgroundImage: "linear-gradient(to bottom, rgba(148,163,184,.32) 1px, transparent 1px)",
              backgroundSize: `100% ${slotHeight}px`,
            }}
          >
            {list.map((assignment) => classCard(assignment, operating.start))}
            {dragPreview && dragPreview.day === day && dragPreview.roomId === room.id ? (
              <div
                className={`pointer-events-none absolute left-1 right-1 z-20 rounded-xl border-2 border-dashed p-2 shadow-lg ${dragAllowed ? "border-emerald-500 bg-emerald-50/90" : "border-red-500 bg-red-50/90"}`}
                style={{
                  top: ((toMinutes(dragPreview.startTime) - operating.start) / 15) * slotHeight,
                  height: Math.max(40, ((toMinutes(dragPreview.endTime) - toMinutes(dragPreview.startTime)) / 15) * slotHeight),
                }}
              >
                <p className="truncate text-xs font-bold">{dragAllowed ? "✓" : "✕"} {klass(dragPreview)?.name}</p>
                <p className="mt-0.5 truncate text-[10px] text-slate-600">{pretty(dragPreview.startTime)} · {room.name}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => stepDay(-1)} disabled={focusDay === days[0]} className="grid size-10 place-items-center rounded-xl border border-slate-200 disabled:opacity-30" aria-label="Previous day"><ChevronLeft className="size-4" /></button>
          <div className="min-w-0 text-center"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Schedule v{currentScheduleVersion}</p><h2 className="truncate text-lg font-semibold">{focusDay}</h2></div>
          <button type="button" onClick={() => stepDay(1)} disabled={focusDay === days[days.length - 1]} className="grid size-10 place-items-center rounded-xl border border-slate-200 disabled:opacity-30" aria-label="Next day"><ChevronRight className="size-4" /></button>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
          {([[1, "1 Day"], [2, "2 Day"], [3, "3 Day"], ["week", "Week"]] as const).map(([mode, label]) => (
            <button key={label} type="button" onClick={() => setViewMode(mode)} className={`min-h-9 rounded-lg px-2 text-xs font-semibold ${viewMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
          ))}
        </div>

        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Rooms</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button type="button" onClick={() => setRoomFilter("ALL")} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold ${roomFilter === "ALL" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>All rooms</button>
            {state.rooms.map((room) => <button key={room.id} type="button" onClick={() => setRoomFilter(room.id)} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold ${roomFilter === room.id ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>{room.name}</button>)}
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">Class height follows class length. Drag an unlocked class to another 15-minute slot or room. In All rooms, each room has its own timeline.</p>
      </section>

      {notice ? <div className={`rounded-xl border p-3 text-sm ${notice.startsWith("Move blocked") ? "border-red-200 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>{notice}</div> : null}

      {viewMode === "week" ? (
        <div className="space-y-3">
          {days.map((day) => (
            <section key={day} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between"><h3 className="font-semibold">{day}</h3><span className="text-xs text-slate-500">{assignmentsFor(day).length} classes</span></div>
              <div className="mt-2 space-y-2">
                {visibleRooms.map((room) => {
                  const list = assignmentsFor(day, room.id);
                  return <div key={room.id} className="rounded-xl bg-slate-50 p-2.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{room.name}</p><div className="mt-1.5 space-y-1">{list.map((assignment) => <button key={assignment.id} type="button" onClick={() => setDetails(assignment)} className="flex w-full items-center gap-2 text-left text-xs"><span>{subjectMarker(klass(assignment)?.subject, klass(assignment)?.name)}</span><span className="min-w-0 flex-1 truncate font-medium">{klass(assignment)?.name}</span><span className="shrink-0 text-slate-500">{pretty(assignment.startTime)}</span></button>)}{!list.length ? <p className="text-xs text-slate-400">No classes</p> : null}</div></div>;
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
          {visibleDays.map((day) => (
            <section key={day} className="snap-start space-y-3" style={{ flex: viewMode === 1 ? "0 0 100%" : "0 0 82%" }}>
              <div className="sticky top-[68px] z-10 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur"><div className="flex items-center justify-between"><strong>{day}</strong><span className="text-xs text-slate-500">{assignmentsFor(day).length} classes</span></div></div>
              {visibleRooms.map((room) => roomTimeline(day, room))}
            </section>
          ))}
        </div>
      )}

      {details ? (
        <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/45">
          <button className="absolute inset-0" aria-label="Close class details" onClick={() => setDetails(null)} />
          <section className="relative w-full rounded-t-[28px] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Class details</p><h2 className="mt-1 text-xl font-semibold">{subjectMarker(klass(details)?.subject, klass(details)?.name)} {klass(details)?.name}</h2></div>
              <button type="button" onClick={() => setDetails(null)} className="grid size-10 place-items-center rounded-xl border border-slate-200"><X className="size-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-400">Time</span><strong>{pretty(details.startTime)}–{pretty(details.endTime)}</strong></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-400">Duration</span><strong>{toMinutes(details.endTime) - toMinutes(details.startTime)} min</strong></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-400">Room</span><strong>{roomMap.get(details.roomId)?.name}</strong></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-400">Teacher</span><strong>{teacherMap.get(details.teacherId)?.name}</strong></div>
            </div>
            <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">{details.locked ? "This class is locked and cannot be dragged." : canEdit && !scheduleIsStale ? "Close this panel, then press and drag the class block to move it. The duration stays fixed and the move is validated before saving." : "This schedule is currently read-only for your account or needs revalidation before edits."}</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}

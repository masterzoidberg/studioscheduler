"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GripVertical,
  LockKeyhole,
  Pencil,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import type { Assignment, Day, SchedulePatch } from "@/lib/domain";
import { applyAssignmentChanges, validateSchedule } from "@/lib/validator";
import { useWorkspace } from "@/components/workspace-provider";
import { getBrowserSupabase } from "@/lib/supabase";
import { safeTeacherColor, subjectMarker, translucentHex } from "@/lib/schedule-visuals";

const days: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type ViewMode = 1 | 2 | 3 | "week";

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

const pretty = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
};

const asTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const samePlacement = (a: Assignment, b: Assignment) =>
  a.day === b.day &&
  a.startTime === b.startTime &&
  a.endTime === b.endTime &&
  a.roomId === b.roomId &&
  a.teacherId === b.teacherId;

function windowFor(day: Day) {
  return day === "Saturday" ? { start: 9 * 60, end: 15 * 60 } : { start: 16 * 60 + 15, end: 22 * 60 };
}

export function ScheduleView() {
  const {
    state,
    currentAssignments,
    currentScheduleVersion,
    currentRulebookVersion,
    currentScheduleRulebookVersion,
    scheduleIsStale,
    validation,
    applySchedulePatch,
    rebaseSchedule,
    canEdit,
  } = useWorkspace();

  const [day, setDay] = useState<Day>("Monday");
  const [viewMode, setViewMode] = useState<ViewMode>(1);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [draft, setDraft] = useState<Assignment | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [moveSaving, setMoveSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<Assignment | null>(null);
  const [teacherColors, setTeacherColors] = useState<Record<string, string>>({});

  const scheduleScrollerRef = useRef<HTMLDivElement | null>(null);
  const panStateRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const classDragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!state?.studioId) return;
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
  }, [state?.studioId]);

  if (!state) return null;

  const classMap = new Map(state.classes.map((item) => [item.id, item]));
  const sessionMap = new Map(state.sessions.map((item) => [item.id, item]));
  const teacherMap = new Map(state.teachers.map((item) => [item.id, item]));
  const roomMap = new Map(state.rooms.map((item) => [item.id, item]));
  const klass = (assignment: Assignment) => classMap.get(sessionMap.get(assignment.sessionId)?.classId || "");
  const assignmentsFor = (targetDay: Day) =>
    currentAssignments
      .filter((assignment) => assignment.day === targetDay)
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const teacherColor = (teacherId: string) =>
    safeTeacherColor(teacherColors[teacherId] || teacherMap.get(teacherId)?.displayColor, teacherId);

  const dayAssignments = assignmentsFor(day);
  const preview = draft ? validateSchedule(state, applyAssignmentChanges(currentAssignments, draft.id, draft)) : null;
  const related = editing ? validation.violations.filter((violation) => violation.assignmentIds.includes(editing.id)) : [];
  const dragValidation = dragPreview
    ? validateSchedule(state, applyAssignmentChanges(currentAssignments, dragPreview.id, dragPreview))
    : null;
  const dragAllowed = dragValidation
    ? validation.hardViolations === 0
      ? dragValidation.hardViolations === 0
      : dragValidation.hardViolations < validation.hardViolations
    : false;
  const health = scheduleIsStale
    ? "STALE RULEBOOK"
    : !validation.valid
      ? "DETECTED CONFLICTS"
      : validation.fullyValidated
        ? "FULLY VALIDATED"
        : "PARTIALLY VALIDATED";

  const slotHeight = 28;
  const weekSlotHeight = 14;

  function begin(assignment: Assignment) {
    setEditing(assignment);
    setDraft({ ...assignment });
    setReason("");
    setNotice("");
  }

  async function save() {
    if (!draft || !editing) return;
    setSaving(true);
    const changes: Partial<Assignment> = {
      day: draft.day,
      startTime: draft.startTime,
      endTime: draft.endTime,
      teacherId: draft.teacherId,
      roomId: draft.roomId,
    };
    const patch: SchedulePatch = {
      id: "schedule-edit",
      operation: "MOVE",
      assignmentId: draft.id,
      changes,
      reason: reason.trim() || `Edited ${klass(draft)?.name || draft.id}`,
      proposedBy: "USER",
    };
    const result = await applySchedulePatch(patch);
    setSaving(false);
    if (!result.ok) {
      const detail = result.validation?.violations.find((item) => item.severity === "HARD")?.message;
      setNotice(detail || result.error || "Change blocked.");
      return;
    }
    setNotice(`Saved as Schedule v${result.version}.`);
    setEditing(null);
    setDraft(null);
  }

  function scrollToDay(targetDay: Day) {
    setDay(targetDay);
    const scroller = scheduleScrollerRef.current;
    if (!scroller) return;
    const panel = scroller.querySelector<HTMLElement>(`[data-schedule-day="${targetDay}"]`);
    if (!panel) return;
    scroller.scrollTo({ left: panel.offsetLeft - scroller.offsetLeft, behavior: "smooth" });
  }

  function stepDay(delta: number) {
    const index = days.indexOf(day);
    const next = days[Math.max(0, Math.min(days.length - 1, index + delta))];
    scrollToDay(next);
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    if ((event.target as HTMLElement).closest("button")) return;
    const scroller = event.currentTarget;
    panStateRef.current = { active: true, startX: event.clientX, scrollLeft: scroller.scrollLeft };
    scroller.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panStateRef.current.active) return;
    event.currentTarget.scrollLeft = panStateRef.current.scrollLeft - (event.clientX - panStateRef.current.startX);
  }

  function handleCanvasPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panStateRef.current.active) return;
    panStateRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function startClassDrag(event: ReactPointerEvent<HTMLButtonElement>, assignment: Assignment) {
    event.stopPropagation();
    if (!canEdit || assignment.locked || scheduleIsStale || moveSaving) return;
    classDragRef.current = {
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

  function autoPanDuringClassDrag(clientX: number) {
    const scroller = scheduleScrollerRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const edge = 70;
    if (clientX < rect.left + edge) scroller.scrollLeft -= 24;
    if (clientX > rect.right - edge) scroller.scrollLeft += 24;
  }

  function moveClassDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = classDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && distance < 6) return;
    drag.moved = true;
    autoPanDuringClassDrag(event.clientX);

    const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const drop = hit?.closest<HTMLElement>("[data-drop-day][data-drop-room]");
    if (!drop) return;

    const targetDay = drop.dataset.dropDay as Day | undefined;
    const targetRoom = drop.dataset.dropRoom;
    const gridStart = Number(drop.dataset.gridStart);
    const rowHeight = Number(drop.dataset.slotHeight);
    if (!targetDay || !targetRoom || !Number.isFinite(gridStart) || !Number.isFinite(rowHeight) || rowHeight <= 0) return;

    const rect = drop.getBoundingClientRect();
    const duration = toMinutes(drag.assignment.endTime) - toMinutes(drag.assignment.startTime);
    const slot = Math.round((event.clientY - rect.top) / rowHeight);
    const operating = windowFor(targetDay);
    const unclamped = gridStart + slot * 15;
    const latestStart = Math.max(operating.start, operating.end - duration);
    const start = Math.max(operating.start, Math.min(latestStart, unclamped));
    const candidate: Assignment = {
      ...drag.assignment,
      day: targetDay,
      roomId: targetRoom,
      startTime: asTime(start),
      endTime: asTime(start + duration),
    };

    if (samePlacement(candidate, drag.candidate)) return;
    drag.candidate = candidate;
    setDragPreview(candidate);
  }

  async function finishClassDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = classDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    classDragRef.current = null;
    setDraggingId(null);

    if (!drag.moved) {
      setDragPreview(null);
      begin(drag.assignment);
      return;
    }

    const candidate = drag.candidate;
    setDragPreview(null);
    if (samePlacement(candidate, drag.assignment)) return;

    const nextValidation = validateSchedule(state, applyAssignmentChanges(currentAssignments, candidate.id, candidate));
    const allowed = validation.hardViolations === 0
      ? nextValidation.hardViolations === 0
      : nextValidation.hardViolations < validation.hardViolations;
    if (!allowed) {
      const message = nextValidation.violations.find((item) => item.severity === "HARD")?.message;
      setNotice(`Move blocked: ${message || "this placement creates or fails to reduce a detected HARD conflict."}`);
      return;
    }

    setMoveSaving(true);
    setNotice(`Moving ${klass(candidate)?.name || candidate.id}…`);
    const result = await applySchedulePatch({
      id: `drag-${candidate.id}`,
      operation: "MOVE",
      assignmentId: candidate.id,
      changes: {
        day: candidate.day,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        roomId: candidate.roomId,
      },
      reason: `Dragged ${klass(candidate)?.name || candidate.id} to ${candidate.day} ${pretty(candidate.startTime)} in ${roomMap.get(candidate.roomId)?.name || candidate.roomId}`,
      proposedBy: "USER",
    });
    setMoveSaving(false);
    if (!result.ok) {
      const message = result.validation?.violations.find((item) => item.severity === "HARD")?.message;
      setNotice(`Move blocked: ${message || result.error || "server validation rejected the drop."}`);
      return;
    }
    setDay(candidate.day);
    setNotice(`Moved ${klass(candidate)?.name || candidate.id}. Saved as Schedule v${result.version}.`);
  }

  function cancelClassDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = classDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    classDragRef.current = null;
    setDraggingId(null);
    setDragPreview(null);
  }

  function classCardStyle(assignment: Assignment) {
    const color = teacherColor(assignment.teacherId);
    return {
      borderLeftColor: color,
      backgroundColor: translucentHex(color),
    };
  }

  function detailedCard(assignment: Assignment, top: number, height: number, outside: boolean) {
    const currentClass = klass(assignment);
    const teacher = teacherMap.get(assignment.teacherId);
    const marker = subjectMarker(currentClass?.subject, currentClass?.name);
    const isDragging = draggingId === assignment.id;
    return (
      <button
        key={assignment.id}
        type="button"
        onPointerDown={(event) => startClassDrag(event, assignment)}
        onPointerMove={moveClassDrag}
        onPointerUp={(event) => void finishClassDrag(event)}
        onPointerCancel={cancelClassDrag}
        className={`absolute left-1.5 right-1.5 overflow-hidden rounded-lg border border-slate-200 border-l-[5px] p-2 text-left shadow-sm transition-opacity focus:outline-none focus:ring-2 focus:ring-slate-950/30 ${
          assignment.locked || !canEdit || scheduleIsStale ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
        } ${isDragging ? "opacity-25" : "opacity-100"}`}
        style={{
          ...classCardStyle(assignment),
          top: Math.max(0, top),
          height: Math.max(36, height),
          touchAction: assignment.locked || !canEdit || scheduleIsStale ? "auto" : "none",
        }}
        aria-label={`${currentClass?.name || assignment.sessionId}, ${teacher?.name || "teacher"}, ${pretty(assignment.startTime)} to ${pretty(assignment.endTime)}${assignment.locked ? ", locked" : ", drag to move or tap to edit"}`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {assignment.locked ? <LockKeyhole className="size-3 shrink-0 text-slate-500" /> : <GripVertical className="size-3 shrink-0 text-slate-400" />}
          <span className="shrink-0 text-sm" aria-hidden="true">{marker}</span>
          <span className="truncate text-xs font-bold text-slate-900">{currentClass?.name || assignment.sessionId}</span>
        </div>
        {height >= 54 ? (
          <p className="mt-1 truncate text-[11px] font-medium text-slate-700">{teacher?.name}</p>
        ) : null}
        {height >= 78 ? (
          <p className="mt-0.5 truncate text-[10px] text-slate-500">
            {pretty(assignment.startTime)}–{pretty(assignment.endTime)}
          </p>
        ) : null}
        {outside ? <p className="mt-1 text-[9px] font-semibold text-red-700">Outside visible operating window</p> : null}
      </button>
    );
  }

  const detailCount = viewMode === "week" ? 1 : viewMode;
  const detailPanelWidth = detailCount === 1 ? "100%" : detailCount === 2 ? "50%" : "33.333333%";
  const detailPanelMinWidth = detailCount === 1 ? "100%" : detailCount === 2 ? "540px" : "410px";

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm leading-6 text-slate-600">
            Drag an unlocked class to another 15-minute slot or room. Every accepted drop is revalidated and saved as a new ScheduleVersion.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-950 px-3 py-1.5 font-semibold text-white">Schedule v{currentScheduleVersion}</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">Current Rulebook v{currentRulebookVersion}</span>
            <span
              className={`rounded-full border px-3 py-1.5 ${
                scheduleIsStale
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : validation.valid
                    ? "border-blue-200 bg-blue-50 text-blue-800"
                    : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {health}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
              {validation.coverage.implementedHardRules}/{validation.coverage.applicableHardRules} HARD enforced
            </span>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">Schedule linked to Rulebook v{currentScheduleRulebookVersion}</div>
      </section>

      {notice ? (
        <section className={`rounded-xl border p-3 text-sm ${notice.startsWith("Move blocked") ? "border-red-200 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>
          {notice}
        </section>
      ) : null}

      {scheduleIsStale ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <strong>Rulebook changed after this schedule version.</strong>
              <p className="mt-1 leading-6">Revalidate the unchanged assignments before moving classes.</p>
            </div>
            {canEdit ? (
              <button
                onClick={() => void rebaseSchedule()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-amber-950 px-4 font-semibold text-white"
              >
                <RefreshCw className="size-4" />
                Revalidate
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Schedule view</p>
            <p className="mt-1 text-sm text-slate-600">Focus on one day, compare adjacent days, or scan the full week.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              [1, "1 Day"],
              [2, "2 Days"],
              [3, "3 Days"],
              ["week", "Week"],
            ] as const).map(([mode, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`min-h-10 rounded-xl px-4 text-sm font-semibold ${
                  viewMode === mode ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => stepDay(-1)}
            disabled={day === days[0]}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-30"
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {days.map((targetDay) => (
              <button
                key={targetDay}
                type="button"
                onClick={() => scrollToDay(targetDay)}
                className={`min-h-10 shrink-0 rounded-xl px-4 text-sm font-semibold ${
                  day === targetDay ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {targetDay}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => stepDay(1)}
            disabled={day === days[days.length - 1]}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-30"
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          {viewMode === "week"
            ? "Week view is for scanning. Tap a class for details; use a detailed view to drag it."
            : "Each horizontal line is 15 minutes. Drag class cards to move them; drag empty canvas space horizontally to pan through days."}
        </p>
      </section>

      <div className="md:hidden">
        <div className="space-y-3">
          {dayAssignments.map((assignment) => {
            const currentClass = klass(assignment);
            const color = teacherColor(assignment.teacherId);
            return (
              <button
                key={assignment.id}
                onClick={() => begin(assignment)}
                className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm"
              >
                <div className="h-1.5" style={{ backgroundColor: color }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        {assignment.locked ? <LockKeyhole className="size-3.5 text-slate-500" /> : null}
                        <span aria-hidden="true">{subjectMarker(currentClass?.subject, currentClass?.name)}</span>
                        <h3 className="font-semibold">{currentClass?.name || assignment.sessionId}</h3>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{pretty(assignment.startTime)}–{pretty(assignment.endTime)}</p>
                    </div>
                    <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold">{roomMap.get(assignment.roomId)?.name}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
                      {teacherMap.get(assignment.teacherId)?.name}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3.5" />
                      {currentClass?.durationMinutes} min
                    </span>
                    <span>{currentClass?.level}</span>
                  </div>
                </div>
              </button>
            );
          })}
          {dayAssignments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
              No assignments on {day} yet.
            </div>
          ) : null}
        </div>
      </div>

      {viewMode !== "week" ? (
        <div
          ref={scheduleScrollerRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerEnd}
          onPointerCancel={handleCanvasPointerEnd}
          className="hidden cursor-grab snap-x snap-mandatory overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100/70 pb-2 active:cursor-grabbing md:flex"
        >
          {days.map((targetDay) => {
            const operating = windowFor(targetDay);
            const rows = Math.ceil((operating.end - operating.start) / 15);
            const gridHeight = rows * slotHeight;
            const targetAssignments = assignmentsFor(targetDay);
            const roomColumnMinimum = detailCount === 1 ? 190 : detailCount === 2 ? 145 : 112;
            const gridTemplateColumns = `66px repeat(${Math.max(state.rooms.length, 1)}, minmax(${roomColumnMinimum}px, 1fr))`;

            return (
              <section
                key={targetDay}
                data-schedule-day={targetDay}
                className="snap-start border-r border-slate-200 bg-white last:border-r-0"
                style={{ flex: `0 0 ${detailPanelWidth}`, minWidth: detailPanelMinWidth }}
              >
                <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-900">{targetDay}</h2>
                      <p className="text-xs text-slate-500">{targetAssignments.length} scheduled session{targetAssignments.length === 1 ? "" : "s"}</p>
                    </div>
                    {day === targetDay ? <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-semibold text-white">FOCUS</span> : null}
                  </div>
                </div>

                <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns }}>
                  <div className="p-2 text-[10px] font-semibold text-slate-500">TIME</div>
                  {state.rooms.map((room) => (
                    <div key={room.id} className="border-l border-slate-200 p-2 text-center">
                      <p className="truncate text-xs font-semibold">{room.name}</p>
                    </div>
                  ))}
                </div>

                <div className="grid" style={{ gridTemplateColumns }}>
                  <div className="border-r border-slate-200 bg-slate-50">
                    {Array.from({ length: rows }, (_, index) => {
                      const total = operating.start + index * 15;
                      return (
                        <div key={total} className="border-b border-slate-200/70 px-1.5 pt-1 text-[9px] text-slate-500" style={{ height: slotHeight }}>
                          {pretty(asTime(total))}
                        </div>
                      );
                    })}
                  </div>

                  {state.rooms.map((room) => (
                    <div
                      key={room.id}
                      data-drop-day={targetDay}
                      data-drop-room={room.id}
                      data-grid-start={operating.start}
                      data-slot-height={slotHeight}
                      className="relative border-r border-slate-200 last:border-r-0"
                      style={{
                        height: gridHeight,
                        backgroundImage: "linear-gradient(to bottom, rgba(148,163,184,.34) 1px, transparent 1px)",
                        backgroundSize: `100% ${slotHeight}px`,
                      }}
                    >
                      {targetAssignments
                        .filter((assignment) => assignment.roomId === room.id)
                        .map((assignment) => {
                          const top = ((toMinutes(assignment.startTime) - operating.start) / 15) * slotHeight;
                          const height = ((toMinutes(assignment.endTime) - toMinutes(assignment.startTime)) / 15) * slotHeight;
                          const outside = top < 0 || top + height > gridHeight;
                          return detailedCard(assignment, top, height, outside);
                        })}

                      {dragPreview && dragPreview.day === targetDay && dragPreview.roomId === room.id ? (
                        <div
                          className={`pointer-events-none absolute left-1 right-1 z-10 rounded-lg border-2 border-dashed p-2 shadow-lg ${
                            dragAllowed ? "border-emerald-500 bg-emerald-50/90" : "border-red-500 bg-red-50/90"
                          }`}
                          style={{
                            top: ((toMinutes(dragPreview.startTime) - operating.start) / 15) * slotHeight,
                            height: Math.max(36, ((toMinutes(dragPreview.endTime) - toMinutes(dragPreview.startTime)) / 15) * slotHeight),
                          }}
                        >
                          <p className="truncate text-xs font-bold text-slate-900">
                            {dragAllowed ? "✓" : "✕"} {subjectMarker(klass(dragPreview)?.subject, klass(dragPreview)?.name)} {klass(dragPreview)?.name}
                          </p>
                          <p className="mt-1 truncate text-[10px] text-slate-600">{pretty(dragPreview.startTime)} · {room.name}</p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
          <div className="grid min-w-[960px] grid-cols-6 divide-x divide-slate-200">
            {days.map((targetDay) => {
              const operating = windowFor(targetDay);
              const rows = Math.ceil((operating.end - operating.start) / 15);
              const height = rows * weekSlotHeight;
              const targetAssignments = assignmentsFor(targetDay);
              return (
                <section key={targetDay} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode(1);
                      setTimeout(() => scrollToDay(targetDay), 0);
                    }}
                    className="w-full border-b border-slate-200 bg-slate-50 p-3 text-left"
                  >
                    <p className="font-semibold">{targetDay}</p>
                    <p className="text-xs text-slate-500">{targetAssignments.length} sessions</p>
                  </button>
                  <div className="grid grid-cols-3 divide-x divide-slate-100">
                    {state.rooms.slice(0, 3).map((room) => (
                      <div key={room.id}>
                        <div className="truncate border-b border-slate-100 p-1.5 text-center text-[9px] font-semibold text-slate-500">{room.name}</div>
                        <div
                          className="relative"
                          style={{
                            height,
                            backgroundImage: "linear-gradient(to bottom, rgba(148,163,184,.23) 1px, transparent 1px)",
                            backgroundSize: `100% ${weekSlotHeight}px`,
                          }}
                        >
                          {targetAssignments
                            .filter((assignment) => assignment.roomId === room.id)
                            .map((assignment) => {
                              const currentClass = klass(assignment);
                              const top = ((toMinutes(assignment.startTime) - operating.start) / 15) * weekSlotHeight;
                              const cardHeight = Math.max(16, ((toMinutes(assignment.endTime) - toMinutes(assignment.startTime)) / 15) * weekSlotHeight);
                              const color = teacherColor(assignment.teacherId);
                              return (
                                <button
                                  key={assignment.id}
                                  type="button"
                                  onClick={() => begin(assignment)}
                                  className="absolute left-0.5 right-0.5 overflow-hidden rounded border border-slate-200 border-l-[4px] px-1 py-0.5 text-left shadow-sm"
                                  style={{ top: Math.max(0, top), height: cardHeight, borderLeftColor: color, backgroundColor: translucentHex(color) }}
                                  title={`${currentClass?.name} · ${teacherMap.get(assignment.teacherId)?.name} · ${pretty(assignment.startTime)}`}
                                >
                                  <span className="block truncate text-[9px] font-bold">
                                    {subjectMarker(currentClass?.subject, currentClass?.name)} {currentClass?.name}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {!validation.valid ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <h2 className="font-semibold text-red-900">Detected HARD violations</h2>
          <div className="mt-3 space-y-2">
            {validation.violations
              .filter((item) => item.severity === "HARD")
              .slice(0, 12)
              .map((item, index) => (
                <div key={`${item.constraintId}-${index}`} className="rounded-xl bg-white/70 p-3 text-sm text-red-900">
                  <strong>{item.constraintId}</strong>
                  <span className="ml-2">{item.message}</span>
                </div>
              ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <ShieldCheck className="mr-2 inline size-4" />
          No HARD conflicts are detected by the {validation.coverage.implementedHardRules} implemented HARD rules. {validation.coverage.notImplementedHardRules} applicable HARD rules still await machine enforcement.
        </section>
      )}

      {draft && editing ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6">
          <div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Assignment inspector</p>
                <h2 className="mt-1 text-xl font-semibold">
                  {subjectMarker(klass(draft)?.subject, klass(draft)?.name)} {klass(draft)?.name}
                </h2>
              </div>
              <button onClick={() => { setEditing(null); setDraft(null); }} className="grid size-10 place-items-center rounded-xl">
                <X className="size-5" />
              </button>
            </div>

            {editing.locked ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <LockKeyhole className="mr-2 inline size-4" />
                This placement is locked. The server will reject attempts to move it too.
              </div>
            ) : null}
            {!canEdit ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Viewer access is read-only.</div> : null}

            <div className="mt-5 grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">
                  Day
                  <select
                    disabled={!canEdit || editing.locked || scheduleIsStale}
                    value={draft.day}
                    onChange={(event) => setDraft({ ...draft, day: event.target.value as Day })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"
                  >
                    {days.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Room
                  <select
                    disabled={!canEdit || editing.locked || scheduleIsStale}
                    value={draft.roomId}
                    onChange={(event) => setDraft({ ...draft, roomId: event.target.value })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"
                  >
                    {state.rooms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-slate-600">
                  Start
                  <input
                    disabled={!canEdit || editing.locked || scheduleIsStale}
                    type="time"
                    step={900}
                    value={draft.startTime}
                    onChange={(event) => {
                      const duration = klass(draft)?.durationMinutes ?? (toMinutes(draft.endTime) - toMinutes(draft.startTime));
                      const start = toMinutes(event.target.value);
                      setDraft({ ...draft, startTime: event.target.value, endTime: asTime(start + duration) });
                    }}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                  />
                </label>
                <div className="text-xs font-semibold text-slate-600">
                  Duration
                  <div className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-600">
                    {klass(draft)?.durationMinutes ?? toMinutes(draft.endTime) - toMinutes(draft.startTime)} minutes · ends {pretty(draft.endTime)}
                  </div>
                </div>
              </div>

              <label className="text-xs font-semibold text-slate-600">
                Teacher
                <select
                  disabled={!canEdit || editing.locked || scheduleIsStale}
                  value={draft.teacherId}
                  onChange={(event) => setDraft({ ...draft, teacherId: event.target.value })}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"
                >
                  {state.teachers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                </select>
              </label>

              <div className={`rounded-xl border p-4 ${preview && (validation.hardViolations === 0 ? preview.hardViolations === 0 : preview.hardViolations < validation.hardViolations) ? "border-blue-200 bg-blue-50" : "border-red-200 bg-red-50"}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {preview && (validation.hardViolations === 0 ? preview.hardViolations === 0 : preview.hardViolations < validation.hardViolations)
                    ? <CheckCircle2 className="size-4 text-blue-600" />
                    : <AlertTriangle className="size-4 text-red-600" />}
                  Proposed move preview
                </div>
                <p className="mt-2 text-sm text-slate-700">
                  {preview?.hardViolations || 0} detected HARD violation(s). Coverage remains {preview?.coverage.implementedHardRules || 0}/{preview?.coverage.applicableHardRules || 0} applicable HARD rules.
                </p>
                {preview && preview.hardViolations > 0 ? (
                  <div className="mt-3 space-y-1 text-xs text-red-800">
                    {preview.violations.filter((item) => item.severity === "HARD").slice(0, 5).map((item, index) => <p key={index}>• {item.message}</p>)}
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-slate-500">The database reruns the implemented HARD checks before committing.</p>
              </div>

              {related.length ? (
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-600">Current findings for this assignment</p>
                  {related.map((item, index) => <p key={index} className="mt-1 text-xs text-slate-600">• {item.message}</p>)}
                </div>
              ) : null}

              <label className="text-xs font-semibold text-slate-600">
                Reason
                <input
                  disabled={!canEdit || editing.locked || scheduleIsStale}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Optional note about this move"
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                />
              </label>

              <div className="flex gap-2">
                <button onClick={() => { setEditing(null); setDraft(null); }} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Close</button>
                <button
                  disabled={!canEdit || editing.locked || scheduleIsStale || saving || !preview || (validation.hardViolations === 0 ? preview.hardViolations > 0 : preview.hardViolations >= validation.hardViolations)}
                  onClick={() => void save()}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-40"
                >
                  <Pencil className="size-4" />
                  {saving ? "Saving…" : "Save new schedule version"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

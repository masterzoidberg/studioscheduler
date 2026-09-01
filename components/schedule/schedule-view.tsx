"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
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

const days: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type ViewMode = 1 | 2 | 3 | "week";

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
  const scheduleScrollerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef({ active: false, startX: 0, scrollLeft: 0 });

  if (!state) return null;

  const classMap = new Map(state.classes.map((item) => [item.id, item]));
  const sessionMap = new Map(state.sessions.map((item) => [item.id, item]));
  const teacherMap = new Map(state.teachers.map((item) => [item.id, item]));
  const roomMap = new Map(state.rooms.map((item) => [item.id, item]));
  const klass = (assignment: Assignment) => classMap.get(sessionMap.get(assignment.sessionId)?.classId || "");
  const assignmentsFor = (targetDay: Day) =>
    currentAssignments.filter((assignment) => assignment.day === targetDay).sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  const dayAssignments = assignmentsFor(day);
  const preview = draft ? validateSchedule(state, applyAssignmentChanges(currentAssignments, draft.id, draft)) : null;
  const related = editing ? validation.violations.filter((violation) => violation.assignmentIds.includes(editing.id)) : [];
  const health = scheduleIsStale
    ? "STALE RULEBOOK"
    : !validation.valid
      ? "DETECTED CONFLICTS"
      : validation.fullyValidated
        ? "FULLY VALIDATED"
        : "PARTIALLY VALIDATED";

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
      setNotice(result.error || "Change blocked.");
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

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    if ((event.target as HTMLElement).closest("button")) return;
    const scroller = event.currentTarget;
    dragStateRef.current = { active: true, startX: event.clientX, scrollLeft: scroller.scrollLeft };
    scroller.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStateRef.current.active) return;
    event.currentTarget.scrollLeft =
      dragStateRef.current.scrollLeft - (event.clientX - dragStateRef.current.startX);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStateRef.current.active) return;
    dragStateRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const detailCount = viewMode === "week" ? 1 : viewMode;
  const detailPanelWidth = detailCount === 1 ? "100%" : detailCount === 2 ? "50%" : "33.333333%";
  const detailPanelMinWidth = detailCount === 1 ? "100%" : detailCount === 2 ? "520px" : "390px";
  const slotHeight = 28;
  const weekSlotHeight = 14;

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm leading-6 text-slate-600">
            Every room, teacher, and dancer view is derived from these canonical assignments.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-950 px-3 py-1.5 font-semibold text-white">
              Schedule v{currentScheduleVersion}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
              Current Rulebook v{currentRulebookVersion}
            </span>
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
        <div className="text-right text-xs text-slate-500">
          Schedule linked to Rulebook v{currentScheduleRulebookVersion}
        </div>
      </section>

      {scheduleIsStale ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <strong>Rulebook changed after this schedule version.</strong>
              <p className="mt-1 leading-6">
                Revalidate the unchanged assignments against Rulebook v{currentRulebookVersion} before making another schedule edit.
              </p>
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
            <p className="mt-1 text-sm text-slate-600">
              Use a focused day, compare adjacent days, or zoom out to the whole week.
            </p>
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
                  viewMode === mode
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
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

        {viewMode !== "week" ? (
          <p className="mt-2 text-xs text-slate-400">
            Swipe on touch screens or drag the empty canvas horizontally with a mouse to move through days.
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-400">
            Week view is a compact overview. Select any class to open the full assignment inspector.
          </p>
        )}
      </section>

      <div className="md:hidden">
        <div className="space-y-3">
          {dayAssignments.map((assignment) => {
            const currentClass = klass(assignment);
            return (
              <button
                key={assignment.id}
                onClick={() => begin(assignment)}
                className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {assignment.locked ? <LockKeyhole className="size-3.5 text-slate-500" /> : null}
                      <h3 className="font-semibold">{currentClass?.name || assignment.sessionId}</h3>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {pretty(assignment.startTime)}–{pretty(assignment.endTime)}
                    </p>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold">
                    {roomMap.get(assignment.roomId)?.name}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="size-3.5" />
                    {teacherMap.get(assignment.teacherId)?.name}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="size-3.5" />
                    {currentClass?.durationMinutes} min
                  </span>
                  <span>{currentClass?.level}</span>
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
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          className="hidden cursor-grab snap-x snap-mandatory overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100/70 pb-2 active:cursor-grabbing md:flex"
        >
          {days.map((targetDay) => {
            const operating = windowFor(targetDay);
            const rows = Math.ceil((operating.end - operating.start) / 15);
            const gridHeight = rows * slotHeight;
            const targetAssignments = assignmentsFor(targetDay);
            const roomColumnMinimum = detailCount === 1 ? 180 : detailCount === 2 ? 130 : 105;
            const gridTemplateColumns = `62px repeat(${Math.max(state.rooms.length, 1)}, minmax(${roomColumnMinimum}px, 1fr))`;

            return (
              <section
                key={targetDay}
                data-schedule-day={targetDay}
                className="snap-start border-r border-slate-200 bg-white last:border-r-0"
                style={{ flex: `0 0 ${detailPanelWidth}`, minWidth: detailPanelMinWidth }}
              >
                <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-950">{targetDay}</h2>
                      <p className="text-xs text-slate-500">
                        {pretty(asTime(operating.start))}–{pretty(asTime(operating.end))}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      {targetAssignments.length} classes
                    </span>
                  </div>
                </div>

                <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns }}>
                  <div className="p-2 text-[10px] font-semibold text-slate-500">TIME</div>
                  {state.rooms.map((room) => (
                    <div key={room.id} className="border-l border-slate-200 p-2">
                      <p className="truncate text-xs font-semibold">{room.name}</p>
                    </div>
                  ))}
                </div>

                <div className="grid" style={{ gridTemplateColumns }}>
                  <div className="border-r border-slate-200 bg-slate-50">
                    {Array.from({ length: rows }, (_, index) => {
                      const total = operating.start + index * 15;
                      return (
                        <div
                          key={total}
                          className="border-b border-slate-100 px-1.5 pt-1 text-[9px] text-slate-400"
                          style={{ height: slotHeight }}
                        >
                          {index % 2 === 0 ? pretty(asTime(total)).replace(" ", " ") : ""}
                        </div>
                      );
                    })}
                  </div>

                  {state.rooms.map((room) => (
                    <div
                      key={room.id}
                      className="relative border-r border-slate-200 last:border-r-0"
                      style={{
                        height: gridHeight,
                        backgroundImage: "linear-gradient(to bottom,#e2e8f0 1px,transparent 1px)",
                        backgroundSize: `100% ${slotHeight}px`,
                      }}
                    >
                      {targetAssignments
                        .filter((assignment) => assignment.roomId === room.id)
                        .map((assignment) => {
                          const currentClass = klass(assignment);
                          const top = ((toMinutes(assignment.startTime) - operating.start) / 15) * slotHeight;
                          const naturalHeight =
                            ((toMinutes(assignment.endTime) - toMinutes(assignment.startTime)) / 15) * slotHeight;
                          const height = Math.max(slotHeight * 2, naturalHeight);
                          const outside = top < 0 || top + height > gridHeight;

                          return (
                            <button
                              key={assignment.id}
                              type="button"
                              onClick={() => begin(assignment)}
                              title={`${currentClass?.name || assignment.sessionId} · ${teacherMap.get(assignment.teacherId)?.name || ""} · ${pretty(assignment.startTime)}–${pretty(assignment.endTime)}`}
                              className={`absolute left-1.5 right-1.5 overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-sm ${
                                outside
                                  ? "border-red-300 bg-red-50"
                                  : assignment.locked
                                    ? "border-slate-300 bg-slate-100"
                                    : "border-blue-200 bg-blue-50"
                              }`}
                              style={{
                                top: Math.max(0, top),
                                height: Math.min(height, Math.max(slotHeight * 2, gridHeight - Math.max(0, top))),
                              }}
                            >
                              <div className="flex items-center gap-1">
                                {assignment.locked ? <LockKeyhole className="size-2.5 shrink-0" /> : null}
                                <span className="truncate text-[11px] font-semibold">{currentClass?.name}</span>
                              </div>
                              {height >= slotHeight * 3 ? (
                                <p className="mt-0.5 truncate text-[10px] text-slate-600">
                                  {teacherMap.get(assignment.teacherId)?.name}
                                </p>
                              ) : null}
                              {height >= slotHeight * 4 ? (
                                <p className="truncate text-[9px] text-slate-500">
                                  {pretty(assignment.startTime)}–{pretty(assignment.endTime)}
                                </p>
                              ) : null}
                              {outside ? (
                                <p className="mt-1 text-[9px] font-semibold text-red-700">Outside operating window</p>
                              ) : null}
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 md:block">
          <div className="grid min-w-[1040px] grid-cols-6 gap-2">
            {days.map((targetDay) => {
              const operating = windowFor(targetDay);
              const rows = Math.ceil((operating.end - operating.start) / 15);
              const gridHeight = rows * weekSlotHeight;
              const targetAssignments = assignmentsFor(targetDay);
              const roomCount = Math.max(state.rooms.length, 1);

              return (
                <section key={targetDay} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode(1);
                      requestAnimationFrame(() => scrollToDay(targetDay));
                    }}
                    className={`w-full rounded-xl px-2 py-2 text-left ${
                      day === targetDay ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    <p className="text-sm font-semibold">{targetDay}</p>
                    <p className={`text-[10px] ${day === targetDay ? "text-slate-300" : "text-slate-500"}`}>
                      {targetAssignments.length} classes
                    </p>
                  </button>

                  <div
                    className="relative mt-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                    style={{
                      height: gridHeight,
                      backgroundImage: "linear-gradient(to bottom,#e2e8f0 1px,transparent 1px)",
                      backgroundSize: `100% ${weekSlotHeight}px`,
                    }}
                  >
                    {Array.from({ length: rows }, (_, index) => {
                      if (index % 4 !== 0) return null;
                      const total = operating.start + index * 15;
                      return (
                        <span
                          key={total}
                          className="pointer-events-none absolute left-1 z-[2] text-[8px] font-medium text-slate-400"
                          style={{ top: index * weekSlotHeight + 1 }}
                        >
                          {pretty(asTime(total)).replace(":00", "")}
                        </span>
                      );
                    })}

                    {targetAssignments.map((assignment) => {
                      const currentClass = klass(assignment);
                      const roomIndex = Math.max(
                        0,
                        state.rooms.findIndex((room) => room.id === assignment.roomId),
                      );
                      const top = ((toMinutes(assignment.startTime) - operating.start) / 15) * weekSlotHeight;
                      const height = Math.max(
                        weekSlotHeight * 2,
                        ((toMinutes(assignment.endTime) - toMinutes(assignment.startTime)) / 15) * weekSlotHeight,
                      );
                      const laneWidth = 72 / roomCount;
                      const left = 26 + roomIndex * laneWidth;

                      return (
                        <button
                          key={assignment.id}
                          type="button"
                          onClick={() => {
                            setDay(targetDay);
                            begin(assignment);
                          }}
                          title={`${currentClass?.name || assignment.sessionId} · ${teacherMap.get(assignment.teacherId)?.name || ""} · ${roomMap.get(assignment.roomId)?.name || ""} · ${pretty(assignment.startTime)}–${pretty(assignment.endTime)}`}
                          className={`absolute overflow-hidden rounded-md border px-1 py-0.5 text-left shadow-sm ${
                            assignment.locked
                              ? "border-slate-300 bg-slate-200"
                              : "border-blue-200 bg-blue-100"
                          }`}
                          style={{
                            top: Math.max(0, top),
                            height: Math.min(height, Math.max(weekSlotHeight * 2, gridHeight - Math.max(0, top))),
                            left: `${left}%`,
                            width: `${Math.max(18, laneWidth - 1.5)}%`,
                          }}
                        >
                          <span className="block truncate text-[8px] font-semibold text-slate-800">
                            {currentClass?.name}
                          </span>
                          {height >= weekSlotHeight * 4 ? (
                            <span className="block truncate text-[7px] text-slate-600">
                              {teacherMap.get(assignment.teacherId)?.name}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-1 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${roomCount}, minmax(0,1fr))` }}>
                    {state.rooms.map((room) => (
                      <span key={room.id} className="truncate text-center text-[8px] font-semibold text-slate-400">
                        {room.name.replace(/^Studio\s+/i, "")}
                      </span>
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
              .filter((violation) => violation.severity === "HARD")
              .slice(0, 12)
              .map((violation, index) => (
                <div
                  key={`${violation.constraintId}-${index}`}
                  className="rounded-xl bg-white/70 p-3 text-sm text-red-900"
                >
                  <strong>{violation.constraintId}</strong>
                  <span className="ml-2">{violation.message}</span>
                </div>
              ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <ShieldCheck className="mr-2 inline size-4" />
          No HARD conflicts are detected by the {validation.coverage.implementedHardRules} implemented HARD rules.{" "}
          {validation.coverage.notImplementedHardRules} applicable HARD rules still await machine enforcement.
        </section>
      )}

      {draft && editing ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-6">
          <div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">
                  Assignment inspector
                </p>
                <h2 className="mt-1 text-xl font-semibold">{klass(draft)?.name}</h2>
              </div>
              <button onClick={() => { setEditing(null); setDraft(null); }} className="rounded-xl p-2">
                <X className="size-5" />
              </button>
            </div>

            {editing.locked ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <LockKeyhole className="mr-2 inline size-4" />
                This placement is locked. The server will reject direct attempts to move it too.
              </div>
            ) : null}

            {!canEdit ? (
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                Viewer access is read-only.
              </div>
            ) : null}

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
                    {days.map((item) => <option key={item}>{item}</option>)}
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
                    onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  End
                  <input
                    disabled={!canEdit || editing.locked || scheduleIsStale}
                    type="time"
                    step={900}
                    value={draft.endTime}
                    onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                  />
                </label>
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

              <div
                className={`rounded-xl border p-4 ${
                  preview?.valid ? "border-blue-200 bg-blue-50" : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {preview?.valid ? (
                    <CheckCircle2 className="size-4 text-blue-600" />
                  ) : (
                    <AlertTriangle className="size-4 text-red-600" />
                  )}
                  Proposed move preview
                </div>
                <p className="mt-2 text-sm text-slate-700">
                  {preview?.hardViolations || 0} detected HARD violation(s). Coverage remains{" "}
                  {preview?.coverage.implementedHardRules || 0}/{preview?.coverage.applicableHardRules || 0} applicable HARD rules.
                </p>
                {preview && !preview.valid ? (
                  <div className="mt-3 space-y-1 text-xs text-red-800">
                    {preview.violations
                      .filter((violation) => violation.severity === "HARD")
                      .slice(0, 5)
                      .map((violation, index) => <p key={index}>• {violation.message}</p>)}
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-slate-500">
                  The database independently reruns the implemented HARD checks before committing, so browser-side preview cannot bypass validation.
                </p>
              </div>

              {related.length ? (
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-600">Current findings for this assignment</p>
                  {related.map((violation, index) => (
                    <p key={index} className="mt-1 text-xs text-slate-600">• {violation.message}</p>
                  ))}
                </div>
              ) : null}

              <label className="text-xs font-semibold text-slate-600">
                Reason
                <input
                  disabled={!canEdit || editing.locked || scheduleIsStale}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is this assignment moving?"
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                />
              </label>

              {notice ? <p className="text-sm text-red-700">{notice}</p> : null}

              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(null); setDraft(null); }}
                  className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold"
                >
                  Close
                </button>
                <button
                  disabled={!canEdit || editing.locked || scheduleIsStale || saving || !preview?.valid}
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

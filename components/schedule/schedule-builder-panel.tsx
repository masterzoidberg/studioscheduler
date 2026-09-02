"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus2, CheckCircle2, ChevronDown, ChevronUp, Clock3, Inbox, RotateCcw, X } from "lucide-react";
import type { Assignment, ClassSession, Day } from "@/lib/domain";
import { validateSchedule } from "@/lib/validator";
import { getBrowserSupabase } from "@/lib/supabase";
import { assignmentIdForSession, defaultStartTime, placementEndTime, unscheduledSessions } from "@/lib/schedule-builder";
import { subjectMarker } from "@/lib/schedule-visuals";
import { useWorkspace } from "@/components/workspace-provider";
import { useScheduleEditMode } from "@/components/schedule/schedule-edit-mode";

const days: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Tab = "UNSCHEDULED" | "PLACED";

function pretty(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

function messageOf(error: unknown) {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message || "Unknown error");
  return String(error || "Unknown error");
}

export function ScheduleBuilderPanel() {
  const {
    state,
    currentAssignments,
    currentScheduleVersion,
    currentRulebookVersion,
    currentEnforcementVersion,
    scheduleIsStale,
    validation,
    refresh,
    canEdit,
  } = useWorkspace();
  const { editingEnabled } = useScheduleEditMode();

  const [expanded, setExpanded] = useState(true);
  const [tab, setTab] = useState<Tab>("UNSCHEDULED");
  const [placing, setPlacing] = useState<ClassSession | null>(null);
  const [day, setDay] = useState<Day>("Monday");
  const [startTime, setStartTime] = useState("16:45");
  const [teacherId, setTeacherId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingUnassign, setPendingUnassign] = useState<Assignment | null>(null);
  const [notice, setNotice] = useState("");

  const unscheduled = useMemo(
    () => state ? unscheduledSessions(state.sessions, currentAssignments) : [],
    [state, currentAssignments],
  );

  if (!state) return null;
  const studio = state;
  const mutationEnabled = canEdit && editingEnabled && !scheduleIsStale;

  const classMap = new Map(state.classes.map((item) => [item.id, item]));
  const sessionMap = new Map(state.sessions.map((item) => [item.id, item]));
  const teacherMap = new Map(state.teachers.map((item) => [item.id, item]));
  const roomMap = new Map(state.rooms.map((item) => [item.id, item]));
  const klassForSession = (session: ClassSession) => classMap.get(session.classId);
  const klassForAssignment = (assignment: Assignment) => classMap.get(sessionMap.get(assignment.sessionId)?.classId || "");

  const placingClass = placing ? klassForSession(placing) : undefined;
  // V2.1 eligibleTeacherIds are retained as import provenance only. They are not current Rulebook truth.
  // Until the reviewed Rulebook compiler provides canonical qualification constraints, show all teachers
  // and let implemented deterministic validation/server validation decide only what it actually knows.
  const eligibleTeachers = state.teachers;
  const endTime = placingClass ? placementEndTime(startTime, placingClass) : startTime;
  const candidate: Assignment | null = placing && placingClass && teacherId && roomId
    ? {
        id: assignmentIdForSession(placing.id),
        sessionId: placing.id,
        day,
        startTime,
        endTime,
        teacherId,
        roomId,
        locked: placing.locked,
        status: "NORMAL",
      }
    : null;
  const placementPreview = candidate ? validateSchedule(state, [...currentAssignments, candidate]) : null;
  const placementAllowed = Boolean(placementPreview && placementPreview.hardViolations <= validation.hardViolations);

  const placed = [...currentAssignments].sort((a, b) => {
    const dayDiff = days.indexOf(a.day) - days.indexOf(b.day);
    return dayDiff || a.startTime.localeCompare(b.startTime);
  });

  function beginPlace(session: ClassSession) {
    const nextDay: Day = "Monday";
    setDay(nextDay);
    setStartTime(defaultStartTime(nextDay));
    setTeacherId(studio.teachers[0]?.id || "");
    setRoomId(studio.rooms[0]?.id || "");
    setNotice("");
    setPlacing(session);
  }

  function changeDay(nextDay: Day) {
    setDay(nextDay);
    const nextDefault = defaultStartTime(nextDay);
    if (nextDay === "Saturday" && startTime > "14:45") setStartTime(nextDefault);
    if (nextDay !== "Saturday" && startTime < "16:45") setStartTime(nextDefault);
  }

  async function placeSession() {
    if (!editingEnabled || !placing || !placingClass || !candidate || !placementAllowed || scheduleIsStale) return;
    setSaving(true);
    setNotice("");
    const { data, error } = await getBrowserSupabase().rpc("apply_schedule_builder_patch_v23", {
      p_operation: "ASSIGN",
      p_assignment_id: candidate.id,
      p_session_id: placing.id,
      p_changes: {
        day: candidate.day,
        startTime: candidate.startTime,
        teacherId: candidate.teacherId,
        roomId: candidate.roomId,
        status: "NORMAL",
      },
      p_reason: `Placed ${placingClass.name} from Unscheduled`,
      p_expected_schedule_version: currentScheduleVersion,
      p_expected_rulebook_version: currentRulebookVersion,
      p_expected_enforcement_version: currentEnforcementVersion,
      p_ai_proposed: false,
    });
    setSaving(false);
    if (error) {
      setNotice(`Placement blocked: ${messageOf(error)}`);
      return;
    }
    const result = (data || {}) as Record<string, unknown>;
    setPlacing(null);
    setNotice(`Placed ${placingClass.name}. Saved as Schedule v${Number(result.scheduleVersion || currentScheduleVersion + 1)}.`);
    await refresh();
  }

  async function unassign() {
    if (!editingEnabled || !pendingUnassign || pendingUnassign.locked || scheduleIsStale) return;
    const currentClass = klassForAssignment(pendingUnassign);
    setSaving(true);
    setNotice("");
    const { data, error } = await getBrowserSupabase().rpc("apply_schedule_builder_patch_v23", {
      p_operation: "UNASSIGN",
      p_assignment_id: pendingUnassign.id,
      p_session_id: pendingUnassign.sessionId,
      p_changes: {},
      p_reason: `Moved ${currentClass?.name || pendingUnassign.sessionId} to Unscheduled`,
      p_expected_schedule_version: currentScheduleVersion,
      p_expected_rulebook_version: currentRulebookVersion,
      p_expected_enforcement_version: currentEnforcementVersion,
      p_ai_proposed: false,
    });
    setSaving(false);
    if (error) {
      setNotice(`Unassign blocked: ${messageOf(error)}`);
      return;
    }
    const result = (data || {}) as Record<string, unknown>;
    setPendingUnassign(null);
    setTab("UNSCHEDULED");
    setNotice(`Moved ${currentClass?.name || "class"} to Unscheduled. Saved as Schedule v${Number(result.scheduleVersion || currentScheduleVersion + 1)}.`);
    await refresh();
  }

  return (
    <section className={`overflow-hidden rounded-2xl border bg-white ${unscheduled.length ? "border-amber-200" : "border-emerald-200"}`}>
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${unscheduled.length ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}><Inbox className="size-5" /></div>
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Schedule Builder</p><h2 className="truncate font-semibold text-slate-950">{unscheduled.length ? `${unscheduled.length} class session${unscheduled.length === 1 ? "" : "s"} still need placement` : "Every class session is placed"}</h2></div>
        </div>
        <div className="flex shrink-0 items-center gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{placed.length} placed</span>{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</div>
      </button>

      {expanded ? (
        <div className="border-t border-slate-200 p-4">
          {notice ? <div className={`mb-3 rounded-xl border p-3 text-sm ${notice.includes("blocked") ? "border-red-200 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>{notice}</div> : null}
          {scheduleIsStale ? <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Revalidate the current schedule before placing or unassigning classes.</div> : null}

          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:w-80">
            <button type="button" onClick={() => setTab("UNSCHEDULED")} className={`min-h-9 rounded-lg text-sm font-semibold ${tab === "UNSCHEDULED" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Unscheduled ({unscheduled.length})</button>
            <button type="button" onClick={() => setTab("PLACED")} className={`min-h-9 rounded-lg text-sm font-semibold ${tab === "PLACED" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Placed ({placed.length})</button>
          </div>

          {tab === "UNSCHEDULED" ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {unscheduled.map((session) => {
                const klass = klassForSession(session);
                return <div key={session.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-semibold text-slate-950"><span aria-hidden="true">{subjectMarker(klass?.subject, klass?.name)}</span> {klass?.name || session.classId}</h3><p className="mt-1 text-xs text-slate-500">Session {session.ordinal} · {klass?.durationMinutes || "?"} min · {klass?.level || "Level not set"}</p></div>{session.locked ? <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600">LOCKED</span> : null}</div>
                  <button type="button" disabled={!mutationEnabled || saving} onClick={() => beginPlace(session)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-40"><CalendarPlus2 className="size-4" />Place class</button>
                </div>;
              })}
              {unscheduled.length === 0 ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 className="mr-2 inline size-4" />Nothing is waiting in the tray.</div> : null}
            </div>
          ) : (
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
              {placed.map((assignment) => {
                const klass = klassForAssignment(assignment);
                return <div key={assignment.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold"><span aria-hidden="true">{subjectMarker(klass?.subject, klass?.name)}</span> {klass?.name || assignment.sessionId}</p><p className="mt-1 truncate text-xs text-slate-500">{assignment.day} · {pretty(assignment.startTime)} · {roomMap.get(assignment.roomId)?.name} · {teacherMap.get(assignment.teacherId)?.name}</p></div><button type="button" disabled={!mutationEnabled || assignment.locked || saving} onClick={() => setPendingUnassign(assignment)} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"><RotateCcw className="size-3.5" />{assignment.locked ? "Locked" : "Unassign"}</button></div>;
              })}
            </div>
          )}
        </div>
      ) : null}

      {placing && placingClass ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-6">
          <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Place from Unscheduled</p><h2 className="mt-1 text-xl font-semibold"><span aria-hidden="true">{subjectMarker(placingClass.subject, placingClass.name)}</span> {placingClass.name}</h2><p className="mt-1 text-sm text-slate-500">{placingClass.durationMinutes} minutes · {placingClass.level}</p></div><button type="button" onClick={() => setPlacing(null)} className="grid size-10 place-items-center rounded-xl"><X className="size-5" /></button></div>

            <div className="mt-5 grid gap-4">
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Day<select value={day} onChange={(event) => changeDay(event.target.value as Day)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{days.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Start<input type="time" step={900} value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal" /></label></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><Clock3 className="mr-2 inline size-4" />Ends at <strong>{pretty(endTime)}</strong>. Duration is fixed at {placingClass.durationMinutes} minutes.</div>
              <label className="text-xs font-semibold text-slate-600">Teacher<select value={teacherId} onChange={(event) => setTeacherId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">Choose teacher</option>{eligibleTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><AlertTriangle className="mr-1.5 inline size-3.5" />Teacher choices are intentionally not filtered by legacy class eligibility data. Qualification must come from the reviewed Rulebook/constraint model. Current preview only enforces the rules already implemented.</div>
              <label className="text-xs font-semibold text-slate-600">Room<select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">Choose room</option>{state.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>

              <div className={`rounded-xl border p-4 ${placementAllowed ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}><div className="flex items-center gap-2 text-sm font-semibold">{placementAllowed ? <CheckCircle2 className="size-4 text-emerald-700" /> : <AlertTriangle className="size-4 text-red-700" />}Placement preview</div><p className="mt-2 text-sm text-slate-700">{placementPreview?.hardViolations ?? validation.hardViolations} detected HARD violation(s) after placement.</p>{placementPreview && placementPreview.hardViolations > validation.hardViolations ? <div className="mt-2 space-y-1 text-xs text-red-800">{placementPreview.violations.filter((item) => item.severity === "HARD").slice(0, 5).map((item, index) => <p key={index}>• {item.message}</p>)}</div> : null}<p className="mt-2 text-xs text-slate-500">This preview only covers the HARD rules currently implemented. The server checks them again before saving.</p></div>

              <div className="flex gap-2"><button type="button" onClick={() => setPlacing(null)} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Cancel</button><button type="button" disabled={!mutationEnabled || saving || !candidate || !placementAllowed} onClick={() => void placeSession()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-40"><CalendarPlus2 className="size-4" />{saving ? "Placing…" : "Place class"}</button></div>
            </div>
          </div>
        </div>
      ) : null}

      {pendingUnassign ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-6"><div className="w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Send to Unscheduled</p><h2 className="mt-1 text-xl font-semibold">{klassForAssignment(pendingUnassign)?.name || pendingUnassign.sessionId}</h2></div><button type="button" onClick={() => setPendingUnassign(null)} className="grid size-10 place-items-center rounded-xl"><X className="size-5" /></button></div><p className="mt-4 text-sm leading-6 text-slate-600">This removes the placement from the current schedule but keeps the class session in the studio. It will appear in the Unscheduled tray and can be placed again later.</p><div className="mt-5 flex gap-2"><button type="button" onClick={() => setPendingUnassign(null)} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold">Keep placed</button><button type="button" disabled={!mutationEnabled || saving} onClick={() => void unassign()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-700 font-semibold text-white disabled:opacity-40"><RotateCcw className="size-4" />{saving ? "Moving…" : "Send to Unscheduled"}</button></div></div></div>
      ) : null}
    </section>
  );
}

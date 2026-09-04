"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Database, RefreshCw } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { getBrowserSupabase } from "@/lib/supabase";

type TeacherSnapshot = { id: string; name: string };
type StudentSnapshot = { id: string; name: string; level?: string | null; cohortIds?: string[] };
type RoomSnapshot = { id: string; name: string; capacity?: number | null; features?: string[] };
type ClassSnapshot = {
  id: string;
  name: string;
  subject?: string | null;
  level?: string | null;
  durationMinutes?: number | null;
  weeklyFrequency?: number | null;
  companyOnly?: boolean;
  rosterStudentIds?: string[];
};
type SessionSnapshot = {
  id: string;
  classId: string;
  ordinal?: number | null;
  durationMinutes?: number | null;
  locked?: boolean;
};
type PlanningSnapshot = {
  schemaVersion?: string;
  teachers?: TeacherSnapshot[];
  students?: StudentSnapshot[];
  rooms?: RoomSnapshot[];
  classes?: ClassSnapshot[];
  sessions?: SessionSnapshot[];
  cohorts?: unknown[];
};

type ConfirmationRow = {
  version: number;
  snapshot_hash: string;
  snapshot: PlanningSnapshot | null;
  confirmed_for_scheduling_at: string | null;
  confirmed_for_scheduling_by_label: string | null;
  scheduling_confirmation_note: string | null;
};

const CURRENT_DATASET_SELECT =
  "version,snapshot_hash,snapshot,confirmed_for_scheduling_at,confirmed_for_scheduling_by_label,scheduling_confirmation_note";

function safeArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function PlanningDatasetConfirmationCard() {
  const { state, canEdit, currentPlanningDatasetVersion } = useWorkspace();
  const [row, setRow] = useState<ConfirmationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedPlanningDatasetVersion, setLoadedPlanningDatasetVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!state) return;
    let active = true;
    void getBrowserSupabase()
      .from("planning_dataset_versions")
      .select(CURRENT_DATASET_SELECT)
      .eq("studio_id", state.studioId)
      .eq("status", "CURRENT")
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setNotice(error.message);
        else setRow(data as ConfirmationRow | null);
        setLoadedPlanningDatasetVersion(currentPlanningDatasetVersion);
        setLoading(false);
      });
    return () => { active = false; };
  }, [state, currentPlanningDatasetVersion]);

  async function refreshConfirmation() {
    if (!state) return;
    const { data, error } = await getBrowserSupabase()
      .from("planning_dataset_versions")
      .select(CURRENT_DATASET_SELECT)
      .eq("studio_id", state.studioId)
      .eq("status", "CURRENT")
      .maybeSingle();
    if (error) setNotice(error.message);
    else setRow(data as ConfirmationRow | null);
    setLoadedPlanningDatasetVersion(currentPlanningDatasetVersion);
  }

  const rowCurrent = Boolean(
    row
    && row.version === currentPlanningDatasetVersion
    && loadedPlanningDatasetVersion === currentPlanningDatasetVersion,
  );

  async function confirm() {
    if (!canEdit || saving || !rowCurrent || !row?.snapshot) return;
    setSaving(true);
    setNotice("");
    const { data, error } = await getBrowserSupabase().rpc("confirm_current_planning_dataset_v32", {
      p_expected_planning_dataset_version: currentPlanningDatasetVersion,
      p_note: "Reviewed the displayed immutable teacher, student, room, class, session, and roster snapshot for automatic scheduling.",
    });
    if (error) setNotice(`Confirmation failed: ${error.message}`);
    else {
      const result = (data || {}) as Record<string, unknown>;
      setNotice(`Planning Dataset v${String(result.planningDatasetVersion || currentPlanningDatasetVersion)} confirmed for scheduling.`);
      await refreshConfirmation();
    }
    setSaving(false);
  }

  const snapshot = rowCurrent ? row?.snapshot : null;
  const teachers = safeArray(snapshot?.teachers);
  const students = safeArray(snapshot?.students);
  const rooms = safeArray(snapshot?.rooms);
  const classes = safeArray(snapshot?.classes);
  const sessions = safeArray(snapshot?.sessions);
  const studentNames = useMemo(
    () => new Map(students.map((student) => [student.id, student.name])),
    [students],
  );
  const sessionsByClass = useMemo(() => {
    const map = new Map<string, SessionSnapshot[]>();
    for (const session of sessions) {
      const existing = map.get(session.classId) || [];
      existing.push(session);
      map.set(session.classId, existing);
    }
    return map;
  }, [sessions]);

  if (!state) return null;
  const confirmed = Boolean(rowCurrent && row?.confirmed_for_scheduling_at);
  const snapshotLoaded = Boolean(rowCurrent && snapshot);
  const loadingCurrent = loading || loadedPlanningDatasetVersion !== currentPlanningDatasetVersion;

  return (
    <section className={`rounded-2xl border p-5 ${confirmed ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
            {confirmed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Database className="size-4 text-amber-600" />}
            Fluid planning-data checkpoint
          </div>
          <h3 className="mt-2 text-lg font-semibold">
            {confirmed ? `Planning Dataset v${row?.version} is confirmed` : `Review Planning Dataset v${currentPlanningDatasetVersion}`}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Every meaningful planning edit creates a new immutable version. Review the exact snapshot below before confirming it for automatic scheduling; the next planning edit automatically creates a new, unconfirmed version.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Snapshot {rowCurrent && row?.snapshot_hash ? row.snapshot_hash.slice(0, 12) : "not loaded"} · schema {snapshot?.schemaVersion || "unknown"}. External source manifests remain provenance baselines, not a freeze on current enrollment.
          </p>
          {confirmed ? (
            <p className="mt-3 text-xs font-medium text-emerald-800">
              Confirmed {new Date(row!.confirmed_for_scheduling_at!).toLocaleString()} by {row?.confirmed_for_scheduling_by_label || "an editor"}.
            </p>
          ) : null}
          {notice ? <p className="mt-3 text-xs font-medium text-slate-700">{notice}</p> : null}
        </div>
        {canEdit ? (
          <button
            disabled={loadingCurrent || saving || confirmed || !snapshotLoaded}
            onClick={() => void confirm()}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${saving ? "animate-spin" : ""}`} />
            {saving ? "Confirming…" : confirmed ? "Confirmed" : "Confirm reviewed snapshot"}
          </button>
        ) : null}
      </div>

      {snapshotLoaded ? (
        <div className="mt-5 space-y-3 border-t border-slate-200/80 pt-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Teachers", teachers.length],
              ["Students", students.length],
              ["Rooms", rooms.length],
              ["Classes", classes.length],
              ["Sessions", sessions.length],
            ].map(([label, count]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{count}</p>
              </div>
            ))}
          </div>

          <details className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Teachers and rooms</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Teachers</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {teachers.length ? teachers.map((teacher) => teacher.name).join(", ") : "No teachers in this snapshot."}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rooms</p>
                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  {rooms.length ? rooms.map((room) => (
                    <p key={room.id}>
                      <span className="font-medium">{room.name}</span>
                      {typeof room.capacity === "number" ? ` · capacity ${room.capacity}` : ""}
                      {room.features?.length ? ` · ${room.features.join(", ")}` : ""}
                    </p>
                  )) : <p>No rooms in this snapshot.</p>}
                </div>
              </div>
            </div>
          </details>

          <details className="rounded-xl border border-slate-200 bg-white/80 p-3" open={!confirmed}>
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Classes, sessions, and rosters</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-semibold">Class</th>
                    <th className="px-2 py-2 font-semibold">Frequency</th>
                    <th className="px-2 py-2 font-semibold">Class duration</th>
                    <th className="px-2 py-2 font-semibold">Sessions</th>
                    <th className="px-2 py-2 font-semibold">Roster</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {classes.map((classRow) => {
                    const classSessions = (sessionsByClass.get(classRow.id) || []).slice().sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
                    const rosterIds = classRow.rosterStudentIds || [];
                    return (
                      <tr key={classRow.id} className="align-top">
                        <td className="px-2 py-2">
                          <p className="font-medium text-slate-900">{classRow.name}</p>
                          <p className="text-slate-500">{[classRow.subject, classRow.level].filter(Boolean).join(" · ") || "No subject/level"}</p>
                        </td>
                        <td className="px-2 py-2">{classRow.weeklyFrequency ?? "—"}× / week</td>
                        <td className="px-2 py-2">{classRow.durationMinutes ?? "—"} min</td>
                        <td className="px-2 py-2">
                          {classSessions.length ? classSessions.map((session) => (
                            <span key={session.id} className="mr-2 inline-block whitespace-nowrap">
                              #{session.ordinal ?? "?"}: {session.durationMinutes ?? "—"} min{session.locked ? " · locked" : ""}
                            </span>
                          )) : "No sessions"}
                        </td>
                        <td className="px-2 py-2">
                          <p className="font-medium">{rosterIds.length} student{rosterIds.length === 1 ? "" : "s"}</p>
                          <p className="mt-1 max-w-sm text-slate-500">
                            {rosterIds.length ? rosterIds.map((id) => studentNames.get(id) || `Unknown student ${id.slice(0, 8)}`).join(", ") : "No enrolled students"}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>

          <details className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Student inventory</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {students.length ? students.map((student) => (
                <div key={student.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs">
                  <p className="font-medium text-slate-900">{student.name}</p>
                  <p className="mt-1 text-slate-500">
                    {student.level || "No level"}{student.cohortIds?.length ? ` · ${student.cohortIds.length} cohort${student.cohortIds.length === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
              )) : <p className="text-sm text-slate-600">No students in this snapshot.</p>}
            </div>
          </details>
        </div>
      ) : loadingCurrent ? (
        <p className="mt-5 border-t border-slate-200/80 pt-4 text-sm text-slate-500">Loading immutable planning snapshot…</p>
      ) : (
        <p className="mt-5 border-t border-slate-200/80 pt-4 text-sm font-medium text-rose-700">
          The immutable snapshot could not be loaded, so confirmation is disabled.
        </p>
      )}
    </section>
  );
}

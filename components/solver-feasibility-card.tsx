"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Loader2, Play, ShieldCheck } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

type GatewayBlocker = { code: string; message: string; ruleIds?: string[]; entityIds?: string[] };
type SolveContext = {
  studioId: string;
  rulebookVersion: number;
  planningDatasetVersion: number;
  compilerVersion: string;
};
type GatewayStatus = {
  serviceConfigured: boolean;
  adoptionConfigured: boolean;
  readyToRun: boolean;
  canRun: boolean;
  preparationReady: boolean;
  context: SolveContext | null;
  blockers: GatewayBlocker[];
  publishedConstraintModel: { version: number; rulebookVersion: number; compilerVersion: string; complete: boolean } | null;
};
type SolverAssignment = {
  sessionId: string;
  day: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday";
  startTime: string;
  endTime?: string;
  teacherId: string;
  roomId: string;
  locked?: boolean;
  status?: string;
};
type SolveResult = {
  status?: string;
  error?: string;
  code?: string;
  blockers?: GatewayBlocker[];
  context?: SolveContext;
  candidate?: {
    assignments?: SolverAssignment[];
    validation?: { hardViolations?: number; unsupportedConstraintIds?: string[] };
  } | null;
  diagnostics?: { wallTimeSeconds?: number | null; branches?: number | null; conflicts?: number | null };
  adoptionMessage?: string;
};
type AdoptionResult = {
  status?: string;
  error?: string;
  code?: string;
  adoption?: {
    scheduleVersion?: number;
    assignmentCount?: number;
    rulebookVersion?: number;
    planningDatasetVersion?: number;
    constraintModelVersion?: number;
  };
};

const DAY_ORDER = new Map([
  ["Monday", 0],
  ["Tuesday", 1],
  ["Wednesday", 2],
  ["Thursday", 3],
  ["Friday", 4],
  ["Saturday", 5],
]);

export function SolverFeasibilityCard() {
  const {
    session,
    canEdit,
    state,
    refresh,
    currentRulebookVersion,
    currentPlanningDatasetVersion,
    currentScheduleVersion,
  } = useWorkspace();
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [notice, setNotice] = useState("");
  const [adoptionSuccess, setAdoptionSuccess] = useState("");
  const [result, setResult] = useState<SolveResult | null>(null);

  const authHeaders = useCallback(() => session ? { Authorization: `Bearer ${session.access_token}` } : null, [session]);

  const refreshStatus = useCallback(async (options: { preserveNotice?: boolean } = {}) => {
    const headers = authHeaders();
    if (!headers) return;
    setLoading(true);
    try {
      const response = await fetch("/api/solver/feasibility", { headers, cache: "no-store" });
      const payload = await response.json() as GatewayStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not read solver gateway status.");
      setStatus(payload);
      if (!options.preserveNotice) setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    const headers = authHeaders();
    if (!headers) return;
    let active = true;

    void fetch("/api/solver/feasibility", { headers, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as GatewayStatus & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not read solver gateway status.");
        if (!active) return;
        setStatus(payload);
        setNotice("");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : String(error));
        setStatus(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [authHeaders, currentRulebookVersion, currentPlanningDatasetVersion, currentScheduleVersion]);

  const reviewRows = useMemo(() => {
    const assignments = result?.candidate?.assignments || [];
    const sessionsById = new Map((state?.sessions || []).map((item) => [item.id, item]));
    const classesById = new Map((state?.classes || []).map((item) => [item.id, item]));
    const teachersById = new Map((state?.teachers || []).map((item) => [item.id, item]));
    const roomsById = new Map((state?.rooms || []).map((item) => [item.id, item]));

    return assignments.map((assignment) => {
      const classSession = sessionsById.get(assignment.sessionId);
      const klass = classSession ? classesById.get(classSession.classId) : undefined;
      return {
        ...assignment,
        className: klass?.name || assignment.sessionId,
        ordinal: classSession?.ordinal ?? null,
        teacherName: teachersById.get(assignment.teacherId)?.name || assignment.teacherId,
        roomName: roomsById.get(assignment.roomId)?.name || assignment.roomId,
        locked: Boolean(assignment.locked || classSession?.locked),
      };
    }).sort((a, b) => {
      const dayDiff = (DAY_ORDER.get(a.day) ?? 99) - (DAY_ORDER.get(b.day) ?? 99);
      if (dayDiff !== 0) return dayDiff;
      const timeDiff = a.startTime.localeCompare(b.startTime);
      if (timeDiff !== 0) return timeDiff;
      return a.className.localeCompare(b.className);
    });
  }, [result, state]);

  async function runSolver() {
    const headers = authHeaders();
    if (!headers || running || !canEdit) return;
    setRunning(true);
    setResult(null);
    setReviewAcknowledged(false);
    setAdoptionSuccess("");
    setNotice("");
    try {
      const response = await fetch("/api/solver/feasibility", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      const payload = await response.json() as SolveResult;
      setResult(payload);
      if (!response.ok) setNotice(payload.error || `Solver gateway returned HTTP ${response.status}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      await refreshStatus({ preserveNotice: true });
    }
  }

  async function adoptCandidate() {
    const headers = authHeaders();
    const assignments = result?.candidate?.assignments;
    const context = result?.context;
    if (!headers || !assignments?.length || !context || !canEdit || !status?.adoptionConfigured || !reviewAcknowledged || adopting) return;

    const confirmed = window.confirm(
      `Adopt this reviewed ${assignments.length}-assignment candidate as a new immutable schedule version? The server will reload canonical data and independently validate it again before replacing the current schedule.`,
    );
    if (!confirmed) return;

    setAdopting(true);
    setNotice("");
    setAdoptionSuccess("");
    try {
      const response = await fetch("/api/solver/adopt", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          context,
          assignments,
          reason: "Adopt reviewed CP-SAT candidate from solver feasibility review",
        }),
        cache: "no-store",
      });
      const payload = await response.json() as AdoptionResult;
      if (!response.ok || payload.status !== "ADOPTED") {
        setNotice(payload.error || `Solver adoption returned HTTP ${response.status}.`);
        return;
      }

      const version = payload.adoption?.scheduleVersion;
      const count = payload.adoption?.assignmentCount ?? assignments.length;
      setAdoptionSuccess(
        version
          ? `Schedule v${version} adopted with ${count} assignments after fresh server-side validation.`
          : `The reviewed candidate was adopted with ${count} assignments after fresh server-side validation.`,
      );
      setResult(null);
      setReviewAcknowledged(false);
      await refresh();
      await refreshStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setAdopting(false);
    }
  }

  if (!session) return null;

  const ready = Boolean(status?.readyToRun && canEdit);
  const feasible = result?.status === "FEASIBLE" && Boolean(result.candidate);
  const infeasible = result?.status === "INFEASIBLE";

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Cpu className="size-4" />
            CP-SAT feasibility gateway
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">Find a feasible schedule candidate</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The browser never sends scheduling facts to CP-SAT. The authenticated server reloads canonical Supabase truth, reruns readiness and delegated preflight, verifies the published Constraint Model, then forwards the exact versioned problem to the private solver service. Returned schedules are independently revalidated and are never saved automatically.
          </p>
        </div>
        <button
          type="button"
          disabled={!ready || running || loading}
          onClick={() => void runSolver()}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {running ? "Solving…" : "Find feasible schedule"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Private solver</div>
          <div className="mt-1 flex items-center gap-2 font-semibold">
            {status?.serviceConfigured ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
            {loading ? "Checking…" : status?.serviceConfigured ? "Configured" : "Not configured"}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Governed adoption</div>
          <div className="mt-1 flex items-center gap-2 font-semibold">
            {status?.adoptionConfigured ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
            {loading ? "Checking…" : status?.adoptionConfigured ? "Configured" : "Not configured"}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Server preflight</div>
          <div className="mt-1 flex items-center gap-2 font-semibold">
            {status?.preparationReady && !status.blockers?.length ? <ShieldCheck className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
            {status?.preparationReady && !status.blockers?.length ? "Passed" : "Blocked"}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pinned context</div>
          <div className="mt-1 text-sm font-semibold">
            {status?.context
              ? `Rulebook v${status.context.rulebookVersion} · Planning v${status.context.planningDatasetVersion}`
              : "Not ready"}
          </div>
          <div className="mt-1 text-xs text-slate-500">{status?.context?.compilerVersion || "Compiler unavailable"}</div>
        </div>
      </div>

      {status?.blockers?.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="font-semibold text-amber-950">Gateway blockers</div>
          <div className="mt-2 space-y-2 text-sm text-amber-900">
            {status.blockers.slice(0, 8).map((blocker) => (
              <div key={`${blocker.code}-${blocker.message}`}><span className="font-semibold">{blocker.code}:</span> {blocker.message}</div>
            ))}
            {status.blockers.length > 8 ? <div>+ {status.blockers.length - 8} more blocker(s)</div> : null}
          </div>
        </div>
      ) : null}

      {feasible ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" /> Feasible candidate independently validated</div>
          <p className="mt-2">
            {reviewRows.length} session assignments returned with {result.candidate?.validation?.hardViolations ?? 0} detected HARD violations under the shared Constraint IR. Review every row before adoption.
          </p>
          {result.context ? (
            <p className="mt-2 text-xs leading-5 text-emerald-800">
              Solved against Rulebook v{result.context.rulebookVersion}, Planning Dataset v{result.context.planningDatasetVersion}, and {result.context.compilerVersion}.
            </p>
          ) : null}

          <div className="mt-4 overflow-x-auto rounded-xl border border-emerald-200 bg-white">
            <table className="min-w-full border-collapse text-left text-xs text-slate-800">
              <thead className="bg-emerald-50 text-[11px] font-semibold uppercase tracking-wide text-emerald-900">
                <tr>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2">Teacher</th>
                  <th className="px-3 py-2">Room</th>
                  <th className="px-3 py-2">Lock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reviewRows.map((row) => (
                  <tr key={row.sessionId}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{row.day}</td>
                    <td className="whitespace-nowrap px-3 py-2">{row.startTime}{row.endTime ? `–${row.endTime}` : ""}</td>
                    <td className="px-3 py-2">{row.className}{row.ordinal && row.ordinal > 1 ? ` · session ${row.ordinal}` : ""}</td>
                    <td className="px-3 py-2">{row.teacherName}</td>
                    <td className="px-3 py-2">{row.roomName}</td>
                    <td className="px-3 py-2">{row.locked ? "Locked" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!status?.adoptionConfigured ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              This candidate can be reviewed, but governed adoption is disabled until the server-only Supabase service-role credential is configured on the application backend.
            </div>
          ) : null}

          <label className={`mt-4 flex items-start gap-3 rounded-xl border p-3 text-sm leading-5 ${status?.adoptionConfigured ? "border-emerald-200 bg-white text-slate-800" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
            <input
              type="checkbox"
              checked={reviewAcknowledged}
              disabled={!status?.adoptionConfigured}
              onChange={(event) => setReviewAcknowledged(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>I reviewed every assignment above and want this candidate to replace the current schedule with a new immutable ScheduleVersion.</span>
          </label>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-xs leading-5 text-emerald-800">
              Adoption reloads canonical state, verifies the exact version context, independently validates the candidate again, preserves locks, runs the legacy HARD validator, and only then commits atomically.
            </p>
            <button
              type="button"
              disabled={!status?.adoptionConfigured || !reviewAcknowledged || adopting || !canEdit}
              onClick={() => void adoptCandidate()}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {adopting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {adopting ? "Revalidating…" : "Adopt reviewed candidate"}
            </button>
          </div>
        </div>
      ) : null}

      {infeasible ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">No complete feasible candidate was proven under the supplied HARD model.</div>
          <p className="mt-1 text-xs leading-5">This does not modify the current schedule. Constraint diagnostics can be used next to explain the blocking core.</p>
        </div>
      ) : null}

      {adoptionSuccess ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" /> Candidate adopted</div>
          <p className="mt-1">{adoptionSuccess}</p>
        </div>
      ) : null}

      {notice ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{notice}</div> : null}
      {!canEdit ? <div className="mt-4 text-xs text-slate-500">Viewer access can inspect gateway readiness but cannot run or adopt CP-SAT candidates.</div> : null}
    </section>
  );
}

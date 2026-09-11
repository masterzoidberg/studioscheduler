"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Play, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import type { ReviewedSolverCandidateContextV1 } from "@/lib/solver-candidate-context";
import {
  cancelledSolverOutcome,
  presentSolverOutcome,
  type SolverOutcome,
} from "@/lib/solver-outcome";

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
  serviceStatus?: number;
  serviceVersion?: string | null;
  blockers?: GatewayBlocker[];
  blockingConstraintIds?: string[];
  unsupportedConstraintIds?: string[];
  wallTimeSeconds?: number | null;
  context?: SolveContext;
  candidateContext?: ReviewedSolverCandidateContextV1;
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
  const [reviewStale, setReviewStale] = useState(false);
  const [notice, setNotice] = useState("");
  const [adoptionSuccess, setAdoptionSuccess] = useState("");
  const [result, setResult] = useState<SolveResult | null>(null);
  const [outcome, setOutcome] = useState<SolverOutcome | null>(null);
  const [progressStage, setProgressStage] = useState(0);
  const solveRequestId = useRef(0);
  const solveAbortController = useRef<AbortController | null>(null);

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
        setOutcome(presentSolverOutcome({
          responseOk: false,
          transportError: error instanceof Error ? error.message : String(error),
        }));
        setStatus(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [authHeaders, currentRulebookVersion, currentPlanningDatasetVersion, currentScheduleVersion]);

  useEffect(() => {
    if (!running) return;
    const stageTwo = window.setTimeout(() => setProgressStage(1), 900);
    const stageThree = window.setTimeout(() => setProgressStage(2), 2400);
    return () => {
      window.clearTimeout(stageTwo);
      window.clearTimeout(stageThree);
    };
  }, [running]);

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
    const requestId = solveRequestId.current + 1;
    solveRequestId.current = requestId;
    const controller = new AbortController();
    solveAbortController.current = controller;
    setRunning(true);
    setProgressStage(0);
    setResult(null);
    setOutcome(null);
    setReviewAcknowledged(false);
    setReviewStale(false);
    setAdoptionSuccess("");
    setNotice("");
    try {
      const response = await fetch("/api/solver/feasibility", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json() as SolveResult;
      if (requestId !== solveRequestId.current) return;
      setResult(payload);
      setOutcome(presentSolverOutcome({ payload, responseOk: response.ok, httpStatus: response.status }));
    } catch (error) {
      if (requestId !== solveRequestId.current) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        setOutcome(cancelledSolverOutcome());
      } else {
        setResult(null);
        setOutcome(presentSolverOutcome({
          responseOk: false,
          transportError: error instanceof Error ? error.message : String(error),
        }));
      }
    } finally {
      if (requestId !== solveRequestId.current) return;
      solveAbortController.current = null;
      setRunning(false);
      await refreshStatus({ preserveNotice: true });
    }
  }

  function cancelSolver() {
    if (!running) return;
    solveRequestId.current += 1;
    solveAbortController.current?.abort();
    solveAbortController.current = null;
    setRunning(false);
    setResult(null);
    setOutcome(cancelledSolverOutcome());
    setReviewAcknowledged(false);
    setReviewStale(false);
    setNotice("");
  }

  async function adoptCandidate() {
    const headers = authHeaders();
    const assignments = result?.candidate?.assignments;
    const candidateContext = result?.candidateContext;
    const reviewedScheduleVersion = candidateContext?.solverContextToken.scheduleVersion;
    const contextStale = Boolean(candidateContext && candidateContext.solverContextToken.scheduleVersion !== currentScheduleVersion);
    if (!headers || !assignments?.length || !candidateContext || !canEdit || !status?.adoptionConfigured || !reviewAcknowledged || reviewStale || contextStale || adopting) return;

    const confirmed = window.confirm(
      `Adopt this reviewed ${assignments.length}-assignment candidate from Schedule v${reviewedScheduleVersion ?? "?"} as a new immutable schedule version? Any intervening schedule or lock change will reject adoption and require a fresh review.`,
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
          candidateContext,
          assignments,
          reason: "Adopt reviewed CP-SAT candidate from solver feasibility review",
        }),
        cache: "no-store",
      });
      const payload = await response.json() as AdoptionResult;
      if (!response.ok || payload.status !== "ADOPTED") {
        if (payload.code === "SOLVER_ADOPTION_REVIEW_CONTEXT_STALE") {
          setReviewAcknowledged(false);
          setReviewStale(true);
          setOutcome(presentSolverOutcome({
            responseOk: false,
            httpStatus: response.status,
            payload: { code: "SOLVER_CONTEXT_CHANGED_RETRY" },
          }));
          setNotice(payload.error || "This reviewed candidate is stale. Generate a fresh candidate and review it again.");
          return;
        }
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
      setOutcome(null);
      setReviewAcknowledged(false);
      setReviewStale(false);
      await refresh();
      await refreshStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setAdopting(false);
    }
  }

  if (!session) return null;

  const canStartSolve = Boolean(canEdit && !loading && (status ? status.readyToRun : true));
  const feasible = outcome?.kind === "CANDIDATE" && Boolean(result?.candidate);
  const candidateContextStale = Boolean(
    result?.candidateContext
    && result.candidateContext.solverContextToken.scheduleVersion !== currentScheduleVersion,
  );
  const candidateIsStale = reviewStale || candidateContextStale;
  const displayedOutcome = outcome || (!loading && status && !status.serviceConfigured
    ? presentSolverOutcome({ responseOk: false, httpStatus: 503, payload: { code: "SOLVER_SERVICE_NOT_CONFIGURED" } })
    : null);
  const reviewedScheduleVersion = result?.candidateContext?.solverContextToken.scheduleVersion ?? null;
  const reviewedScheduleFingerprint = result?.candidateContext?.solverContextToken.scheduleAssignmentsHash?.slice(0, 12) || "";

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Play className="size-4" />
            Setup review → schedule
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">Build a schedule</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Use the confirmed Setup review to create a complete schedule. Building checks the current Must happen rules and locks, then shows the proposed changes here. Your current schedule stays unchanged until you review and adopt the proposal.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={!canStartSolve || running}
            onClick={() => void runSolver()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? "Building…" : "Build schedule"}
          </button>
          {running ? (
            <button
              type="button"
              onClick={cancelSolver}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700"
            >
              <X className="size-4" />
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      {running ? (
        <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4" role="status" aria-live="polite">
          <p className="font-semibold text-blue-950">Building a schedule…</p>
          <p className="mt-1 text-xs leading-5 text-blue-800">This may take a moment. You can cancel safely; cancellation keeps the current schedule in place.</p>
          <ol className="mt-4 grid gap-2 sm:grid-cols-3">
            {["Check current Setup", "Build a candidate", "Validate the proposal"].map((stage, index) => (
              <li key={stage} aria-current={index === progressStage ? "step" : undefined} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${index <= progressStage ? "border-blue-300 bg-white text-blue-950" : "border-blue-100 text-blue-700"}`}>
                <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-blue-100 align-middle text-[10px]">{index < progressStage ? "✓" : index === progressStage ? "…" : index + 1}</span>
                {stage}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className={`rounded-2xl border p-4 ${status?.readyToRun ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Setup review</div>
          <div className="mt-1 flex items-center gap-2 font-semibold text-slate-950">
            {status?.readyToRun ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
            {loading ? "Checking…" : status?.readyToRun ? "Ready to build" : "Needs attention"}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">{status?.readyToRun ? "The current reviewed setup can be used." : "Resolve the review findings before building."}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current schedule</div>
          <div className="mt-1 flex items-center gap-2 font-semibold text-slate-950"><ShieldCheck className="size-4 text-slate-600" /> Protected</div>
          <p className="mt-1 text-xs leading-5 text-slate-600">Nothing changes until you review and adopt a proposal.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">After building</div>
          <div className="mt-1 flex items-center gap-2 font-semibold text-slate-950"><CheckCircle2 className="size-4 text-slate-600" /> Review changes</div>
          <p className="mt-1 text-xs leading-5 text-slate-600">Every assignment and lock is shown before adoption.</p>
        </div>
      </div>

      {status?.blockers?.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="font-semibold text-amber-950">Review before building</div>
          <p className="mt-1 text-xs leading-5 text-amber-900">The current Setup review has {status.blockers.length} item{status.blockers.length === 1 ? "" : "s"} to resolve.</p>
          <div className="mt-3 space-y-2 text-sm text-amber-900">
            {status.blockers.slice(0, 8).map((blocker) => (
              <div key={`${blocker.code}-${blocker.message}`}>{blocker.message}</div>
            ))}
            {status.blockers.length > 8 ? <div>+ {status.blockers.length - 8} more blocker(s)</div> : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/setup" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-950 px-3 text-xs font-semibold text-white">Open Setup review <ArrowRight className="size-3.5" /></Link>
            <Link href="/planning-repairs" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950">Review requirements</Link>
          </div>
        </div>
      ) : null}

      <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
        <summary className="cursor-pointer font-semibold text-slate-900">Advanced diagnostics</summary>
        <p className="mt-3 leading-5">These details identify the exact server-prepared policy, planning, model, and schedule context. They are for troubleshooting; the manager-facing result is shown above.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="font-semibold text-slate-500">Private solver</div><div className="mt-1 font-semibold">{loading ? "Checking…" : status?.serviceConfigured ? "Configured" : "Not configured"}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="font-semibold text-slate-500">Governed adoption</div><div className="mt-1 font-semibold">{loading ? "Checking…" : status?.adoptionConfigured ? "Configured" : "Not configured"}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="font-semibold text-slate-500">Server preflight</div><div className="mt-1 font-semibold">{status?.preparationReady && !status.blockers?.length ? "Passed" : "Blocked"}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="font-semibold text-slate-500">Pinned context</div><div className="mt-1 font-semibold">{status?.context ? `Rulebook v${status.context.rulebookVersion} · Planning v${status.context.planningDatasetVersion}` : "Not ready"}</div><div className="mt-1 break-all text-slate-500">{status?.context?.compilerVersion || "Compiler unavailable"}</div></div>
        </div>
        {status?.blockers?.length ? <div className="mt-4 space-y-2"><p className="font-semibold">Raw blocker codes</p>{status.blockers.slice(0, 8).map((blocker) => <div key={`advanced-${blocker.code}-${blocker.message}`} className="rounded-lg bg-white p-2"><span className="font-semibold">{blocker.code}</span>{blocker.ruleIds?.length ? ` · rules ${blocker.ruleIds.join(", ")}` : ""}{blocker.entityIds?.length ? ` · entities ${blocker.entityIds.join(", ")}` : ""}</div>)}</div> : null}
        {result?.context ? <div className="mt-4 rounded-xl bg-white p-3"><p className="font-semibold">Candidate context</p><p className="mt-1 break-all">Rulebook v{result.context.rulebookVersion} · Planning Dataset v{result.context.planningDatasetVersion} · compiler {result.context.compilerVersion} · base Schedule v{reviewedScheduleVersion ?? "?"} · lock fingerprint {reviewedScheduleFingerprint || "unavailable"}</p></div> : null}
        {result?.diagnostics || outcome?.diagnostic || result?.blockingConstraintIds?.length || result?.unsupportedConstraintIds?.length ? <div className="mt-4 rounded-xl bg-white p-3"><p className="font-semibold">Last solver response</p><p className="mt-1 break-all">{result?.status || outcome?.kind || "No response"}{result?.code ? ` · ${result.code}` : ""}{result?.serviceVersion ? ` · service ${result.serviceVersion}` : ""}{result?.serviceStatus ? ` · HTTP ${result.serviceStatus}` : ""}{result?.diagnostics?.wallTimeSeconds != null ? ` · ${result.diagnostics.wallTimeSeconds}s` : result?.wallTimeSeconds != null ? ` · ${result.wallTimeSeconds}s` : ""}</p>{result?.diagnostics ? <p className="mt-1">branches {result.diagnostics.branches ?? "—"} · conflicts {result.diagnostics.conflicts ?? "—"}</p> : null}{result?.blockingConstraintIds?.length ? <p className="mt-1 break-all">blocking constraints: {result.blockingConstraintIds.join(", ")}</p> : null}{result?.unsupportedConstraintIds?.length ? <p className="mt-1 break-all">unsupported constraints: {result.unsupportedConstraintIds.join(", ")}</p> : null}{outcome?.diagnostic ? <p className="mt-1 break-all">detail: {outcome.diagnostic}</p> : null}</div> : null}
      </details>

      {feasible ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" /> {outcome?.title}</div>
          <p className="mt-2">{outcome?.message} It contains {reviewRows.length} assignment{reviewRows.length === 1 ? "" : "s"}. Review every row before adoption.</p>
          <p className="mt-2 text-xs leading-5 text-emerald-800">This review is tied to the current schedule and lock context. Any change will require a fresh build and review.</p>

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

          {candidateIsStale ? (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
              This reviewed candidate is stale. It remains visible for comparison, but the current schedule or lock context changed after it was generated. Generate a fresh candidate and review it again before adoption.
            </div>
          ) : null}

          {!status?.adoptionConfigured ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              This candidate can be reviewed, but governed adoption is disabled until the server-only Supabase service-role credential is configured on the application backend.
            </div>
          ) : null}

          <label className={`mt-4 flex items-start gap-3 rounded-xl border p-3 text-sm leading-5 ${status?.adoptionConfigured ? "border-emerald-200 bg-white text-slate-800" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
            <input
              type="checkbox"
              checked={reviewAcknowledged && !candidateContextStale}
              disabled={!status?.adoptionConfigured || candidateIsStale}
              onChange={(event) => setReviewAcknowledged(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>I reviewed every assignment above against the displayed current schedule and lock context, and want this candidate to replace that exact reviewed base with a new immutable schedule version.</span>
          </label>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-xs leading-5 text-emerald-800">
              Adoption verifies the exact reviewed base ScheduleVersion and schedule/lock fingerprint, independently validates the candidate again, preserves locks, runs the legacy HARD validator, and only then commits atomically. Any intervening change requires regeneration and re-review.
            </p>
            <button
              type="button"
              disabled={!status?.adoptionConfigured || !reviewAcknowledged || candidateIsStale || adopting || !canEdit}
              onClick={() => void adoptCandidate()}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {adopting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {adopting ? "Revalidating…" : "Adopt reviewed candidate"}
            </button>
          </div>
        </div>
      ) : null}

      {displayedOutcome && displayedOutcome.kind !== "CANDIDATE" ? (
        <div className={`mt-4 rounded-2xl border p-4 text-sm ${displayedOutcome.kind === "UNKNOWN" || displayedOutcome.kind === "UNAVAILABLE" || displayedOutcome.kind === "INCOMPLETE" ? "border-blue-200 bg-blue-50 text-blue-950" : displayedOutcome.kind === "CANCELLED" ? "border-slate-200 bg-slate-50 text-slate-900" : "border-amber-200 bg-amber-50 text-amber-950"}`} aria-live="polite">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> {displayedOutcome.title}</div>
          <p className="mt-2 max-w-3xl leading-6">{displayedOutcome.message}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {displayedOutcome.links.map((link) => <Link key={link.href} href={link.href} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-current/25 bg-white px-3 text-xs font-semibold">{link.label}<ArrowRight className="size-3.5" /></Link>)}
            {displayedOutcome.retryable ? (
              <button type="button" disabled={!canStartSolve} onClick={() => void runSolver()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                <RefreshCw className="size-3.5" /> Try again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {adoptionSuccess ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" /> Schedule created</div>
          <p className="mt-1">{adoptionSuccess}</p>
        </div>
      ) : null}

      {notice ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{notice}</div> : null}
      {!canEdit ? <div className="mt-4 text-xs text-slate-500">Viewer access can inspect gateway readiness but cannot run or adopt CP-SAT candidates.</div> : null}
    </section>
  );
}

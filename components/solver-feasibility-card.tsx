"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Loader2, Play, ShieldCheck } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

type GatewayBlocker = { code: string; message: string; ruleIds?: string[]; entityIds?: string[] };
type GatewayStatus = {
  serviceConfigured: boolean;
  readyToRun: boolean;
  canRun: boolean;
  preparationReady: boolean;
  context: { studioId: string; rulebookVersion: number; planningDatasetVersion: number; compilerVersion: string } | null;
  blockers: GatewayBlocker[];
  publishedConstraintModel: { version: number; rulebookVersion: number; compilerVersion: string; complete: boolean } | null;
};
type SolveResult = {
  status?: string;
  error?: string;
  code?: string;
  blockers?: GatewayBlocker[];
  candidate?: { assignments?: Array<{ sessionId: string }>; validation?: { hardViolations?: number; unsupportedConstraintIds?: string[] } } | null;
  diagnostics?: { wallTimeSeconds?: number | null; branches?: number | null; conflicts?: number | null };
  adoptionMessage?: string;
};

export function SolverFeasibilityCard() {
  const {
    session,
    canEdit,
    currentRulebookVersion,
    currentPlanningDatasetVersion,
    currentScheduleVersion,
  } = useWorkspace();
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<SolveResult | null>(null);

  const authHeaders = useCallback(() => session ? { Authorization: `Bearer ${session.access_token}` } : null, [session]);

  const refreshStatus = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/solver/feasibility", { headers, cache: "no-store" });
      const payload = await response.json() as GatewayStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not read solver gateway status.");
      setStatus(payload);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, currentRulebookVersion, currentPlanningDatasetVersion, currentScheduleVersion]);

  async function runSolver() {
    const headers = authHeaders();
    if (!headers || running || !canEdit) return;
    setRunning(true);
    setResult(null);
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
      await refreshStatus();
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
            The browser never sends scheduling facts to CP-SAT. The authenticated server reloads canonical Supabase truth, reruns readiness and delegated preflight, verifies the published Constraint Model, then forwards the exact versioned problem to the private solver service. Returned schedules are independently revalidated and are not saved automatically.
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

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Private service</div>
          <div className="mt-1 flex items-center gap-2 font-semibold">
            {status?.serviceConfigured ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
            {loading ? "Checking…" : status?.serviceConfigured ? "Configured" : "Not configured"}
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
            {result.candidate?.assignments?.length || 0} session assignments returned with {result.candidate?.validation?.hardViolations ?? 0} detected HARD violations under the shared Constraint IR. The candidate remains unsaved.
          </p>
          {result.adoptionMessage ? <p className="mt-2 text-xs leading-5 text-emerald-800">{result.adoptionMessage}</p> : null}
        </div>
      ) : null}

      {infeasible ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">No complete feasible candidate was proven under the supplied HARD model.</div>
          <p className="mt-1 text-xs leading-5">This does not modify the current schedule. Constraint diagnostics can be used next to explain the blocking core.</p>
        </div>
      ) : null}

      {notice ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{notice}</div> : null}
      {!canEdit ? <div className="mt-4 text-xs text-slate-500">Viewer access can inspect gateway readiness but cannot run CP-SAT.</div> : null}
    </section>
  );
}

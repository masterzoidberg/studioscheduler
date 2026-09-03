"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, Play, Sigma } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { evaluateScheduleReadiness } from "@/lib/schedule-readiness";
import { getBrowserSupabase } from "@/lib/supabase";

type PublishedModel = {
  version: number;
  rulebook_version: number;
  compiler_version: string;
  complete_hard_constraint_compilation: boolean;
};

type SolveResult = {
  status: "FEASIBLE" | "INFEASIBLE" | "PRECONDITION_REQUIRED" | "UNSUPPORTED" | "UNKNOWN" | string;
  assignments?: Array<{ sessionId: string; day: string; startTime: string; endTime: string; teacherId: string; roomId: string }>;
  blockingConstraintIds?: string[];
  missingPreconditionConstraintIds?: string[];
  unsupportedConstraintIds?: string[];
  wallTimeSeconds?: number;
  error?: string;
  context?: {
    rulebookVersion: number;
    constraintModelVersion: number;
    planningDatasetVersion: number;
  };
};

export function FeasibilitySolverCard() {
  const { state, session, currentRulebookVersion, currentPlanningDatasetVersion } = useWorkspace();
  const [published, setPublished] = useState<PublishedModel | null>(null);
  const [loadingModel, setLoadingModel] = useState(true);
  const [solving, setSolving] = useState(false);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [error, setError] = useState("");

  const model = useMemo(() => state ? compileConstraintModel(state) : null, [state]);
  const readiness = useMemo(() => state ? evaluateScheduleReadiness(state) : null, [state]);
  const currentPlanning = state?.planningDatasetVersions?.find((version) => version.status === "CURRENT") ?? null;

  useEffect(() => {
    if (!state) return;
    let active = true;
    setLoadingModel(true);
    void getBrowserSupabase()
      .from("constraint_model_versions")
      .select("version,rulebook_version,compiler_version,complete_hard_constraint_compilation")
      .eq("studio_id", state.studioId)
      .eq("status", "CURRENT")
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError(queryError.message);
        setPublished((data as PublishedModel | null) ?? null);
        setLoadingModel(false);
      });
    return () => { active = false; };
  }, [state, currentRulebookVersion]);

  if (!state || !model || !readiness) return null;

  // A stale *old schedule* does not prevent creating a brand-new feasibility
  // candidate from current planning truth. All other readiness blockers do.
  const solverBlockers = readiness.blockers.filter((item) => item.code !== "SCHEDULE_PLANNING_DATASET_STALE");
  const modelCurrent = Boolean(
    published
    && published.rulebook_version === currentRulebookVersion
    && published.compiler_version === model.compilerVersion
    && published.complete_hard_constraint_compilation,
  );
  const planningConfirmed = Boolean(currentPlanning?.confirmedForSchedulingAt);
  const canSolve = solverBlockers.length === 0 && planningConfirmed && modelCurrent && Boolean(session?.access_token) && !loadingModel;

  async function solve() {
    if (!canSolve || !session?.access_token || !published) return;
    setSolving(true);
    setResult(null);
    setError("");
    try {
      const response = await fetch("/api/feasibility", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedRulebookVersion: currentRulebookVersion,
          expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
          expectedConstraintModelVersion: published.version,
          maxSeconds: 10,
        }),
      });
      const payload = await response.json() as SolveResult;
      if (!response.ok) throw new Error(payload.error || `Feasibility service returned HTTP ${response.status}`);
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSolving(false);
    }
  }

  const statusTone = result?.status === "FEASIBLE"
    ? "border-emerald-200 bg-emerald-50"
    : result?.status === "INFEASIBLE"
      ? "border-red-200 bg-red-50"
      : "border-slate-200 bg-white";

  return (
    <section className={`rounded-2xl border p-5 ${statusTone}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Sigma className="size-4" />
            CP-SAT HARD feasibility
          </div>
          <h3 className="mt-2 text-lg font-semibold">
            {result?.status === "FEASIBLE"
              ? "A HARD-feasible candidate exists"
              : result?.status === "INFEASIBLE"
                ? "No feasible candidate exists under the current HARD model"
                : "Prove feasibility before optimization"}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            This runs the pinned OR-Tools CP-SAT engine against the current confirmed Planning Dataset and published Constraint Model. It generates a read-only candidate only. It never writes a schedule automatically.
          </p>
        </div>
        <button
          disabled={!canSolve || solving}
          onClick={() => void solve()}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {solving ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
          {solving ? "Solving…" : "Run HARD feasibility"}
        </button>
      </div>

      {!canSolve ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div>
            <strong>Solver locked.</strong>{" "}
            {solverBlockers.length > 0
              ? `${solverBlockers.length} planning/readiness blocker${solverBlockers.length === 1 ? "" : "s"} must be resolved.`
              : !planningConfirmed
                ? `Planning Dataset v${currentPlanningDatasetVersion} must be confirmed after Cami reviews the current fluid data.`
                : !modelCurrent
                  ? "The tested Constraint Model must be published for the current Rulebook/compiler."
                  : "An authenticated workspace session is required."}
          </div></div>
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white/80 p-4">
          <div className="flex items-center gap-2">
            {result.status === "FEASIBLE" ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
            <span className="text-sm font-semibold">{result.status}</span>
          </div>
          {result.status === "FEASIBLE" ? <p className="mt-2 text-sm text-slate-700">{result.assignments?.length || 0} sessions placed in a candidate schedule in {Number(result.wallTimeSeconds || 0).toFixed(3)} seconds.</p> : null}
          {result.status === "INFEASIBLE" ? <p className="mt-2 text-sm text-slate-700">Diagnostic policy-fixed blockers: {(result.blockingConstraintIds || []).join(", ") || "no small fixed-anchor core identified"}.</p> : null}
          {result.status === "PRECONDITION_REQUIRED" ? <p className="mt-2 text-sm text-slate-700">A structural planning fact still needs explicit proof before CP-SAT may proceed: {(result.missingPreconditionConstraintIds || []).join(", ")}.</p> : null}
          {result.status === "UNSUPPORTED" ? <p className="mt-2 text-sm text-slate-700">Unsupported constraint nodes: {(result.unsupportedConstraintIds || []).join(", ")}.</p> : null}
          {result.context ? <p className="mt-2 text-xs text-slate-500">Rulebook v{result.context.rulebookVersion} · Constraint Model v{result.context.constraintModelVersion} · Planning Dataset v{result.context.planningDatasetVersion}</p> : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs font-medium text-red-700">{error}</p> : null}
    </section>
  );
}

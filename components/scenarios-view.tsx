"use client";

import { useState } from "react";
import { CheckCircle2, Cpu, FlaskConical, GitCompareArrows, ShieldAlert, Trash2 } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { compareSolverCandidateReviews, solverCandidateReviewIsStale, type SolverCandidateReview } from "@/lib/solver-candidate-review";

export function ScenariosView() {
  const {
    state, candidateReviews, canEdit, session, selectedStudioId, solverContextToken, refresh,
    deleteSolverCandidateReview,
  } = useWorkspace();
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  if (!state) return null;

  const selectedCandidates = selectedCandidateIds
    .map((id) => candidateReviews.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is SolverCandidateReview => Boolean(candidate));
  const comparison = selectedCandidates.length === 2
    ? compareSolverCandidateReviews(selectedCandidates[0], selectedCandidates[1])
    : null;

  function toggleCandidate(candidateId: string) {
    setSelectedCandidateIds((current) => current.includes(candidateId)
      ? current.filter((id) => id !== candidateId)
      : current.length < 2 ? [...current, candidateId] : [current[1], candidateId]);
  }

  async function adoptCandidate(candidate: SolverCandidateReview) {
    if (!session || !selectedStudioId || !canEdit || !solverContextToken) return;
    if (solverCandidateReviewIsStale(candidate, solverContextToken)) {
      setNotice("This candidate is stale. Build and review a fresh candidate before adoption.");
      return;
    }
    if (!window.confirm(`Adopt ${candidate.name} as a new immutable schedule version?`)) return;
    setNotice("");
    const response = await fetch("/api/solver/adopt", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        studioId: selectedStudioId,
        candidateContext: candidate.candidateContext,
        assignments: candidate.assignments,
        reason: `Adopt reviewed candidate ${candidate.id}`,
      }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      setNotice(String(payload.error || "The governed adoption route rejected this candidate. Generate a fresh review if the context changed."));
      return;
    }
    setNotice(`Candidate adopted as Schedule v${String((payload.adoption as Record<string, unknown> | undefined)?.scheduleVersion || "new")}.`);
    await refresh();
  }

  async function deleteCandidate(candidate: SolverCandidateReview) {
    if (!window.confirm(`Delete ${candidate.name}? This removes only the review record; schedule history will not change.`)) return;
    const result = await deleteSolverCandidateReview(candidate.id);
    setNotice(result.ok ? "Candidate review deleted. Schedule history is unchanged." : result.error || "The candidate review could not be deleted.");
    if (result.ok) setSelectedCandidateIds((current) => current.filter((id) => id !== candidate.id));
  }

  return <div className="space-y-6">
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-blue-800"><GitCompareArrows className="size-5" /></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.12em] text-blue-800">Candidate review</p>
          <h2 className="mt-1 font-semibold text-blue-950">Saved solver candidates</h2>
          <p className="mt-2 text-sm leading-6 text-blue-950/80">Reopen a candidate to review its exact assignments and pinned Rulebook, Planning Dataset, model, schedule, and lock context. Select two candidates to compare changed sessions and quality-score components.</p>
        </div>
      </div>
      {notice ? <p className="mt-4 rounded-xl border border-blue-200 bg-white p-3 text-sm text-blue-950" role="status">{notice}</p> : null}
    </section>

    {candidateReviews.length ? <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{candidateReviews.map((candidate) => {
      const stale = !solverContextToken || solverCandidateReviewIsStale(candidate, solverContextToken);
      const selected = selectedCandidateIds.includes(candidate.id);
      const breakdown = Object.entries(candidate.quality.breakdown).filter((entry): entry is [string, number] => typeof entry[1] === "number");
      return <article key={candidate.id} className={`rounded-2xl border bg-white p-5 ${selected ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200"}`}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-semibold">{candidate.name}</h2><p className="mt-1 text-xs text-slate-500">{candidate.createdByLabel} · {new Date(candidate.createdAt).toLocaleString()}</p></div>
          <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${stale ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{stale ? "STALE" : "CURRENT"}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold">
          <span className="rounded-md bg-slate-100 px-2 py-1">Rulebook v{candidate.candidateContext.solverContextToken.rulebookVersion}</span>
          <span className="rounded-md bg-slate-100 px-2 py-1">Planning v{candidate.candidateContext.solverContextToken.planningDatasetVersion} · {candidate.candidateContext.solverContextToken.planningDatasetId || "historical"}</span>
          <span className="rounded-md bg-slate-100 px-2 py-1">Schedule v{candidate.candidateContext.solverContextToken.scheduleVersion}</span>
        </div>
        <p className="mt-3 text-sm text-slate-600">{candidate.assignments.length} assignments · {candidate.optimizationStatus === "OPTIMAL" ? "proven optimum" : candidate.optimizationStatus === "FEASIBLE_INCUMBENT" ? "feasible incumbent" : "feasibility result"}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{breakdown.slice(0, 4).map(([key, value]) => <span key={key} className="rounded-md bg-blue-50 px-2 py-1 text-[10px] text-blue-800">{key}: {value}</span>)}</div>
        {stale ? <p className="mt-3 text-xs leading-5 text-amber-800">Read-only historical review. The current context changed, so adoption requires a fresh candidate.</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => toggleCandidate(candidate.id)} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold ${selected ? "bg-blue-900 text-white" : "border border-slate-300 text-slate-700"}`}><GitCompareArrows className="size-3.5" />{selected ? "Selected" : "Compare"}</button>
          <button type="button" disabled={!canEdit || stale} onClick={() => void adoptCandidate(candidate)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-900 px-3 text-xs font-semibold text-white disabled:opacity-40"><CheckCircle2 className="size-3.5" />Adopt</button>
          {canEdit ? <button type="button" onClick={() => void deleteCandidate(candidate)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700"><Trash2 className="size-3.5" />Delete review</button> : null}
        </div>
      </article>;
    })}</section> : <div className="rounded-2xl border border-dashed border-blue-300 bg-white p-8 text-center text-sm text-slate-500">No saved solver candidates yet. Build a schedule from Setup to create a review record.</div>}

    {comparison ? <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2"><GitCompareArrows className="size-5 text-slate-500" /><h2 className="font-semibold">Candidate comparison</h2></div>
      <p className="mt-2 text-sm text-slate-600">{comparison.changedSessions.length} session change{comparison.changedSessions.length === 1 ? "" : "s"} · {comparison.qualityComponents.length} quality component change{comparison.qualityComponents.length === 1 ? "" : "s"}</p>
      {comparison.changedSessions.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-2">Session</th><th className="px-2 py-2">Candidate 1</th><th className="px-2 py-2">Candidate 2</th><th className="px-2 py-2">Changed</th></tr></thead><tbody className="divide-y divide-slate-100">{comparison.changedSessions.map((change) => <tr key={change.sessionId}><td className="px-2 py-2 font-semibold">{change.sessionId}</td><td className="px-2 py-2">{change.left ? `${change.left.day} ${change.left.startTime} · ${change.left.roomId}` : "—"}</td><td className="px-2 py-2">{change.right ? `${change.right.day} ${change.right.startTime} · ${change.right.roomId}` : "—"}</td><td className="px-2 py-2">{change.changedFields.join(", ")}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-slate-500">Assignments are identical.</p>}
      {comparison.qualityComponents.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{comparison.qualityComponents.map((change) => <div key={change.key} className="rounded-xl bg-slate-50 p-3 text-xs"><strong>{change.metric}</strong><span className="ml-2 text-slate-500">{change.leftValue ?? "—"} → {change.rightValue ?? "—"} ({change.delta == null ? "not comparable" : change.delta > 0 ? `+${change.delta}` : change.delta})</span></div>)}</div> : null}
    </section> : null}

    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-amber-800"><ShieldAlert className="size-5"/></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.12em] text-amber-800">Advanced · historical records</p>
          <h2 className="mt-1 font-semibold text-amber-950">Legacy scenarios are read-only</h2>
          <p className="mt-2 text-sm leading-6 text-amber-950/80">These records were created against the older Rulebook / EnforcementVersion / Schedule linkage. They remain visible for audit history, but scenario creation and application are hidden until this surface is rebuilt on the coherent PlanningDatasetVersion + ConstraintModelVersion authority.</p>
        </div>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{state.scenarios.map((scenario) => {
      const baseSchedule = state.scheduleVersions.find((version) => version.version === scenario.baseScheduleVersion);
      const baseEnforcement = scenario.baseEnforcementVersion ?? baseSchedule?.enforcementVersion ?? 0;
      return <article key={scenario.id} className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><FlaskConical className="size-4 text-slate-400"/><h2 className="font-semibold">{scenario.name}</h2></div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold">
          <span className="rounded-md bg-slate-100 px-2 py-1">Rulebook v{scenario.baseRulebookVersion}</span>
          <span className="rounded-md bg-violet-50 px-2 py-1 text-violet-700"><Cpu className="mr-1 inline size-3"/>Legacy Enforcement v{baseEnforcement}</span>
          <span className="rounded-md bg-slate-100 px-2 py-1">Schedule v{scenario.baseScheduleVersion}</span>
        </div>
        <p className="mt-3 text-sm text-slate-600">{scenario.rulePatches.length} historical rule patch{scenario.rulePatches.length === 1 ? "" : "es"} · {scenario.schedulePatches.length} historical schedule patch{scenario.schedulePatches.length === 1 ? "" : "es"}</p>
        {scenario.rulePatches.slice(0, 3).map((item) => <p key={item.id} className="mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">{item.ruleId || "New rule"} · {item.reason}</p>)}
        <p className="mt-3 text-xs text-slate-400">Created {new Date(scenario.createdAt).toLocaleString()}</p>
      </article>;
    })}</section>
    {state.scenarios.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No historical scenarios are stored for this workspace.</div> : null}
  </div>;
}

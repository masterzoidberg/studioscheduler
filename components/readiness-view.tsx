"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { compileConstraintModel } from "@/lib/constraint-compiler-v3";
import { constraintModelDefinition } from "@/lib/constraint-model-version";
import { validateConstraintModelSchedule } from "@/lib/constraint-engine";
import { evaluateScheduleReadiness } from "@/lib/schedule-readiness";
import { getBrowserSupabase } from "@/lib/supabase";

type PublishedModel = {
  version: number;
  rulebookVersion: number;
  compilerVersion: string;
  snapshotHash: string;
  complete: boolean;
};

export function ReadinessView() {
  const {
    state,
    canEdit,
    currentAssignments,
    currentRulebookVersion,
    currentPlanningDatasetVersion,
    currentScheduleVersion,
  } = useWorkspace();
  const [published, setPublished] = useState<PublishedModel | null>(null);
  const [loadingModel, setLoadingModel] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [autoSyncAttempted, setAutoSyncAttempted] = useState(false);

  const model = useMemo(() => state ? compileConstraintModel(state) : null, [state]);
  const definition = useMemo(() => model ? constraintModelDefinition(model) : null, [model]);
  const readiness = useMemo(() => state ? evaluateScheduleReadiness(state) : null, [state]);
  const engine = useMemo(
    () => state && model ? validateConstraintModelSchedule(state, model, currentAssignments) : null,
    [state, model, currentAssignments],
  );

  const loadPublished = useCallback(async () => {
    if (!state) return;
    setLoadingModel(true);
    const { data, error } = await getBrowserSupabase()
      .from("constraint_model_versions")
      .select("version,rulebook_version,compiler_version,snapshot_hash,complete_hard_constraint_compilation")
      .eq("studio_id", state.studioId)
      .eq("status", "CURRENT")
      .maybeSingle();
    if (error) {
      setNotice(error.message);
      setPublished(null);
    } else if (data) {
      setPublished({
        version: Number(data.version),
        rulebookVersion: Number(data.rulebook_version),
        compilerVersion: String(data.compiler_version),
        snapshotHash: String(data.snapshot_hash),
        complete: Boolean(data.complete_hard_constraint_compilation),
      });
    } else {
      setPublished(null);
    }
    setLoadingModel(false);
  }, [state]);

  const syncModel = useCallback(async (automatic = false) => {
    if (!definition || !canEdit || syncing) return;
    setSyncing(true);
    if (!automatic) setNotice("");
    const { data, error } = await getBrowserSupabase().rpc("publish_constraint_model_v30", {
      p_snapshot: definition,
      p_reason: automatic
        ? `Automatic engineering sync of ${definition.compilerVersion} for Rulebook v${definition.rulebookVersion}`
        : `Engineering sync of ${definition.compilerVersion} for Rulebook v${definition.rulebookVersion}`,
      p_expected_rulebook_version: currentRulebookVersion,
    });
    setSyncing(false);
    if (error) {
      setNotice(`Constraint model sync failed: ${error.message}`);
      return;
    }
    const result = (data || {}) as Record<string, unknown>;
    setNotice(
      result.alreadyCurrent
        ? `Constraint Model v${String(result.constraintModelVersion)} is already current.`
        : `Published Constraint Model v${String(result.constraintModelVersion)} from the tested TypeScript compiler.`,
    );
    await loadPublished();
  }, [definition, canEdit, syncing, currentRulebookVersion, loadPublished]);

  useEffect(() => {
    void loadPublished();
  }, [loadPublished]);

  useEffect(() => {
    if (autoSyncAttempted || loadingModel || !canEdit || !definition || !model?.completeHardConstraintCompilation) return;
    const stale = !published
      || published.rulebookVersion !== definition.rulebookVersion
      || published.compilerVersion !== definition.compilerVersion
      || !published.complete;
    setAutoSyncAttempted(true);
    if (stale) void syncModel(true);
  }, [autoSyncAttempted, loadingModel, canEdit, definition, model, published, syncModel]);

  if (!state || !model || !definition || !readiness || !engine) return null;

  const modelCurrent = Boolean(
    published
    && published.rulebookVersion === definition.rulebookVersion
    && published.compilerVersion === definition.compilerVersion
    && published.complete,
  );

  const cards = [
    {
      label: "Rulebook truth",
      value: `v${currentRulebookVersion}`,
      detail: `${model.activeRuleCount}/178 active rules accounted for`,
      icon: ShieldCheck,
    },
    {
      label: "Planning dataset",
      value: `v${currentPlanningDatasetVersion}`,
      detail: `${state.teachers.length} teachers · ${state.students.length} students · ${state.rooms.length} rooms · ${state.classes.length} classes`,
      icon: Database,
    },
    {
      label: "Constraint compiler",
      value: model.completeHardConstraintCompilation ? "Complete" : "Incomplete",
      detail: `${model.hardConstraints.length} typed HARD/fixed constraint nodes · ${model.uncompiledConstraintRuleIds.length} uncompiled`,
      icon: Cpu,
    },
    {
      label: "Published model",
      value: published ? `v${published.version}` : "Not synced",
      detail: published ? `${published.compilerVersion} · Rulebook v${published.rulebookVersion}` : "Will sync from the tested compiler for editors", 
      icon: RefreshCw,
    },
  ];

  return (
    <div className="space-y-6">
      <section className={`rounded-3xl border p-5 sm:p-6 ${readiness.ready && engine.valid && modelCurrent ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              {readiness.ready && engine.valid && modelCurrent ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
              Automatic scheduling readiness
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              {readiness.ready && engine.valid && modelCurrent ? "Scheduling knowledge is ready for a feasibility solver" : "Foundation checks still need attention"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              This gate combines the reviewed Rulebook, the current fluid Planning Dataset, the canonical Constraint IR compiler, and an independent runtime evaluation of the current assignments. Inventory changes are expected. They create a new Planning Dataset version instead of rewriting history.
            </p>
          </div>
          {canEdit ? (
            <button
              disabled={syncing || !model.completeHardConstraintCompilation}
              onClick={() => void syncModel(false)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing model…" : "Sync constraint model"}
            </button>
          ) : null}
        </div>
        {notice ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div> : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, detail, icon: Icon }) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-600">{label}</p><Icon className="size-4 text-slate-400" /></div>
            <p className="mt-5 text-2xl font-semibold tracking-tight">{value}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Planning gate</p><h3 className="mt-1 text-lg font-semibold">Inventory and Rulebook structure</h3></div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${readiness.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{readiness.ready ? "Ready" : `${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? "" : "s"}`}</span>
          </div>
          <div className="mt-4 space-y-3">
            {readiness.blockers.map((issue) => (
              <div key={`${issue.code}-${issue.entityIds.join("-")}`} className="rounded-xl border border-red-100 bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-950">{issue.message}</p>
                <p className="mt-1 text-xs text-red-700">{issue.code}{issue.ruleIds.length ? ` · ${issue.ruleIds.join(", ")}` : ""}</p>
              </div>
            ))}
            {readiness.warnings.map((issue) => (
              <div key={`${issue.code}-${issue.entityIds.join("-")}`} className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-950">{issue.message}</p>
                <p className="mt-1 text-xs text-amber-700">{issue.code}</p>
              </div>
            ))}
            {!readiness.blockers.length && !readiness.warnings.length ? <p className="py-6 text-center text-sm text-slate-500">No planning readiness findings.</p> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Constraint X-Ray foundation</p><h3 className="mt-1 text-lg font-semibold">Canonical IR runtime check</h3></div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${engine.valid ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{engine.valid ? "No detected conflict" : `${engine.hardViolations} finding${engine.hardViolations === 1 ? "" : "s"}`}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            {engine.evaluatedConstraintIds.length} constraint nodes evaluated directly, {engine.delegatedConstraintIds.length} delegated to structural readiness, {engine.unsupportedConstraintIds.length} unsupported. Schedule v{currentScheduleVersion} is used only as a diagnostic candidate here.
          </p>
          <div className="mt-4 space-y-3">
            {engine.violations.slice(0, 20).map((issue, index) => (
              <div key={`${issue.constraintId}-${index}`} className="rounded-xl bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-900">{issue.message}</p>
                <p className="mt-1 text-xs text-slate-500">{issue.constraintId} · {issue.ruleIds.join(", ")}</p>
              </div>
            ))}
            {!engine.violations.length ? <p className="py-6 text-center text-sm text-slate-500">No conflict detected under the current Constraint IR candidate evaluation.</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
        <strong>Important:</strong> this page does not claim the current schedule is fully legal merely because the candidate has no IR finding. Automatic solving remains blocked until the planning gate is clear, the published model matches the current Rulebook/compiler, and the solver itself passes independent golden-fixture validation.
      </section>
    </div>
  );
}

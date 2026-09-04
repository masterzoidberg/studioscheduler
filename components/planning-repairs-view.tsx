"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, GraduationCap, ListChecks, UsersRound, Wrench, X } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { mutatePlanningEntity } from "@/lib/planning-inventory-client";
import { rulebookClassStructureRepairs } from "@/lib/planning-structure-repair";
import {
  rulebookRosterRepairDraft,
  rulebookRosterRepairs,
  type RulebookRosterRepair,
} from "@/lib/planning-roster-repair";

function statusLabel(status: RulebookRosterRepair["status"]) {
  switch (status) {
    case "ROSTER_MISSING": return "Roster addition";
    case "CLASS_MISSING": return "Class missing";
    case "CLASS_AMBIGUOUS": return "Class ambiguous";
    case "STUDENT_MISSING": return "Student missing";
    case "STUDENT_AMBIGUOUS": return "Student ambiguous";
  }
}

export function PlanningRepairsView() {
  const { state, canEdit, currentPlanningDatasetVersion, refresh } = useWorkspace();
  const [activeRepair, setActiveRepair] = useState<RulebookRosterRepair | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const structureRepairs = useMemo(
    () => state ? rulebookClassStructureRepairs({ classes: state.classes, sessions: state.sessions }) : [],
    [state],
  );
  const rosterRepairs = useMemo(
    () => state ? rulebookRosterRepairs({ classes: state.classes, students: state.students }) : [],
    [state],
  );

  if (!state) return null;
  const workspaceState = state;

  const studentNames = new Map(workspaceState.students.map((student) => [student.id, student.name]));
  const currentPlanning = workspaceState.planningDatasetVersions?.find((version) => version.status === "CURRENT") ?? null;
  const planningConfirmed = Boolean(currentPlanning?.confirmedForSchedulingAt);
  const actionableRosterRepairs = rosterRepairs.filter((repair) => repair.status === "ROSTER_MISSING");
  const blockedRosterRepairs = rosterRepairs.filter((repair) => repair.status !== "ROSTER_MISSING");
  const activeClass = activeRepair?.classId
    ? workspaceState.classes.find((klass) => klass.id === activeRepair.classId) ?? null
    : null;
  const activeCurrentNames = activeClass
    ? activeClass.rosterStudentIds.map((id) => studentNames.get(id) ?? id).sort((a, b) => a.localeCompare(b))
    : [];
  const activeAdditionNames = activeRepair?.requiredStudentNames ?? [];
  const activeAfterNames = activeClass && activeRepair
    ? [...new Set([...activeClass.rosterStudentIds, ...activeRepair.requiredStudentIds])]
      .map((id) => studentNames.get(id) ?? id)
      .sort((a, b) => a.localeCompare(b))
    : [];

  async function applyRosterRepair() {
    if (!activeRepair || activeRepair.status !== "ROSTER_MISSING" || !activeRepair.classId || !canEdit || saving) return;
    const klass = workspaceState.classes.find((item) => item.id === activeRepair.classId);
    if (!klass) {
      setNotice("The target class changed while this repair was open. Refresh and review the repair again.");
      setActiveRepair(null);
      return;
    }

    const missingRequired = activeRepair.requiredStudentIds.filter(
      (id) => !workspaceState.students.some((student) => student.id === id),
    );
    if (missingRequired.length) {
      setNotice("A Rulebook-required student record is no longer present. Resolve People data before applying this repair.");
      setActiveRepair(null);
      return;
    }

    const draft = rulebookRosterRepairDraft(activeRepair, klass);
    setSaving(true);
    setNotice("");
    const result = await mutatePlanningEntity({
      operation: "UPDATE",
      entityType: "CLASS",
      entityId: klass.id,
      changes: {
        name: draft.name,
        subject: draft.subject,
        level: draft.level,
        durationMinutes: draft.durationMinutes,
        weeklyFrequency: draft.weeklyFrequency,
        rosterStudentIds: draft.rosterStudentIds,
        companyOnly: Boolean(draft.companyOnly),
      },
      reason: `Applied reviewed Rulebook roster additions for ${klass.name} (${activeRepair.ruleIds.join(", ")})`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });
    setSaving(false);

    if (!result.ok) {
      setNotice(result.error || "Roster repair failed.");
      return;
    }

    setActiveRepair(null);
    await refresh();
    setNotice(
      `Applied additive Rulebook roster repair for ${klass.name}. Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}; review the remaining repairs before confirmation.`,
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white"><ListChecks className="size-5" /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Path to first solve</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Planning repairs</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Repair only facts the reviewed Rulebook can establish deterministically, then review the full immutable Planning Dataset before confirming it. Missing source rosters are never reconstructed from guesses.
            </p>
          </div>
        </div>
        {notice ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div> : null}
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <article className={`rounded-2xl border p-5 ${structureRepairs.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="flex items-center justify-between gap-3"><Wrench className="size-5 text-slate-500" />{!structureRepairs.length ? <CheckCircle2 className="size-5 text-emerald-600" /> : null}</div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Stage 1</p>
          <h2 className="mt-1 font-semibold">Class structure</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {structureRepairs.length
              ? `${structureRepairs.length} verified Ballet/Pointe structure repair${structureRepairs.length === 1 ? "" : "s"} still need review.`
              : "All verified Ballet/Pointe structure requirements are represented."}
          </p>
          <Link href="/classes" className="mt-4 inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900">Open class repairs</Link>
        </article>

        <article className={`rounded-2xl border p-5 ${rosterRepairs.length ? "border-violet-200 bg-violet-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="flex items-center justify-between gap-3"><UsersRound className="size-5 text-slate-500" />{!rosterRepairs.length ? <CheckCircle2 className="size-5 text-emerald-600" /> : null}</div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Stage 2</p>
          <h2 className="mt-1 font-semibold">Rulebook roster facts</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {rosterRepairs.length
              ? `${actionableRosterRepairs.length} additive repair${actionableRosterRepairs.length === 1 ? " is" : "s are"} actionable now; ${blockedRosterRepairs.length} depend on missing or ambiguous class/person records.`
              : "Every explicit Rulebook enrollment relationship is represented in current rosters."}
          </p>
        </article>

        <article className={`rounded-2xl border p-5 ${planningConfirmed ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex items-center justify-between gap-3"><GraduationCap className="size-5 text-slate-500" />{planningConfirmed ? <CheckCircle2 className="size-5 text-emerald-600" /> : null}</div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Stage 3</p>
          <h2 className="mt-1 font-semibold">Review & confirm snapshot</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {planningConfirmed
              ? `Planning Dataset v${currentPlanningDatasetVersion} is confirmed for scheduling.`
              : `Planning Dataset v${currentPlanningDatasetVersion} remains unconfirmed until deterministic blockers clear and a manager reviews the full snapshot.`}
          </p>
          <Link href="/readiness" className="mt-4 inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900">Open readiness & solver</Link>
        </article>
      </section>

      <section className={`rounded-2xl border p-5 ${rosterRepairs.length ? "border-violet-200 bg-white" : "border-emerald-200 bg-emerald-50/50"}`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Explicit enrollment relationships</p>
            <h2 className="mt-1 text-lg font-semibold">Rulebook roster repair queue</h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">
              Repairs here are additive only. They preserve every existing roster member and every non-roster class field. General enrollment still comes from current studio roster truth, not from this queue.
            </p>
          </div>
          {rosterRepairs.length ? <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-900">{rosterRepairs.length} finding{rosterRepairs.length === 1 ? "" : "s"}</span> : null}
        </div>

        {rosterRepairs.length ? (
          <div className="mt-4 grid gap-3">
            {rosterRepairs.map((repair, index) => (
              <article key={`${repair.status}-${repair.className ?? "relationship"}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-950">{repair.className ?? repair.relationshipLabels[0]}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${repair.status === "ROSTER_MISSING" ? "bg-violet-100 text-violet-900" : "bg-amber-100 text-amber-900"}`}>{statusLabel(repair.status)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{repair.detail}</p>
                    {repair.requiredStudentNames.length ? <p className="mt-2 text-xs text-slate-500"><strong>Required:</strong> {repair.requiredStudentNames.join(", ")}</p> : null}
                    <p className="mt-1 text-[11px] text-slate-400">{repair.relationshipLabels.join(" · ")}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">{repair.ruleIds.join(" · ")}</p>
                  </div>
                  <div className="shrink-0">
                    {canEdit && repair.status === "ROSTER_MISSING" ? (
                      <button type="button" onClick={() => setActiveRepair(repair)} className="min-h-10 rounded-xl bg-violet-950 px-4 text-xs font-semibold text-white">Review additions</button>
                    ) : repair.status === "CLASS_MISSING" || repair.status === "CLASS_AMBIGUOUS" ? (
                      <Link href="/classes" className="inline-flex min-h-10 items-center rounded-xl border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950">Resolve class first</Link>
                    ) : (
                      <Link href="/people" className="inline-flex min-h-10 items-center rounded-xl border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950">Resolve person first</Link>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-sm font-medium text-emerald-900"><CheckCircle2 className="size-5 shrink-0" />No explicit Rulebook roster relationship repairs remain.</div>
        )}
      </section>

      {activeRepair ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-6">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 sm:rounded-[28px] sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">Additive Rulebook repair</p><h2 className="mt-1 text-xl font-semibold">Review {activeRepair.className}</h2></div>
              <button type="button" onClick={() => setActiveRepair(null)} aria-label="Close roster repair"><X className="size-5" /></button>
            </div>

            {!activeClass ? (
              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><AlertTriangle className="mr-2 inline size-4" />The target class is no longer available. Close this review and refresh the repair queue.</div>
            ) : (
              <>
                <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm leading-6 text-violet-950">
                  <strong>This action can only add the Rulebook-required students shown below.</strong> It does not remove current roster members and does not change name, subject, level, duration, frequency, company status, teacher eligibility, or sessions.
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current roster · {activeCurrentNames.length}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{activeCurrentNames.length ? activeCurrentNames.join(", ") : "No students currently listed."}</p>
                  </div>
                  <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Required additions · {activeAdditionNames.length}</p>
                    <p className="mt-2 text-sm font-medium leading-6 text-violet-950">{activeAdditionNames.join(", ")}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resulting roster · {activeAfterNames.length}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{activeAfterNames.join(", ")}</p>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 p-3 text-xs leading-5 text-slate-600">
                  <p><strong>Rulebook basis:</strong> {activeRepair.ruleIds.join(", ")}</p>
                  <p className="mt-1"><strong>Relationship:</strong> {activeRepair.relationshipLabels.join(" · ")}</p>
                </div>

                <div className="mt-5 flex gap-2">
                  <button type="button" onClick={() => setActiveRepair(null)} className="min-h-11 flex-1 rounded-xl border border-slate-300 text-sm font-semibold">Cancel</button>
                  <button type="button" disabled={!canEdit || saving} onClick={() => void applyRosterRepair()} className="min-h-11 flex-1 rounded-xl bg-violet-950 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Applying…" : "Apply required additions"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

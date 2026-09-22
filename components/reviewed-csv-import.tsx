"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { CheckCircle2, Download, FileUp, Upload } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import {
  parseReviewedCsvBundle,
  reviewedCsvTemplates,
  type ReviewedCsvBundle,
  type ReviewedCsvInventory,
} from "@/lib/reviewed-csv-intake";

type CsvKind = keyof ReviewedCsvBundle;
const kinds: Array<{ key: CsvKind; label: string; detail: string }> = [
  { key: "teachers", label: "Teachers CSV", detail: "id, name, notes" },
  { key: "students", label: "Students CSV", detail: "id, name, level" },
  { key: "classes", label: "Classes CSV", detail: "id, name, subject, level, duration, frequency, scope" },
  { key: "roster", label: "Roster CSV", detail: "class_id, student_id" },
];

const emptyBundle: ReviewedCsvBundle = { teachers: "", students: "", classes: "", roster: "" };
const newBatchId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `import-${Date.now()}`;

function downloadCsv(kind: CsvKind) {
  const blob = new Blob([reviewedCsvTemplates[kind]], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${kind}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReviewedCsvImport() {
  const { state, canEdit, currentPlanningDatasetVersion, applyReviewedCsvImport } = useWorkspace();
  const [bundle, setBundle] = useState<ReviewedCsvBundle>(emptyBundle);
  const [fileNames, setFileNames] = useState<Partial<Record<CsvKind, string>>>({});
  const [batchId, setBatchId] = useState(newBatchId);
  const [reason, setReason] = useState("Reviewed CSV planning inventory import");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"info" | "error">("info");

  const inventory = useMemo<ReviewedCsvInventory | null>(() => state ? ({
    teachers: state.teachers,
    students: state.students,
    classes: state.classes,
  }) : null, [state]);
  const preview = useMemo(() => inventory ? parseReviewedCsvBundle(bundle, inventory) : null, [bundle, inventory]);

  async function selectFile(kind: CsvKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice("");
    setFileNames((current) => ({ ...current, [kind]: file.name }));
    const text = await file.text();
    setBundle((current) => ({ ...current, [kind]: text }));
    setReviewed(false);
  }

  async function apply() {
    if (!preview?.valid || !reviewed || !reason.trim()) return;
    setBusy(true);
    setNotice("");
    const result = await applyReviewedCsvImport({
      batchId,
      rows: preview.rows,
      reason: reason.trim(),
      sourceMetadata: {
        format: "CSV",
        schemaVersion: "1.0",
        source: "BROWSER_CSV_REVIEW",
        fileKinds: Object.keys(fileNames).sort(),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error || "The reviewed CSV batch was rejected. Your draft remains available for correction.");
      setNoticeTone("error");
      return;
    }
    setNotice(`Applied ${preview.rows.length} reviewed planning row${preview.rows.length === 1 ? "" : "s"}. Planning Dataset advanced to v${result.version ?? currentPlanningDatasetVersion}.`);
    setNoticeTone("info");
    setBundle(emptyBundle);
    setFileNames({});
    setReviewed(false);
    setBatchId(newBatchId());
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <div className="flex items-start gap-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50"><Upload className="size-5 text-violet-700" /></div>
      <div><h2 className="font-semibold">Reviewed CSV intake</h2><p className="mt-1 text-sm leading-6 text-slate-600">Load people, classes, and rosters with explicit stable IDs. Nothing is written until the complete preview is reviewed and applied as one atomic PlanningDataset batch.</p></div>
    </div>

    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">1. Download templates</h3><p className="mt-1 text-xs text-slate-600">Use the ID columns for matching. Names never merge records automatically.</p></div><Download className="size-4 text-slate-400" /></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {kinds.map((kind) => <button key={kind.key} type="button" onClick={() => downloadCsv(kind.key)} className="flex min-h-11 items-center justify-between rounded-xl border border-slate-300 bg-white px-3 text-left text-xs font-semibold"><span>{kind.label}<small className="mt-1 block font-normal text-slate-500">{kind.detail}</small></span><Download className="size-4 text-slate-500" /></button>)}
      </div>
    </div>

    <div className="mt-4 rounded-xl border border-slate-200 p-4">
      <div><h3 className="text-sm font-semibold">2. Choose CSV files</h3><p className="mt-1 text-xs text-slate-600">CSV values must be plain text. Formula-like exported values are rejected.</p></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {kinds.map((kind) => <label key={kind.key} className="flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 p-3 hover:border-slate-500"><FileUp className="size-5 shrink-0 text-slate-500" /><span className="min-w-0"><strong className="block text-xs font-semibold">{kind.label}</strong><span className="mt-1 block truncate text-xs text-slate-500">{fileNames[kind.key] || "Choose a file"}</span><input aria-label={kind.label} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void selectFile(kind.key, event)} /></span></label>)}
      </div>
    </div>

    <div className="mt-4 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">3. Preview and review</h3><p className="mt-1 text-xs text-slate-600">Expected Planning Dataset: v{currentPlanningDatasetVersion}. A stale version rejects without writes.</p></div>{preview?.valid ? <CheckCircle2 className="size-5 text-emerald-600" /> : null}</div>
      {preview ? <>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div className="rounded-lg bg-slate-50 p-2"><strong className="block text-lg">{preview.counts.teachers}</strong>teachers</div><div className="rounded-lg bg-slate-50 p-2"><strong className="block text-lg">{preview.counts.students}</strong>students</div><div className="rounded-lg bg-slate-50 p-2"><strong className="block text-lg">{preview.counts.classes}</strong>classes</div><div className="rounded-lg bg-slate-50 p-2"><strong className="block text-lg">{preview.counts.rosterLinks}</strong>roster links</div></div>
        {preview.errors.length ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900" role="alert"><strong>Fix before applying</strong><ul className="mt-2 space-y-1">{preview.errors.slice(0, 12).map((error) => <li key={`${error.code}-${error.path}`}>{error.path}: {error.message}</li>)}</ul>{preview.errors.length > 12 ? <p className="mt-2">And {preview.errors.length - 12} more issue{preview.errors.length - 12 === 1 ? "" : "s"}.</p> : null}</div> : null}
        {preview.warnings.length ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Review warnings</strong><ul className="mt-2 space-y-1">{preview.warnings.slice(0, 8).map((warning) => <li key={`${warning.code}-${warning.path}`}>{warning.message}</li>)}</ul></div> : null}
        <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-700"><input type="checkbox" className="mt-1 size-4" checked={reviewed} disabled={!preview.valid} onChange={(event) => setReviewed(event.target.checked)} />I reviewed the stable IDs, duplicate/missing-reference results, and the complete batch. Apply exactly this preview.</label>
      </> : null}
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <label className="text-xs font-semibold text-slate-700">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal" /></label>
      <div className="text-xs text-slate-500"><span className="font-semibold text-slate-700">Retry-safe batch</span><span className="mt-1 block break-all">{batchId}</span></div>
      <button type="button" disabled={!canEdit || busy || !preview?.valid || !reviewed || !reason.trim()} onClick={() => void apply()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-40"><Upload className="size-4" />{busy ? "Applying…" : "Apply reviewed batch"}</button>
    </div>
    {notice ? <p className={`mt-3 rounded-xl p-3 text-xs leading-5 ${noticeTone === "error" ? "border border-red-200 bg-red-50 text-red-900" : "border border-emerald-200 bg-emerald-50 text-emerald-900"}`} role="status">{notice}</p> : null}
    {!canEdit ? <p className="mt-3 text-xs text-amber-800">Editor access is required to apply a reviewed planning import.</p> : null}
  </section>;
}

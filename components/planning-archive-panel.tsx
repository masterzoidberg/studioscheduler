"use client";

import { ArchiveRestore, ArchiveX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { getBrowserSupabase } from "@/lib/supabase";
import type { PlanningEntityType } from "@/lib/planning-inventory-client";
import { setPlanningEntityArchived } from "@/lib/planning-archive-client";

const STUDIO_ID = "11111111-1111-4111-8111-111111111111";

type ArchivedItem = {
  entityType: PlanningEntityType;
  id: string;
  name: string;
  detail: string;
  archivedAt: string;
};

type ArchivedLoadResult = {
  items: ArchivedItem[];
  error: string;
};

const labels: Record<PlanningEntityType, string> = {
  TEACHER: "Teacher",
  STUDENT: "Student",
  ROOM: "Room",
  CLASS: "Class",
};

async function loadArchivedItems(entityTypes: PlanningEntityType[]): Promise<ArchivedLoadResult> {
  const wanted = new Set(entityTypes);
  const supabase = getBrowserSupabase();
  const queries: PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>[] = [];
  const types: PlanningEntityType[] = [];

  if (wanted.has("TEACHER")) {
    queries.push(supabase.from("teachers").select("id,name,archived_at").eq("studio_id", STUDIO_ID).not("archived_at", "is", null).order("name"));
    types.push("TEACHER");
  }
  if (wanted.has("STUDENT")) {
    queries.push(supabase.from("students").select("id,name,level,archived_at").eq("studio_id", STUDIO_ID).not("archived_at", "is", null).order("name"));
    types.push("STUDENT");
  }
  if (wanted.has("ROOM")) {
    queries.push(supabase.from("rooms").select("id,name,capacity,archived_at").eq("studio_id", STUDIO_ID).not("archived_at", "is", null).order("name"));
    types.push("ROOM");
  }
  if (wanted.has("CLASS")) {
    queries.push(supabase.from("class_definitions").select("id,name,subject,level,archived_at").eq("studio_id", STUDIO_ID).not("archived_at", "is", null).order("name"));
    types.push("CLASS");
  }

  const results = await Promise.all(queries);
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) {
    return { items: [], error: firstError instanceof Error ? firstError.message : String(firstError) };
  }

  const items: ArchivedItem[] = [];
  results.forEach((result, index) => {
    const entityType = types[index];
    for (const row of result.data || []) {
      const detail = entityType === "STUDENT"
        ? String(row.level || "")
        : entityType === "ROOM"
          ? `Capacity ${row.capacity ?? "not set"}`
          : entityType === "CLASS"
            ? [row.subject, row.level].filter(Boolean).join(" · ")
            : "";
      items.push({
        entityType,
 id: String(row.id),
        name: String(row.name),
        detail,
        archivedAt: String(row.archived_at || ""),
      });
    }
  });
  items.sort((a, b) => a.entityType.localeCompare(b.entityType) || a.name.localeCompare(b.name));
  return { items, error: "" };
}

export function PlanningArchivePanel({ entityTypes }: { entityTypes: PlanningEntityType[] }) {
  const { canEdit, currentPlanningDatasetVersion, refresh } = useWorkspace();
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const entityTypeKey = useMemo(() => [...entityTypes].sort().join("|"), [entityTypes]);

  useEffect(() => {
    let active = true;
    const requestedTypes = entityTypeKey.split("|").filter(Boolean) as PlanningEntityType[];
    void loadArchivedItems(requestedTypes).then((result) => {
      if (!active) return;
      setItems(result.items);
      if (result.error) setNotice(result.error);
      setLoading(false);
    });
    return () => { active = false; };
  }, [entityTypeKey, currentPlanningDatasetVersion]);

  async function restore(item: ArchivedItem) {
    if (!canEdit || restoring) return;
    setRestoring(`${item.entityType}:${item.id}`);
    setNotice("");
    const result = await setPlanningEntityArchived({
      entityType: item.entityType,
      entityId: item.id,
      archive: false,
      reason: `Restored ${labels[item.entityType].toLowerCase()} ${item.name} to active planning inventory`,
      expectedPlanningDatasetVersion: currentPlanningDatasetVersion,
    });
    setRestoring(null);
    if (!result.ok) {
      setNotice(result.error || `Could not restore ${item.name}.`);
      return;
    }
    await refresh();
    const reloaded = await loadArchivedItems(entityTypeKey.split("|").filter(Boolean) as PlanningEntityType[]);
    setItems(reloaded.items);
    setNotice(
      reloaded.error
        ? reloaded.error
        : `${item.name} restored. Planning Dataset advanced to v${result.planningDatasetVersion ?? "?"}; review readiness before scheduling.`,
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Historical inventory</p>
          <h2 className="mt-1 font-semibold text-slate-950">Archived records</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
            Archived records remain available for historical schedules and audit history, but they do not participate in the active Planning Dataset or solver. Restore them here if they become current again.
          </p>
        </div>
        <ArchiveX className="size-5 shrink-0 text-slate-400" />
      </div>

      {notice ? <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">{notice}</div> : null}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading archived records…</p>
      ) : items.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const key = `${item.entityType}:${item.id}`;
            return (
              <article key={key} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{labels[item.entityType]}</p>
                    <h3 className="mt-1 truncate font-semibold text-slate-900">{item.name}</h3>
                    {item.detail ? <p className="mt-1 text-xs text-slate-500">{item.detail}</p> : null}
                    <p className="mt-2 text-[11px] text-slate-400">Archived {item.archivedAt ? new Date(item.archivedAt).toLocaleDateString() : "previously"}</p>
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={restoring === key}
                      onClick={() => void restore(item)}
                      className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                    >
                      <ArchiveRestore className="size-3.5" />{restoring === key ? "Restoring…" : "Restore"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No archived records in this part of the inventory.</p>
      )}
    </section>
  );
}

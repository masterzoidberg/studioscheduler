import { getBrowserSupabase } from "@/lib/supabase";
import type { SetupAssignment, SetupAssignmentArea, SetupAssignmentStatus } from "@/lib/domain";

export interface SetupAssignmentInput {
  assignedTo: string;
  area: SetupAssignmentArea;
  title: string;
  instructions?: string;
}

export interface SetupAssignmentUpdate extends SetupAssignmentInput {
  assignmentId: string;
  status: SetupAssignmentStatus;
}

export interface SetupAssignmentMutationResult {
  ok: boolean;
  error?: string;
  assignmentId?: string;
  details?: Record<string, unknown>;
}

const areas = new Set<SetupAssignmentArea>(["STUDIO", "PEOPLE", "CLASSES", "STUDENTS", "POLICIES", "IMPORT"]);
const statuses = new Set<SetupAssignmentStatus>(["OPEN", "IN_PROGRESS", "DONE"]);

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? error);
  return String(error);
}

function details(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function mapSetupAssignment(row: Record<string, unknown>): SetupAssignment | null {
  const area = String(row.area || "") as SetupAssignmentArea;
  const status = String(row.status || "") as SetupAssignmentStatus;
  const id = String(row.id || "");
  const studioId = String(row.studio_id || "");
  const assignedTo = String(row.assigned_to || "");
  const createdBy = String(row.created_by || "");
  if (!id || !studioId || !assignedTo || !createdBy || !areas.has(area) || !statuses.has(status)) return null;
  return {
    id,
    studioId,
    area,
    title: String(row.title || ""),
    instructions: row.instructions == null ? null : String(row.instructions),
    status,
    assignedTo,
    assignedToLabel: String(row.assigned_to_label || "Studio user"),
    createdBy,
    createdByLabel: String(row.created_by_label || "Studio user"),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || row.created_at || ""),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  };
}

export async function listSetupAssignments(studioId: string) {
  try {
    const { data, error } = await getBrowserSupabase().rpc("list_setup_assignments_v69", { p_studio_id: studioId });
    if (error) throw error;
    const items = (Array.isArray(data) ? data : [])
      .map((row) => mapSetupAssignment(row as Record<string, unknown>))
      .filter((row): row is SetupAssignment => row !== null);
    return { ok: true as const, items };
  } catch (error) {
    return { ok: false as const, error: message(error), items: [] as SetupAssignment[] };
  }
}

export async function createSetupAssignment(studioId: string, input: SetupAssignmentInput): Promise<SetupAssignmentMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("create_setup_assignment_v69", {
      p_studio_id: studioId,
      p_assigned_to: input.assignedTo,
      p_area: input.area,
      p_title: input.title,
      p_instructions: input.instructions || null,
    });
    if (error) throw error;
    const result = details(data);
    return { ok: true, assignmentId: typeof result.id === "string" ? result.id : undefined, details: result };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function updateSetupAssignment(studioId: string, input: SetupAssignmentUpdate): Promise<SetupAssignmentMutationResult> {
  try {
    const { data, error } = await getBrowserSupabase().rpc("update_setup_assignment_v69", {
      p_studio_id: studioId,
      p_assignment_id: input.assignmentId,
      p_assigned_to: input.assignedTo,
      p_area: input.area,
      p_title: input.title,
      p_instructions: input.instructions || null,
      p_status: input.status,
    });
    if (error) throw error;
    const result = details(data);
    return { ok: true, assignmentId: typeof result.id === "string" ? result.id : input.assignmentId, details: result };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

"use client";

import Link from "next/link";
import { ArrowRight, ClipboardList, UserRound } from "lucide-react";
import { useState } from "react";
import type { SetupAssignment, SetupAssignmentArea, SetupAssignmentStatus } from "@/lib/domain";
import { useWorkspace } from "@/components/workspace-provider";

const areaMeta: Record<SetupAssignmentArea, { label: string; description: string; href: string }> = {
  STUDIO: { label: "Studio", description: "Rooms, hours, and room restrictions", href: "#setup-studio" },
  PEOPLE: { label: "People", description: "Teachers, rooms, or students in the working inventory", href: "/people" },
  CLASSES: { label: "Classes", description: "Class structure, scope, and roster setup", href: "#setup-class-details" },
  STUDENTS: { label: "Students", description: "Student restrictions and relationships", href: "#setup-student-policies" },
  POLICIES: { label: "Requirements", description: "Rulebook-backed repairs and requirements", href: "/planning-repairs" },
  IMPORT: { label: "CSV import", description: "Reviewed people, classes, or roster intake", href: "/settings#setup-import" },
};

const statuses: Array<{ value: SetupAssignmentStatus; label: string }> = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "DONE", label: "Done" },
];

function memberLabel(member: { displayName?: string; email?: string; userId: string }) {
  return member.displayName || member.email || member.userId;
}

function assignmentStatusLabel(status: SetupAssignmentStatus) {
  return statuses.find((option) => option.value === status)?.label || status;
}

function AssignmentCard({
  assignment,
  canUpdate,
  onStatusChange,
}: {
  assignment: SetupAssignment;
  canUpdate: boolean;
  onStatusChange: (assignment: SetupAssignment, status: SetupAssignmentStatus) => void;
}) {
  const area = areaMeta[assignment.area];
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{area.label}</p>
          <h4 className="mt-1 text-sm font-semibold text-slate-950">{assignment.title}</h4>
          <p className="mt-1 text-xs text-slate-500">Assigned to {assignment.assignedToLabel}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-600">
          <span className="sr-only">Status for {assignment.title}</span>
          <select
            value={assignment.status}
            disabled={!canUpdate}
            onChange={(event) => onStatusChange(assignment, event.target.value as SetupAssignmentStatus)}
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
          >
            {statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      {assignment.instructions ? <p className="mt-3 text-sm leading-6 text-slate-600">{assignment.instructions}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href={area.href} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-900 hover:bg-slate-50">
          Open {area.label} form <ArrowRight className="size-3.5" />
        </Link>
        <span className="text-xs text-slate-500">{assignmentStatusLabel(assignment.status)}</span>
      </div>
    </article>
  );
}

export function SetupAssignments() {
  const {
    state, session, canEdit, members, setupAssignments, createSetupAssignment, updateSetupAssignment,
  } = useWorkspace();
  const [area, setArea] = useState<SetupAssignmentArea>("STUDIO");
  const [assignee, setAssignee] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  if (!state) return null;

  const eligibleMembers = members.filter((member) => member.role === "OWNER" || member.role === "EDITOR");
  const defaultAssignee = assignee || eligibleMembers.find((member) => member.userId === session?.user.id)?.userId || eligibleMembers[0]?.userId || "";
  const visibleAssignments = canEdit
    ? setupAssignments
    : setupAssignments.filter((assignment) => assignment.assignedTo === session?.user.id);

  async function create() {
    if (!defaultAssignee || !title.trim()) {
      setNotice("Choose an editor and add a short title before assigning setup work.");
      return;
    }
    setBusy(true);
    const result = await createSetupAssignment({ assignedTo: defaultAssignee, area, title: title.trim(), instructions: instructions.trim() });
    setBusy(false);
    setNotice(result.ok ? "Setup work assigned. The assignee can enter the information from the linked form." : result.error || "The setup assignment could not be created.");
    if (result.ok) {
      setTitle("");
      setInstructions("");
    }
  }

  async function changeStatus(assignment: SetupAssignment, status: SetupAssignmentStatus) {
    if (status === assignment.status) return;
    setUpdatingId(assignment.id);
    const result = await updateSetupAssignment({
      assignmentId: assignment.id,
      assignedTo: assignment.assignedTo,
      area: assignment.area,
      title: assignment.title,
      instructions: assignment.instructions || "",
      status,
    });
    setUpdatingId(null);
    setNotice(result.ok ? `Marked “${assignment.title}” ${assignmentStatusLabel(status).toLowerCase()}.` : result.error || "The setup assignment could not be updated.");
  }

  return (
    <section id="setup-assignment" className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4 sm:p-5" aria-labelledby="setup-assignment-heading">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-sky-800"><ClipboardList className="size-5" /></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-800">Delegated setup work</p>
          <h3 id="setup-assignment-heading" className="mt-1 text-xl font-semibold text-slate-950">Assign setup, then let people enter it themselves</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">Managers assign a concrete setup area to a current Owner or Editor. The assignee enters information in the existing canonical form; manager readiness review remains a separate step.</p>
        </div>
      </div>

      {notice ? <div role="status" className="mt-4 rounded-lg border border-sky-200 bg-white p-3 text-sm text-sky-900">{notice}</div> : null}

      {canEdit ? (
        <div className="mt-5 rounded-xl border border-sky-200 bg-white p-4">
          <div className="flex items-center gap-2"><UserRound className="size-4 text-sky-800" /><h4 className="text-sm font-semibold text-slate-950">Create an assignment</h4></div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
            <div>
              <label htmlFor="setup-assignment-area" className="text-xs font-semibold text-slate-700">Area</label>
              <select id="setup-assignment-area" value={area} onChange={(event) => setArea(event.target.value as SetupAssignmentArea)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                {Object.entries(areaMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label} — {meta.description}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="setup-assignment-assignee" className="text-xs font-semibold text-slate-700">Assign to</label>
              <select id="setup-assignment-assignee" value={defaultAssignee} onChange={(event) => setAssignee(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                {eligibleMembers.map((member) => <option key={member.userId} value={member.userId}>{memberLabel(member)} · {member.role}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="setup-assignment-title" className="text-xs font-semibold text-slate-700">Task title</label>
              <input id="setup-assignment-title" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add current teacher availability" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm" />
            </div>
          </div>
          <label htmlFor="setup-assignment-instructions" className="mt-3 block text-xs font-semibold text-slate-700">Instructions (optional)</label>
          <textarea id="setup-assignment-instructions" maxLength={2000} value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={3} placeholder="Describe what the assignee should verify or enter." className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="button" disabled={busy || !defaultAssignee} onClick={() => void create()} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">{busy ? "Assigning…" : "Assign setup work"}</button>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="flex items-end justify-between gap-3">
          <div><h4 className="text-sm font-semibold text-slate-950">{canEdit ? "Workspace setup work" : "My setup work"}</h4><p className="mt-1 text-xs text-slate-600">{canEdit ? "Track each handoff without changing the underlying planning records." : "Open a task below, enter the information in its canonical form, and update the status when you are done."}</p></div>
          {updatingId ? <span className="text-xs text-slate-500" role="status">Saving…</span> : null}
        </div>
        {visibleAssignments.length ? <div className="mt-3 grid gap-3 lg:grid-cols-2">{visibleAssignments.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} canUpdate={canEdit || assignment.assignedTo === session?.user.id} onStatusChange={(item, nextStatus) => void changeStatus(item, nextStatus)} />)}</div> : <div className="mt-3 rounded-xl border border-dashed border-sky-300 bg-white p-4 text-sm text-slate-600" role="status">{canEdit ? "No setup work has been assigned yet. Create the first handoff above." : "Nothing is assigned to you yet. Ask a manager to assign a setup area when you are ready to enter information."}</div>}
      </div>
    </section>
  );
}

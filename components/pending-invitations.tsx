"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

export function PendingInvitations() {
  const { pendingInvitations, acceptInvitation } = useWorkspace();
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  if (pendingInvitations.length === 0) return null;

  async function accept(studioId: string, inviteId: string) {
    setBusyInviteId(inviteId);
    setMessage("");
    const result = await acceptInvitation(studioId, inviteId);
    setMessage(result.ok ? "Invitation accepted. Workspace access is ready." : result.error || "Could not accept the invitation.");
    setBusyInviteId(null);
  }

  return <section className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4 sm:p-5" aria-labelledby="pending-invitations-heading">
    <div className="flex items-center gap-2"><MailCheck className="size-5 text-emerald-700"/><h2 id="pending-invitations-heading" className="font-semibold">Workspace invitations</h2></div>
    <p className="mt-1 text-sm leading-6 text-slate-600">Accept an invitation while signed in with the email address it was sent to.</p>
    <div className="mt-3 space-y-2">
      {pendingInvitations.map((invite) => {
        return <div key={invite.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{invite.studioName}</p>
            <p className="text-xs text-slate-500">{invite.role} · {invite.expired ? "Invitation expired" : `Expires ${new Date(invite.expiresAt).toLocaleString()}`}</p>
            {invite.expired ? <p className="mt-1 text-xs text-amber-800">Ask a workspace owner to send a new invitation.</p> : null}
          </div>
          {!invite.expired ? <button
            disabled={busyInviteId !== null}
            onClick={() => void accept(invite.studioId, invite.id)}
            className="min-h-10 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >{busyInviteId === invite.id ? "Accepting…" : `Accept invitation to ${invite.studioName}`}</button> : null}
        </div>;
      })}
    </div>
    {message ? <p className="mt-3 text-sm text-slate-700">{message}</p> : null}
  </section>;
}

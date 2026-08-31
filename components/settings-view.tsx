"use client";

import { useState } from "react";
import { Download, Fingerprint, LogOut, ShieldCheck, UserPlus, UsersRound, X } from "lucide-react";
import type { StudioRole } from "@/lib/domain";
import { OpenRouterAccountCard } from "@/components/openrouter-account-card";
import { useWorkspace } from "@/components/workspace-provider";

const roles: StudioRole[] = ["OWNER", "EDITOR", "VIEWER"];

export function SettingsView(){
  const {
    state, session, role, isOwner, members, invites, currentRulebookVersion, exportPackage, signOut,
    inviteMember, setMemberRole, removeMember, cancelInvite,
  } = useWorkspace();
  const [inviteEmail,setInviteEmail]=useState("");
  const [inviteRole,setInviteRole]=useState<StudioRole>("EDITOR");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  if(!state)return null;

  const current=state.rulebookVersions.find(v=>v.status==="CURRENT");
  const verified=state.rules.filter(r=>(r.reviewStatus??r.verificationStatus)==="VERIFIED").length;
  const edited=state.rules.filter(r=>r.review?.decision==="EDIT").length;
  const approved=state.rules.filter(r=>r.review?.decision==="APPROVED").length;

  function download(){
    const data=exportPackage();if(!data)return;
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download=`DWDE-Rulebook-v${currentRulebookVersion}.json`;a.click();URL.revokeObjectURL(url);
  }

  async function invite(){
    const email=inviteEmail.trim();if(!email)return;
    setBusy(true);const result=await inviteMember(email,inviteRole);setBusy(false);
    setNotice(result.ok?`Invitation created for ${email} as ${inviteRole}. They will receive workspace access after signing in with that email.`:result.error||"Could not create invitation.");
    if(result.ok)setInviteEmail("");
  }

  async function changeRole(userId:string,nextRole:StudioRole){
    setBusy(true);const result=await setMemberRole(userId,nextRole);setBusy(false);
    setNotice(result.ok?`Member role changed to ${nextRole}.`:result.error||"Could not change role.");
  }

  async function remove(userId:string){
    setBusy(true);const result=await removeMember(userId);setBusy(false);
    setNotice(result.ok?"Workspace access removed.":result.error||"Could not remove member.");
  }

  async function cancel(inviteId:string){
    setBusy(true);const result=await cancelInvite(inviteId);setBusy(false);
    setNotice(result.ok?"Pending invitation cancelled.":result.error||"Could not cancel invitation.");
  }

  return <div className="space-y-6">
    {notice?<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div>:null}

    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50"><ShieldCheck className="size-5 text-emerald-700"/></div><div><h2 className="font-semibold">Canonical Rulebook source</h2><p className="mt-1 text-sm leading-6 text-slate-600">Production Rulebook replacement is no longer exposed as a general UI action. The reviewed V2 database is canonical; later changes go through versioned rule edits and explicit migrations.</p></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Current</span><strong className="mt-1 block text-2xl">V{currentRulebookVersion}</strong><span className="text-xs text-slate-500">{current?.documentType||"Rulebook"}</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Rules</span><strong className="mt-1 block text-2xl">{state.rules.length}</strong><span className="text-xs text-slate-500">{verified} verified</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Human review</span><strong className="mt-1 block text-2xl">{edited}</strong><span className="text-xs text-slate-500">edited · {approved} unchanged</span></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Status</span><strong className="mt-1 block text-lg">{current?.sourceHash?"Reviewed":"Current"}</strong><span className="text-xs text-slate-500">living, versioned data</span></div>
      </div>
      {current?.sourceHash?<div className="mt-4 rounded-xl border border-slate-200 p-3 text-xs leading-5 text-slate-600"><div className="flex items-center gap-2 font-semibold text-slate-800"><Fingerprint className="size-4"/>Reproducible source identity</div><p className="mt-2 break-all"><strong>Rules SHA-256:</strong> {current.sourceHash}</p>{current.sourceFileHash?<p className="mt-1 break-all"><strong>Imported file SHA-256:</strong> {current.sourceFileHash}</p>:null}</div>:null}
    </section>

    <OpenRouterAccountCard/>

    <section className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><Download className="size-5 text-slate-400"/><h2 className="mt-3 font-semibold">Export current Rulebook</h2><p className="mt-1 text-sm leading-6 text-slate-600">Exports reviewed human wording, provenance, review history, and current machine-enforcement metadata without replacing the database authority.</p><button onClick={download} className="mt-4 min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">Export DWDE v{currentRulebookVersion}</button></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><ShieldCheck className="size-5 text-slate-400"/><h2 className="mt-3 font-semibold">Authority boundaries</h2><p className="mt-1 text-sm leading-6 text-slate-600">Human review, deterministic enforcement coverage, AI inference, and schedule validation remain separate. AI can propose changes; only governed versioned mutations can commit them.</p></div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100"><UsersRound className="size-5 text-slate-500"/></div><div><h2 className="font-semibold">Studio access</h2><p className="mt-1 text-sm leading-6 text-slate-600">Signed in as {session?.user.email||"studio user"} · role <strong>{role||"NONE"}</strong>. Authentication does not grant studio access by itself.</p></div></div>

      {isOwner?<div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-2"><UserPlus className="size-4 text-slate-500"/><h3 className="text-sm font-semibold">Invite a studio user</h3></div><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]"><input type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="person@example.com" className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"/><select value={inviteRole} onChange={e=>setInviteRole(e.target.value as StudioRole)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm">{roles.map(r=><option key={r}>{r}</option>)}</select><button disabled={busy||!inviteEmail.trim()} onClick={()=>void invite()} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-40">Invite</button></div></div>:null}

      <div className="mt-5 space-y-2"><h3 className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Members</h3>{members.map(member=>{const self=member.userId===session?.user.id;return <div key={member.userId} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{member.displayName||member.email||"Studio user"}{self?" · You":""}</p><p className="truncate text-xs text-slate-500">{member.email}</p></div>{isOwner?<div className="flex gap-2"><select disabled={busy||self} value={member.role} onChange={e=>void changeRole(member.userId,e.target.value as StudioRole)} className="min-h-10 rounded-xl border border-slate-300 bg-white px-2 text-xs disabled:bg-slate-100">{roles.map(r=><option key={r}>{r}</option>)}</select><button disabled={busy||self} onClick={()=>void remove(member.userId)} className="grid size-10 place-items-center rounded-xl border border-red-200 text-red-600 disabled:opacity-30" aria-label="Remove member"><X className="size-4"/></button></div>:<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{member.role}</span>}</div>})}</div>

      {isOwner&&invites.filter(i=>!i.acceptedAt).length?<div className="mt-5 space-y-2"><h3 className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Pending invitations</h3>{invites.filter(i=>!i.acceptedAt).map(invite=><div key={invite.id} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{invite.email}</p><p className="text-xs text-amber-800">{invite.role} · invited {new Date(invite.createdAt).toLocaleString()}</p></div><button disabled={busy} onClick={()=>void cancel(invite.id)} className="grid size-10 place-items-center rounded-xl border border-amber-300 bg-white text-amber-900" aria-label="Cancel invitation"><X className="size-4"/></button></div>)}</div>:null}

      <button onClick={()=>void signOut()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold"><LogOut className="size-4"/>Sign out</button>
    </section>
  </div>;
}

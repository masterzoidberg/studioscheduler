"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Building2, CalendarDays, Home, LogOut, Menu, MoreHorizontal, RefreshCw, Settings, SlidersHorizontal, X } from "lucide-react";
import { LoginScreen } from "@/components/login-screen";
import { MobileScheduleView } from "@/components/schedule/mobile-schedule-view";
import { ScheduleBuilderPanel } from "@/components/schedule/schedule-builder-panel";
import { ScheduleEditControls } from "@/components/schedule/schedule-edit-controls";
import { ScheduleExportPanel } from "@/components/schedule/schedule-export-panel";
import { ScheduleEditModeProvider } from "@/components/schedule/schedule-edit-mode";
import { SidebarNav } from "@/components/sidebar-nav";
import { useWorkspace } from "@/components/workspace-provider";

const titles: Record<string, { eyebrow: string; title: string }> = {
  "/": { eyebrow: "Studio", title: "Home" },
  "/setup": { eyebrow: "Studio setup", title: "Setup" },
  "/schedule": { eyebrow: "Weekly plan", title: "Weekly schedule" },
  "/people": { eyebrow: "Setup deep link", title: "People & rooms" },
  "/classes": { eyebrow: "Setup deep link", title: "Classes" },
  "/planning-repairs": { eyebrow: "Setup deep link", title: "Requirements" },
  "/rulebook": { eyebrow: "Advanced diagnostics", title: "Rulebook" },
  "/readiness": { eyebrow: "Advanced diagnostics", title: "Readiness" },
  "/scenarios": { eyebrow: "Advanced historical records", title: "Legacy scenarios" },
  "/versions": { eyebrow: "Advanced diagnostics", title: "Version history" },
  "/settings": { eyebrow: "Account + advanced", title: "Settings" },
};

function Brand() {
  return <Link href="/" className="flex items-center gap-3" aria-label="Studio Scheduler home"><div className="grid size-10 place-items-center rounded-xl bg-slate-950 text-sm font-bold text-white">SS</div><div><p className="text-sm font-semibold text-slate-950">Studio Scheduler</p><p className="text-xs text-slate-500">Weekly planning</p></div></Link>;
}

function BottomNav({ openMore }: { openMore: () => void }) {
  const pathname = usePathname();
  const items = [["/", "Home", Home], ["/setup", "Setup", SlidersHorizontal], ["/schedule", "Schedule", CalendarDays], ["/settings", "Settings", Settings]] as const;
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">{items.map(([href,label,Icon])=><Link key={href} href={href} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${pathname===href?"text-slate-950":"text-slate-500"}`}><Icon className="size-5"/>{label}</Link>)}<button onClick={openMore} className="flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-500"><MoreHorizontal className="size-5"/>More</button></nav>;
}

function CreateWorkspaceForm({ createWorkspace }: { createWorkspace: (name: string, slug: string, requestId?: string) => Promise<{ ok: boolean; message: string; requestId: string }> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await createWorkspace(name, slug, requestId || undefined);
    setBusy(false);
    setMessage(result.message);
    setRequestId(result.ok ? null : result.requestId);
  }

  return <form onSubmit={(event)=>void submit(event)} className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white"><Building2 className="size-5 text-slate-600"/></div><div><h2 className="font-semibold">Create a workspace</h2><p className="mt-1 text-sm leading-6 text-slate-600">Start empty, then add people, rooms, classes, and supported weekly hours. One timezone, daytime sessions, and a 15-minute grid are supported.</p></div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-800">Workspace name<input required maxLength={120} value={name} onChange={(event)=>setName(event.target.value)} placeholder="Example Dance Studio" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"/></label><label className="text-sm font-semibold text-slate-800">Workspace link <span className="font-normal text-slate-500">(optional)</span><input maxLength={63} value={slug} onChange={(event)=>setSlug(event.target.value)} placeholder="example-dance-studio" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"/></label></div>
    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className={`text-xs leading-5 ${message && !message.includes("created") && !message.includes("opening") ? "text-red-700" : "text-slate-500"}`} role={message ? "status" : undefined}>{message || "Your account becomes the owner of this workspace."}</p><button disabled={busy || !name.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Creating…" : "Create workspace"}<ArrowRight className="size-4"/></button></div>
  </form>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { loading,error,accessMode,session,role,state,availableWorkspaces,selectedStudioId,switchStudio,createWorkspace,scheduleIsStale,validation,refresh,signOut } = useWorkspace();
  const [mobileNavOpen,setMobileNavOpen]=useState(false);
  const heading=titles[pathname]??titles["/"];

  if (loading && !state) return <div className="grid min-h-screen place-items-center bg-slate-950 text-white"><div className="flex items-center gap-3 text-sm"><RefreshCw className="size-5 animate-spin"/>Opening workspace…</div></div>;
  if (!loading && accessMode==="NONE") return <LoginScreen/>;
  if (!loading && session && !state) return <main className="grid min-h-screen place-items-center bg-slate-950 p-5"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Building2 className="size-5"/></div><h1 className="mt-5 text-2xl font-semibold">{availableWorkspaces.length ? "Choose a workspace" : "Set up your workspace"}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{availableWorkspaces.length ? "Choose an existing workspace or create another one for this account." : "You are signed in. Create a workspace or accept an invitation to continue."}</p>{availableWorkspaces.length ? <label className="mt-5 block text-sm font-semibold text-slate-800">Workspace<select aria-label="Workspace" value={selectedStudioId || ""} onChange={(event)=>void switchStudio(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal"><option value="" disabled>Select a workspace</option>{availableWorkspaces.map((workspace)=><option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.role}</option>)}</select></label> : null}<CreateWorkspaceForm createWorkspace={createWorkspace}/><p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Signed in as {session.user.email}</p>{error && availableWorkspaces.length ? <p className="mt-3 text-xs text-amber-700">{error}</p> : null}<button onClick={()=>void signOut()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold"><LogOut className="size-4"/>Sign out</button></div></main>;

  const health = scheduleIsStale
    ? { label:"NEEDS REVIEW", detail:"Setup changed since this schedule was last checked.", tone:"border-amber-200 bg-amber-50 text-amber-900", dot:"bg-amber-500" }
    : !validation.valid
      ? { label:"CONFLICTS FOUND", detail:`${validation.hardViolations} schedule conflict${validation.hardViolations===1?"":"s"} detected.`, tone:"border-red-200 bg-red-50 text-red-900", dot:"bg-red-500" }
      : { label:"CURRENT", detail:"No schedule conflict is currently detected.", tone:"border-emerald-200 bg-emerald-50 text-emerald-900", dot:"bg-emerald-500" };

  return <div className="min-h-screen bg-[#f5f7f9] text-slate-950">
    <div className="mx-auto grid min-h-screen max-w-[1920px] lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="hidden border-r border-slate-200 bg-white px-4 py-5 lg:flex lg:flex-col">
        <div className="px-2"><Brand/></div><div className="mt-8 flex-1"><SidebarNav/></div>
        <div className={`rounded-2xl border p-3.5 ${health.tone}`}><div className="flex items-center gap-2 text-xs font-semibold"><span className={`size-2 rounded-full ${health.dot}`}/>Schedule status</div><p className="mt-2 text-base font-semibold">{health.label}</p><p className="mt-1 text-xs leading-5 opacity-80">{health.detail}</p></div>
      </aside>

      <div className="min-w-0 pb-20 lg:pb-0">
        <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur"><div className="flex min-h-[68px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8"><div className="flex min-w-0 items-center gap-3"><button className="hidden size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 lg:grid xl:hidden" onClick={()=>setMobileNavOpen(true)} aria-label="Open navigation"><Menu className="size-5"/></button><div className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500 sm:text-[11px]">{heading.eyebrow}</p><h1 className="truncate text-lg font-semibold sm:text-xl">{heading.title}</h1></div></div><div className="flex items-center gap-2">{availableWorkspaces.length > 1 ? <select aria-label="Selected workspace" value={selectedStudioId || ""} onChange={(event)=>void switchStudio(event.target.value)} className="hidden min-h-10 max-w-52 rounded-xl border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 sm:block">{availableWorkspaces.map((workspace)=><option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select> : null}<button onClick={()=>void refresh()} className="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-500" aria-label="Refresh workspace"><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/></button><div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 sm:block">{session?.user.email||"Studio user"} · {role}</div></div></div>{error?<div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 sm:px-6 lg:px-8">Workspace error: {error}</div>:null}</header>
        <main className="px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">{pathname === "/schedule" ? <ScheduleEditModeProvider><div className="space-y-5"><ScheduleEditControls/><ScheduleBuilderPanel/><ScheduleExportPanel/><div className="md:hidden"><MobileScheduleView/></div><div className="hidden md:block">{children}</div></div></ScheduleEditModeProvider> : children}</main>
      </div>
    </div>

    <BottomNav openMore={()=>setMobileNavOpen(true)}/>
    {mobileNavOpen?<div className="fixed inset-0 z-50"><button className="absolute inset-0 bg-slate-950/40" onClick={()=>setMobileNavOpen(false)} aria-label="Close menu"/><aside className="absolute bottom-0 left-0 right-0 max-h-[88vh] rounded-t-[28px] bg-white p-5 shadow-2xl sm:bottom-auto sm:left-0 sm:top-0 sm:h-full sm:w-80 sm:rounded-none"><div className="flex items-center justify-between"><Brand/><button onClick={()=>setMobileNavOpen(false)} className="rounded-xl p-2 text-slate-500"><X className="size-5"/></button></div><div className="mt-6" onClick={()=>setMobileNavOpen(false)}><SidebarNav compact/></div><div className={`mt-5 rounded-xl border p-3 text-xs leading-5 ${health.tone}`}><strong>{health.label}</strong><br/>{health.detail}</div></aside></div>:null}
  </div>;
}

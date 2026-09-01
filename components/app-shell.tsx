"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, BookOpenCheck, CalendarDays, Home, LogOut, Menu, MoreHorizontal, RefreshCw, Sparkles, UsersRound, X } from "lucide-react";
import { CopilotPanel } from "@/components/copilot-panel";
import { LoginScreen } from "@/components/login-screen";
import { MobileScheduleView } from "@/components/schedule/mobile-schedule-view";
import { SidebarNav } from "@/components/sidebar-nav";
import { useWorkspace } from "@/components/workspace-provider";

const titles: Record<string, { eyebrow: string; title: string }> = {
  "/": { eyebrow: "DWDE Studio Scheduler", title: "Scheduling control room" },
  "/rulebook": { eyebrow: "Canonical scheduling policy", title: "Master Rulebook" },
  "/schedule": { eyebrow: "Canonical assignments", title: "Weekly schedule" },
  "/people": { eyebrow: "Teachers + dancers", title: "People" },
  "/classes": { eyebrow: "Program catalog", title: "Classes" },
  "/scenarios": { eyebrow: "Isolated what-if workspace", title: "Scenarios" },
  "/versions": { eyebrow: "Auditable history", title: "Versions" },
  "/settings": { eyebrow: "Export, AI + access", title: "Settings" },
};

function Brand() {
  return <Link href="/" className="flex items-center gap-3" aria-label="DWDE Studio Scheduler home"><div className="grid size-10 place-items-center rounded-xl bg-slate-950 text-sm font-bold text-white">DW</div><div><p className="text-sm font-semibold text-slate-950">DWDE Studio</p><p className="text-xs text-slate-500">Scheduler</p></div></Link>;
}

function BottomNav({ openMore }: { openMore: () => void }) {
  const pathname = usePathname();
  const items = [["/", "Home", Home], ["/schedule", "Schedule", CalendarDays], ["/rulebook", "Rules", BookOpenCheck], ["/people", "People", UsersRound]] as const;
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">{items.map(([href,label,Icon])=><Link key={href} href={href} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${pathname===href?"text-slate-950":"text-slate-500"}`}><Icon className="size-5"/>{label}</Link>)}<button onClick={openMore} className="flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-500"><MoreHorizontal className="size-5"/>More</button></nav>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    loading,error,accessMode,session,role,state,currentRulebookVersion,currentEnforcementVersion,currentScheduleVersion,
    currentScheduleRulebookVersion,currentScheduleEnforcementVersion,scheduleIsStale,validation,refresh,signOut,
  } = useWorkspace();
  const [mobileNavOpen,setMobileNavOpen]=useState(false);
  const [mobileCopilotOpen,setMobileCopilotOpen]=useState(false);
  const heading=titles[pathname]??titles["/"];

  if (loading && !state) return <div className="grid min-h-screen place-items-center bg-slate-950 text-white"><div className="flex items-center gap-3 text-sm"><RefreshCw className="size-5 animate-spin"/>Opening DWDE workspace…</div></div>;
  if (!loading && accessMode==="NONE") return <LoginScreen/>;
  if (!loading && session && !state) return <main className="grid min-h-screen place-items-center bg-slate-950 p-5"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex size-11 items-center justify-center rounded-xl bg-amber-100 text-amber-800"><AlertTriangle className="size-5"/></div><h1 className="mt-5 text-2xl font-semibold">Signed in, but not invited yet</h1><p className="mt-3 text-sm leading-6 text-slate-600">{error||"This account does not have access to the DWDE workspace."}</p><p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Signed in as {session.user.email}</p><button onClick={()=>void signOut()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold"><LogOut className="size-4"/>Sign out</button></div></main>;

  const health = scheduleIsStale
    ? { label:"STALE POLICY LINK", tone:"border-amber-200 bg-amber-50 text-amber-900", dot:"bg-amber-500" }
    : !validation.valid
      ? { label:"NEEDS REPAIR", tone:"border-red-200 bg-red-50 text-red-900", dot:"bg-red-500" }
      : validation.fullyValidated
        ? { label:"FULLY VALIDATED", tone:"border-emerald-200 bg-emerald-50 text-emerald-900", dot:"bg-emerald-500" }
        : { label:"PARTIALLY VALIDATED", tone:"border-blue-200 bg-blue-50 text-blue-900", dot:"bg-blue-500" };

  return <div className="min-h-screen bg-[#f5f7f9] text-slate-950">
    <div className="mx-auto grid min-h-screen max-w-[1920px] lg:grid-cols-[236px_minmax(0,1fr)] 2xl:grid-cols-[236px_minmax(0,1fr)_350px]">
      <aside className="hidden border-r border-slate-200 bg-white px-4 py-5 lg:flex lg:flex-col">
        <div className="px-2"><Brand/></div><div className="mt-8 flex-1"><SidebarNav/></div>
        <div className={`rounded-2xl border p-3.5 ${health.tone}`}><div className="flex items-center gap-2 text-xs font-semibold"><span className={`size-2 rounded-full ${health.dot}`}/>Schedule health</div><p className="mt-2 text-base font-semibold">{health.label}</p><p className="mt-1 text-xs leading-5 opacity-80">{validation.hardViolations} detected HARD · {validation.coverage.implementedHardRules}/{validation.coverage.applicableHardRules} HARD rules enforced</p></div>
        <div className="mt-4 px-2 text-[11px] leading-5 text-slate-400">Rulebook v{currentRulebookVersion} · Enforcement v{currentEnforcementVersion} · Schedule v{currentScheduleVersion}<br/>Schedule uses Rulebook v{currentScheduleRulebookVersion} + Enforcement v{currentScheduleEnforcementVersion}</div>
      </aside>

      <div className="min-w-0 pb-20 lg:pb-0">
        <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur"><div className="flex min-h-[68px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8"><div className="flex min-w-0 items-center gap-3"><button className="hidden size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 lg:grid 2xl:hidden" onClick={()=>setMobileNavOpen(true)} aria-label="Open navigation"><Menu className="size-5"/></button><div className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500 sm:text-[11px]">{heading.eyebrow}</p><h1 className="truncate text-lg font-semibold sm:text-xl">{heading.title}</h1></div></div><div className="flex items-center gap-2"><button onClick={()=>void refresh()} className="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-500" aria-label="Refresh workspace"><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/></button><div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 sm:block">{session?.user.email||"Studio user"} · {role}</div><button onClick={()=>setMobileCopilotOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-medium text-white 2xl:hidden"><Sparkles className="size-4"/><span className="hidden sm:inline">Copilot</span></button></div></div>{error?<div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 sm:px-6 lg:px-8">Workspace error: {error}</div>:null}</header>
        <main className="px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">{pathname === "/schedule" ? <><div className="md:hidden"><MobileScheduleView/></div><div className="hidden md:block">{children}</div></> : children}</main>
      </div>
      <div className="sticky top-0 hidden h-screen 2xl:block"><CopilotPanel/></div>
    </div>

    <BottomNav openMore={()=>setMobileNavOpen(true)}/>
    {mobileNavOpen?<div className="fixed inset-0 z-50"><button className="absolute inset-0 bg-slate-950/40" onClick={()=>setMobileNavOpen(false)} aria-label="Close menu"/><aside className="absolute bottom-0 left-0 right-0 max-h-[88vh] rounded-t-[28px] bg-white p-5 shadow-2xl sm:bottom-auto sm:left-0 sm:top-0 sm:h-full sm:w-80 sm:rounded-none"><div className="flex items-center justify-between"><Brand/><button onClick={()=>setMobileNavOpen(false)} className="rounded-xl p-2 text-slate-500"><X className="size-5"/></button></div><div className="mt-6" onClick={()=>setMobileNavOpen(false)}><SidebarNav compact/></div><div className={`mt-5 rounded-xl border p-3 text-xs leading-5 ${health.tone}`}>{health.label}<br/>{validation.hardViolations} detected HARD · {validation.coverage.implementedHardRules}/{validation.coverage.applicableHardRules} enforced<br/>RB v{currentScheduleRulebookVersion}/{currentRulebookVersion} · EV v{currentScheduleEnforcementVersion}/{currentEnforcementVersion}</div></aside></div>:null}
    {mobileCopilotOpen?<div className="fixed inset-0 z-50"><button className="absolute inset-0 bg-slate-950/40" onClick={()=>setMobileCopilotOpen(false)} aria-label="Close Copilot"/><div className="absolute inset-x-0 bottom-0 h-[88vh] sm:left-auto sm:right-4 sm:bottom-4 sm:w-[400px]"><CopilotPanel mobile onClose={()=>setMobileCopilotOpen(false)}/></div></div>:null}
  </div>;
}

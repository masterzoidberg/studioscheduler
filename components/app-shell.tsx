"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Sparkles, X } from "lucide-react";
import { CopilotPanel } from "@/components/copilot-panel";
import { navItems, SidebarNav } from "@/components/sidebar-nav";

const titles: Record<string, { eyebrow: string; title: string }> = {
  "/": { eyebrow: "DWDE Studio Scheduler", title: "Scheduling control room" },
  "/rulebook": { eyebrow: "Master Rulebook · v3", title: "Rulebook" },
  "/schedule": { eyebrow: "Current Schedule · v7", title: "Weekly schedule" },
  "/people": { eyebrow: "Studio roster", title: "People" },
  "/classes": { eyebrow: "Program catalog", title: "Classes" },
  "/scenarios": { eyebrow: "Safe what-if workspace", title: "Scenarios" },
  "/versions": { eyebrow: "Auditable history", title: "Versions" },
  "/settings": { eyebrow: "Workspace configuration", title: "Settings" },
};

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="DWDE Studio Scheduler home">
      <div className="grid size-10 place-items-center rounded-xl bg-slate-950 text-sm font-bold tracking-tight text-white shadow-sm">DW</div>
      <div><p className="text-sm font-semibold tracking-tight text-slate-950">DWDE Studio</p><p className="text-xs text-slate-500">Scheduler</p></div>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileCopilotOpen, setMobileCopilotOpen] = useState(false);
  const heading = titles[pathname] ?? titles["/"];

  return (
    <div className="min-h-screen bg-[#f5f7f9] text-slate-950">
      <div className="mx-auto grid min-h-screen max-w-[1920px] lg:grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[236px_minmax(0,1fr)_340px]">
        <aside className="hidden border-r border-slate-200 bg-white px-4 py-5 lg:flex lg:flex-col">
          <div className="px-2"><Brand /></div>
          <div className="mt-8 flex-1"><SidebarNav /></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />Schedule health</div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">PASS</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">0 hard violations in current mock schedule</p>
          </div>
          <div className="mt-4 px-2 text-[11px] leading-5 text-slate-400">Milestone 1 · Visual prototype</div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur">
            <div className="flex h-[72px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button type="button" className="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 lg:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu className="size-5" /></button>
                <div className="min-w-0"><p className="truncate text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">{heading.eyebrow}</p><h1 className="truncate text-lg font-semibold tracking-tight text-slate-950 sm:text-xl">{heading.title}</h1></div>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 sm:block">Cami · Owner view</div>
                <button type="button" onClick={() => setMobileCopilotOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white xl:hidden"><Sparkles className="size-4" /><span className="hidden sm:inline">Copilot</span></button>
              </div>
            </div>
          </header>
          <main className="px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">{children}</main>
        </div>

        <div className="sticky top-0 hidden h-screen xl:block"><CopilotPanel /></div>
      </div>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative h-full w-[min(84vw,320px)] border-r border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between"><Brand /><button type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="size-5" /></button></div>
            <div className="mt-8" onClick={() => setMobileNavOpen(false)}><SidebarNav compact /></div>
            <div className="mt-8 border-t border-slate-200 pt-5"><p className="text-xs font-semibold text-slate-500">Available sections</p><p className="mt-2 text-sm leading-6 text-slate-600">{navItems.length} workspace areas are wired for Milestone 1 review.</p></div>
          </aside>
        </div>
      ) : null}

      {mobileCopilotOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button type="button" aria-label="Close Copilot" className="absolute inset-0 bg-slate-950/35 backdrop-blur-[2px]" onClick={() => setMobileCopilotOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 h-[82vh] sm:left-auto sm:right-4 sm:bottom-4 sm:w-[380px]"><CopilotPanel mobile onClose={() => setMobileCopilotOpen(false)} /></div>
        </div>
      ) : null}
    </div>
  );
}

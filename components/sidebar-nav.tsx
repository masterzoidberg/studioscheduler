"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { BookOpenText, CalendarDays, Clock3, GraduationCap, History, LayoutDashboard, Settings, ShieldCheck, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

export const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Rulebook", href: "/rulebook", icon: BookOpenText },
  { label: "Readiness", href: "/readiness", icon: ShieldCheck },
  { label: "Schedule", href: "/schedule", icon: CalendarDays },
  { label: "People", href: "/people", icon: UsersRound },
  { label: "Classes", href: "/classes", icon: GraduationCap },
  { label: "Scenarios", href: "/scenarios", icon: Clock3 },
  { label: "Versions", href: "/versions", icon: History },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function SidebarNav({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary navigation" className={cn("space-y-1", compact && "grid gap-1")}>
      {navItems.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} className={cn("group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition", active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950")}>
            <Icon aria-hidden="true" className="size-4.5 shrink-0" strokeWidth={1.9} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

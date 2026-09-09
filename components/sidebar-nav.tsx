"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, LayoutDashboard, Settings, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "Home", href: "/", icon: LayoutDashboard },
  { label: "Setup", href: "/setup", icon: SlidersHorizontal },
  { label: "Schedule", href: "/schedule", icon: CalendarDays },
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

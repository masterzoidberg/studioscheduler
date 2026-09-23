import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenText, History, ShieldCheck, Waypoints } from "lucide-react";
import { OpenRouterAccountCard } from "@/components/openrouter-account-card";
import { SettingsView } from "@/components/settings-view";

export const metadata: Metadata = { title: "Settings" };

const advancedLinks = [
  {
    href: "/rulebook",
    title: "Rulebook",
    detail: "Reviewed scheduling policy, typed policy authority and detailed rule records.",
    icon: BookOpenText,
  },
  {
    href: "/readiness",
    title: "Readiness diagnostics",
    detail: "Deterministic planning blockers, certification details and solver diagnostics.",
    icon: ShieldCheck,
  },
  {
    href: "/versions",
    title: "Version history",
    detail: "Auditable Rulebook, planning and schedule history for technical review.",
    icon: History,
  },
  {
    href: "/scenarios",
    title: "Legacy scenarios",
    detail: "Read-only historical what-if records retained for audit continuity.",
    icon: Waypoints,
  },
] as const;

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <OpenRouterAccountCard />
      <SettingsView />

      <section id="advanced-diagnostics" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Advanced</p>
        <h2 className="mt-2 text-lg font-semibold">Technical scheduling diagnostics</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          These screens remain available for detailed policy, readiness and history work, but they are no longer part of the normal manager setup journey.
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {advancedLinks.map(({ href, title, detail, icon: Icon }) => (
            <Link key={href} href={href} className="rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-white">
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{detail}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

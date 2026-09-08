import type { Metadata } from "next";
import Link from "next/link";
import { OpenRouterAccountCard } from "@/components/openrouter-account-card";
import { SettingsView } from "@/components/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage(){
  return <div className="space-y-6">
    <OpenRouterAccountCard/>
    <SettingsView/>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Advanced</p>
      <h2 className="mt-2 font-semibold">Historical scenario records</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Legacy what-if records remain available for audit history. They are read-only until scenario behavior is rebuilt on the coherent PlanningDatasetVersion and ConstraintModelVersion authority.</p>
      <Link href="/scenarios" className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold">View legacy scenarios</Link>
    </section>
  </div>;
}

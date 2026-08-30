import type { Metadata } from "next";
import { FlaskConical } from "lucide-react";
import { FeaturePreview } from "@/components/feature-preview";

export const metadata: Metadata = { title: "Scenarios" };

export default function ScenariosPage() {
  return <FeaturePreview eyebrow="What-if workspace" title="Experiment without quietly changing what is true." description="A scenario will branch from a specific Rulebook and Schedule version, apply temporary rules or assignments, and stay isolated until Cami explicitly adopts a change." icon={FlaskConical} items={[{ title: "Aimée Saturday availability", detail: "Temporarily allow Saturday and see what becomes feasible without touching the real Rulebook." }, { title: "Cami five-day limit", detail: "Measure whether relaxing the four-day work limit actually creates useful arrangements or needless disruption." }, { title: "Studio C capacity", detail: "Test a 20-dancer capacity and compare violations, attendance days, teacher impact, and schedule repair cost." }]} />;
}

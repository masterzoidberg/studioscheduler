import type { Metadata } from "next";
import { PlanningDatasetConfirmationCard } from "@/components/planning-dataset-confirmation-card";
import { ReadinessView } from "@/components/readiness-view";
import { SolverFeasibilityCard } from "@/components/solver-feasibility-card";

export const metadata: Metadata = { title: "Scheduling Readiness" };

export default function ReadinessPage() {
  return (
    <div className="space-y-6">
      <PlanningDatasetConfirmationCard />
      <ReadinessView />
      <SolverFeasibilityCard />
    </div>
  );
}

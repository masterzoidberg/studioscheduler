import type { Metadata } from "next";
import { PlanningRepairsView } from "@/components/planning-repairs-view";
import { RequiredClassIntake } from "@/components/required-class-intake";

export const metadata: Metadata = { title: "Planning Repairs" };

export default function PlanningRepairsPage() {
  return (
    <div className="space-y-6">
      <PlanningRepairsView />
      <RequiredClassIntake />
    </div>
  );
}

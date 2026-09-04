import type { Metadata } from "next";
import { PlanningRepairsView } from "@/components/planning-repairs-view";

export const metadata: Metadata = { title: "Planning Repairs" };

export default function PlanningRepairsPage() {
  return <PlanningRepairsView />;
}

import type { Metadata } from "next";
import { ReadinessView } from "@/components/readiness-view";

export const metadata: Metadata = { title: "Scheduling Readiness" };

export default function ReadinessPage() {
  return <ReadinessView />;
}

import type { Metadata } from "next";
import { History } from "lucide-react";
import { FeaturePreview } from "@/components/feature-preview";

export const metadata: Metadata = { title: "Versions" };

export default function VersionsPage() {
  return <FeaturePreview eyebrow="Rulebook + schedule history" title="Every meaningful change should be explainable and reversible." description="Rulebook and Schedule versions will remain independent, while each Schedule records the exact Rulebook version it was validated against. Undo creates a reversing patch rather than deleting history." icon={History} items={[{ title: "Rulebook v5", detail: "See who changed Cami's regular workday maximum, why, and what schedule assignments were affected." }, { title: "Schedule v12 → v13", detail: "Compare only changed assignments: old day/time/room/teacher beside the new values." }, { title: "Restore safely", detail: "Restoring generates an auditable reversing patch and a new version instead of erasing later history." }]} />;
}

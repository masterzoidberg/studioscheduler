import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { FeaturePreview } from "@/components/feature-preview";

export const metadata: Metadata = { title: "People" };

export default function PeoplePage() {
  return <FeaturePreview eyebrow="Teachers + dancers" title="Understand the human impact of every scheduling choice." description="Teacher qualifications, workdays, availability, dancer attendance patterns, and derived schedules will all be views over the same canonical assignments." icon={UsersRound} items={[{ title: "Teacher profiles", detail: "Subjects, prohibited classes, hard assignments, workday limits, teaching hours, idle time, and linked rules." }, { title: "Dancer schedules", detail: "Classes, level, weekly attendance days, gaps, latest finish, and lower-level relationships without duplicating schedule truth." }, { title: "Context-aware Copilot", detail: "Selecting Cami or Karly will give the Copilot only the relevant structured entity and rule context it needs." }]} />;
}

import type { Metadata } from "next";
import { GraduationCap } from "lucide-react";
import { FeaturePreview } from "@/components/feature-preview";

export const metadata: Metadata = { title: "Classes" };

export default function ClassesPage() {
  return <FeaturePreview eyebrow="Class definitions" title="Define what a class is without baking in where it happens." description="Class definitions and schedule assignments remain separate. Duration, frequency, roster, eligible teachers, room restrictions, and sequence relationships belong to the class; day/time/teacher/room belong to assignments." icon={GraduationCap} items={[{ title: "Searchable class catalog", detail: "Browse Ballet, Jazz, Tap, Contemporary, Lyrical, Hip Hop, Combo, Pointe, company, and adult offerings." }, { title: "Eligibility + restrictions", detail: "See eligible teachers, room requirements, frequency, roster, sequencing, and company-only status in one inspector." }, { title: "Assignment independence", detail: "Moving a class in the calendar changes an Assignment, not the underlying ClassDefinition." }]} />;
}

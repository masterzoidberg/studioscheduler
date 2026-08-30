import type { Metadata } from "next";
import { RulebookView } from "@/components/rulebook/rulebook-view";

export const metadata: Metadata = { title: "Rulebook" };

export default function RulebookPage() {
  return <RulebookView />;
}

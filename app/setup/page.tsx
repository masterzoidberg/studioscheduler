import type { Metadata } from "next";
import { SetupDashboard } from "@/components/setup-dashboard";

export const metadata: Metadata = { title: "Studio Setup" };

export default function SetupPage() {
  return <SetupDashboard />;
}

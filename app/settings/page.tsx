import type { Metadata } from "next";
import { OpenRouterAccountCard } from "@/components/openrouter-account-card";
import { SettingsView } from "@/components/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage(){
  return <div className="space-y-6"><OpenRouterAccountCard/><SettingsView/></div>;
}

import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { FeaturePreview } from "@/components/feature-preview";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <FeaturePreview eyebrow="Workspace configuration" title="Keep security and AI behavior explicit." description="Authentication providers, studio defaults, server-side OpenAI model choices, audit behavior, and future zero-hard-violation automation will live here. Automatic AI application remains off by default." icon={Settings} items={[{ title: "Authentication", detail: "Supabase magic-link and GitHub sign-in first, behind an AuthProvider seam for future identity providers." }, { title: "AI models", detail: "Reasoning and fast model choices come from server environment variables rather than being scattered through source code." }, { title: "Safety defaults", detail: "AI proposals require confirmation. Service-role credentials and OpenAI API keys never enter browser JavaScript." }]} />;
}

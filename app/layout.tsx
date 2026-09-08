import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { getSupabasePublicConfiguration } from "@/lib/supabase-config";

export const metadata: Metadata = {
  title: { default: "DWDE Studio Scheduler", template: "%s · DWDE Studio Scheduler" },
  description: "A shared, validated rulebook and scheduling workspace for DWDE Studio.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

function ConfigurationRequired({ message }: { message: string }) {
  return <main className="grid min-h-screen place-items-center bg-slate-950 p-5 text-slate-950">
    <section className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Configuration required</p>
      <h1 className="mt-3 text-2xl font-semibold">Studio Scheduler is safely offline</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
        Configure both <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> for this environment, then restart the app. Local verification should use an explicitly configured loopback/disposable target.
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">No implicit production database is used when configuration is missing or incomplete.</p>
    </section>
  </main>;
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const configuration = getSupabasePublicConfiguration();
  return <html lang="en"><body>{configuration.configured
    ? <WorkspaceProvider><AppShell>{children}</AppShell></WorkspaceProvider>
    : <ConfigurationRequired message={configuration.message}/>
  }</body></html>;
}

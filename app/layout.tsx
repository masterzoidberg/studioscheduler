import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: { default: "DWDE Studio Scheduler", template: "%s · DWDE Studio Scheduler" },
  description: "A visual rulebook and scheduling control room for DWDE Studio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}

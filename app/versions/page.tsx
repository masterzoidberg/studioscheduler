import type { Metadata } from "next";
import { VersionsView } from "@/components/versions-view";
export const metadata: Metadata = { title: "Versions" };
export default function VersionsPage(){ return <VersionsView/>; }

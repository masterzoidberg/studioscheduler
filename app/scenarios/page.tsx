import type { Metadata } from "next";
import { ScenariosView } from "@/components/scenarios-view";
export const metadata: Metadata = { title: "Scenarios" };
export default function ScenariosPage(){ return <ScenariosView/>; }

import type { Metadata } from "next";
import { PeopleView } from "@/components/people-view";
export const metadata: Metadata = { title: "People" };
export default function PeoplePage(){ return <PeopleView/>; }

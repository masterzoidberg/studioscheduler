import type { Metadata } from "next";
import { PeopleView } from "@/components/people-view";
import { RoomCapacityReviewPanel } from "@/components/room-capacity-review-panel";

export const metadata: Metadata = { title: "People" };

export default function PeoplePage() {
  return (
    <>
      <PeopleView />
      <RoomCapacityReviewPanel />
    </>
  );
}

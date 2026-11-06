// Competitions list.
import type { Metadata } from "next";
import { CompetitionList } from "@/features/competitions/Competitions";

export const metadata: Metadata = { title: "Competitions" };

export default function Page() {
  return <CompetitionList />;
}

// Activity: one thread per job or node you own, plus your wallet.
import type { Metadata } from "next";
import { ActivityPage } from "@/features/activity/ActivityPage";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  return <ActivityPage />;
}

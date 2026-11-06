// Dev-only: the earned-bond meter in every state, for the team's bond decision (UX-INTEGRATION.md section 12, item 1). Not on /balance until the contract holds earnings against a threshold.
import type { Metadata } from "next";
import { BondPlayground } from "@/features/balance/BondPlayground";

export const metadata: Metadata = { title: "Bond playground" };
export default function Page() {
  return <BondPlayground />;
}

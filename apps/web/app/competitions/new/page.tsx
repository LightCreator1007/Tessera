// Host a competition: on a live network the on-chain flow, in demo mode the four-step wizard.
import { HostCompetition } from "@/features/competitions/HostCompetition";
import { LiveHost } from "@/features/competitions/LiveHost";
import { isDemo } from "@/lib/api/client";

export const metadata = { title: "Host a competition" };
export default function Page() {
  return isDemo ? <HostCompetition /> : <LiveHost />;
}

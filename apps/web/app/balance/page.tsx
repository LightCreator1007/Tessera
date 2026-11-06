// Balance: one ledger for the wallet and the node's earnings, with the two exits, spend on a job or claim.
import { Overview } from "@/features/me/Overview";

export const metadata = { title: "Balance" };
export default function Page() {
  return <Overview />;
}

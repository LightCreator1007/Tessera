// One RL competition: its terms, standings with verifier results, and the next step this wallet can sign.
import { RLDetail } from "@/features/competitions/rl/RLCompetition";

export const metadata = { title: "RL competition" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RLDetail id={id} />;
}

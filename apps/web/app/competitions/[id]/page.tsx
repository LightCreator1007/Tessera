// One competition: rules, the labels commitment, entries or the leaderboard, and your own entry. Hosted competitions live in the browser's wallet state, so the lookup happens client side.
import { CompetitionDetail } from "@/features/competitions/Competitions";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompetitionDetail id={id} />;
}

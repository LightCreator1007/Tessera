// Enter one competition: commit predictions, prove personhood, pay the fee, sign.
import { EnterCompetition } from "@/features/competitions/EnterCompetition";

export const metadata = { title: "Enter a competition" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EnterCompetition id={id} />;
}

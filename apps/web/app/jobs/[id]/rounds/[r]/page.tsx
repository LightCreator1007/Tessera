// Round receipt as a full page, for direct links and reloads.
import { RoundPage } from "@/features/round/RoundReceipt";

export default async function Page({ params }: { params: Promise<{ id: string; r: string }> }) {
  const { id, r } = await params;
  return <RoundPage id={Number(id)} r={Number(r)} />;
}

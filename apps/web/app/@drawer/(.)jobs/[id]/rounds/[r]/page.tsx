// Intercepted round receipt: opens as a drawer over the job page when navigated to from inside the app.
import { RoundDrawer } from "@/features/round/RoundReceipt";

export default async function Page({ params }: { params: Promise<{ id: string; r: string }> }) {
  const { id, r } = await params;
  return <RoundDrawer id={Number(id)} r={Number(r)} />;
}

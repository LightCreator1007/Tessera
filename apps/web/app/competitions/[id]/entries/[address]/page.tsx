// One entrant's entry in a competition: rank, per-class accuracy, confusion matrix, commits and notebook.
import { EntrantPage } from "@/features/competitions/Entrant";

export default async function Page({ params }: { params: Promise<{ id: string; address: string }> }) {
  const { id, address } = await params;
  return <EntrantPage id={id} who={address} />;
}

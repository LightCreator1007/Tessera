// Single node route.
import { NodePage } from "@/features/node/NodePages";

export default async function Page({ params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  return <NodePage op={op} />;
}

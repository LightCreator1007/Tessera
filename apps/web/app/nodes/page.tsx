// Nodes list route. ?scope=yours|all picks the lens; without it, the page picks Yours when you run a node.
import { NodesPage } from "@/features/node/NodePages";

export const metadata = { title: "Nodes" };
export default async function Page({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  return <NodesPage scope={scope === "yours" || scope === "all" ? scope : undefined} />;
}

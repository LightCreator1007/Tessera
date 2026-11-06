// Add a node: the CLI quickstart with the web pairing, verify and stake steps inside it.
import { JoinFlow } from "@/features/node/JoinFlow";

export const metadata = { title: "Add a node" };
export default function Page() {
  return <JoinFlow />;
}

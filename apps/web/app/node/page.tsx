// Local console route: the tod-node on this machine, live. Linked from the CLI and the TUI as localhost:3100/node.
import { LocalNode } from "@/features/node/LocalNode";
import { PageHeader } from "@/components/primitives";

export const metadata = { title: "This machine's node" };
export default function Page() {
  return (
    <div className="flex flex-col">
      <PageHeader title="This machine's node" />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 md:px-6">
        <LocalNode />
      </div>
    </div>
  );
}

// Quickstart: add your laptop as a node with the CLI, then pair and stake on the web.
import type { Metadata } from "next";
import { ButtonLink, CodePanel, Steps } from "@/components/primitives";
import { Code, DocSection, DocTitle } from "@/features/docs/DocsFrame";
import { InstallCommand, PairCommand } from "@/features/docs/Live";
import { PAIR_TTL_MIN } from "@/features/docs/cli";

export const metadata: Metadata = { title: "Add your laptop" };

export default function Page() {
  const steps = [
    { key: "install", title: "Install the wrapper", sub: <>Needs Docker with at least 4 GB of memory. The wrapper runs the node image with its own data volume and passes every argument through. Put it on your PATH.</>, body: <InstallCommand />, open: true },
    { key: "init", title: "Create the operator key and run the self-test", sub: "The key never leaves the data volume. The self-test refuses to continue if this machine's math drifts from the reference.", body: <CodePanel code={"tod-node init\ntod-node selftest"} />, open: true },
    { key: "pair", title: "Pair it with your wallet", sub: `Prints a pairing code that expires after ${PAIR_TTL_MIN} minutes.`, body: <PairCommand />, open: true },
    { key: "join", title: "Paste the code, verify, stake", sub: "On the web: paste the code, prove you are one person with World ID, then approve and stake 15 TOD. The stake is one bond for every job.", body: <ButtonLink href="/nodes/add" variant="primary">Open add a node</ButtonLink>, open: true },
    { key: "run", title: "Start it", sub: <>Runs in the background and restarts after a reboot. <Code>run</Code> is planned for release R2.</>, body: <CodePanel code="tod-node run" />, open: true },
  ];
  return (
    <>
      <DocTitle eyebrow="Quickstart" title="Add your laptop">
        A node trains shards of other people&apos;s jobs while the laptop is idle. Its earnings collect in your balance, and the post flow spends them on your own jobs first.
      </DocTitle>
      <Steps steps={steps} />
      <DocSection id="pay" title="How it gets paid">
        <p>Each finalized round splits its pay equally across the nodes whose work passed replay. The first 5 verified hours are a proving period: that share goes to the community pool. After that the node keeps its share and also gets a drip from the pool. A replay mismatch slashes stake; two missed reveals bench the node until it is re-armed.</p>
      </DocSection>
      <DocSection id="stop" title="Stopping">
        <p>The web cannot switch a laptop off. Stop it with <Code>tod-node stop</Code>, then withdraw the stake from your node&apos;s page once it is idle.</p>
      </DocSection>
    </>
  );
}

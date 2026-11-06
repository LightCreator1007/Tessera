// Quickstart: train a model from the browser, from connecting a wallet to downloading checked weights.
import type { Metadata } from "next";
import { ButtonLink, Steps } from "@/components/primitives";
import { Code, DocSection, DocTitle } from "@/features/docs/DocsFrame";

export const metadata: Metadata = { title: "Train a model" };

const STEPS = [
  {
    key: "connect",
    title: "Connect a wallet on Base Sepolia",
    sub: "It pays the budget. You need test TOD for the budget and a little ETH for gas; the post flow offers test TOD when you are short.",
  },
  {
    key: "data",
    title: "Pick the data and the model",
    sub: "Choose a preset dataset and a workload that fits it. Every node downloads the same copy, so any node's work can be replayed and checked.",
  },
  {
    key: "budget",
    title: "Set the budget and the rounds",
    sub: "The budget is split evenly across rounds. If your node has earned anything, the budget step fills in a pay-from-earnings amount first; when earnings cover it all, there is no approve step.",
  },
  {
    key: "post",
    title: "Lock the budget",
    sub: <>One or two transactions: approve TOD for the part your wallet pays, then <Code>createJob</Code>. Nothing leaves the contract until a round is verified. There is no cancel, except for a job stuck waiting for nodes past its wait, which you can abandon.</>,
  },
  {
    key: "watch",
    title: "Watch rounds, then take the weights",
    sub: "Each round shows commit, reveal, replay, verify and pay. The Model tab downloads the weights after the last finalized round and checks their hash against the chain before saving.",
  },
].map((s) => ({ ...s, open: false }));

export default function Page() {
  return (
    <>
      <DocTitle eyebrow="Quickstart" title="Train a model">
        Five steps in the browser. A job waits until enough idle staked nodes are free, then trains round by round.
      </DocTitle>
      <Steps steps={STEPS} />
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/jobs/new" variant="primary">New training job</ButtonLink>
        <ButtonLink href="/docs/how-it-works">How a round is checked</ButtonLink>
      </div>
      <DocSection id="refunds" title="If a job stalls">
        <p>A job that stalls past its window can be abandoned by anyone. Rounds that finalized stay paid; the budget for rounds that never opened goes back to you. Withdraw it from the job&apos;s page.</p>
      </DocSection>
    </>
  );
}

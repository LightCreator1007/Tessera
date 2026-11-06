// Docs, contracts: the live addresses this app reads and writes, from the coordinator config.
import type { Metadata } from "next";
import { Code, DocSection, DocTitle } from "@/features/docs/DocsFrame";
import { ContractTable } from "@/features/docs/Live";

export const metadata: Metadata = { title: "Contracts" };

export default function Page() {
  return (
    <>
      <DocTitle eyebrow="Reference" title="Contracts and the coordinator">
        The chain is the source of truth. Every number in the app is either read from these contracts, checked against a hash they store, or labelled untrusted.
      </DocTitle>
      <DocSection id="addresses" title="Live addresses">
        <ContractTable />
      </DocSection>
      <DocSection id="money" title="Where the money moves">
        <p><Code>JobMarket.createJob(params, fromBalance)</Code> escrows a budget. <Code>fromBalance</Code> is taken from your unclaimed node earnings first, so only the rest needs an approve.</p>
        <p>Each finalized round credits nodes&apos; claimable balances. <Code>claim()</Code> moves yours to your wallet. <Code>withdrawRefund</Code> returns the budget of rounds that never opened.</p>
      </DocSection>
    </>
  );
}

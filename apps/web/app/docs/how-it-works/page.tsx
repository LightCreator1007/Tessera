// Docs, how it works: the round lifecycle, what each trust label means (#trust), and how agents act on a user's behalf (#agents). Moved from /how-it-works.
import type { Metadata } from "next";
import { TrustLabel } from "@/components/primitives";
import { DocTitle } from "@/features/docs/DocsFrame";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  { n: "01", title: "Lock a budget", body: "A requester picks a workload, sets the number of rounds and locks the budget in the JobMarket contract. Nothing leaves the contract until a round is verified." },
  { n: "02", title: "Draw a roster", body: "Each round, idle verified nodes are drawn and given one shard of the batch each. The seed is drawn after everyone commits, so nobody can pick their data." },
  { n: "03", title: "Commit, then reveal", body: "Nodes train their shard, post a hash of the result, and only then reveal it. A node that commits but doesn't reveal is marked and, after two misses, benched." },
  { n: "04", title: "Replay a piece", body: "Two verifiers replay a random piece of each node's work bit for bit. A mismatch is a slash: the node loses stake and the round reverts." },
  { n: "05", title: "Catch poisoned updates", body: "Replay proves the work was computed, not that it was honest. Every update is also ranked against the others, and one that pulls the model away from the rest is flagged and left out of the merge, even if it replays cleanly." },
  { n: "06", title: "Pay by contribution", body: "When the verifiers agree, the round finalizes on chain and each honest node is paid its share. The aggregate weights become the start of the next round." },
];

export default function Page() {
  return (
    <>
      <DocTitle eyebrow="How it works" title="How a round is trained, checked and paid.">Six steps, the same for every round of every job.</DocTitle>

      <ol className="flex flex-col">
        {STEPS.map((s) => (
          <li key={s.n} id={`step-${s.n}`} className="grid grid-step gap-4 border-b border-rule py-6">
            <span className="font-mono text-sm tabular text-subtle">{s.n}</span>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-lg font-semibold text-ink">{s.title}</h2>
              <p className="text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section id="trust" className="flex scroll-mt-20 flex-col gap-5">
        <h2 className="text-lg font-semibold text-ink">Where each number comes from</h2>
        <p className="text-muted">Every value on this site carries one of these labels. Hover a label anywhere to see this text again.</p>
        <dl className="flex flex-col divide-y divide-rule border-y border-rule">
          {([
            ["chain", "Read from the JobMarket or NodeRegistry contract. Nobody, including us, can change it."],
            ["hash-checked", "Served by the coordinator, and its hash matches the one recorded on chain. Safe to rely on."],
            ["untrusted", "Served by the coordinator and not yet checked against the chain. Useful for live progress, never for money."],
            ["demo", "No coordinator is connected. These are fixtures shaped like the real responses, shown so the interface can be reviewed."],
          ] as const).map(([t, d]) => (
            <div key={t} className="grid gap-3 py-4 sm:grid-label-lg">
              <dt><TrustLabel trust={t} /></dt>
              <dd className="text-sm text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="agents" className="flex scroll-mt-20 flex-col gap-4">
        <h2 className="text-lg font-semibold text-ink">Agents</h2>
        <p className="text-muted">
          An agent can post a job or run a node for you, but it never holds your keys. Every action that moves money goes through the same approval you would see:
          the amount, the contract and what happens if it fails. You approve each one in your wallet.
        </p>
      </section>
    </>
  );
}

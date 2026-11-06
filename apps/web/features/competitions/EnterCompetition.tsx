"use client";
// Enter a competition on one page: commit your predictions, prove you're one person, pay the fee (from earnings first), sign once. Each step opens only when the one before it is done, and the entry rules (closed, host, already entered) are checked before any of it.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { isDemo } from "@/lib/api/client";
import { setWallet } from "@/lib/wallet";
import { useTx } from "@/lib/tx";
import { formatToken } from "@/lib/money";
import { More, Sequence, StepPanel, TxButton, TxStatus } from "@/components/flow";
import { openConnect } from "@/components/connect";
import { Banner, Button, EmptyState, Money, Skeleton, short } from "@/components/primitives";
import { CommitFile } from "./CommitFile";
import { HumanGate } from "@/components/human/HumanGate";
import { useHuman } from "@/lib/identity";
import { PayLine } from "./HostCompetition";
import { entryGate, samplePredictions, split, useCompetition, type Committed } from "./model";

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso));

export function EnterCompetition({ id }: { id: string }) {
  const router = useRouter();
  const { c, w } = useCompetition(id);
  const [mounted, setMounted] = useState(false);
  const [preds, setPreds] = useState<Committed | null>(null);
  const human = useHuman();
  const mint = useTx();
  const approve = useTx();
  const enter = useTx({ revertAs: "DeadlinePassed" });
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="mx-auto w-full max-w-2xl px-6 pt-16"><Skeleton className="h-8 w-72" /></div>;
  if (!c) {
    return (
      <EmptyState icon={Trophy} title="No competition with that id" action={<Link href="/competitions" className="text-sm text-ink underline decoration-subtle underline-offset-4">All competitions</Link>}>
        Competitions you host live in this browser until the contract ships. Another browser won&apos;t have them.
      </EmptyState>
    );
  }

  const entered = enter.phase === "confirmed";
  const gate = entryGate(c, w);
  const back = `/competitions/${c.id}`;
  if (!gate.ok && !entered) {
    return (
      <EmptyState icon={Trophy} title={gate.text} action={<Link href={back} className="text-sm text-ink underline decoration-subtle underline-offset-4">Back to {c.title}</Link>}>
        {gate.why === "host" ? "Hosts are blocked so nobody can score their own answer key." : gate.why === "entered" ? "Your predictions are committed. Scores appear after the host reveals the labels." : "Scores appear after the host reveals the labels."}
      </EmptyState>
    );
  }

  const ready = w.connected && !w.wrongNetwork;
  const person = human.verified;
  const pay = split(c.fee, w);

  const submit = () =>
    enter.run(() => {
      setWallet((x) => ({
        usdc: x.usdc - pay.need,
        claimable: x.claimable - pay.fromEarnings,
        allowance: 0,
        entries: [...x.entries, { competition: c.id, predictionsHash: preds?.hash ?? "", fileName: preds?.name ?? "", at: Date.now(), fromEarnings: pay.fromEarnings }],
      }));
      setTimeout(() => router.push(back), 900);
    });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 pt-10 pb-24 md:pt-16">
      <StepPanel
        eyebrow={<Link href={back} className="hover:text-ink">{c.title}</Link>}
        title="Enter this competition"
        lede={<>Entries close {date(c.deadline)} UTC. Your predictions are committed now and scored after the host reveals the labels, so nobody sees them early.</>}
        footer={<Link href={back} className="text-sm text-muted hover:text-ink">Cancel</Link>}
      >
        {!isDemo && <Banner tone="warn" title="Competitions aren't on chain yet.">Entering needs the competition contract.</Banner>}
        <dl className="grid grid-cols-3 gap-4 border-y border-rule py-4">
          <div className="flex flex-col gap-1"><dt className="text-xs text-muted">Entry fee</dt><dd className="text-sm text-ink">{c.fee === 0 ? "Free" : <Money units={c.fee} />}</dd></div>
          <div className="flex flex-col gap-1"><dt className="text-xs text-muted">Prize</dt><dd className="text-sm"><Money units={c.prize} /></dd></div>
          <div className="flex flex-col gap-1"><dt className="text-xs text-muted">Entries so far</dt><dd className="text-sm tabular text-ink">{c.entries.length}</dd></div>
        </dl>
        {c.fee > 0 && <PayLine total={c.fee} pay={pay} connected={w.connected} claimable={w.claimable} />}
        <Sequence
          items={[
            {
              key: "wallet", title: "Connect a wallet", done: ready, note: w.address ? short(w.address) : undefined,
              body: <><p className="text-sm text-muted">The wallet pays the fee and receives the prize if you win.</p><Button variant="primary" onClick={openConnect}>{w.wrongNetwork ? "Switch network" : "Connect wallet"}</Button></>,
            },
            // Before the file, because verifying leaves this page and a file chosen below would be lost on the way.
            {
              key: "person", title: person ? "Verified as one person" : "Prove you're one person", done: person || entered, note: "World ID",
              body: <HumanGate intro="One entry per person. World ID proves that without telling Tessera who you are, and you only do it once." />,
            },
            {
              key: "preds", title: "Commit your predictions", done: !!preds || entered, note: preds ? `${preds.name}, hashed` : undefined,
              body: <div className="flex w-full flex-col gap-3"><CommitFile what="predictions" value={preds} onChange={setPreds} sample={() => samplePredictions(Date.now() % 100_000)} /><More label="What format?"><p>One predicted class per item, in item order: this task has 2,000 items. The file stays here; you upload it for scoring after the deadline, and it must hash to this commitment.</p></More></div>,
            },
            {
              key: "fund", title: pay.shortBy > 0 && !entered ? `Get ${formatToken(pay.shortBy)} more TOD` : "Fee covered", done: pay.shortBy <= 0 || entered, note: pay.need === 0 ? "from earnings" : <Money units={w.usdc} />,
              body: <><p className="text-sm text-muted">You have {formatToken(w.usdc)} TOD. Test TOD is free on this network.</p><TxButton tx={mint} label="Get test TOD" onRun={() => mint.run(() => setWallet((x) => ({ usdc: x.usdc + 200 * 1_000_000 })))} /><TxStatus tx={mint} /></>,
            },
            {
              key: "approve", title: pay.need === 0 ? "No approve needed" : `Allow ${formatToken(pay.need)} TOD`, done: pay.approved || entered, note: pay.need === 0 ? "earnings cover the fee" : "exact amount only",
              body: <><p className="text-sm text-muted">Your wallet asks once, for this amount exactly.</p><TxButton tx={approve} label="Approve" onRun={() => approve.run(() => setWallet({ allowance: pay.need }))} /><TxStatus tx={approve} /></>,
            },
            {
              key: "enter", title: entered ? "Entered" : "Sign your entry", done: entered, note: "taking you back to the competition",
              body: <><p className="text-sm text-muted">One signature records your predictions hash{c.fee > 0 ? " and pays the fee" : ""}. It can&apos;t be changed after.</p><TxButton tx={enter} label="Enter" disabled={!isDemo} why="Needs the competition contract" onRun={submit} /><TxStatus tx={enter} /></>,
            },
          ].filter((x) => pay.need > 0 || (x.key !== "fund" && x.key !== "approve"))}
        />
      </StepPanel>
    </div>
  );
}

"use client";
// Owner panel on a node's page: what your node is doing now, earnings and claim, stake, the CLI commands, and stopping. Shown only to the wallet that owns the node; everyone else sees the public record alone.
import { calls, watchOperator } from "@/lib/chain";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Laptop } from "lucide-react";
import { useJobs, useNodes, useRound } from "@/lib/api/hooks";
import { isDemo } from "@/lib/api/client";
import { setWallet, useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/tx";
import { formatToken } from "@/lib/money";
import { Command, TxButton, TxStatus } from "@/components/flow";
import { Banner, ButtonLink, Card, EmptyState, Eyebrow, Money, PhaseStrip, SectionTitle, Skeleton, cx } from "@/components/primitives";
import { CompetitionNudge } from "@/features/competitions/Nudge";
import { DemoChip, MIN_STAKE } from "./JoinFlow";
import { LocalNode } from "./LocalNode";
import { SlashHistory } from "./SlashHistory";
import { ExcludedNotice } from "./Excluded";

const TOD = 1_000_000;
const PROBATION_HOURS = 5;

/** /me/node used to be a page. The node lives in wallet state, so the old link resolves in the browser. */
/** One honest round's pay in the demo, in base units: the TUI demo pays 1.67 TOD per round. */
const DEMO_ROUND_PAY = 1_670_000;

export function MyNodeRedirect() {
  const w = useWallet();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (ready) router.replace(w.node ? `/nodes/${w.node.operator}` : "/nodes?scope=yours");
  }, [ready, w.node, router]);
  return <div className="p-6"><Skeleton className="h-8 w-64" /></div>;
}

export function OwnerNode() {
  const w = useWallet();
  const jobs = useJobs();
  const nodes = useNodes();
  const claim = useTx({ revertAs: "NothingToClaim" });
  const add = useTx({ revertAs: "StakeTooLow" });
  const withdraw = useTx({ revertAs: "NodeIsBusy" });
  const [more, setMore] = useState("10");
  const [busy, setBusy] = useState(false);
  const node = w.node;
  // Live mode reads this operator's stake from NodeRegistry.
  useEffect(() => { watchOperator(node ? node.operator : null); }, [node]);
  const live = (jobs.data?.data ?? []).find((j) => j.status === "running") ?? null;
  const round = useRound(live?.id ?? Number.NaN, busy && live ? live.currentRound : null);
  if (!node) return null;

  if (!node.joined) {
    return (
      <Card>
        <EmptyState icon={Laptop} title="Setup isn't finished" action={<ButtonLink href="/nodes/add" variant="primary">Finish setup</ButtonLink>}>
          The laptop is paired with this wallet. Verify, stake and join to start earning.
        </EmptyState>
      </Card>
    );
  }

  const state = !node.running ? "offline" : busy ? "training" : "idle";
  const verifiedHours = 0;
  const idle = (nodes.data?.data ?? []).filter((n) => n.online && n.idle).length;
  const lowStake = node.stake < MIN_STAKE;
  const moreUnits = Math.round(Number(more) * TOD);
  const needsApprove = moreUnits > 0 && w.allowanceTo.registry < moreUnits;

  return (
    <section aria-label="Your node" className="flex flex-col gap-4 rounded-xl border border-brand-line bg-brand-soft p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Eyebrow>your node · now</Eyebrow>
          <p className="text-sm text-ink">
            {state === "offline" ? "Joined, waiting for the first heartbeat" : state === "training" ? `Training job ${String(live?.id).padStart(2, "0")}, round ${live?.currentRound}` : "Idle and eligible"}
          </p>
          <p className="text-sm text-muted">
            {state === "offline" && "Start it on the laptop. It comes online within a minute."}
            {state === "idle" && `Rounds draw the longest-idle node first.${nodes.data ? ` ${idle} nodes are idle right now.` : ""}`}
            {state === "training" && "It trains its shard, uploads, then commits and reveals. Pay lands after both verifiers replay a piece."}
          </p>
        </div>
        <ButtonLink href="/jobs/new" variant="primary">Spend earnings on a job</ButtonLink>
      </div>
      {state === "offline" && <Command cmd="tod-node run" />}
      {state === "training" && <PhaseStrip status={round.data?.data.status ?? null} />}
      {isDemo && (
        <div className="flex flex-wrap gap-2">
          <DemoChip onClick={() => setWallet((x) => ({ node: x.node && { ...x.node, running: !x.node.running } }))}>{node.running ? "go offline" : "come online"}</DemoChip>
          {node.running && <DemoChip onClick={() => setBusy((b) => !b)}>{busy ? "finish round" : "get drawn into a round"}</DemoChip>}
          {node.running && <DemoChip onClick={() => setWallet((x) => ({ claimable: x.claimable + DEMO_ROUND_PAY }))}>get paid for a round</DemoChip>}
          <DemoChip onClick={() => setWallet((x) => ({ node: x.node && { ...x.node, stake: 8 * TOD } }))}>get slashed below minimum</DemoChip>
        </div>
      )}

      <ExcludedNotice owner={w.address} on="node" />
      <CompetitionNudge />
      {lowStake && <Banner tone="danger" title={`Stake is ${formatToken(node.stake)} TOD, under the ${formatToken(MIN_STAKE)} minimum.`}>Rounds stop drawing this node until you add stake below.</Banner>}

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="flex flex-col gap-3 p-4">
          <SectionTitle title="Earnings" sub="pay collects here" />
          <p className="text-xl text-ink"><Money units={w.claimable} live /></p>
          <TxButton tx={claim} variant="secondary" label="Claim to wallet" disabled={w.claimable === 0} why="Nothing to claim yet" onRun={() => claim.send(calls.claim, () => setWallet((x) => ({ usdc: x.usdc + x.claimable, claimable: 0, claims: [...x.claims, { amount: x.claimable, at: Date.now() }] })))} />
          <TxStatus tx={claim} />
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <SectionTitle title="Proving period" sub="first pay goes to the pool" />
          <ol className="flex gap-1" aria-label={`${verifiedHours} of ${PROBATION_HOURS} verified hours`}>
            {Array.from({ length: PROBATION_HOURS }, (_, i) => <li key={i} className={cx("h-2 flex-1 rounded-xs", i < verifiedHours ? "bg-brand" : "bg-band")} />)}
          </ol>
          <p className="text-sm text-muted">{verifiedHours} of {PROBATION_HOURS} verified hours; until then its share goes to the community pool. After that it keeps its share plus a drip from the pool.</p>
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <SectionTitle title="Stake" sub="withdraw when idle" />
          <p className="text-xl text-ink"><Money units={node.stake} /></p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="add-stake">Add stake, TOD</label>
            <input id="add-stake" inputMode="decimal" value={more} onChange={(e) => setMore(e.target.value.replace(/[^0-9.]/g, ""))} className="h-8 w-20 rounded-md border border-field bg-surface px-2 font-mono text-sm text-ink outline-none focus:border-muted" />
            <TxButton tx={add} variant="secondary" label={!isDemo && needsApprove ? "Approve" : "Add"} disabled={!(moreUnits > 0) || moreUnits > w.usdc} why={moreUnits > w.usdc ? "Not enough TOD in your wallet" : "Enter an amount"} onRun={() => !isDemo && needsApprove ? add.send(() => calls.approve("registry", moreUnits)) : add.send(() => calls.depositStake(node.operator, moreUnits), () => setWallet((x) => ({ usdc: x.usdc - moreUnits, node: x.node && { ...x.node, stake: x.node.stake + moreUnits } })))} />
            <TxButton tx={withdraw} variant="secondary" label="Withdraw all" disabled={busy || node.stake === 0} why={busy ? "Opens when this round ends" : "Nothing staked"} onRun={() => withdraw.send(() => calls.withdrawStake(node.operator, node.stake), () => setWallet((x) => ({ usdc: x.node ? x.usdc + x.node.stake : x.usdc, node: x.node && { ...x.node, stake: 0 } })))} />
          </div>
          <TxStatus tx={add} />
          <TxStatus tx={withdraw} />
        </Card>
      </div>

      <SlashHistory owner={w.address} operator={node.operator} stake={node.stake} minStake={MIN_STAKE} />

      <LocalNode compact />
    </section>
  );
}

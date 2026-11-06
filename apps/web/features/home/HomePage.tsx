"use client";
// Home adapts to what you have, not to a role (REVAMP-3 section 6). Signed out it is the landing: hero, network strip, live rounds. Signed in it is your workspace in a fixed order: your training, balance, your node, the network. An empty section shrinks to one line instead of disappearing.
import { LiveSystem } from "@/components/mosaic/isoScenes";
import { OfflineBanner } from "@/components/mosaic/OfflineBanner";
import Link from "next/link";
import { ArrowRight, Download, House, Layers, Plus, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useJobState, useJobs, useNodes, usePool, useRound, useRounds, useVerdicts } from "@/lib/api/hooks";
import { isDemo } from "@/lib/api/client";
import { ownsJob, setWallet, useWallet, type PostedJob } from "@/lib/wallet";
import { useTx } from "@/lib/tx";
import { TxButton, TxStatus } from "@/components/flow";
import { RoundTrack, WorkloadArt } from "@/components/pixel";
import { Sparkline, toPoints } from "@/components/charts";
import { HeroBanner } from "@/components/hero";
import { useLedger } from "@/features/me/Overview";
import type { Job, Round } from "@/lib/api/types";
import {
  Banner, Button, ButtonLink, Card, Counter, DocsLink, EmptyState, Eyebrow, IconButton, JobStatusPill, Money, NameCell, Null, PageHeader, PhaseStrip, Pill, RoundStatusPill, SectionTitle, Skeleton, short,
} from "@/components/primitives";

const ACTIVE_SHOWN = 5;
const FINISHED_SHOWN = 3;

export function HomePage() {
  const w = useWallet();
  return w.connected ? <Workspace /> : <Landing />;
}

function Header({ children }: { children?: React.ReactNode }) {
  const jobs = useJobs();
  const qc = useQueryClient();
  const updated = jobs.dataUpdatedAt ? Math.max(0, Math.round((Date.now() - jobs.dataUpdatedAt) / 1000)) : null;
  return (
    <PageHeader
      icon={House}
      title="home" heading="Home"
      meta={updated !== null && <span className="flex items-center gap-1.5 font-mono text-xs text-subtle"><span className="size-1.5 rounded-full bg-subtle" />updated {updated}s ago</span>}
    >
      <IconButton icon={RefreshCw} label="Refresh" onClick={() => qc.invalidateQueries()} />
      {children}
    </PageHeader>
  );
}

function CoordinatorDown() {
  const jobs = useJobs();
  if (!jobs.isError) return null;
  return (
    <OfflineBanner onRetry={() => jobs.refetch()}>
      Contract history and your balance are still readable. Live round state returns with the coordinator.
    </OfflineBanner>
  );
}

/* Signed out: the landing. */

function Landing() {
  const jobs = useJobs();
  const pool = usePool();
  const list = jobs.data?.data ?? [];
  const live = list.find((j) => j.status === "running") ?? null;
  const liveRound = useRound(live?.id ?? Number.NaN, live?.currentRound ?? null);
  const liveState = useJobState(live?.id ?? Number.NaN);
  const curve = liveState.data ? toPoints(liveState.data.data.rounds).map((p) => p.y) : [];
  return (
    <div className="flex flex-col pb-16">
      <Header />
      <div className="flex flex-col gap-6 px-4 py-5 md:px-6">
        <HeroBanner dismissible={false} round={live?.currentRound ?? null} job={live?.id ?? null} status={liveRound.data?.data.status ?? null} nodes={pool.data?.data.online ?? null} curve={curve} total={live?.rounds ?? null} />
        <CoordinatorDown />
        <NetworkStrip withRecycled />
        {live && liveRound.data && <LiveSystemCard job={live.id} round={liveRound.data.data} />}
        <LiveRounds />
      </div>
    </div>
  );
}

/** How a round works, drawn from the live one: the real roster, coordinator, verifiers and contract, the current stage lit. */
function LiveSystemCard({ job, round }: { job: number; round: Round }) {
  const ver = useVerdicts(job, round.round);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="How a round works, live" sub={`job #${job} · round ${round.round} · ${round.status}`}>
        <Link href={`/jobs/${job}/rounds/${round.round}`} className="text-sm text-muted hover:text-ink">receipt</Link>
      </SectionTitle>
      <div className="h-96 overflow-hidden border border-rule bg-surface">
        <LiveSystem round={round} verdicts={ver.data?.data ?? []} />
      </div>
    </section>
  );
}

/* Signed in: the workspace. */

function Workspace() {
  return (
    <div className="flex flex-col pb-16">
      <Header>
        <ButtonLink href="/jobs/new" variant="primary" icon={Plus} className="md:hidden">New job</ButtonLink>
      </Header>
      <div className="flex flex-col gap-6 px-4 py-5 md:px-6">
        <CoordinatorDown />
        <div className="grid items-start gap-4 lg:grid-split">
          <YourTraining />
          <div className="flex flex-col gap-4">
            <BalanceCard />
            <YourNode />
          </div>
        </div>
        <NetworkStrip />
      </div>
    </div>
  );
}

function YourTraining() {
  const w = useWallet();
  const jobs = useJobs();
  const owned = (jobs.data?.data ?? []).filter((j) => ownsJob(w.address, isDemo, j));
  const active = owned.filter((j) => j.status === "running" || j.status === "open");
  const finished = owned.filter((j) => j.status === "completed" || j.status === "abandoned").slice(0, FINISHED_SHOWN);
  const posted = w.postedJobs;
  const total = owned.length + posted.length;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle title="Your training" sub={jobs.isPending ? "loading" : total === 0 ? "nothing yet" : `${active.length + posted.length} active · ${owned.length - active.length} finished`}>
        {total > 0 && <Link href="/jobs?scope=yours" className="inline-flex min-h-6 items-center gap-1 text-sm text-muted hover:text-ink">all your jobs <ArrowRight className="size-3.5" /></Link>}
      </SectionTitle>
      {jobs.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : total === 0 ? (
        <EmptyState icon={Layers} poster="EMPTY" title="Train your first model" action={<ButtonLink href="/jobs/new" variant="primary" icon={Plus}>New job</ButtonLink>}>
          Pick a dataset and a workload, lock a budget, and idle laptops train it round by round. Each round is replayed before it pays.
        </EmptyState>
      ) : (
        <>
          {(active.length > 0 || posted.length > 0) && (
            <ul className="flex flex-col divide-y divide-rule-row">
              {posted.map((p) => <PostedItem key={`p${p.id}`} p={p} />)}
              {active.slice(0, ACTIVE_SHOWN).map((j) => <ActiveItem key={j.id} job={j} />)}
            </ul>
          )}
          {active.length > ACTIVE_SHOWN && <Link href="/jobs?scope=yours" className="inline-flex min-h-6 items-center text-sm text-muted hover:text-ink">{active.length - ACTIVE_SHOWN} more active jobs</Link>}
          {finished.length > 0 && (
            <div className="flex flex-col gap-1">
              <Eyebrow>recently finished</Eyebrow>
              <ul className="flex flex-col divide-y divide-rule-row">
                {finished.map((j) => <FinishedItem key={j.id} job={j} />)}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function ActiveItem({ job }: { job: Job }) {
  const r = useRound(job.id, job.status === "running" ? job.currentRound : null);
  const rounds = useRounds(job.id);
  const st = useJobState(job.id);
  const rd = r.data?.data;
  return (
    <li className="relative flex flex-col gap-3 py-4 first:pt-1">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/jobs/${job.id}`} className="min-w-0 after:absolute after:inset-0">
          <NameCell lead={<WorkloadArt workload={job.workload} />} title={<>{job.workload} <span className="font-mono text-xs text-subtle">#{job.id}</span></>} sub={job.currentRound === null ? "waiting for enough idle nodes" : `round ${job.currentRound} of ${job.rounds}`} />
        </Link>
        <span className="flex shrink-0 items-center gap-3">
          <span className="hidden text-trend-good sm:block">{st.data ? <Sparkline points={toPoints(st.data.data.rounds)} width={88} height={20} /> : null}</span>
          {rd ? <RoundStatusPill status={rd.status} /> : <JobStatusPill status={job.status} />}
        </span>
      </div>
      {job.status === "running" ? (r.isPending ? <Skeleton className="h-6 w-full" /> : <PhaseStrip status={rd?.status ?? null} />) : <RoundTrack total={job.rounds} rounds={rounds.data?.data ?? []} />}
    </li>
  );
}

function PostedItem({ p }: { p: PostedJob }) {
  return (
    <li className="flex items-center justify-between gap-3 py-4 first:pt-1">
      <NameCell lead={<WorkloadArt workload={p.workload} />} title={<>{p.workload} <span className="font-mono text-xs text-subtle">#{p.id}</span></>} sub={`posted from this browser · ${p.rounds} rounds`} />
      <JobStatusPill status="open" />
    </li>
  );
}

function FinishedItem({ job }: { job: Job }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <Link href={`/jobs/${job.id}`} className="block min-w-0 truncate py-0.5 text-sm text-ink hover:underline">{job.workload} <span className="font-mono text-xs text-subtle">#{job.id}</span></Link>
      {job.status === "completed" ? (
        <ButtonLink href={`/jobs/${job.id}?tab=model`} icon={Download}>Weights</ButtonLink>
      ) : (
        <ButtonLink href={`/jobs/${job.id}`}>Refund</ButtonLink>
      )}
    </li>
  );
}

function BalanceCard() {
  const w = useWallet();
  const { earned, spent, share } = useLedger();
  const claim = useTx({ revertAs: "NothingToClaim" });
  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle title="Balance" sub="one balance, two sources">
        <Link href="/balance" className="inline-flex min-h-6 items-center gap-1 text-sm text-muted hover:text-ink">ledger <ArrowRight className="size-3.5" /></Link>
      </SectionTitle>
      <dl className="grid grid-cols-2 gap-4">
        <Counter value={<Money units={w.usdc} />} label="in your wallet" />
        <Counter value={<Money units={w.claimable} />} label="earned, unclaimed" tone={w.claimable > 0 ? "ok" : undefined} />
      </dl>
      {share !== null && earned > 0 && <p className="text-sm text-muted">Your laptop paid for <span className="font-mono text-brand">{Math.round(share * 100)}%</span> of your training.</p>}
      {spent === 0 && earned > 0 && <p className="text-sm text-muted">What your node earned can pay for a job, with no approve step.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {w.claimable > 0 && <ButtonLink href="/jobs/new" variant="primary">Spend on a job</ButtonLink>}
        <TxButton tx={claim} variant="secondary" label="Claim" disabled={w.claimable === 0} why="Nothing to claim yet" onRun={() => claim.run(() => setWallet((x) => ({ usdc: x.usdc + x.claimable, claimable: 0, claims: [...x.claims, { amount: x.claimable, at: Date.now() }] })))} />
      </div>
      <TxStatus tx={claim} />
    </Card>
  );
}

function YourNode() {
  const w = useWallet();
  const nodes = useNodes();
  const node = w.node;
  if (!node) {
    return (
      <p className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rule px-4 py-3 text-sm text-muted">
        Your laptop can pay for your next job.
        <Link href="/nodes/add" className="inline-flex min-h-6 items-center text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">Add a node</Link>
      </p>
    );
  }
  const n = nodes.data?.data.find((x) => x.op.toLowerCase() === node.operator.toLowerCase());
  const now = !node.joined ? "Setup not finished" : n ? (n.online ? (n.idle ? "Idle, waiting to be drawn" : "Training in a round") : "No heartbeat in 60 s") : node.running ? "Running, first heartbeat pending" : "Joined, not running";
  return (
    <Card className="flex flex-col gap-3 p-5">
      <SectionTitle title="Your node" sub={<span className="font-mono">{short(node.operator)}</span>}>
        <Link href={`/nodes/${node.operator}`} className="inline-flex min-h-6 items-center gap-1 text-sm text-muted hover:text-ink">manage <ArrowRight className="size-3.5" /></Link>
      </SectionTitle>
      <p className="flex items-center gap-2 text-sm text-ink">
        {n && n.online && !n.idle ? <Pill tone="brand" live>Training</Pill> : <Pill tone={node.joined && (n?.online || node.running) ? "neutral" : "warn"}>{node.joined ? (n?.online || node.running ? "Idle" : "Offline") : "Pairing"}</Pill>}
        {now}
      </p>
      <p className="text-sm text-muted">Stake <Money units={node.stake} /></p>
    </Card>
  );
}

/* Shared: the network, as one strip, and the live rounds list. */

function NetworkStrip({ withRecycled = false }: { withRecycled?: boolean }) {
  const jobs = useJobs();
  const pool = usePool();
  const w = useWallet();
  const list = jobs.data?.data ?? [];
  const running = list.filter((j) => j.status === "running");
  const paid = list.reduce((s, j) => s + (j.budget - j.remaining), 0);
  const live = running[0] ?? null;
  const local = w.postedJobs.reduce((s, p) => s + (p.fromEarnings ?? 0), 0); // rails-allow: jobs without a recorded split took nothing from earnings
  const fromEarnings = isDemo ? 18_000_000 + local : null;
  const budgets = list.reduce((s, j) => s + j.budget, 0) + w.postedJobs.reduce((s, p) => s + p.budget, 0);
  return (
    <section aria-label="Network" className="flex flex-col gap-3 rounded-xl border border-rule p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>the network</Eyebrow>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 whitespace-nowrap">
          {live && live.currentRound !== null && <Link href={`/jobs/${live.id}/rounds/${live.currentRound}`} className="inline-flex min-h-6 items-center text-xs text-muted hover:text-ink">watch round {live.currentRound} of job {live.id}</Link>}
          <Link href="/nodes?scope=all" className="hidden min-h-6 items-center text-xs text-muted hover:text-ink sm:inline-flex">all nodes</Link>
          <Link href="/jobs?scope=all" className="hidden min-h-6 items-center text-xs text-muted hover:text-ink sm:inline-flex">all jobs</Link>
          <DocsLink href="/docs/contracts">contracts</DocsLink>
        </span>
      </div>
      {jobs.isPending || pool.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Counter value={pool.data ? pool.data.data.online : <Null>Unknown</Null>} label={pool.data ? `nodes online · ${pool.data.data.idle} idle` : "nodes online"} />
          <Counter value={running.length} label={`jobs training · of ${list.length}`} />
          <Counter value={<Money units={paid} />} label="paid to nodes" />
          {withRecycled ? (
            <Counter value={fromEarnings === null || budgets === 0 ? <Null>Needs the indexer</Null> : `${((fromEarnings / budgets) * 100).toFixed(1)}%`} label="of budgets paid from node earnings" />
          ) : (
            <Counter value={list.reduce((s, j) => s + Math.max(0, (j.currentRound ?? 0) - (j.status === "running" ? 1 : 0)), 0)} label="rounds settled" /> // rails-allow: round count
          )}
        </dl>
      )}
    </section>
  );
}

function LiveRounds() {
  const jobs = useJobs();
  const running = (jobs.data?.data ?? []).filter((j) => j.status === "running");
  return (
    <Card className="flex flex-col gap-5 p-5">
      <SectionTitle title="Live rounds" sub={`${running.length} jobs training now`}>
        <Link href="/jobs?scope=all" className="inline-flex min-h-6 items-center gap-1 text-sm text-muted hover:text-ink">all jobs <ArrowRight className="size-3.5" /></Link>
      </SectionTitle>
      {jobs.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : running.length === 0 ? (
        <EmptyState icon={Layers} poster="IDLE" title="No rounds running">When a job draws its roster, the round shows up here.</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-rule">
          {running.map((j) => <LiveRow key={j.id} job={j} />)}
        </ul>
      )}
    </Card>
  );
}

function LiveRow({ job }: { job: Job }) {
  const r = useRound(job.id, job.currentRound);
  const rd = r.data?.data;
  return (
    <li className="relative flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/jobs/${job.id}`} className="flex min-w-0 items-baseline gap-2 after:absolute after:inset-0">
          <span className="truncate text-sm text-ink">{job.workload}</span>
          <span className="font-mono text-xs text-subtle">#{job.id} · R{job.currentRound} / {job.rounds}</span>
        </Link>
        {rd && <RoundStatusPill status={rd.status} />}
      </div>
      {r.isPending ? <Skeleton className="h-6 w-full" /> : <PhaseStrip status={rd?.status ?? null} />}
      {rd && (
        <p className="font-mono text-xs text-subtle">
          {rd.committed.length}/{rd.roster.length} committed · {rd.revealed.length}/{rd.roster.length} revealed
        </p>
      )}
    </li>
  );
}

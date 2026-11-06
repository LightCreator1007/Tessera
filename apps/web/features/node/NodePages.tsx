"use client";
// Node directory (Yours | All scope, Neatlogs table with a fleet view option) and the single-node page on the detection-detail layout: the owner panel when it is yours, stat card, proving track, round record, penalties, Properties rail.
import { PoolCity, RecordStreet } from "@/components/mosaic/isoScenes";
import { StatePoster } from "@/components/mosaic/StatePoster";
import { NumberLoader } from "@/components/mosaic/NumberLoader";
import { ConnectGate } from "@/components/mosaic/ConnectGate";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Cpu, Filter, Laptop, ShieldAlert, Wallet } from "lucide-react";
import { openConnect } from "@/components/connect";
import { OwnerNode } from "./OwnerNode";
import { NodeSettings } from "./NodeSettings";
import { useNodeChain, useNodes } from "@/lib/api/hooks";
import { useWallet } from "@/lib/wallet";
import type { Node, NodeChain, NodeRoundResult } from "@/lib/api/types";
import { NodeArt, hueFor, type Hue, type ScreenState } from "@/components/pixel";
import { DEMO_NOW } from "@/mocks/fixtures";
import {
  AddressChip, Banner, Button, ButtonLink, Card, ChipSelect, Counter, Crumbs, DocsLink, EmptyState, Money, NameCell, Null, PageHeader, Pager, Pill, PillTabs, PropRow, PropsRail, ROW,
  SectionTitle, Segmented, Skeleton, TD, TH, THead, TextTabs, cx, relTime, short,
} from "@/components/primitives";

type Standing = "proving" | "active" | "benched" | "inactive" | "new" | "unknown";
function standing(c: NodeChain | undefined, minStake: number): Standing {
  if (!c) return "unknown";
  if (c.stake !== null && c.stake < minStake / 2) return "inactive";
  if (c.missedReveals >= 2) return "benched";
  if (!c.graduated) return c.verifiedWorkSeconds === 0 ? "new" : "proving";
  return "active";
}
const STANDING: Record<Standing, { label: string; tone: "ok" | "warn" | "danger" | "pending" | "neutral" }> = {
  active: { label: "Active", tone: "ok" },
  proving: { label: "Proving", tone: "pending" },
  new: { label: "New", tone: "pending" },
  benched: { label: "Benched", tone: "warn" },
  inactive: { label: "Stake too low", tone: "danger" },
  unknown: { label: "Unknown", tone: "neutral" },
};
const MIN_STAKE = 5_000_000;

type Seg = "all" | "online" | "idle" | "offline";

export function NodesPage({ scope: asked }: { scope?: "yours" | "all" }) {
  const nodes = useNodes();
  const w = useWallet();
  const scope = asked ?? (w.node ? "yours" : "all");
  const [seg, setSeg] = useState<Seg>("all");
  const [hw, setHw] = useState("all");
  const [view, setView] = useState<"city" | "table" | "fleet">("city");
  const list = nodes.data?.data ?? [];
  const pick = (s: Seg) => list.filter((n) => s === "all" || (s === "online" && n.online) || (s === "idle" && n.online && n.idle) || (s === "offline" && !n.online));
  const archOf = (n: Node) => n.arch ?? "not reported";
  const arches = [{ key: "all", label: "Any hardware" }, ...[...new Set(list.map(archOf))].map((k) => ({ key: k, label: k, count: list.filter((n) => archOf(n) === k).length }))];
  const shown = pick(seg).filter((n) => hw === "all" || archOf(n) === hw);
  const mine = w.node?.operator?.toLowerCase() ?? null;
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader icon={Cpu} title="nodes" heading="Nodes" meta={<DocsLink href="/docs/node">Add your laptop</DocsLink>}>
        {scope === "all" && <Segmented items={[{ key: "city", label: "City" }, { key: "table", label: "Table" }, { key: "fleet", label: "Fleet" }]} value={view} onChange={setView} label="View" />}
        <ButtonLink href="/nodes/add" variant="primary" icon={Laptop}>Add a node</ButtonLink>
      </PageHeader>

      <div className="px-4 pt-3 md:px-6">
        <PillTabs value={scope} hrefFor={(k) => `/nodes?scope=${k}`} items={[{ key: "yours", label: "Yours", count: w.connected ? (w.node ? 1 : 0) : undefined }, { key: "all", label: "All", count: nodes.isPending ? undefined : list.length }]} />
      </div>

      {scope === "yours" ? <YourNodes /> : <>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-6">
        <TextTabs
          label="Filter nodes"
          items={[{ key: "all", label: "All", count: list.length }, { key: "online", label: "Online", count: pick("online").length }, { key: "idle", label: "Idle", count: pick("idle").length }, { key: "offline", label: "Offline", count: pick("offline").length }]}
          value={seg}
          onChange={setSeg}
        />
        <span className="flex items-center gap-1">
          <Filter className="mr-1 size-3.5 text-muted" strokeWidth={1.5} aria-hidden />
          <ChipSelect label="Hardware" value={hw} options={arches} onChange={setHw} />
        </span>
      </div>

      {view === "city" && (
        <div className="mx-4 mb-3 h-96 overflow-hidden border border-rule bg-surface md:mx-6 md:h-128">
          {nodes.isPending ? <Skeleton className="size-full" /> : <PoolCity nodes={shown} mine={mine} />}
        </div>
      )}

      {view === "fleet" ? (
        <div className="grid grid-cols-2 gap-3 px-4 pb-10 sm:grid-cols-3 md:px-6 xl:grid-cols-4">
          {nodes.isPending
            ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)
            : shown.map((n) => <FleetCard key={n.op} n={n} mine={n.op.toLowerCase() === mine} />)}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <table className="w-full min-w-table text-sm">
            <THead><TH>Node</TH><TH>Now</TH><TH>Hardware</TH><TH>Workloads</TH><TH className="text-right">Version</TH></THead>
            <tbody>
              {nodes.isPending
                ? Array.from({ length: 6 }, (_, i) => <tr key={i} className="border-t border-rule-row"><TD><Skeleton className="h-8 w-44" /></TD><TD><Skeleton className="h-6 w-20" /></TD><TD><Skeleton className="h-4 w-28" /></TD><TD><Skeleton className="h-4 w-32" /></TD><TD><Skeleton className="ml-auto h-4 w-10" /></TD></tr>)
                : shown.map((n) => (
                    <tr key={n.op} className={ROW}>
                      <TD>
                        <Link href={`/nodes/${n.op}`} className="block after:absolute after:inset-0">
                          <NameCell
                            lead={<NodeArt op={n.op} state={screen(n)} />}
                            title={<span className="font-mono text-xs">{short(n.op)} {n.op.toLowerCase() === mine && <Pill tone="brand">you</Pill>}</span>}
                            sub={n.online ? (n.idle ? "waiting to be drawn" : "in a round now") : "no heartbeat in 60 s"}
                          />
                        </Link>
                      </TD>
                      <TD><Liveness n={n} /></TD>
                      <TD className="text-muted">{n.arch ?? <Null>Not reported</Null>}</TD>
                      <TD className="font-mono text-xs text-muted">{n.workloads.join(", ")}</TD>
                      <TD className="text-right font-mono text-xs text-muted">{n.version}</TD>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      {!nodes.isPending && shown.length === 0 && (
        <EmptyState icon={Cpu} poster={list.length === 0 ? "EMPTY" : undefined} title={list.length === 0 ? "No nodes yet" : "No nodes match"} action={list.length === 0 ? <ButtonLink href="/nodes/add" variant="primary" icon={Laptop}>Add a node</ButtonLink> : undefined}>
          {list.length === 0 ? "Add your laptop to be the first." : "Try another filter."}
        </EmptyState>
      )}
      {view === "table" && <Pager shown={shown.length} total={shown.length} />}
      </>}
    </div>
  );
}

/** The Yours scope. Your node comes from wallet state, so it shows even before the coordinator has seen a heartbeat. */
function YourNodes() {
  const w = useWallet();
  const nodes = useNodes();
  if (!w.connected) {
    return <ConnectGate title="Connect to see your node" figure="heron">A node is paired with one owner wallet. Its earnings land in that wallet&apos;s balance.</ConnectGate>;
  }
  if (!w.node) {
    return (
      <EmptyState icon={Laptop} poster="EMPTY" title="Your laptop can pay for your next job" action={<span className="flex flex-wrap justify-center gap-2"><ButtonLink href="/nodes/add" variant="primary">Add a node</ButtonLink><ButtonLink href="/docs/cli">CLI reference</ButtonLink></span>}>
        Install the CLI, pair it with this wallet and stake 15 TOD. It trains other people&apos;s jobs while idle, and the earnings pay for yours first.
      </EmptyState>
    );
  }
  const node = w.node;
  const n = nodes.data?.data.find((x) => x.op.toLowerCase() === node.operator.toLowerCase());
  const now = !node.joined ? "setup not finished" : n ? (n.online ? (n.idle ? "waiting to be drawn" : "in a round now") : "no heartbeat in 60 s") : node.running ? "running, first heartbeat pending" : "joined, not running";
  return (
    <div className="flex-1 overflow-x-auto pt-3">
      <table className="w-full min-w-table text-sm">
        <THead><TH>Node</TH><TH>Now</TH><TH>Stake</TH><TH className="text-right">Unclaimed earnings</TH></THead>
        <tbody>
          <tr className={ROW}>
            <TD>
              <Link href={`/nodes/${node.operator}`} className="block after:absolute after:inset-0">
                <NameCell lead={<NodeArt op={node.operator} state={screen(n)} />} title={<span className="font-mono text-xs">{short(node.operator)} <Pill tone="brand">you</Pill></span>} sub={now} />
              </Link>
            </TD>
            <TD>{n ? <Liveness n={n} /> : <Pill tone={node.joined ? "neutral" : "pending"}>{node.joined ? "No heartbeat" : "Pairing"}</Pill>}</TD>
            <TD><Money units={node.stake} /></TD>
            <TD className="text-right"><Money units={w.claimable} className="text-ink" /></TD>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function screen(n: Node | undefined): ScreenState {
  if (!n || !n.online) return "offline";
  return n.idle ? "idle" : "training";
}

function FleetCard({ n, mine }: { n: Node; mine: boolean }) {
  return (
    <Link href={`/nodes/${n.op}`} className="group flex flex-col overflow-hidden rounded-xl border border-rule bg-surface transition-colors duration-150 hover:bg-hover">
      <NodeArt op={n.op} state={screen(n)} size="lg" className="aspect-video w-full rounded-none p-5" />
      <span className="flex flex-col gap-1.5 border-t border-rule p-3">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-xs text-ink">{short(n.op)} {mine && <Pill tone="brand">you</Pill>}</span>
          <Liveness n={n} />
        </span>
        <span className="truncate text-xs text-subtle">{n.arch ?? "hardware not reported"} · {n.workloads.length} workload{n.workloads.length === 1 ? "" : "s"}</span>
      </span>
    </Link>
  );
}

function Liveness({ n }: { n: Node | undefined }) {
  if (!n) return <Null>No heartbeat</Null>;
  if (!n.online) return <Pill tone="warn">Offline</Pill>;
  return n.idle ? <Pill tone="neutral">Idle</Pill> : <Pill tone="brand" live>Training</Pill>;
}

export function NodePage({ op }: { op: string }) {
  const nodes = useNodes();
  const chain = useNodeChain(op);
  const w = useWallet();
  const n = nodes.data?.data.find((x) => x.op.toLowerCase() === op.toLowerCase());
  const c = chain.data?.data;
  const mine = w.node?.operator?.toLowerCase() === op.toLowerCase();
  const head = <PageHeader title={<Crumbs items={[{ href: mine ? "/nodes?scope=yours" : "/nodes", label: "nodes" }, { label: short(op), mono: true }]} />} />;

  // Your own node renders from wallet state at once; the public record below fills in when the chain answers.
  if (mine && (chain.isPending || nodes.isPending || chain.isError) && !n) {
    return (
      <div className="flex min-h-full flex-col">
        {head}
        <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
          <h1 className="font-mono text-xl font-medium text-ink" title={op}>{short(op, 6, 4)} <Pill tone="brand">your node</Pill></h1>
          <OwnerNode />
          {nodes.isPending ? <Skeleton className="h-40 w-full rounded-xl" /> : <Card><EmptyState icon={Cpu} title="No public record yet">The chain record appears once NodeJoined is indexed and the first round settles.</EmptyState></Card>}
        </div>
      </div>
    );
  }
  if (chain.isPending || nodes.isPending) return <div className="flex flex-col">{head}<div className="flex flex-col gap-4 px-4 py-6 md:px-6"><Skeleton className="h-8 w-72" /><Skeleton className="h-40 w-full rounded-xl" /></div></div>;
  if (chain.isError && !n) return <div className="flex flex-col">{head}<EmptyState icon={Cpu} title="This address hasn't joined as a node">Nodes appear after their NodeJoined event.</EmptyState></div>;

  const s = standing(c, MIN_STAKE);
  return (
    <div className="flex min-h-full flex-col">
      {head}
      <div className="grid flex-1 xl:grid-detail">
        <div className="flex min-w-0 flex-col gap-6 px-4 py-6 md:px-6">
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate font-mono text-xl font-medium text-ink" title={op}>{short(op, 6, 4)}</h1>
              {mine && <Pill tone="brand">your node</Pill>}
            </div>
            <p className="text-sm text-muted">{n?.arch ?? "Hardware not reported"} · {n ? `${n.workloads.length} workload${n.workloads.length === 1 ? "" : "s"}` : "no heartbeat yet"} · version {n?.version ?? "unknown"}</p>
          </header>
          {mine && <OwnerNode />}
          {s === "benched" && <Banner tone="warn" title="Benched after two missed reveals">This node isn&apos;t drawn into new rounds until the operator re-arms it. Its stake is untouched.</Banner>}
          {s === "inactive" && <Banner tone="danger" title="Stake below half the minimum">Slashes took the stake under the floor. Top up to be drawn into rounds again.</Banner>}

          <Card className="grid gap-5 p-4 md:grid-split">
            {c ? (
              <dl className="grid grid-cols-2 content-start gap-x-6 gap-y-5">
                <Counter value={`${(c.verifiedWorkSeconds / 3600).toFixed(1)} h`} label="verified work" />
                <Counter value={c.history.length} label="rounds sat" />
                <Counter value={c.missedReveals} label="missed reveals" tone={c.missedReveals > 0 ? "warn" : undefined} />
                <Counter value={c.penalties.length} label="penalties" tone={c.penalties.length > 0 ? "danger" : undefined} />
              </dl>
            ) : <Null>No chain record yet</Null>}
            <div className="flex flex-col justify-between gap-4">
              <NodeArt op={op} state={s === "inactive" ? "slashed" : screen(n)} size="lg" className="aspect-video w-full rounded-lg p-4" />
              {c && <ProvingTrack c={c} hue={hueFor(op)} />}
            </div>
          </Card>

          {c && <RoundRecord c={c} />}

          <section className="flex flex-col gap-3">
            <SectionTitle title="Penalties" sub="slashes and missed reveals, newest first" />
            {!c || c.penalties.length === 0 ? (
              <Card><EmptyState icon={ShieldAlert} poster="CLEAN" title="No penalties">Every round this node joined was revealed and passed replay.</EmptyState></Card>
            ) : (
              <div className="overflow-hidden rounded-xl border border-rule">
                {c.penalties.some((p) => p.kind === "Slashed") && <StatePoster word="SLASHED" kind="slashed" className="h-28 border-b border-rule bg-surface" />}
                <table className="w-full text-sm">
                  <THead><TH>When</TH><TH>What</TH><TH>Round</TH><TH className="text-right">Lost</TH></THead>
                  <tbody>
                    {c.penalties.map((p) => (
                      <tr key={`${p.job}-${p.round}`} className={ROW}>
                        <TD className="font-mono text-xs text-muted">{relTime(p.at, DEMO_NOW)}</TD>
                        <TD>{p.kind === "Slashed" ? <Pill tone="danger">Slashed: replay mismatch</Pill> : <Pill tone="warn">Missed reveal</Pill>}</TD>
                        <TD><Link href={`/jobs/${p.job}/rounds/${p.round}`} className="font-mono text-xs text-ink hover:underline">#{p.job} R{p.round}</Link></TD>
                        <TD className="text-right">{p.amount === null ? <Null>Nothing</Null> : <Money units={p.amount} className="text-danger" />}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {mine && <OwnSettings />}
        </div>
        <PropsRail>
          <PropRow label="Standing"><Pill tone={STANDING[s].tone}>{STANDING[s].label}</Pill></PropRow>
          <PropRow label="Now"><Liveness n={n} /></PropRow>
          <PropRow label="Stake"><Money units={c?.stake ?? null} /></PropRow>
          <PropRow label="Earned"><Money units={c?.earned ?? null} /></PropRow>
          <PropRow label="Hardware">{n?.arch ?? <Null />}</PropRow>
          <PropRow label="Workloads"><span className="font-mono text-xs">{n?.workloads.join(", ") ?? <Null />}</span></PropRow>
          <PropRow label="Joined">{c ? relTime(c.joinedAt, DEMO_NOW) : <Null />}</PropRow>
          <PropRow label="Operator"><AddressChip value={op} /></PropRow>
        </PropsRail>
      </div>
    </div>
  );
}

/** Your laptop's schedule, pause and limits, on its own page. Links from Settings land here with #node-settings (#settings would open the modal), which arrives before the section renders, so scroll once it does. */
function OwnSettings() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (location.hash === "#node-settings") { ref.current?.scrollIntoView({ block: "start" }); window.scrollTo(0, 0); } }, []); // the frame itself must not scroll, only the main panel
  return (
    <section ref={ref} id="node-settings" className="flex scroll-mt-4 flex-col gap-3 border-t border-rule pt-6">
      <SectionTitle title="Settings" sub="when this laptop takes rounds, and what it runs" />
      <NodeSettings />
    </section>
  );
}

const PROVE_TILE: Record<Hue, string> = { coral: "bg-px-coral", amber: "bg-px-amber", lime: "bg-px-lime", teal: "bg-px-teal", sky: "bg-px-sky", violet: "bg-px-violet", rose: "bg-px-rose" };

/** Probation as one tile per day, filled in the node's own hue. */
function ProvingTrack({ c, hue }: { c: NodeChain; hue: Hue }) {
  const days = Math.round(c.probationSeconds / 86400);
  const elapsed = c.graduated ? days : Math.min(days, Math.floor((DEMO_NOW - c.joinedAt) / 86400));
  const left = Math.max(0, (c.probationSeconds - (DEMO_NOW - c.joinedAt)) / 86400);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline justify-between gap-3 font-mono text-xs uppercase tracking-wide text-subtle">
        <span>Proving period</span>
        <span className="normal-case tracking-normal">{c.graduated ? "complete, full pay share" : `${left.toFixed(1)} days left, reduced share`}</span>
      </p>
      {!c.graduated && <NumberLoader value={(DEMO_NOW - c.joinedAt) / c.probationSeconds} label="Proving period" className="h-48" />}
      <ol className="flex gap-1" aria-label={`Proving: day ${elapsed} of ${days}`}>
        {Array.from({ length: days }, (_, i) => (
          <li key={i} className={cx("h-2 flex-1 rounded-xs", i < elapsed ? PROVE_TILE[hue] : i === elapsed ? "bg-mosaic tile-flicker" : "bg-band")} />
        ))}
      </ol>
    </div>
  );
}

const RESULT: Record<NodeRoundResult, { tile: string; label: string }> = {
  paid: { tile: "bg-ok", label: "Paid" },
  fallback: { tile: "bg-warn", label: "Paid on fallback" },
  slashed: { tile: "bg-danger", label: "Slashed" },
  reverted: { tile: "bg-danger opacity-50", label: "Round reverted" },
  voided: { tile: "bg-warn opacity-50", label: "Voided" },
  live: { tile: "bg-brand tile-flicker", label: "In progress" },
};

/** The node's record: one tile per round it sat in, grouped by job, each tile opening the receipt. */
function RoundRecord({ c }: { c: NodeChain }) {
  const byJob = new Map<number, NodeChain["history"]>();
  c.history.forEach((h) => byJob.set(h.job, [...(byJob.get(h.job) ?? []), h]));
  const used = (Object.keys(RESULT) as NodeRoundResult[]).filter((k) => c.history.some((h) => h.result === k));
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Round record" sub="every round this node sat in, by job" />
      {c.history.length > 0 && <div className="h-56 overflow-hidden border border-rule bg-surface"><RecordStreet chain={c} /></div>}
      {c.history.length === 0 ? (
        <Card><EmptyState icon={Cpu} poster="WAIT" title="No rounds yet">The node is staked and waiting to be drawn into a roster.</EmptyState></Card>
      ) : (
        <Card className="flex flex-col gap-4 p-4">
          {[...byJob.entries()].map(([job, rows]) => (
            <div key={job} className="grid items-center gap-2 sm:grid-label">
              <Link href={`/jobs/${job}`} className="font-mono text-xs uppercase tracking-wide text-muted hover:text-ink">job {String(job).padStart(2, "0")}</Link>
              <ol className="flex flex-wrap gap-1">
                {rows.map((h) => (
                  <li key={h.round}>
                    <Link href={`/jobs/${h.job}/rounds/${h.round}`} title={`Round ${h.round}: ${RESULT[h.result].label}`} className={cx("block size-5 rounded-xs transition-opacity duration-200 hover:opacity-70", RESULT[h.result].tile)}>
                      <span className="sr-only">Round {h.round}: {RESULT[h.result].label}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-rule pt-3 text-xs text-muted">
            {used.map((k) => (
              <li key={k} className="flex items-center gap-1.5"><span className={cx("size-2 rounded-xs", RESULT[k].tile)} aria-hidden />{RESULT[k].label}</li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

"use client";
// Job detail: breadcrumb bar, title and summary, pill tabs (Overview, Rounds, Contributors, Model, Spec via ?tab), and the Properties rail, which gains the owner actions (refund, follow-up job) when the job is yours.
import { RoundPlates } from "@/components/mosaic/isoScenes";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Box, ChevronRight, Download, FileCode2, Layers, Link2, MoreHorizontal, Users } from "lucide-react";
import { api, isDemo } from "@/lib/api/client";
import { ownsJob, setWallet, useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/tx";
import { formatToken } from "@/lib/money";
import { TxButton, TxStatus } from "@/components/flow";
import { f64 } from "@/lib/api/metric";
import { Problem, errorKind } from "@/components/problem";
import { useConfig, useJob, useJobState, useNodes, useRound, useRounds, useSpec, useVerdicts } from "@/lib/api/hooks";
import type { Job, Round, RoundSummary } from "@/lib/api/types";
import { LossChart, toPoints } from "@/components/charts";
import { RoundTrack, WorkloadArt } from "@/components/pixel";
import { CoverBand } from "@/components/mosaic/CoverBand";
import { coverFor } from "@/components/mosaic/figures";
import type { RoundStatus, Trust } from "@/lib/api/types";
import {
  AddressChip, Banner, Button, ButtonLink, Card, Crumbs, EmptyState, HashChip, IconButton, JobStatusPill, Money, Null, PageHeader, PhaseStrip, PillTabs, Progress, PropRow, PropsRail, RoundStatusPill,
  SectionTitle, Segmented, Skeleton, SourceBadge, TD, TH, THead, TrustLabel, cx, duration, short,
} from "@/components/primitives";

const TABS = ["overview", "rounds", "contributors", "model", "spec"] as const;
type Tab = (typeof TABS)[number];

/** How far the live round is, for the cover to develop: each stage that finishes reveals more of the poster. */
const STAGE_DONE: Record<RoundStatus, number> = { open: 0.1, committing: 0.3, revealing: 0.5, verifying: 0.75, finalized: 1, fallback: 1, reverted: 1, voided: 1 };
const TRUST_WORD: Record<Trust, string> = { chain: "on chain", "hash-checked": "hash checked", untrusted: "coordinator only" };

export function JobPage({ id, tab: rawTab }: { id: number; tab?: string }) {
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "overview";
  const job = useJob(id);
  const rounds = useRounds(id);

  if (job.isPending) return <JobSkeleton />;
  if (job.isError) {
    return (
      <div className="pt-16">
        <Problem
          error={job.error}
          retry={() => job.refetch()}
          action={errorKind(job.error) === "not_found" ? <Link href="/jobs" className="text-sm text-ink underline underline-offset-4">Back to jobs</Link> : undefined}
          overrides={{ not_found: { title: `Job #${id} isn't here`, body: "Either it was never created, or the coordinator hasn't indexed it yet. Jobs appear within a block of their JobCreated event." } }}
        />
      </div>
    );
  }
  const j = job.data.data;
  const currentStatus = (rounds.data?.data ?? []).find((r) => r.round === j.currentRound)?.status ?? null;
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={<Crumbs items={[{ href: "/jobs", label: "jobs" }, { label: `${j.workload} #${j.id}` }]} />}>
        <IconButton icon={Link2} label="Copy link" onClick={() => navigator.clipboard?.writeText(location.href)} />
      </PageHeader>
      <div className="grid flex-1 xl:grid-detail">
        <div className="flex min-w-0 flex-col gap-6 px-4 py-6 md:px-6">
          <header className="flex flex-col gap-5">
            <CoverBand
              cover={coverFor(j.id)}
              live={j.status === "running"}
              develop={j.status === "running" ? STAGE_DONE[currentStatus ?? "open"] : undefined}
              label={`${j.workload} job ${j.id} poster`}
              title={<>{j.workload} <span className="font-mono text-subtle">#{j.id}</span></>}
              meta={[`job ${String(j.id).padStart(2, "0")}`, j.currentRound === null ? "not started" : `round ${String(j.currentRound).padStart(2, "0")} of ${j.rounds}`, j.status === "running" && currentStatus ? `${currentStatus}` : TRUST_WORD[j.trust]]}
            />
            <p className="max-w-3xl text-sm text-muted">{summary(j)}</p>
            <div className="flex flex-col gap-2">
              <RoundTrack size="lg" total={j.rounds} rounds={rounds.data?.data ?? []} hrefFor={(r) => `/jobs/${j.id}/rounds/${r}`} />
              <p className="flex justify-between font-mono text-xs uppercase tracking-wide text-subtle">
                <span>round 01</span>
                <span>{j.currentRound === null ? "not started" : `${String(j.currentRound).padStart(2, "0")} of ${j.rounds}`}</span>
                <span>round {String(j.rounds).padStart(2, "0")}</span>
              </p>
            </div>
          </header>
          <StatusBanner job={j} />
          <PillTabs
            value={tab}
            hrefFor={(t) => (t === "overview" ? `/jobs/${id}` : `/jobs/${id}?tab=${t}`)}
            items={[
              { key: "overview", label: "Overview" },
              { key: "rounds", label: "Rounds", count: rounds.data?.data.length },
              { key: "contributors", label: "Contributors" },
              { key: "model", label: "Model" },
              { key: "spec", label: "Spec" },
            ]}
          />
          {tab === "overview" && <Overview job={j} />}
          {tab === "rounds" && <RoundsTab job={j} />}
          {tab === "contributors" && <Contributors job={j} />}
          {tab === "model" && <ModelTab job={j} />}
          {tab === "spec" && <SpecTab job={j} />}
        </div>
        <Properties job={j} />
      </div>
    </div>
  );
}

/** What only the job's owner can do. There is no top-up in JobMarket, so more training is a follow-up job. */
function OwnerActions({ job }: { job: Job }) {
  const refund = useTx({ revertAs: "WrongState" });
  const [refunded, setRefunded] = useState(false);
  const opened = job.currentRound ?? 0; // rails-allow: rounds opened, zero before the first
  const ended = job.status === "completed" || job.status === "abandoned";
  const refundable = ended ? Math.min(job.remaining, ((job.rounds - opened) * job.budget) / job.rounds) : 0;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-line bg-brand-soft p-3">
      <p className="text-xs font-medium text-ink">You posted this job</p>
      {ended && refundable > 0 && !refunded && (
        <>
          <TxButton tx={refund} label={`Withdraw ${formatToken(refundable)} TOD refund`} onRun={() => refund.run(() => { setRefunded(true); setWallet((x) => ({ usdc: x.usdc + refundable })); })} />
          <TxStatus tx={refund} />
        </>
      )}
      {refunded && <p className="text-sm text-ok">Refund sent to your wallet.</p>}
      {ended && refundable <= 0 && <p className="text-sm text-muted">Every round opened, so there is nothing to refund.</p>}
      {!ended && <p className="text-sm text-muted">Rounds that never open are refundable once the job ends. There is no cancel.</p>}
      <Link href="/jobs/new" className="inline-flex min-h-6 items-center self-start text-sm text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink hover:decoration-ink">Post a follow-up job</Link>
    </div>
  );
}

function summary(j: Job) {
  const base = `Trains ${j.workload} over ${j.rounds} rounds. Each round is replayed by two verifiers before it pays.`;
  if (j.status === "open") return `${base} Waiting for enough idle staked nodes to open round 1.`;
  if (j.status === "completed") return `${base} All ${j.rounds} rounds are done.`;
  if (j.status === "abandoned") return `${base} The requester abandoned it after round ${j.currentRound}.`;
  return `${base} Round ${j.currentRound} is in progress.`;
}

function Properties({ job }: { job: Job }) {
  const cfg = useConfig();
  const w = useWallet();
  const mine = ownsJob(w.address, isDemo, job);
  const live = job.status === "running" && job.currentRound !== null;
  return (
    <PropsRail>
        <PropRow label="Status"><JobStatusPill status={job.status} /></PropRow>
        <PropRow label="Source"><TrustLabel trust={job.trust} /></PropRow>
        <PropRow label="Workload"><span className="font-mono text-xs">{job.workload}</span></PropRow>
        <PropRow label="Requester"><AddressChip value={job.requester} you={mine} /></PropRow>
        <PropRow label="Budget"><Money units={job.budget} /></PropRow>
        <PropRow label="Spent"><Money units={job.budget - job.remaining} /></PropRow>
        <PropRow label="Remaining"><Money units={job.remaining} /></PropRow>
        <PropRow label="Stake per node"><Money units={job.stakePerNode} /></PropRow>
        <PropRow label="Rounds"><span className="font-mono tabular">{job.currentRound === null ? `0 of ${job.rounds}, not started` : `${job.currentRound} / ${job.rounds}`}</span></PropRow>
        <PropRow label="Verifiers">{cfg.data ? <span className="font-mono">{cfg.data.data.threshold} of {cfg.data.data.verifiers.length} to pay</span> : <Null>Not loaded</Null>}</PropRow>
        <PropRow label="Spec hash"><HashChip value={job.modelSpecHash} label="spec hash" /></PropRow>
        <BudgetMeter job={job} />
        <div className="flex flex-col gap-2 pt-4">
          {live && <ButtonLink href={`/jobs/${job.id}/rounds/${job.currentRound}`} variant="primary">Watch round {job.currentRound}</ButtonLink>}
          {job.status === "completed" && <ButtonLink href={`/jobs/${job.id}?tab=model`} variant={live ? "secondary" : "primary"}>Download weights</ButtonLink>}
        </div>
        {mine && <OwnerActions job={job} />}
    </PropsRail>
  );
}

function BudgetMeter({ job }: { job: Job }) {
  const spent = job.budget - job.remaining;
  const pct = job.budget ? spent / job.budget : 0;
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">Budget used</span>
        <span className="font-mono text-xs text-ink tabular">{(pct * 100).toFixed(1)}%</span>
      </div>
      <Progress kind="meter" value={pct} tone={job.status === "abandoned" ? "warn" : "ink"} label="Budget used" />
    </div>
  );
}

function StatusBanner({ job }: { job: Job }) {
  const cur = job.currentRound;
  const v = useVerdicts(job.id, cur);
  const disagree = cur !== null && v.data && new Set(v.data.data.filter((x) => x.verdict === "pass" || x.verdict === "fail").map((x) => x.verdict)).size > 1;
  if (job.status === "abandoned") return <Banner tone="warn" title={cur === null ? "Abandoned before round 1" : `Abandoned after round ${cur}`}>Finalized rounds stay paid. The unspent <Money units={job.remaining} /> is refundable to the requester.</Banner>;
  if (job.status === "open") return <Banner tone="pending" title="Waiting for nodes">Round 1 opens once enough staked nodes with this workload are idle. Nothing has been spent.</Banner>;
  if (disagree) {
    return (
      <Banner tone="danger" title={`Verifiers disagree on round ${cur}`} action={<Link href={`/jobs/${job.id}/rounds/${cur}`} className="text-sm text-ink underline underline-offset-4">Open receipt</Link>}>
        One verifier passed the round and one reported a failure. Payment waits for the threshold or the fallback window.
      </Banner>
    );
  }
  return null;
}

type Range = "all" | "last10";
function Overview({ job }: { job: Job }) {
  const st = useJobState(job.id);
  const [range, setRange] = useState<Range>("all");
  const all = st.data ? toPoints(st.data.data.rounds) : [];
  const pts = range === "last10" ? all.slice(-10) : all;
  const last = [...all].reverse().find((p) => p.y !== null);
  const best = all.reduce<number | null>((m, p) => (p.y === null ? m : m === null ? p.y : Math.min(m, p.y)), null);
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <dl className="flex flex-wrap gap-10">
            <Metric label="Latest loss" value={last ? last.y!.toFixed(4) : null} />
            <Metric label="Best loss" value={best === null ? null : best.toFixed(4)} />
            <Metric label="Rounds done" value={job.currentRound === null ? `0/${job.rounds}` : `${job.currentRound}/${job.rounds}`} />
          </dl>
          <div className="rounded-lg border border-rule p-0.5">
            <Segmented items={[{ key: "last10", label: "Last 10" }, { key: "all", label: "All" }]} value={range} onChange={setRange} label="Chart range" />
          </div>
        </div>
        {st.isPending ? <Skeleton className="h-56 w-full" /> : <LossChart points={pts} total={job.rounds} from={range === "last10" && pts.length ? pts[0].x : 1} height={240} />}
      </Card>
      <div className="grid gap-6 2xl:grid-cols-2">
        <CurrentRound job={job} />
        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle title="Recent rounds" sub="newest first">
            <Link href={`/jobs/${job.id}?tab=rounds`} className="text-sm text-muted hover:text-ink">all rounds</Link>
          </SectionTitle>
          <RoundsTable job={job} limit={5} compact />
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col-reverse gap-1">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="font-mono text-xl text-ink tabular">{value ?? <span className="text-subtle">–</span>}</dd>
    </div>
  );
}

function CurrentRound({ job }: { job: Job }) {
  const r = job.currentRound;
  const myOp = useWallet().node?.operator?.toLowerCase() ?? null;
  const round = useRound(job.id, r);
  const ver = useVerdicts(job.id, r);
  const nodes = useNodes();
  const online = new Map(nodes.data?.data.map((n) => [n.op, n]) ?? []);
  const rd = round.data?.data;
  return (
    <Card className="flex flex-col gap-5 p-5">
      <SectionTitle title={r === null ? "Current round" : `Round ${r}`} sub={rd ? `${rd.committed.length}/${rd.roster.length} committed · ${rd.revealed.length}/${rd.roster.length} revealed` : "no roster yet"}>
        {rd && <RoundStatusPill status={rd.status} />}
        {r !== null && <Link href={`/jobs/${job.id}/rounds/${r}`} className="text-sm text-muted hover:text-ink">receipt</Link>}
      </SectionTitle>
      {rd ? (
        <div className="h-80 overflow-hidden border border-rule bg-surface">
          <RoundPlates round={rd} verdicts={ver.data?.data ?? []} />
        </div>
      ) : (
        <PhaseStrip status={null} />
      )}
      {r === null ? (
        <EmptyState icon={Users} title="No roster yet">The roster is drawn when round 1 opens.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Roster for round {r}</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th className="pb-2 font-medium">Shard</th><th className="pb-2 font-medium">Node</th><th className="pb-2 font-medium">Commit</th><th className="pb-2 font-medium">Reveal</th>
            </tr>
          </thead>
          <tbody>
            {round.isPending
              ? Array.from({ length: 4 }, (_, i) => <tr key={i}><td colSpan={4} className="py-2"><Skeleton className="h-6 w-full" /></td></tr>)
              : rd?.roster.map((s) => {
                  const n = online.get(s.op);
                  return (
                    <tr key={s.op} className="border-t border-rule">
                      <td className="py-2.5 font-mono text-subtle">{s.shard}</td>
                      <td className="py-2.5">
                        <span className="flex items-center gap-2">
                          <span className={cx("size-1.5 rounded-full", n?.online ? "bg-ok" : "bg-subtle")} aria-label={n?.online ? "Online" : "Offline"} />
                          <AddressChip value={s.op} href={`/nodes/${s.op}`} you={s.op.toLowerCase() === myOp} />
                        </span>
                      </td>
                      <td className="py-2.5"><Step on={rd.committed.includes(s.op)} waiting={rd.status === "committing"} /></td>
                      <td className="py-2.5"><Step on={rd.revealed.includes(s.op)} waiting={rd.status === "committing" || rd.status === "revealing"} /></td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Step({ on, waiting }: { on: boolean; waiting: boolean }) {
  if (on) return <span className="text-ok">Done</span>;
  if (waiting) return <span className="text-pending">Waiting</span>;
  return <span className="font-medium text-danger">Missed</span>;
}

function RoundsTab({ job }: { job: Job }) {
  return (
    <div className="-mx-4 overflow-x-auto border-y border-rule md:-mx-6">
      <RoundsTable job={job} />
    </div>
  );
}

function CTh({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("pb-2 text-left text-xs font-medium uppercase tracking-wider text-muted", className)}>{children}</th>;
}
function CTd({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("py-2.5", className)}>{children}</td>;
}

function RoundsTable({ job, limit, compact }: { job: Job; limit?: number; compact?: boolean }) {
  const rounds = useRounds(job.id);
  const st = useJobState(job.id);
  const metric = new Map(st.data?.data.rounds.map((r) => [r.round, r]) ?? []);
  const rows: RoundSummary[] = (rounds.data?.data ?? []).slice(0, limit);
  if (!rounds.isPending && rows.length === 0) return <EmptyState icon={Layers} title="No rounds yet">Rounds are listed here as they open, newest first.</EmptyState>;
  const Th = compact ? CTh : TH;
  const Td = compact ? CTd : TD;
  const head = (
    <>
      <Th>Round</Th><Th>Status</Th><Th className="text-right">Loss</Th><Th className="text-right">Took</Th>{!compact && <Th>Aggregate</Th>}
    </>
  );
  return (
    <table className="w-full text-sm">
      {compact ? <thead><tr>{head}</tr></thead> : <THead>{head}</THead>}
      <tbody>
        {rounds.isPending
          ? Array.from({ length: 5 }, (_, i) => <tr key={i}><td colSpan={5} className="py-2"><Skeleton className="h-6 w-full" /></td></tr>)
          : rows.map((r) => {
              const m = metric.get(r.round);
              return (
                <tr key={r.round} className={cx("relative transition-colors hover:bg-hover", compact ? "border-t border-rule" : "border-b border-rule")}>
                  <Td><Link href={`/jobs/${job.id}/rounds/${r.round}`} className="font-mono text-ink after:absolute after:inset-0" aria-label={`Round ${r.round} receipt`}>R{r.round}</Link></Td>
                  <Td><RoundStatusPill status={r.status} /></Td>
                  <Td className="text-right font-mono tabular">{f64(m?.metric) !== null ? f64(m?.metric)!.toFixed(4) : <Null>-</Null>}</Td>
                  <Td className="text-right font-mono tabular text-muted">{duration(m?.seconds ?? null) ?? <Null>–</Null>}</Td>
                  {!compact && <Td className="font-mono text-xs text-muted">{r.aggregateHash ? `${r.aggregateHash.slice(0, 14)}…` : <Null>Not aggregated</Null>}</Td>}
                </tr>
              );
            })}
      </tbody>
    </table>
  );
}

function Contributors({ job }: { job: Job }) {
  const rounds = useRounds(job.id);
  const myOp = useWallet().node?.operator?.toLowerCase() ?? null;
  const nums = rounds.data?.data.map((r) => r.round) ?? [];
  const details = useQueries({ queries: nums.map((r) => ({ queryKey: ["job", job.id, "round", r], queryFn: () => api.round(job.id, r) })) });
  const loading = rounds.isPending || details.some((d) => d.isPending);
  const rows = useMemo(() => {
    const m = new Map<string, { op: string; earned: number; rounds: number }>();
    for (const d of details) {
      const rd: Round | undefined = d.data?.data;
      rd?.payouts.forEach((p) => {
        const e = m.get(p.op) ?? { op: p.op, earned: 0, rounds: 0 };
        e.earned += p.amount;
        e.rounds += 1;
        m.set(p.op, e);
      });
    }
    return [...m.values()].sort((a, b) => b.earned - a.earned);
  }, [details]);
  const total = rows.reduce((s, r) => s + r.earned, 0);
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) return <EmptyState icon={Users} title="Nobody has been paid yet">Contributors appear once the first round finalizes and pays out.</EmptyState>;
  return (
    <div className="-mx-4 overflow-x-auto border-y border-rule md:-mx-6">
      <table className="w-full text-sm">
        <THead><TH>Node</TH><TH className="text-right">Paid rounds</TH><TH className="text-right">Earned</TH><TH>Share</TH></THead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.op} className="border-b border-rule">
              <TD><AddressChip value={r.op} href={`/nodes/${r.op}`} you={r.op.toLowerCase() === myOp} /></TD>
              <TD className="text-right font-mono tabular">{r.rounds}</TD>
              <TD className="text-right"><Money units={r.earned} /></TD>
              <TD>
                <span className="flex items-center gap-3">
                  <span className="h-1 w-32 rounded-full bg-active"><span className="block h-1 rounded-full bg-ink" style={{ width: `${(r.earned / total) * 100}%` }} /></span>
                  <span className="font-mono text-xs tabular text-muted">{((r.earned / total) * 100).toFixed(1)}%</span>
                </span>
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DL = { kind: "idle" } | { kind: "fetching" } | { kind: "hashing" } | { kind: "ok" } | { kind: "mismatch"; got: string; want: string };
function ModelTab({ job }: { job: Job }) {
  const rounds = useRounds(job.id);
  const lastFinal = rounds.data?.data.find((r) => r.aggregateHash);
  const [dl, setDl] = useState<DL>({ kind: "idle" });
  if (rounds.isPending) return <Skeleton className="h-32 w-full" />;
  if (!lastFinal) return <EmptyState icon={Box} title="No model yet">The first weights are published when round 1 finalizes.</EmptyState>;
  const want = lastFinal.aggregateHash!;
  const run = async () => {
    // Demo: the fixture blob store has no bytes, so this walks the same states the real hash check will.
    setDl({ kind: "fetching" });
    await new Promise((r) => setTimeout(r, 700));
    setDl({ kind: "hashing" });
    await new Promise((r) => setTimeout(r, 500));
    setDl(job.trust === "untrusted" ? { kind: "mismatch", got: want.replace(/.{6}$/, "c0ffee"), want } : { kind: "ok" });
  };
  return (
    <Card className="flex max-w-2xl flex-col gap-5 p-6">
      <SectionTitle title={`Weights after round ${lastFinal.round}`} sub="checked against the aggregate hash on chain before saving" />
      <dl className="flex flex-col">
        <PropRow label="Expected hash"><HashChip value={want} label="aggregate hash" /></PropRow>
        <PropRow label="Format"><span className="font-mono text-sm">safetensors</span></PropRow>
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={Download} onClick={run} disabled={dl.kind === "fetching" || dl.kind === "hashing"}>
          {dl.kind === "fetching" ? "Downloading…" : dl.kind === "hashing" ? "Checking hash…" : "Download weights"}
        </Button>
        {dl.kind === "ok" && <span className="text-sm text-ok">Hash matches. Saved model-r{lastFinal.round}.safetensors</span>}
      </div>
      {dl.kind === "mismatch" && (
        <Banner tone="danger" title="Hash mismatch, file discarded">
          The coordinator served bytes hashing to {dl.got.slice(0, 12)}…, but the chain says {dl.want.slice(0, 12)}…. Nothing was saved.
        </Banner>
      )}
    </Card>
  );
}

function SpecTab({ job }: { job: Job }) {
  const spec = useSpec(job.id, job.modelSpecHash);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle title="Job spec" sub="the exact config every node trains with">
        <HashChip value={job.modelSpecHash} label="spec hash" />
      </SectionTitle>
      {spec.isPending ? <Skeleton className="h-40 w-full" /> : spec.isError ? (
        <Problem error={spec.error} retry={() => spec.refetch()} overrides={{ upstream: { title: "The spec isn't readable", body: "The coordinator's copy isn't valid JSON. The spec hash above is still on chain." }, not_found: { title: "The coordinator has no spec for this job", body: "The spec hash above is still on chain." } }} />
      ) : (
        <>
          {!spec.data.data.matches && (
            <Banner tone="danger" title="This spec doesn't match the chain">
              The coordinator served a spec hashing to {short(spec.data.data.keccak, 10, 6)}, but the job on chain commits to {short(job.modelSpecHash, 10, 6)}. Nodes refuse a spec like this, and so should you.
            </Banner>
          )}
          <pre className="overflow-x-auto rounded-lg border border-rule bg-sunken p-4 font-mono text-xs leading-5 text-ink">{JSON.stringify(spec.data.data.spec, null, 2)}</pre>
        </>
      )}
    </Card>
  );
}

function JobSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6" aria-busy="true" aria-label="Loading job">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-5 w-full max-w-2xl" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

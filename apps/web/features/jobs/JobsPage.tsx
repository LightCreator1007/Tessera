"use client";
// Jobs list in the Neatlogs traces layout: header row with search and the one primary action, the Yours | All scope, a filter strip, the round mosaic, a lean table and a sticky pager. "Yours" is a lens on the same list (REVAMP-3), not a second page.
import { OfflineBanner } from "@/components/mosaic/OfflineBanner";
import { ConnectGate } from "@/components/mosaic/ConnectGate";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Filter, Layers, Plus, RefreshCw, Search, Wallet, X } from "lucide-react";
import { useJobState, useJobs, useNodes, useRounds } from "@/lib/api/hooks";
import { api, isDemo } from "@/lib/api/client";
import { ownsJob, useWallet, type PostedJob } from "@/lib/wallet";
import { openConnect } from "@/components/connect";
import { RoundTrack, WorkloadArt } from "@/components/pixel";
import { PosterCard } from "@/components/mosaic/PosterCard";
import { coverFor } from "@/components/mosaic/figures";
import { formatToken } from "@/lib/money";
import type { Job, JobStatus, RoundSummary } from "@/lib/api/types";
import { Sparkline, toPoints } from "@/components/charts";
import {
  Banner, Button, ButtonLink, ChipSelect, DocsLink, EmptyState, Eyebrow, IconButton, JobStatusPill, Money, NameCell, PageHeader, Pager, Pill, PillTabs, ROW, Segmented, Skeleton, TD, TH, THead, TrustLabel, cx, short,
} from "@/components/primitives";

type Seg = "all" | JobStatus;
const STATUS: { key: Seg; label: string }[] = [
  { key: "all", label: "Any status" },
  { key: "running", label: "Training" },
  { key: "open", label: "Waiting" },
  { key: "completed", label: "Finished" },
  { key: "abandoned", label: "Abandoned" },
];
export type Scope = "yours" | "all";

export function JobsPage({ scope: asked }: { scope?: Scope }) {
  const jobs = useJobs();
  const w = useWallet();
  const [seg, setSeg] = useState<Seg>("all");
  const [wl, setWl] = useState("all");
  const [q, setQ] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "table">("cards");
  const all = useMemo(() => jobs.data?.data ?? [], [jobs.data]);
  const isMine = (j: Job) => ownsJob(w.address, isDemo, j);
  const owned = all.filter(isMine);
  const posted = w.connected ? w.postedJobs : [];
  const yoursCount = owned.length + posted.length;
  const scope: Scope = asked ?? (w.connected && yoursCount > 0 ? "yours" : "all");
  const list = scope === "yours" ? owned : all;
  const workloads = useMemo(() => [{ key: "all", label: "Any workload" }, ...[...new Set(list.map((j) => j.workload))].map((k) => ({ key: k, label: k, count: list.filter((j) => j.workload === k).length }))], [list]);
  const statusOpts = STATUS.map((s) => ({ ...s, count: s.key === "all" ? list.length : list.filter((j) => j.status === s.key).length }));
  const shown = list.filter(
    (j) =>
      (seg === "all" || j.status === seg) &&
      (wl === "all" || j.workload === wl) &&
      (!q || `${j.workload} ${j.id} ${j.requester}`.toLowerCase().includes(q.toLowerCase())),
  );
  const filtered = seg !== "all" || wl !== "all" || !!q;
  const showPosted = (seg === "all" || seg === "open") && !q && wl === "all";
  const lockedOut = scope === "yours" && !w.connected;
  const rows = shown.length + (showPosted && !lockedOut ? posted.length : 0);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader icon={Layers} title="jobs" heading="Jobs" meta={<DocsLink href="/docs/train">How training works</DocsLink>}>
        {q === null ? (
          <IconButton icon={Search} label="Search jobs" onClick={() => setQ("")} />
        ) : (
          <label className="flex h-8 w-56 items-center gap-2 rounded-md border border-rule px-2 focus-within:border-rule-strong">
            <Search className="size-4 text-muted" strokeWidth={1.5} aria-hidden />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ(null)} placeholder="Workload, id or address" aria-label="Search jobs" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle" />
            <button type="button" onClick={() => setQ(null)} aria-label="Close search" className="text-muted hover:text-ink"><X className="size-3.5" /></button>
          </label>
        )}
        <Segmented items={[{ key: "cards", label: "Cards" }, { key: "table", label: "Table" }]} value={view} onChange={setView} label="View" />
        <IconButton icon={RefreshCw} label="Refresh" onClick={() => jobs.refetch()} className={cx(jobs.isFetching && "[&_svg]:animate-spin")} />
        <ButtonLink href="/jobs/new" variant="primary" icon={Plus} className="md:hidden">New job</ButtonLink>
      </PageHeader>

      <div className="px-4 pt-3 md:px-6">
        <PillTabs value={scope} hrefFor={(k) => `/jobs?scope=${k}`} items={[{ key: "yours", label: "Yours", count: w.connected ? yoursCount : undefined }, { key: "all", label: "All", count: jobs.isPending ? undefined : all.length }]} />
      </div>

      <div className="flex flex-wrap items-center gap-1 px-4 py-2.5 md:px-6">
        <Filter className="mr-1 size-3.5 text-muted" strokeWidth={1.5} aria-hidden />
        <ChipSelect label="Status" value={seg} options={statusOpts} onChange={setSeg} />
        <ChipSelect label="Workload" value={wl} options={workloads} onChange={setWl} />
        {filtered && <button type="button" onClick={() => { setSeg("all"); setWl("all"); setQ(null); }} className="ml-1 text-xs text-muted underline-offset-4 hover:text-ink hover:underline">Clear</button>}
      </div>

      {!lockedOut && (jobs.isPending || list.length > 0) && <RoundMosaic jobs={list} loading={jobs.isPending} />}

      {jobs.isError && (
        <div className="px-4 pb-3 md:px-6">
          <OfflineBanner onRetry={() => jobs.refetch()}>Job history on chain is still readable.</OfflineBanner>
        </div>
      )}

      {view === "cards" && !lockedOut && (
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-2 md:px-6 xl:grid-cols-3">
          {showPosted && posted.map((p) => <PosterCard key={`p${p.id}`} href="/jobs?scope=yours" n={`#${String(p.id).padStart(2, "0")}`} title={p.workload} note={`waiting for nodes · ${p.rounds} rounds · ${formatToken(p.budget)} usdc locked`} tag={<Pill tone="brand">you</Pill>} />)}
          {jobs.isPending
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-72" />)
            : shown.map((j) => <JobCard key={j.id} job={j} mine={isMine(j)} />)}
        </div>
      )}

      {/* In cards view this block only carries the empty state, which has to show in both views. */}
      <div className={cx("flex-1 overflow-x-auto", view === "cards" && !lockedOut && (jobs.isPending || rows > 0) && "hidden")}>
        <table className={cx("w-full min-w-table text-sm", (lockedOut || (view === "cards" && rows === 0)) && "hidden")}>
          <THead>
            <TH>Job</TH>
            <TH>Status</TH>
            <TH>Rounds</TH>
            <TH>Loss</TH>
            <TH>Source</TH>
            <TH className="text-right">Escrow left</TH>
          </THead>
          <tbody>
            {!lockedOut && showPosted && posted.map((p) => <PostedRow key={`p${p.id}`} p={p} />)}
            {lockedOut ? null : jobs.isPending
              ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="border-t border-rule-row"><TD><Skeleton className="h-8 w-48" /></TD><TD><Skeleton className="h-6 w-20" /></TD><TD><Skeleton className="h-3 w-40" /></TD><TD><Skeleton className="h-6 w-28" /></TD><TD><Skeleton className="h-4 w-20" /></TD><TD><Skeleton className="ml-auto h-4 w-24" /></TD></tr>
                ))
              : shown.map((j) => <JobRow key={j.id} job={j} mine={isMine(j)} />)}
          </tbody>
        </table>
        {lockedOut ? (
          <ConnectGate title="Connect to see your jobs" figure="tiger">Your jobs are the ones this wallet paid for. Nothing is private; it is a filter on the same list.</ConnectGate>
        ) : !jobs.isPending && !jobs.isError && rows === 0 && (
          <EmptyState icon={Layers} poster={list.length === 0 ? "EMPTY" : undefined} title={scope === "yours" && list.length === 0 ? "Train your first model" : list.length === 0 ? "No jobs yet" : "No jobs match these filters"} action={list.length === 0 ? <ButtonLink href="/jobs/new" variant="primary" icon={Plus}>New job</ButtonLink> : undefined}>
            {scope === "yours" && list.length === 0 ? "Lock a budget, pick a workload, and idle laptops train it. If your node has earned anything, that pays first." : list.length === 0 ? "Once someone locks a budget, the job shows up here within a block." : "Try another status or workload."}
          </EmptyState>
        )}
      </div>
      <Pager shown={rows} total={rows} />
    </div>
  );
}

const OUTCOME: { key: string; label: string; cls: string }[] = [
  { key: "finalized", label: "paid", cls: "bg-ok" },
  { key: "live", label: "live", cls: "bg-brand" },
  { key: "voided", label: "voided or fallback", cls: "bg-warn" },
  { key: "reverted", label: "reverted", cls: "bg-danger" },
];
const TILE: Record<string, string> = { finalized: "bg-ok", fallback: "bg-warn", voided: "bg-warn", reverted: "bg-danger" };

/** Every round of every job as one tile, in job order: the Neatlogs histogram strip, drawn as our mosaic. */
function RoundMosaic({ jobs, loading }: { jobs: Job[]; loading: boolean }) {
  const qs = useQueries({ queries: jobs.map((j) => ({ queryKey: ["job", j.id, "rounds"], queryFn: () => api.rounds(j.id), refetchInterval: 5_000 })) });
  const all = jobs.flatMap((j, i) => {
    const got: RoundSummary[] = qs[i]?.data?.data ?? [];
    return Array.from({ length: j.rounds }, (_, k) => ({ job: j.id, round: k + 1, status: got.find((r) => r.round === k + 1)?.status ?? null }));
  });
  const settled = all.filter((r) => r.status && TILE[r.status]).length;
  const live = all.filter((r) => r.status && !TILE[r.status]).length;
  return (
    <section aria-label="Rounds across all jobs" className="mx-4 mb-3 rounded-xl border border-rule p-4 md:mx-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>{loading ? "loading rounds" : `${settled} rounds settled · ${live} live · ${all.length - settled - live} to go`}</Eyebrow>
        <ul className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {OUTCOME.map((o) => <li key={o.key} className="flex items-center gap-1.5"><span className={cx("size-2 rounded-xs", o.cls)} aria-hidden />{o.label}</li>)}
        </ul>
      </div>
      <ol className="flex flex-wrap gap-1" aria-hidden>
        {(loading ? Array.from({ length: 48 }, () => null) : all).map((r, i) => (
          <li key={i} title={r ? `Job ${r.job}, round ${r.round}: ${r.status ?? "not started"}` : undefined}>
            {r && r.status ? (
              <Link href={`/jobs/${r.job}/rounds/${r.round}`} className={cx("block size-3.5 rounded-xs transition-opacity duration-200 hover:opacity-70", TILE[r.status] ?? "bg-brand tile-flicker")} />
            ) : (
              <span className="block size-3.5 rounded-xs bg-band" />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

const STATUS_WORD: Record<JobStatus, string> = { running: "training", open: "waiting", completed: "finished", abandoned: "abandoned", invalid: "invalid" };

/** A job as a poster card: its figure (stable per job), id, workload and one line of where it stands. */
function JobCard({ job, mine }: { job: Job; mine: boolean }) {
  const done = job.currentRound === null ? "not started" : `round ${job.currentRound} of ${job.rounds}`;
  const left = formatToken(job.remaining);
  return (
    <PosterCard
      href={`/jobs/${job.id}`}
      n={`#${String(job.id).padStart(2, "0")}`}
      title={job.workload}
      note={`${STATUS_WORD[job.status]} · ${done} · ${left === null ? "escrow not reported" : `${left} usdc left`}`}
      cover={coverFor(job.id)}
      live={job.status === "running"}
      tag={mine ? <Pill tone="brand">you</Pill> : <JobStatusPill status={job.status} />}
    />
  );
}

function JobRow({ job, mine }: { job: Job; mine: boolean }) {
  const st = useJobState(job.id);
  const rounds = useRounds(job.id);
  const done = job.currentRound ?? 0; // rails-allow: a round count, and a job that has not started has done 0 rounds
  return (
    <tr className={ROW}>
      <TD>
        <Link href={`/jobs/${job.id}`} className="block after:absolute after:inset-0">
          <NameCell
            lead={<WorkloadArt workload={job.workload} />}
            title={<>{job.workload} <span className="font-mono text-xs text-subtle">#{job.id}</span> {mine && <Pill tone="brand">you</Pill>}</>}
            sub={`${job.rounds} rounds · by ${short(job.requester)}`}
          />
        </Link>
      </TD>
      <TD><JobStatusPill status={job.status} /></TD>
      <TD>
        <span className="flex items-center gap-3">
          <RoundTrack total={job.rounds} rounds={rounds.data?.data ?? []} />
          <span className="whitespace-nowrap font-mono text-xs tabular text-muted">{job.currentRound === null ? "not started" : `${done}/${job.rounds}`}</span>
        </span>
      </TD>
      <TD className={job.status === "running" ? "text-trend-good" : "text-muted"}>{st.data ? <Sparkline points={toPoints(st.data.data.rounds)} width={96} height={22} /> : <Skeleton className="h-5 w-24" />}</TD>
      <TD><TrustLabel trust={job.trust} /></TD>
      <TD className="whitespace-nowrap text-right">
        <Money units={job.remaining} className="text-ink" />
        <span className="block text-xs text-subtle">of <Money units={job.budget} unit={false} /></span>
      </TD>
    </tr>
  );
}

/** A job posted from this browser that the coordinator has not indexed yet (demo), shown in the same columns. */
function PostedRow({ p }: { p: PostedJob }) {
  const nodes = useNodes();
  const eligible = (nodes.data?.data ?? []).filter((n) => n.online && n.idle).length;
  return (
    <tr className="border-t border-rule-row">
      <TD>
        <NameCell
          lead={<WorkloadArt workload={p.workload} />}
          title={<>{p.workload} <span className="font-mono text-xs text-subtle">#{p.id}</span> <Pill tone="brand">you</Pill></>}
          sub={`${p.rounds} rounds · ${p.dataset}`}
        />
      </TD>
      <TD><JobStatusPill status="open" /></TD>
      <TD className="text-muted">{eligible >= p.minQuorum ? "first round opening" : `waiting for nodes: ${eligible} of ${p.minQuorum} free`}</TD>
      <TD><span className="text-xs text-subtle">no rounds yet</span></TD>
      <TD><TrustLabel trust="untrusted" /></TD>
      <TD className="whitespace-nowrap text-right">
        <Money units={p.budget} className="text-ink" />
        {p.fromEarnings ? <span className="block text-xs text-subtle"><Money units={p.fromEarnings} unit={false} /> from earnings</span> : null}
      </TD>
    </tr>
  );
}

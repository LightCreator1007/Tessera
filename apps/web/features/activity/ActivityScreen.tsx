"use client";
// Activity screen in the threads model: one card per job or node (plus your wallet), newest first. The header says where it stands now; the timeline under it lists what happened, newest first, with earlier events behind a disclosure. Data as props, so the playground and /activity render the same thing.
import { ConnectGate } from "@/components/mosaic/ConnectGate";
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { Bell, Check, ChevronDown, Cpu, Download, Layers, Lock, RefreshCw, Wallet, type LucideIcon } from "lucide-react";
import { Banner, Button, ButtonLink, EmptyState, HashChip, PageHeader, Pill, Segmented, Skeleton, cx, relTime, short } from "@/components/primitives";
import { formatToken, TOKEN_SYMBOL } from "@/lib/money";
import { FACETS, KIND, TONE, actsCsv, clock, foldRuns, unreadRows, type Act, type Attention, type Facet, type ThreadMeta } from "./model";

export type Scope = "yours" | "network";
export type Show = { detail: boolean; chips: boolean; amount: boolean; tx: boolean; block: boolean; time: "relative" | "absolute" | "both" };
export type Density = "compact" | "comfortable";
export type ProgressStyle = "segments" | "bar" | "none";

export type ActivityProps = {
  acts: Act[];
  attention: Attention[];
  threads: Record<string, ThreadMeta>;
  state: "ready" | "loading" | "error";
  signedIn: boolean;
  onConnect: () => void;
  onRetry: () => void;
  onReadAll: () => void;
  /** Omit to hide the Yours | Network switch (the real page has no network feed until an indexer exists). */
  scope?: Scope;
  onScope?: (s: Scope) => void;
  show: Show;
  density: Density;
  showAttention: boolean;
  showFacets: boolean;
  /** Events visible per thread before "Show earlier". */
  preview: number;
  progress: ProgressStyle;
  /** Fold runs of payouts on the same job into one row with the total. */
  groupRepeats: boolean;
  stagger: boolean;
  /** Id of an event that just landed; its thread gets the arrival treatment once. */
  arrived: string | null;
  now: number;
};

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

const THREAD_ICON: Record<string, LucideIcon> = { job: Layers, node: Cpu, wallet: Wallet };

export function ActivityScreen(p: ActivityProps) {
  const [facet, setFacet] = useState<Facet | "all">("all");
  const scope = p.scope ?? "yours";
  const scoped = useMemo(() => p.acts.filter((a) => (scope === "yours" ? a.mine : true)), [p.acts, scope]);
  const acts = useMemo(() => (facet === "all" ? scoped : scoped.filter((a) => KIND[a.kind].facet === facet)), [scoped, facet]);
  const unread = unreadRows(scoped);
  const counts = useMemo(() => {
    const c: Partial<Record<Facet | "all", number>> = { all: scoped.length };
    for (const a of scoped) c[KIND[a.kind].facet] = (c[KIND[a.kind].facet] ?? 0) + 1; // rails-allow: a count that has not started is zero
    return c;
  }, [scoped]);
  const threads = useMemo(() => {
    const m = new Map<string, Act[]>();
    for (const a of acts) m.set(a.thread, [...(m.get(a.thread) || []), a]);
    if (facet === "all" && scope === "yours") for (const [k, t] of Object.entries(p.threads)) if (t.always && !m.has(k)) m.set(k, []);
    // Threads with no events yet (a job waiting for nodes) sort after everything that has happened.
    const latest = (l: Act[]) => (l.length ? l[0].at : Number.NEGATIVE_INFINITY);
    return [...m.entries()].sort((x, y) => latest(y[1]) - latest(x[1])).map(([k, l]) => [k, p.groupRepeats ? foldRuns(l) : l] as const);
  }, [acts, p.threads, p.groupRepeats, facet, scope]);
  const lockedOut = scope === "yours" && !p.signedIn;
  const stale = p.state === "error" && p.acts.length > 0;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader icon={Bell} title="activity" heading="Activity" meta={!lockedOut && unread > 0 ? <span className="text-xs text-brand">{unread} new</span> : undefined}>
        {!lockedOut && unread > 0 && <Button variant="ghost" icon={Check} onClick={p.onReadAll}>Mark all read</Button>}
        {!lockedOut && <Button variant="ghost" icon={Download} onClick={() => download(actsCsv(acts), "tod-activity.csv")} disabled={acts.length === 0} title={acts.length === 0 ? "Nothing to export in this view" : "Export this view as CSV"}>CSV</Button>}
        {p.onScope && <Segmented label="Whose activity" items={[{ key: "yours", label: "Yours" }, { key: "network", label: "Network" }]} value={scope} onChange={p.onScope} />}
      </PageHeader>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-16 pt-6 md:px-6">
        {lockedOut ? (
          <ConnectGate title="Connect to see your activity" figure="owl" onConnect={p.onConnect}>
            Your jobs moving through training, pay from rounds, and anything your node needs, in one place.
          </ConnectGate>
        ) : (
          <>
            {p.state === "error" && (
              <Banner tone="danger" title={stale ? "Couldn't refresh. Showing what loaded last." : "Couldn't load activity."} action={<Button icon={RefreshCw} onClick={p.onRetry}>Retry</Button>}>
                Your ledger is still here; job status from the coordinator is unreachable.
              </Banner>
            )}
            {p.showAttention && scope === "yours" && p.attention.length > 0 && p.state !== "loading" && <AttentionList items={p.attention} />}
            {p.showFacets && p.state !== "loading" && scoped.length > 0 && (
              <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
                <Segmented label="Filter by kind" items={FACETS} value={facet} onChange={setFacet} counts={counts} />
              </div>
            )}
            {p.state === "loading" ? (
              <Loading />
            ) : p.state === "error" && !stale ? null : threads.length === 0 ? (
              <Empty filtered={facet !== "all"} scope={scope} onClear={() => setFacet("all")} />
            ) : (
              <ul className={cx("flex flex-col gap-3", stale && "opacity-60")} aria-label="Activity by job and node">
                {threads.map(([key, list], i) => (
                  <ThreadCard key={key} id={key} meta={p.threads[key] || { title: key, href: list[0]?.href || "/" }} acts={list} p={p} index={i} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AttentionList({ items }: { items: Attention[] }) {
  return (
    <section aria-labelledby="needs-you" className="flex flex-col gap-2">
      <h2 id="needs-you" className="font-mono text-xs uppercase tracking-wider text-subtle">needs you</h2>
      <ul className="flex flex-col divide-y divide-rule-row rounded-xl border border-rule bg-surface">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className={cx("size-2 shrink-0 rounded-full", a.tone === "danger" ? "bg-danger" : a.tone === "warn" ? "bg-warn" : a.tone === "ok" ? "bg-ok" : "bg-brand")} aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm text-ink">{a.title}</p>
              <p className="text-xs text-muted">{a.hint}</p>
            </div>
            <ButtonLink href={a.action.href} className="ml-6 sm:ml-0">{a.action.label}</ButtonLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ThreadCard({ id, meta, acts, p, index }: { id: string; meta: ThreadMeta; acts: Act[]; p: ActivityProps; index: number }) {
  const [open, setOpen] = useState(false);
  const Icon = THREAD_ICON[id.split(":")[0]] || Bell;
  const unread = acts.filter((a) => a.unread).length;
  const shown = acts.slice(0, Math.max(1, p.preview));
  const more = acts.slice(shown.length);
  const enter = p.stagger ? { className: "animate-rise-in", style: { "--i": index } as CSSProperties } : { className: undefined, style: undefined };
  const progress = meta.progress && p.progress !== "none" ? meta.progress : null;

  return (
    <li style={enter.style} className={cx("rounded-xl border border-rule bg-surface", enter.className, acts.some((a) => a.id === p.arrived) && "animate-arrive")}>
      <div className="flex items-start gap-3 p-4">
        <span className="relative grid size-9 shrink-0 place-items-center rounded-lg bg-band text-muted">
          <Icon className="size-4" strokeWidth={1.5} aria-hidden />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-brand ring-2 ring-surface" aria-hidden />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <Link href={meta.href} className="shrink-0 text-sm font-medium text-ink decoration-rule-strong underline-offset-4 hover:underline">{meta.title}</Link>
            {meta.sub && <span className="hidden min-w-0 truncate text-xs text-subtle sm:block">{meta.sub}</span>}
          </div>
          {(meta.status || progress) && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              {meta.status && <Pill tone={meta.status.tone} live={meta.status.live}>{meta.status.label}</Pill>}
              {progress && <ProgressMark {...progress} style={p.progress} />}
            </div>
          )}
        </div>
        {unread > 0 && <span className="shrink-0 pt-0.5 text-xs text-brand">{unread} new</span>}
      </div>

      {acts.length === 0 ? (
        <p className="border-t border-rule-row py-3 pl-16 pr-4 text-xs text-muted">{meta.empty || "Nothing has happened here yet."}</p>
      ) : (
        <div className="border-t border-rule-row py-2">
          <ol>
            {shown.map((a, i) => <ThreadEvent key={a.id} act={a} p={p} thread={id} first={i === 0} last={i === shown.length - 1 && (!open || more.length === 0)} />)}
          </ol>
          {more.length > 0 && (
            <div className="disclose" data-open={open || undefined}>
              <div inert={!open}>
                <ol>
                  {more.map((a, i) => <ThreadEvent key={a.id} act={a} p={p} thread={id} first={false} last={i === more.length - 1} />)}
                </ol>
              </div>
            </div>
          )}
          {more.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="ml-14 mt-1 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted transition-colors duration-150 hover:bg-band hover:text-ink"
            >
              {open ? "Show less" : `Show ${more.length} earlier`}
              <ChevronDown className={cx("size-3.5 transition-transform duration-200", open && "rotate-180")} aria-hidden />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** One event on a thread's timeline. The icon column sits under the header icon's centre line, and a 1px rule joins the icons. */
function ThreadEvent({ act, p, thread, first, last }: { act: Act; p: ActivityProps; thread: string; first: boolean; last: boolean }) {
  const compact = p.density === "compact";
  const strong = act.unread || first;
  return (
    <li className={cx("relative flex items-start gap-3 pl-6 pr-4", compact ? "py-1.5" : "py-2")}>
      {!(first && last) && (
        <span aria-hidden className={cx("absolute left-8.5 w-px bg-rule", first ? "bottom-0 top-4.5" : last ? "top-0 h-4.5" : "inset-y-0")} />
      )}
      <span className="relative mt-0.5 rounded-full bg-surface"><KindIcon act={act} /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link href={act.href} className={cx("text-sm decoration-rule-strong underline-offset-4 hover:underline", strong ? "text-ink" : "text-muted")}>{act.title}</Link>
        {p.show.detail && act.detail && !compact && <p className="text-xs text-muted">{act.detail}</p>}
        {p.show.chips && <Chips act={act} thread={thread} />}
        <Refs act={act} show={p.show} />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
        {p.show.amount && act.amount !== undefined && <Amount units={act.amount} />}
        <When at={act.at} now={p.now} mode={p.show.time} />
      </div>
    </li>
  );
}

function ProgressMark({ done, total, label, live, style }: { done: number; total: number; label: string; live?: boolean; style: ProgressStyle }) {
  const segments = style === "segments" && total <= 40;
  return (
    <span className="flex min-w-0 items-center gap-2" role="img" aria-label={label}>
      {segments ? (
        <span className="flex shrink-0 gap-0.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={cx("h-2 w-1.5 rounded-xs", i < done ? "bg-brand" : i === done && live ? "bg-brand/40 live-dot" : "bg-band")} />
          ))}
        </span>
      ) : (
        <span className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-band sm:w-28" aria-hidden>
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (done / Math.max(1, total)) * 100)}%` }} />
        </span>
      )}
      <span className="truncate font-mono text-xs text-subtle">{label}</span>
    </span>
  );
}

function KindIcon({ act }: { act: Act }) {
  const k = KIND[act.kind];
  return (
    <span className={cx("grid size-5 place-items-center rounded-full", TONE[k.tone])} aria-hidden>
      <k.icon className="size-3" strokeWidth={1.75} />
    </span>
  );
}

function Amount({ units }: { units: number }) {
  return (
    <span className={cx("whitespace-nowrap font-mono text-sm tabular", units > 0 ? "text-ok" : "text-ink")}>
      {units > 0 ? "+" : "-"}{formatToken(Math.abs(units))}
      <span className="ml-1 text-xs text-subtle">{TOKEN_SYMBOL}</span>
    </span>
  );
}

function When({ at, now, mode }: { at: number; now: number; mode: Show["time"] }) {
  const rel = relTime(at, now);
  return (
    <time dateTime={new Date(at * 1000).toISOString()} title={new Date(at * 1000).toLocaleString("en-GB")} className="whitespace-nowrap font-mono text-xs text-subtle tabular">
      {mode === "relative" ? rel : mode === "absolute" ? clock(at) : <>{clock(at)} · {rel}</>}
    </time>
  );
}

/** Where it happened, minus the thread's own object: a node thread does not repeat the node, a job thread does not repeat the job. */
function Chips({ act, thread }: { act: Act; thread: string }) {
  const bits: string[] = [];
  if (act.job !== undefined && thread !== `job:${act.job}`) bits.push(`job ${String(act.job).padStart(2, "0")}`);
  if (act.round !== undefined) bits.push(`round ${act.round}`);
  if (act.node && thread !== `node:${act.node}`) bits.push(`node ${short(act.node)}`);
  if (!bits.length) return null;
  return <span className="font-mono text-xs text-subtle">{bits.join(" · ")}</span>;
}

function Refs({ act, show }: { act: Act; show: Show }) {
  if (!(show.tx && act.tx) && !(show.block && act.block !== undefined)) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {show.tx && act.tx && <HashChip value={act.tx} label="tx" />}
      {show.block && act.block !== undefined && <span className="font-mono text-xs text-subtle">block #{act.block.toLocaleString("en-US")}</span>}
    </span>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="rounded-xl border border-rule bg-surface">
          <div className="flex items-start gap-3 p-4">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-2 w-40" /></div>
            <Skeleton className="h-2.5 w-12" />
          </div>
          <div className="flex flex-col gap-3 border-t border-rule-row py-3 pl-6 pr-4">
            {Array.from({ length: 2 }, (_, j) => (
              <div key={j} className="flex items-start gap-3">
                <Skeleton className="size-5 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3 w-3/5" /><Skeleton className="h-2.5 w-2/5" /></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ filtered, scope, onClear }: { filtered: boolean; scope: Scope; onClear: () => void }) {
  if (filtered) {
    return (
      <EmptyState icon={Bell} title="Nothing of this kind yet" action={<Button onClick={onClear}>Show everything</Button>}>
        No events match this filter.
      </EmptyState>
    );
  }
  if (scope === "network") return <EmptyState icon={Bell} poster="QUIET" title="The network is quiet">No jobs, rounds or payouts on the network yet.</EmptyState>;
  return (
    <EmptyState
      icon={Bell}
      title="Nothing has happened yet"
      action={<div className="flex flex-wrap justify-center gap-2"><ButtonLink href="/jobs/new" variant="primary">New job</ButtonLink><ButtonLink href="/nodes/add">Add a node</ButtonLink></div>}
    >
      Post a job or add your laptop as a node. Each one gets a thread here: where it stands, and what happened to it.
    </EmptyState>
  );
}

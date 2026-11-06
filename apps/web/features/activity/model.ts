// Activity: what happened to your jobs, your node and your money, in time order. It owns no object; every event deep-links to the page that does (job, round receipt, node, balance).
import { formatToken } from "@/lib/money";
import {
  CheckCircle2, CircleDot, CircleSlash, Coins, Flag, GraduationCap, Layers, Lock, RotateCcw, ShieldAlert, Shuffle,
  TimerOff, Undo2, Unlock, Users, Wallet, Wifi, WifiOff, type LucideIcon,
} from "lucide-react";

export type ActKind =
  | "job.posted" | "job.completed" | "job.abandoned"
  | "round.opened" | "round.finalized" | "round.voided"
  | "node.drawn" | "node.paid" | "node.pool" | "node.slashed" | "node.missed" | "node.graduated" | "node.online" | "node.offline"
  | "money.claimed" | "money.refund" | "stake.added" | "stake.withdrawn";

export type Facet = "money" | "rounds" | "node" | "jobs";
export type Tone = "ok" | "danger" | "warn" | "brand" | "neutral";

export type Act = {
  id: string;
  /** Unix seconds. */
  at: number;
  kind: ActKind;
  /** Yours: it touched your wallet, your job or your node. Otherwise it is network activity. */
  mine: boolean;
  /** One plain sentence, object first. */
  title: string;
  /** The why or the consequence, one line. */
  detail?: string;
  /** Signed token units: positive came to you, negative left you. Absent when no money moved. */
  amount?: number;
  job?: number;
  round?: number;
  node?: string;
  tx?: string;
  block?: number;
  href: string;
  /** Grouping key for the threads view: job:4, node:0x..., wallet. */
  thread: string;
  unread: boolean;
  /** Extra key-values shown only at full detail. */
  facts?: { label: string; value: string }[];
};

/** A standing state that wants a decision, not an event. Pinned above the feed. */
export type Attention = { id: string; tone: Tone; title: string; hint: string; action: { label: string; href: string } };

/** A thread's header: where the job or node stands now. Status and progress are current state, not events, so they carry no time. */
export type ThreadMeta = {
  title: string;
  sub?: string;
  href: string;
  status?: { label: string; tone: "ok" | "warn" | "danger" | "pending" | "neutral" | "chain" | "brand"; live?: boolean };
  progress?: { done: number; total: number; label: string; live?: boolean };
  /** Show the thread even with no timed events yet, for example a job you posted that has not started. */
  always?: boolean;
  /** Line shown when the thread has no events. */
  empty?: string;
};

export const KIND: Record<ActKind, { facet: Facet; tone: Tone; icon: LucideIcon; label: string }> = {
  "job.posted": { facet: "jobs", tone: "neutral", icon: Layers, label: "job posted" },
  "job.completed": { facet: "jobs", tone: "ok", icon: CheckCircle2, label: "job completed" },
  "job.abandoned": { facet: "jobs", tone: "warn", icon: CircleSlash, label: "job abandoned" },
  "round.opened": { facet: "rounds", tone: "neutral", icon: CircleDot, label: "round opened" },
  "round.finalized": { facet: "rounds", tone: "ok", icon: Flag, label: "round finalized" },
  "round.voided": { facet: "rounds", tone: "warn", icon: Undo2, label: "round voided" },
  "node.drawn": { facet: "node", tone: "brand", icon: Shuffle, label: "drawn" },
  "node.paid": { facet: "money", tone: "ok", icon: Coins, label: "paid" },
  "node.pool": { facet: "money", tone: "neutral", icon: Users, label: "to pool" },
  "node.slashed": { facet: "node", tone: "danger", icon: ShieldAlert, label: "slashed" },
  "node.missed": { facet: "node", tone: "danger", icon: TimerOff, label: "missed reveal" },
  "node.graduated": { facet: "node", tone: "ok", icon: GraduationCap, label: "graduated" },
  "node.online": { facet: "node", tone: "neutral", icon: Wifi, label: "online" },
  "node.offline": { facet: "node", tone: "warn", icon: WifiOff, label: "offline" },
  "money.claimed": { facet: "money", tone: "neutral", icon: Wallet, label: "claimed" },
  "money.refund": { facet: "money", tone: "ok", icon: RotateCcw, label: "refund" },
  "stake.added": { facet: "money", tone: "neutral", icon: Lock, label: "staked" },
  "stake.withdrawn": { facet: "money", tone: "neutral", icon: Unlock, label: "unstaked" },
};

export const FACETS: { key: Facet | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "money", label: "Money" },
  { key: "rounds", label: "Rounds" },
  { key: "node", label: "Node" },
  { key: "jobs", label: "Jobs" },
];

export const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  danger: "bg-danger-bg text-danger",
  warn: "bg-warn-bg text-warn",
  brand: "bg-brand-soft text-brand",
  neutral: "bg-band text-muted",
};

/** Day buckets in the reader's local time: Today, Yesterday, then weekday and date. */
export function dayLabel(at: number, now: number) {
  const d = new Date(at * 1000);
  const n = new Date(now * 1000);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(n) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function groupByDay(acts: Act[], now: number) {
  const out: { day: string; acts: Act[] }[] = [];
  for (const a of acts) {
    const day = dayLabel(a.at, now);
    const last = out[out.length - 1];
    if (last && last.day === day) last.acts.push(a);
    else out.push({ day, acts: [a] });
  }
  return out;
}

export function clock(at: number) {
  return new Date(at * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Consecutive payouts on one job read as one fact ("paid for 4 rounds of job 06"), not four lines that differ by a digit. */
export function foldRuns(list: Act[]): Act[] {
  const runs: Act[][] = [];
  for (const a of list) {
    const run = runs[runs.length - 1];
    const joins = run && a.mine && a.kind === "node.paid" && run[0].kind === "node.paid" && run[0].mine && a.job !== undefined && run[0].job === a.job;
    if (joins) run.push(a);
    else runs.push([a]);
  }
  return runs.map((run) => {
    if (run.length === 1) return run[0];
    const head = run[0];
    const job = head.job as number;
    const rounds = run.flatMap((a) => (a.round === undefined ? [] : [a.round])).sort((x, y) => x - y);
    const span = rounds.length > 3 ? `Rounds ${rounds[0]}-${rounds[rounds.length - 1]}` : `Rounds ${rounds.join(", ")}`;
    const total = run.reduce((t, a) => (a.amount === undefined ? t : t + a.amount), 0);
    return {
      ...head,
      id: `${head.id}+${run.length}`,
      title: `Your node was paid for ${run.length} rounds of job ${pad(job)}`,
      detail: `${span}. Each passed replay, and each round split pay equally.`,
      amount: total,
      round: undefined,
      tx: undefined,
      block: undefined,
      href: `/jobs/${job}`,
      unread: run.some((a) => a.unread),
    };
  });
}

/** Unread as the reader sees it: rows after folding, per thread, so the header, the cards and the sidebar agree. */
export function unreadRows(acts: Act[]) {
  const byThread = new Map<string, Act[]>();
  for (const a of acts) byThread.set(a.thread, [...(byThread.get(a.thread) || []), a]);
  let n = 0;
  for (const list of byThread.values()) n += foldRuns(list).filter((a) => a.unread).length;
  return n;
}

/** The feed as CSV, one row per event, for tax records and spreadsheets. Amounts are signed: positive came to you. */
export function actsCsv(acts: Act[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const head = "date,kind,title,amount,job,round,node,tx";
  const rows = acts.map((a) => [
    new Date(a.at * 1000).toISOString(),
    KIND[a.kind].label,
    esc(a.title),
    a.amount === undefined ? "" : `${a.amount < 0 ? "-" : ""}${formatToken(Math.abs(a.amount)) ?? ""}`,
    a.job ?? "",
    a.round ?? "",
    a.node ?? "",
    a.tx ?? "",
  ].join(","));
  return [head, ...rows].join("\n");
}

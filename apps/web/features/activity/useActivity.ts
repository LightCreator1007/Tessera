"use client";
// Activity built from what the app already reads: ledger movements (payouts, budgets, claims, refunds), your node's chain record (joined, graduated, penalties) and the status of your jobs. Only facts with a time become events; status and progress go in thread headers, because rounds carry no timestamps yet.
import { useMemo, useSyncExternalStore } from "react";
import { ownsJob, useWallet } from "@/lib/wallet";
import { isDemo } from "@/lib/api/client";
import { useJobs, useNodeChain } from "@/lib/api/hooks";
import type { Job } from "@/lib/api/types";
import { JOB_LABEL, JOB_TONE, short } from "@/components/primitives";
import { formatToken, TOKEN_SYMBOL } from "@/lib/money";
import { useLedger } from "@/features/me/Overview";
import { MIN_STAKE } from "@/features/node/JoinFlow";
import { unreadRows, type Act, type Attention, type ThreadMeta } from "./model";

const KEY = "activity-seen";
const subs = new Set<() => void>();
let firstVisit: number | null = null;

/** Unix seconds of the last visit to /activity. Before the first visit, the last day counts as new rather than the whole history. */
export function readSeen() {
  const v = localStorage.getItem(KEY);
  if (v !== null) return Number(v);
  firstVisit ??= Math.floor(Date.now() / 1000 - 86_400);
  return firstVisit;
}

export function markSeen(at = Date.now() / 1000) {
  localStorage.setItem(KEY, String(Math.floor(at)));
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  window.addEventListener("storage", f);
  return () => { subs.delete(f); window.removeEventListener("storage", f); };
}

/** Reactive last-seen time; null on the server and before hydration, so nothing renders as new until it is known. */
export function useSeen() {
  return useSyncExternalStore(subscribe, readSeen, () => null);
}

const pad = (n: number) => String(n).padStart(2, "0");
const round = (job: number, r: number) => `/jobs/${job}/rounds/${r}`;

function jobProgress(j: Job): ThreadMeta["progress"] {
  if (j.status === "completed") return { done: j.rounds, total: j.rounds, label: `${j.rounds} of ${j.rounds} rounds` };
  if (j.status === "running" && j.currentRound !== null) return { done: j.currentRound - 1, total: j.rounds, label: `round ${j.currentRound} of ${j.rounds}`, live: true };
  if (j.status === "open") return { done: 0, total: j.rounds, label: `0 of ${j.rounds} rounds` };
  if (j.currentRound !== null) return { done: j.currentRound - 1, total: j.rounds, label: `stopped at round ${j.currentRound}` };
  return undefined;
}

/** since: events after this time count as new. The sidebar passes the stored value; the page passes the value from when it opened, so highlights survive the visit. */
export function useActivity(since: number | null) {
  const w = useWallet();
  const jobs = useJobs();
  const ledger = useLedger();
  const node = w.node;
  const op = node?.operator ?? "";
  const chain = useNodeChain(op, Boolean(node?.joined));
  const record = chain.data?.data ?? null;

  const built = useMemo(() => {
    const acts: Act[] = [];
    const threads: Record<string, ThreadMeta> = {};
    const attention: Attention[] = [];
    if (!w.connected || !w.address) return { acts, threads, attention };
    const isNew = (at: number) => since !== null && at > since;
    const nodeThread = node ? `node:${op}` : "wallet";

    for (const r of ledger.rows) {
      const base = { id: `l-${r.key}`, at: r.at, mine: true, unread: isNew(r.at), job: r.job, round: r.round };
      if (r.kind === "payout") {
        const placed = r.job !== undefined && r.round !== undefined;
        acts.push({ ...base, kind: "node.paid", title: placed ? `Your node was paid for job ${pad(r.job!)}, round ${r.round}` : "Your node was paid", detail: "Its work passed replay, and the round split pay equally.", amount: r.amount, node: node?.operator, href: placed ? round(r.job!, r.round!) : "/balance", thread: nodeThread });
      } else if (r.kind === "budget") {
        const earned = r.fromEarnings ?? 0; // rails-allow: no split recorded means the wallet paid all of it
        acts.push({ ...base, kind: "job.posted", title: r.job !== undefined ? `You posted job ${pad(r.job)}` : r.note, detail: earned > 0 ? `${formatToken(earned)} ${TOKEN_SYMBOL} came from earnings, ${formatToken(r.amount - earned)} from your wallet.` : "Paid from your wallet.", amount: -r.amount, href: r.job !== undefined ? `/jobs/${r.job}` : "/balance", thread: r.job !== undefined ? `job:${r.job}` : "wallet" });
      } else if (r.kind === "claim") {
        acts.push({ ...base, kind: "money.claimed", title: `You claimed ${formatToken(r.amount)} ${TOKEN_SYMBOL} to your wallet`, detail: "Earnings moved from the contract to your wallet.", href: "/balance", thread: "wallet" });
      } else {
        acts.push({ ...base, kind: "money.refund", title: r.job !== undefined ? `Leftover from job ${pad(r.job)} was refunded` : "A refund reached your wallet", detail: "Budget from rounds that never ran came back to you.", amount: r.amount, href: r.job !== undefined ? `/jobs/${r.job}` : "/balance", thread: r.job !== undefined ? `job:${r.job}` : "wallet" });
      }
    }

    if (node && record) {
      const at = { mine: true, node: op, thread: nodeThread };
      acts.push({ ...at, id: "n-joined", at: record.joinedAt, unread: isNew(record.joinedAt), kind: "stake.added", title: "Your node joined the network", detail: record.stake !== null ? `It staked ${formatToken(record.stake)} ${TOKEN_SYMBOL} as one bond for every job.` : undefined, href: `/nodes/${op}` });
      if (record.graduatedAt !== null) acts.push({ ...at, id: "n-grad", at: record.graduatedAt, unread: isNew(record.graduatedAt), kind: "node.graduated", title: "Your node finished its proving period", detail: "It now keeps its share of each round, plus a drip from the pool.", href: `/nodes/${op}` });
      record.penalties.forEach((pe, i) => {
        const slashed = pe.kind === "Slashed";
        acts.push({ ...at, id: `n-pen${i}`, at: pe.at, unread: isNew(pe.at), kind: slashed ? "node.slashed" : "node.missed", job: pe.job, round: pe.round, title: slashed ? `Your node was slashed on job ${pad(pe.job)}, round ${pe.round}` : `Your node missed a reveal on job ${pad(pe.job)}, round ${pe.round}`, detail: slashed ? "A verifier's replay disagreed with its work." : "Two missed reveals bench it until you re-arm it.", amount: pe.amount !== null ? -Math.abs(pe.amount) : undefined, href: round(pe.job, pe.round) });
      });
    }
    acts.sort((a, b) => b.at - a.at);

    const owned = (jobs.data?.data ?? []).filter((j) => ownsJob(w.address, isDemo, j));
    for (const j of owned) {
      threads[`job:${j.id}`] = {
        title: `Job ${pad(j.id)}`, sub: j.workload, href: `/jobs/${j.id}`, always: true,
        status: { label: JOB_LABEL[j.status], tone: JOB_TONE[j.status], live: j.status === "running" },
        progress: jobProgress(j),
        empty: j.status === "open" ? "Waiting for enough idle nodes to open round 1." : "No payments or refunds on this job yet.",
      };
      // A withdrawn refund already zeroes remaining on chain; the ledger check keeps demo data from asking twice.
      const refunded = ledger.rows.filter((r) => r.kind === "refund" && r.job === j.id).reduce((t, r) => t + r.amount, 0);
      if ((j.status === "abandoned" || j.status === "completed") && j.remaining > refunded) {
        attention.push({ id: `refund${j.id}`, tone: "warn", title: `Job ${pad(j.id)} has ${formatToken(j.remaining)} ${TOKEN_SYMBOL} to refund`, hint: "Budget the job never spent. Withdraw it from the job page.", action: { label: `Open job ${pad(j.id)}`, href: `/jobs/${j.id}` } });
      }
    }
    for (const p of w.postedJobs) {
      threads[`job:${p.id}`] ??= { title: `Job ${pad(p.id)}`, sub: p.workload, href: `/jobs/${p.id}`, always: true, status: { label: JOB_LABEL.open, tone: JOB_TONE.open }, progress: { done: 0, total: p.rounds, label: `0 of ${p.rounds} rounds` }, empty: "Waiting for enough idle nodes to open round 1." };
    }

    if (node) {
      const hours = record ? Math.floor(record.verifiedWorkSeconds / 3600) : null;
      const total = record ? Math.round(record.probationSeconds / 3600) : null;
      threads[`node:${op}`] = {
        title: "Your node", sub: short(op), href: `/nodes/${op}`, always: true,
        status: !node.joined ? { label: "Setup unfinished", tone: "pending" } : node.stake < MIN_STAKE ? { label: "Stake too low", tone: "danger" } : node.running ? { label: "Online", tone: "ok", live: true } : { label: "Offline", tone: "warn" },
        progress: record && !record.graduated && hours !== null && total ? { done: Math.min(hours, total), total, label: `proving, ${hours} of ${total} h` } : undefined,
        empty: node.joined ? "No rounds yet. Rounds draw the longest-idle node first." : "Finish setup to start earning.",
      };
      if (!node.joined) attention.push({ id: "setup", tone: "brand", title: "Your node isn't set up yet", hint: "It is paired with this wallet. Verify, stake and join to start earning.", action: { label: "Finish setup", href: "/nodes/add" } });
      else if (node.stake < MIN_STAKE) attention.push({ id: "stake", tone: "danger", title: `Your node's stake is under ${formatToken(MIN_STAKE)} ${TOKEN_SYMBOL}`, hint: "Rounds stop drawing it until you add stake.", action: { label: "Open node", href: `/nodes/${op}` } });
      else if (!node.running) attention.push({ id: "offline", tone: "warn", title: "Your node is offline", hint: "Start it on the laptop with tod-node run.", action: { label: "Open node", href: `/nodes/${op}` } });
    }
    threads.wallet = { title: "Wallet", sub: node ? "claims and refunds" : "earnings, claims and refunds", href: "/balance" };
    if (w.claimable > 0) attention.unshift({ id: "claim", tone: "brand", title: `${formatToken(w.claimable)} ${TOKEN_SYMBOL} of earnings is ready`, hint: "Claim it to your wallet, or let your next job spend it first.", action: { label: "Open balance", href: "/balance" } });

    return { acts, threads, attention };
  }, [w.connected, w.address, w.postedJobs, w.claimable, node, op, record, ledger.rows, jobs.data, since]);

  return {
    ...built,
    signedIn: w.connected && Boolean(w.address),
    state: jobs.isPending ? ("loading" as const) : jobs.isError ? ("error" as const) : ("ready" as const),
    retry: () => { void jobs.refetch(); void chain.refetch(); },
    unread: unreadRows(built.acts),
  };
}

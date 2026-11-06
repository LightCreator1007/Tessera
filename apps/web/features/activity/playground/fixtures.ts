// Seeded activity fixtures at four scales (empty, one, typical, heavy) so every state of the activity screen can be walked without a coordinator.
import type { Act, ActKind, Attention, ThreadMeta } from "../model";

const U = 1_000_000;
const ME_NODE = "0x87690f3c2b1e4d5a6c7b8e9f0a1b2c3d4e5f6071";
const OTHERS = ["0x8c1f2e3d4c5b6a79881726354a5b6c7d8e9f0a1b", "0x41a07b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2", "0x9d3e5f708192a3b4c5d6e7f8091a2b3c4d5e6f70"];
const JOBS: Record<number, string> = { 1: "mnist-mlp", 2: "tiny-shakespeare", 3: "cifar-resnet", 4: "cifar-resnet", 5: "speech-commands", 6: "tiny-stories" };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (r: () => number, n = 64) => "0x" + Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
const jobHref = (j: number) => `/jobs/${j}`;
const roundHref = (j: number, r: number) => `/jobs/${j}/rounds/${r}`;
const nodeHref = (op: string) => `/nodes/${op}`;
const pad = (j: number) => String(j).padStart(2, "0");

type Seed = Omit<Act, "id" | "at" | "unread" | "tx" | "block"> & { ago: number };

/** The typical story: one person who trains (jobs 03 and 04) and runs a node, over a week. Minutes ago. */
function story(): Seed[] {
  return [
    { ago: 2, kind: "node.paid", mine: true, title: "Your node was paid for job 04, round 7", detail: "Both verifiers replayed its shard and agreed.", amount: 1.84 * U, job: 4, round: 7, node: ME_NODE, href: roundHref(4, 7), thread: `node:${ME_NODE}`, facts: [{ label: "Shard", value: "3 of 6" }, { label: "Split", value: "equal, 6 nodes" }] },
    { ago: 9, kind: "round.finalized", mine: true, title: "Job 03 finished round 12 of 20", detail: "Loss went from 1.82 to 1.71. Six nodes were paid.", job: 3, round: 12, href: roundHref(3, 12), thread: "job:3", facts: [{ label: "Metric", value: "loss 1.71" }, { label: "Paid", value: "6 nodes" }] },
    { ago: 26, kind: "node.drawn", mine: true, title: "Your node was drawn into job 04, round 8", detail: "Shard 2 of 6. It is training now.", job: 4, round: 8, node: ME_NODE, href: roundHref(4, 8), thread: `node:${ME_NODE}` },
    { ago: 64, kind: "round.voided", mine: true, title: "Job 03, round 11 was voided", detail: "Only 3 of 6 reveals arrived in time. That round's budget stays in the job.", job: 3, round: 11, href: roundHref(3, 11), thread: "job:3", facts: [{ label: "Reveals", value: "3 of 6" }] },
    { ago: 70, kind: "node.paid", mine: false, title: "Node 0x41a0...b1c2 was paid for job 05, round 3", amount: 2.1 * U, job: 5, round: 3, node: OTHERS[1], href: roundHref(5, 3), thread: "job:5" },
    { ago: 185, kind: "node.missed", mine: true, title: "Your node missed a reveal on job 02, round 4", detail: "One more miss benches it until you re-arm it.", job: 2, round: 4, node: ME_NODE, href: roundHref(2, 4), thread: `node:${ME_NODE}`, facts: [{ label: "Misses", value: "1 of 2" }] },
    { ago: 240, kind: "job.posted", mine: false, title: "Job 06 was posted by 0x8c1f...0a1b", detail: "tiny-stories, 120 TOD over 30 rounds.", job: 6, href: jobHref(6), thread: "job:6" },
    { ago: 60 * 22, kind: "money.claimed", mine: true, title: "You claimed earnings to your wallet", amount: 24.1 * U, href: "/balance", thread: "wallet" },
    { ago: 60 * 26, kind: "job.posted", mine: true, title: "You posted job 04, cifar-resnet", detail: "12.40 TOD came from earnings, 27.60 from your wallet.", amount: -40 * U, job: 4, href: jobHref(4), thread: "job:4", facts: [{ label: "Budget", value: "40.00 TOD" }, { label: "Rounds", value: "10" }] },
    { ago: 60 * 30, kind: "node.graduated", mine: true, title: "Your node finished its proving period", detail: "5 verified hours. From now on it keeps its share, plus a drip from the pool.", node: ME_NODE, href: nodeHref(ME_NODE), thread: `node:${ME_NODE}` },
    { ago: 60 * 31, kind: "node.slashed", mine: false, title: "Node 0x9d3e...6f70 was slashed on job 05, round 2", detail: "A verifier's replay disagreed at step 140.", amount: undefined, job: 5, round: 2, node: OTHERS[2], href: roundHref(5, 2), thread: "job:5" },
    { ago: 60 * 50, kind: "node.pool", mine: true, title: "Your share of job 02, round 3 went to the community pool", detail: "Pay during the proving period goes to the pool.", job: 2, round: 3, node: ME_NODE, href: roundHref(2, 3), thread: `node:${ME_NODE}` },
    { ago: 60 * 75, kind: "node.slashed", mine: true, title: "Your node was slashed on job 01, round 2", detail: "A verifier's replay disagreed at step 140. Check the self-test.", amount: -2 * U, job: 1, round: 2, node: ME_NODE, href: roundHref(1, 2), thread: `node:${ME_NODE}`, facts: [{ label: "Kind", value: "replay mismatch" }, { label: "Evidence", value: "2 verifiers" }] },
    { ago: 60 * 98, kind: "job.completed", mine: true, title: "Job 01 completed", detail: "All 8 rounds finalized. The weights are ready to download.", job: 1, href: jobHref(1), thread: "job:1" },
    { ago: 60 * 99, kind: "money.refund", mine: true, title: "Leftover from job 01 was refunded", detail: "Budget from voided rounds returned to you.", amount: 3.2 * U, job: 1, href: jobHref(1), thread: "job:1" },
    { ago: 60 * 140, kind: "stake.added", mine: true, title: "You staked 15.00 TOD for your node", detail: "One bond covers every job it joins.", amount: -15 * U, node: ME_NODE, href: nodeHref(ME_NODE), thread: `node:${ME_NODE}` },
  ];
}

const HEAVY_KINDS: ActKind[] = ["node.paid", "node.drawn", "round.finalized", "round.opened", "node.paid", "round.finalized", "node.missed", "round.voided"];

function heavy(r: () => number): Seed[] {
  const out: Seed[] = [];
  let ago = 1;
  for (let i = 0; i < 140; i++) {
    ago += Math.floor(r() * 140) + 4;
    const kind = HEAVY_KINDS[Math.floor(r() * HEAVY_KINDS.length)];
    const job = 1 + Math.floor(r() * 6);
    const round = 1 + Math.floor(r() * 20);
    const mine = r() < 0.6;
    const who = mine ? "Your node" : `Node ${OTHERS[i % 3].slice(0, 6)}...${OTHERS[i % 3].slice(-4)}`;
    const base = { ago, kind, mine, job, round, href: roundHref(job, round) };
    if (kind === "node.paid") out.push({ ...base, title: `${who} was paid for job ${pad(job)}, round ${round}`, amount: Math.round((0.6 + r() * 3) * U), node: mine ? ME_NODE : OTHERS[i % 3], thread: mine ? `node:${ME_NODE}` : `job:${job}` });
    else if (kind === "node.drawn") out.push({ ...base, title: `${who} was drawn into job ${pad(job)}, round ${round}`, node: mine ? ME_NODE : OTHERS[i % 3], thread: mine ? `node:${ME_NODE}` : `job:${job}` });
    else if (kind === "node.missed") out.push({ ...base, title: `${who} missed a reveal on job ${pad(job)}, round ${round}`, node: mine ? ME_NODE : OTHERS[i % 3], thread: mine ? `node:${ME_NODE}` : `job:${job}` });
    else if (kind === "round.opened") out.push({ ...base, title: `Job ${pad(job)} opened round ${round}`, thread: `job:${job}` });
    else if (kind === "round.voided") out.push({ ...base, title: `Job ${pad(job)}, round ${round} was voided`, detail: "Too few reveals arrived in time.", thread: `job:${job}` });
    else out.push({ ...base, title: `Job ${pad(job)} finished round ${round}`, detail: `Loss ${(2 - r()).toFixed(2)}.`, thread: `job:${job}` });
  }
  return out;
}

export type Scale = "empty" | "one" | "typical" | "heavy";

export function makeActs(scale: Scale, now: number, unread: number): Act[] {
  const r = rng(7);
  const seeds = scale === "empty" ? [] : scale === "one" ? story().slice(0, 1) : scale === "typical" ? story() : [...story(), ...heavy(rng(11))];
  let left = unread;
  return seeds
    .sort((a, b) => a.ago - b.ago)
    .map((s, i) => {
      const { ago, ...rest } = s;
      const mineUnread = rest.mine && left > 0;
      if (mineUnread) left--;
      return { ...rest, id: `a${i}`, at: Math.round(now - ago * 60), unread: mineUnread, tx: hex(r), block: 18_402_311 - Math.round(ago * 30) };
    });
}

export function makeAttention(opts: { hasNode: boolean; nodeOffline: boolean; claimable: boolean }): Attention[] {
  const out: Attention[] = [];
  if (opts.claimable) out.push({ id: "claim", tone: "brand", title: "12.40 TOD of earnings is ready", hint: "Claim it to your wallet, or let your next job spend it first.", action: { label: "Open balance", href: "/balance" } });
  if (opts.hasNode && opts.nodeOffline) out.push({ id: "offline", tone: "warn", title: "Your node is offline", hint: "It stopped sending heartbeats 40 minutes ago. Start it with tod-node run.", action: { label: "Open node", href: nodeHref(ME_NODE) } });
  out.push({ id: "refund", tone: "warn", title: "Job 03 has 4.00 TOD to refund", hint: "Budget from a voided round. Withdraw it from the job page.", action: { label: "Open job 03", href: jobHref(3) } });
  return out;
}

export const THREADS: Record<string, ThreadMeta> = {
  ...Object.fromEntries(Object.entries(JOBS).map(([id, w]) => [`job:${id}`, { title: `Job ${pad(Number(id))}`, sub: w, href: jobHref(Number(id)) }])),
  "job:3": { title: "Job 03", sub: "cifar-resnet", href: jobHref(3), always: true, status: { label: "Training", tone: "ok", live: true }, progress: { done: 11, total: 20, label: "round 12 of 20", live: true } },
  "job:4": { title: "Job 04", sub: "cifar-resnet", href: jobHref(4), always: true, status: { label: "Training", tone: "ok", live: true }, progress: { done: 7, total: 10, label: "round 8 of 10", live: true } },
  "job:1": { title: "Job 01", sub: "mnist-mlp", href: jobHref(1), status: { label: "Finished", tone: "neutral" }, progress: { done: 8, total: 8, label: "8 of 8 rounds" } },
  "job:7": { title: "Job 07", sub: "speech-commands", href: jobHref(7), always: true, status: { label: "Waiting", tone: "pending" }, progress: { done: 0, total: 12, label: "0 of 12 rounds" }, empty: "Waiting for enough idle nodes to open round 1." },
  [`node:${ME_NODE}`]: { title: "Your node", sub: "0x8769...6071", href: nodeHref(ME_NODE), always: true, status: { label: "Online", tone: "ok", live: true } },
  wallet: { title: "Wallet", sub: "claims and refunds", href: "/balance" },
};

/** A new event for the "push event" action: the next round of job 04 pays out. */
export function nextAct(now: number, n: number): Act {
  return {
    id: `live${n}`, at: Math.round(now), kind: "node.paid", mine: true, unread: true,
    title: `Your node was paid for job 04, round ${7 + n}`, detail: "Both verifiers replayed its shard and agreed.",
    amount: 1.84 * U, job: 4, round: 7 + n, node: ME_NODE, href: roundHref(4, 7 + n), thread: `node:${ME_NODE}`,
    tx: "0x" + "ab".repeat(32), block: 18_402_400 + n,
  };
}

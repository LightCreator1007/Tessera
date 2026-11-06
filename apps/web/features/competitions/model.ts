"use client";
// Competitions as the signed-in wallet sees them: the contract's, against a coordinator, or in demo mode the examples plus this wallet's; and who may enter what.
import { useWallet, type DemoWallet, type HostedCompetition } from "@/lib/wallet";
import { isDemo } from "@/lib/api/client";
import { useLiveCompetitions } from "@/lib/api/hooks";
import type { LiveCompetition } from "@/lib/api/types";
import { COMPETITIONS, ITEMS, labelBytes, type Competition } from "@/lib/learn/competition";
import { mulberry32, sha256 } from "@/lib/learn/replay";

export type Relation = "host" | "entered" | null;
export type Gate = { ok: true } | { ok: false; why: "closed" | "host" | "entered"; text: string };

const fromHosted = (h: HostedCompetition): Competition => ({
  id: h.id, title: h.title, task: h.task, host: h.host, status: "open", prize: h.prize, budget: h.budget, fee: h.fee,
  deadline: h.deadline, labelsSeed: h.labelsSeed, labelsHash: h.labelsHash, committedAt: h.committedAt, entries: [],
});

function merge(w: DemoWallet): Competition[] {
  const all = [...w.hosted.map(fromHosted), ...COMPETITIONS];
  if (!w.address) return all;
  const me = w.address;
  return all.map((c) => {
    const mine = w.entries.find((e) => e.competition === c.id);
    if (!mine || c.entries.some((e) => e.op.toLowerCase() === me.toLowerCase())) return c;
    return { ...c, entries: [...c.entries, { op: me, seed: 0, skill: 0, scoreHash: "" }] };
  });
}

// The contract's lifecycle in the page's terms: closed means past the deadline and not scored yet.
const LIVE_STATUS: Record<LiveCompetition["status"], Competition["status"]> = {
  open: "open", "awaiting-labels": "closed", "labels-hidden": "unrevealed", refundable: "closed",
  scoring: "finished", "ready-to-settle": "finished", settled: "finished",
};

export function fromLive(r: LiveCompetition): Competition {
  const scores = new Map(r.leaderboard.map((e) => [e.entrant.toLowerCase(), e.score / r.items]));
  const status = r.status === "settled" && r.scored === 0 ? "closed" : LIVE_STATUS[r.status];
  return {
    id: String(r.id), title: r.title, task: r.task, host: r.host, status, prize: r.prize, budget: 0, fee: 0,
    deadline: new Date(r.deadline * 1000).toISOString(), labelsSeed: null, labelsHash: r.labelsHash, committedAt: r.createdBlock,
    entries: r.entrants.map((op) => ({ op, seed: 0, skill: 0, scoreHash: "", score: scores.get(op.toLowerCase()) })),
    live: true, items: r.items, revealWindow: r.revealWindow, arkiv: r.arkiv ?? null, stage: r.status, settled: r.settled,
  };
}

export function useCompetitions() {
  const w = useWallet();
  const live = useLiveCompetitions();
  // Against a coordinator, the contract is the source; the examples and this browser's demo hosting are demo mode only.
  if (!isDemo) return { list: (live.data?.data ?? []).map(fromLive), w };
  return { list: merge(w), w };
}

export function useCompetition(id: string) {
  const { list, w } = useCompetitions();
  return { c: list.find((c) => c.id === id) ?? null, w };
}

export function relationOf(c: Competition, w: DemoWallet): Relation {
  if (w.hosted.some((h) => h.id === c.id)) return "host";
  if (!w.address) return null;
  if (c.host.toLowerCase() === w.address.toLowerCase()) return "host";
  return w.entries.some((e) => e.competition === c.id) ? "entered" : null;
}

/** Whether this wallet may enter now. The deadline is checked against the clock, not just the stored status. */
export function entryGate(c: Competition, w: DemoWallet, now = Date.now()): Gate {
  if (c.status !== "open" || Date.parse(c.deadline) <= now) return { ok: false, why: "closed", text: "Entries are closed. The deadline has passed." };
  const rel = relationOf(c, w);
  if (rel === "host") return { ok: false, why: "host", text: "You host this competition, so you can't enter it." };
  if (rel === "entered") return { ok: false, why: "entered", text: "You've entered. One entry per person." };
  return { ok: true };
}

export const isPerson = (w: DemoWallet) => w.personVerified || !!w.node?.humanVerified;

/** A committed file: its hash plus what the person picked, so the screen can say what was committed. */
export type Committed = { hash: string; name: string; bytes: number; sample: boolean };

export const MAX_FILE = 50 * 1024 * 1024;

export async function commitFile(file: File): Promise<Committed | string> {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_FILE) return "That file is over 50 MB. Labels and predictions for 2,000 items are a few KB.";
  return { hash: await sha256(await file.arrayBuffer()), name: file.name, bytes: file.size, sample: false };
}

/** Example labels the browser can rebuild later, so a demo competition can be re-checked end to end. */
export async function sampleLabels(seed: number): Promise<Committed> {
  const bytes = labelBytes(seed);
  return { hash: await sha256(bytes), name: "sample-labels.bin", bytes: bytes.length, sample: true };
}

export async function samplePredictions(seed: number): Promise<Committed> {
  const rnd = mulberry32(seed);
  const bytes = Uint8Array.from({ length: ITEMS }, () => Math.floor(rnd() * 10));
  return { hash: await sha256(bytes), name: "sample-predictions.bin", bytes: bytes.length, sample: true };
}

/** Pay-from-earnings default: earnings cover what they can, the wallet pays the rest after an exact approve. */
export function split(total: number, w: DemoWallet) {
  const fromEarnings = w.address ? Math.min(w.claimable, total) : 0;
  const need = total - fromEarnings;
  return { fromEarnings, need, shortBy: Math.max(0, need - w.usdc), approved: need === 0 || w.allowance >= need };
}

// Turns an owner's chain history into one explained slash per round: what was taken, where it went, and why, from the Slashed, FailureConfirmed and NoRevealReported events JobMarket emits for that round.
import type { OwnerEvent } from "@/lib/api/types";

export type SlashReason = "noReveal" | "ReplayMismatch" | "DataUnavailable" | "ReplayDrift";

export type Slash = {
  key: string;
  job: number;
  round: number;
  at: number;
  /** Stake taken, in token units. 0 when the failure was confirmed but this job's rules take no stake for it. Null when the chain reported a slash without an amount. */
  taken: number | null;
  /** Half of a slash tops up the honest nodes' pay; the rest stays locked for good. */
  toPot: number | null;
  burned: number | null;
  /** Null when the history holds the slash but not the event that says why. */
  reason: SlashReason | null;
  /** For a missed reveal: which miss in this job it was. Penalties grow with each one. */
  missed: number | null;
  tx: string;
};

const REASONS: SlashReason[] = ["noReveal", "ReplayMismatch", "DataUnavailable", "ReplayDrift"];
const num = (v: unknown) => (typeof v === "number" ? v : null);

/** Slashes for one operator, newest first. Events without a job and round cannot be placed and are skipped. */
export function slashesFor(events: OwnerEvent[], operator: string): Slash[] {
  const op = operator.toLowerCase();
  const rounds = new Map<string, OwnerEvent[]>();
  for (const e of events) {
    if (e.kind !== "slashed" && e.kind !== "failure" && e.kind !== "noReveal") continue;
    if (e.op?.toLowerCase() !== op || e.job === null || e.round === null) continue;
    const k = `${e.job}:${e.round}`;
    rounds.set(k, [...(rounds.get(k) ?? []), e]);
  }
  const out: Slash[] = [];
  for (const [key, evs] of rounds) {
    const slashed = evs.find((e) => e.kind === "slashed") ?? null;
    const failure = evs.find((e) => e.kind === "failure") ?? null;
    const miss = evs.find((e) => e.kind === "noReveal") ?? null;
    const kind = failure ? failure.detail?.kind : null;
    const reason: SlashReason | null = miss ? "noReveal" : REASONS.includes(kind as SlashReason) ? (kind as SlashReason) : null;
    const first = slashed ?? miss ?? failure!;
    out.push({
      key,
      job: first.job as number,
      round: first.round as number,
      at: Math.max(...evs.map((e) => e.at)),
      // A confirmed failure with no Slashed event took nothing: the contract skips the event when the amount is zero.
      taken: slashed ? slashed.amount : miss ? miss.amount : 0,
      toPot: slashed ? num(slashed.detail?.toPot) : null,
      burned: slashed ? num(slashed.detail?.burned) : null,
      reason,
      missed: miss ? num(miss.detail?.missed) : null,
      tx: first.tx,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Plain words for each reason: the headline, what happened, and how to keep it from happening again. */
export const REASON_COPY: Record<SlashReason, { title: string; what: string; avoid: string }> = {
  noReveal: {
    title: "Missed its reveal",
    what: "Your node committed to its work in this round but never revealed it before the window closed. That usually means it stopped, slept or lost its network mid-round.",
    avoid: "Stop the node with tod-node stop, which waits for the reveal. Keep the laptop awake and online while it is in a round.",
  },
  ReplayMismatch: {
    title: "Replay didn't match",
    what: "Two verifiers replayed a piece of your node's training and got different weights from the ones it revealed. The network treats this as broken or faked work.",
    avoid: "Run the released tod-node build as shipped. Don't change the training code, the shard or the seed.",
  },
  DataUnavailable: {
    title: "Upload couldn't be fetched",
    what: "The verifiers couldn't download the checkpoint your node revealed, so they had nothing to replay.",
    avoid: "Keep the node online until the round is final, so its upload stays reachable. A connection that drops during upload is the usual cause.",
  },
  ReplayDrift: {
    title: "Replay drifted",
    what: "The verifiers' replay came out close to your node's weights but not exact. Small numeric drift between machines can do this.",
    avoid: "Nothing to change on your side if it happens once. If it repeats, update tod-node and check the node's self-test.",
  },
};

/** Demo history: one of each kind a node owner is likely to meet, on the demo node's operator. */
export function demoSlashEvents(operator: string, now: number): OwnerEvent[] {
  const at = (days: number) => Math.round(now - days * 86400);
  const ev = (kind: OwnerEvent["kind"], job: number, round: number, amount: number | null, detail: Record<string, unknown> | null, days: number, i: number): OwnerEvent =>
    ({ kind, job, round, op: operator, amount, detail, block: 1000 + i, logIndex: i, tx: `0x${(i + 10).toString(16).padStart(64, "a")}`, at: at(days) });
  return [
    ev("noReveal", 7, 4, 200_000, { missed: 1 }, 1.2, 1),
    ev("slashed", 7, 4, 200_000, { toPot: 100_000, burned: 100_000 }, 1.2, 2),
    ev("failure", 6, 3, null, { kind: "DataUnavailable" }, 4.5, 3),
    ev("slashed", 6, 3, 2_000_000, { toPot: 1_000_000, burned: 1_000_000 }, 4.5, 4),
    ev("failure", 6, 1, null, { kind: "ReplayDrift" }, 6, 5),
  ];
}

// The recorded round /demo replays: four laptops, two verifiers, one lazy node caught by replay and one poisoner caught by detection.
import type { NodeResult } from "@/features/verify/NodeVerdict";
import { splitPay } from "@/lib/learn/pay";

export const U = 1_000_000;
export const DEMO_JOB = 12;
export const DEMO_ROUND = 7;
export const POT = 2 * U;
export const FLOOR = 0.2 * U;
export const FLAG_AT = 3;
export const REPLAY_SEGMENT = { n: 3, of: 8 };

export const HASH = {
  honest: "0x00d8bb8345e4139c87a7630153cbfa71403043e05e9f5edf15a0aa3de0c12024",
  lazy: "0x7b096d9314fe1bf685c70fc39bec15583472923af04bd0fea1dd8de55bbc1a57",
};

export type DemoNode = {
  key: "A" | "B" | "C" | "D";
  op: string;
  role: "honest" | "lazy" | "poison";
  /** Validation-loss reduction this node's update caused. Null when the update was excluded. */
  delta: number | null;
  /** Distance of the update from the median update, in median absolute deviations. */
  drift: number;
  commit: string;
  held: number;
};

export const NODES: DemoNode[] = [
  { key: "A", op: "0x3f1c9a07b2e4d1c08e5f6a7b9c0d1e2f3a4b5c6d", role: "honest", delta: 0.031, drift: 0.7, commit: "0x9e41c0a7d3b28f15e6a0c4d7b1f8e2a9c3d6b0f4e7a1c8d2b5f9e3a6c0d4b7e1", held: 6.4 * U },
  { key: "B", op: "0x8b22e4f1c7a90d3b5e6f1a2c4d8e0b9f7a3c5d1e", role: "honest", delta: 0.019, drift: 1.1, commit: "0x2b7f9e3a6c0d4b7e19e41c0a7d3b28f15e6a0c4d7b1f8e2a9c3d6b0f4e7a1c8d", held: 11.2 * U },
  { key: "C", op: "0xc05d7e2a9b1f4c8d3e6a0b5f2c9d1e7a4b8f3c6d", role: "lazy", delta: null, drift: 0.9, commit: "0x5e6a0c4d7b1f8e2a9c3d6b0f4e7a1c8d2b5f9e3a6c0d4b7e19e41c0a7d3b28f1", held: 3.1 * U },
  { key: "D", op: "0xd4a8f3c6e1b9027d5c8e3f6a1b4d7c0e9f2a5b8d", role: "poison", delta: null, drift: 4.6, commit: "0xa1c8d2b5f9e3a6c0d4b7e19e41c0a7d3b28f15e6a0c4d7b1f8e2a9c3d6b0f4e7", held: 2.4 * U },
];

const PAY = splitPay(NODES.map((n) => n.delta), POT, FLOOR);

/** Floor plus a share by loss reduction. The live contract still splits equally; this is the split the team is deciding on. */
export function payFor(n: DemoNode): number | null {
  return PAY[NODES.indexOf(n)] ?? null;
}

export const BEATS = ["train", "commit", "reveal", "replay", "detect", "settle", "done"] as const;
export type Beat = (typeof BEATS)[number];
export const BEAT_LABEL: Record<Beat, string> = { train: "Train", commit: "Commit", reveal: "Reveal", replay: "Replay", detect: "Detect", settle: "Pay", done: "Recap" };

export function resultFor(n: DemoNode, at: number): NodeResult {
  const replayed = at >= BEATS.indexOf("replay");
  const detected = at >= BEATS.indexOf("detect");
  if (!replayed) return "not-audited";
  if (n.role === "lazy") return "replay-failed";
  if (n.role === "poison" && detected) return "flagged";
  return "passed";
}

export const REASON: Record<DemoNode["role"], string> = {
  honest: "Both verifiers replayed segment 3 and got the same weights this node revealed, bit for bit. Its update also sat with the others, so it was merged and paid.",
  lazy: "This node's weights after step 412 didn't match the replay. It stopped training early and padded the rest. Usual honest causes are a different PyTorch build or the laptop sleeping mid-round; here it was neither.",
  poison: "The replay matched, so the work was really done. But this update pulled 4.6 times further from the median than a normal one, which is how a poisoned update looks. It was left out of the merge.",
};

// Example competitions for the read-only /competitions pages. Competitions are not on chain yet, so these are fixtures, but every score is reproducible: labels and predictions come from seeds, and the browser can rebuild and hash them.
import { mulberry32, sha256 } from "./replay";

export const ITEMS = 2000;
export const CLASSES = 10;

export type Entry = { op: string; seed: number; skill: number; scoreHash: string };
export type Competition = {
  id: string;
  title: string;
  task: string;
  host: string;
  status: "open" | "finished" | "unrevealed";
  prize: number;
  budget: number;
  /** Entry fee in TOD units. It joins the prize pool. */
  fee: number;
  deadline: string;
  /** Seed the example labels come from, so the browser can rebuild them; null when the host uploaded a real labels file. */
  labelsSeed: number | null;
  labelsHash: string;
  committedAt: number;
  entries: Entry[];
};

export function labelBytes(seed: number) {
  const rnd = mulberry32(seed);
  const out = new Uint8Array(ITEMS);
  for (let i = 0; i < ITEMS; i++) out[i] = Math.floor(rnd() * CLASSES);
  return out;
}

/** An entry's predictions: right with probability `skill`, otherwise a different class. */
export function predictionBytes(labels: Uint8Array, seed: number, skill: number) {
  const rnd = mulberry32(seed);
  return labels.map((y) => (rnd() < skill ? y : (y + 1 + Math.floor(rnd() * (CLASSES - 1))) % CLASSES));
}

export function correct(labels: Uint8Array, preds: Uint8Array) {
  let n = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] === preds[i]) n++;
  return n;
}

/** The record a scorer posts: competition, entrant, raw count and the labels it was scored against. Hashing it pins all four. */
export function scoreRecord(c: Pick<Competition, "id" | "labelsHash">, op: string, n: number) {
  return new TextEncoder().encode(`${c.id}|${op.toLowerCase()}|${n}/${ITEMS}|${c.labelsHash}`);
}

/** Only example competitions can rebuild their labels in the browser; a hosted one waits for its reveal. */
function seedOf(c: Competition) {
  if (c.labelsSeed === null) throw new Error(`${c.id} has no rebuildable labels until the host reveals them`);
  return c.labelsSeed;
}

export async function rescore(c: Competition, e: Entry, onStep?: (step: number, of: number) => void) {
  const labels = labelBytes(seedOf(c));
  onStep?.(1, 3);
  if ((await sha256(labels)) !== c.labelsHash) throw new Error("The revealed labels don't hash to the commitment.");
  await new Promise((r) => setTimeout(r, 160));
  const n = correct(labels, predictionBytes(labels, e.seed, e.skill));
  onStep?.(2, 3);
  await new Promise((r) => setTimeout(r, 160));
  onStep?.(3, 3);
  return { n, hash: await sha256(scoreRecord(c, e.op, n)) };
}

export function scoreOf(c: Competition, e: Entry) {
  const labels = labelBytes(seedOf(c));
  return correct(labels, predictionBytes(labels, e.seed, e.skill)) / ITEMS;
}

export const COMPETITIONS: Competition[] = [
  {
    id: "leaf-10",
    title: "Leaf disease, 10 classes",
    task: "Classify 2,000 held-out leaf photos into 10 disease classes. Accuracy on the hidden labels decides the ranking.",
    host: "0x6a1e4c2b9d0f37e85a1c6b4d2e9f0a3c7b5d8e1f",
    status: "finished",
    prize: 300_000_000,
    budget: 120_000_000,
    fee: 2_000_000,
    deadline: "2026-10-30T18:00:00Z",
    labelsSeed: 7101,
    labelsHash: "0x05d46a5d7d8e6f8588055e59f4fec477231723985a640dcfbc8f3839e85fca84",
    committedAt: 18_204_331,
    entries: [
      { op: "0x3f1c9a07b2e4d1c08e5f6a7b9c0d1e2f3a4b5c6d", seed: 11, skill: 0.912, scoreHash: "0x7812f7a3d36b3885543dc19a9351e7269980e5df0a164ee2ae10584e2723c88b" },
      { op: "0x8b22e4f1c7a90d3b5e6f1a2c4d8e0b9f7a3c5d1e", seed: 12, skill: 0.887, scoreHash: "0xbdd433391a55fc6bd919f10035af136f27410aac8e55051a912da4fff41c2bd3" },
      { op: "0xe7d2a9c4b1f8063e5d2a7c9b4e1f8a3d6c0b5e2a", seed: 13, skill: 0.861, scoreHash: "0x98bffc227c6d1e5671e5e07b948c0649aa5068334fc035c4bc8adb753af32d9f" },
      { op: "0x19b4f7e2a5c8d0b3e6f9a2c5d8e1b4a7f0c3d6e9", seed: 14, skill: 0.804, scoreHash: "0xef852abda97c9e7b3566228e24ab6400eef5c23dae334264896d702a4a405309" },
      { op: "0x5c8e1b4a7d0f3c6e9b2a5d8f1c4e7b0a3d6f9c2e", seed: 15, skill: 0.733, scoreHash: "0xe1c4788acdfda36acf49a78c933092a4ea6e509cc567cdcce7d3d544a48edd33" },
    ],
  },
  {
    id: "rice-yield",
    title: "Rice yield from field photos",
    task: "Sort 2,000 field photos into 10 yield bands. The host committed the labels before entries opened, so the answer key can't move.",
    host: "0x2d9f6a3c0e7b4d1a8f5c2e9b6d3a0f7c4e1b8d5a",
    status: "open",
    prize: 500_000_000,
    budget: 200_000_000,
    fee: 2_000_000,
    deadline: "2026-11-20T18:00:00Z",
    labelsSeed: 7202,
    labelsHash: "0x212936b1d717d1f7037eb3461c4e99b36be2c033d520ff55c4ecd386832c1d70",
    committedAt: 18_391_044,
    entries: [
      { op: "0x3f1c9a07b2e4d1c08e5f6a7b9c0d1e2f3a4b5c6d", seed: 21, skill: 0.84, scoreHash: "" },
      { op: "0xc05d7e2a9b1f4c8d3e6a0b5f2c9d1e7a4b8f3c6d", seed: 22, skill: 0.79, scoreHash: "" },
      { op: "0x8b22e4f1c7a90d3b5e6f1a2c4d8e0b9f7a3c5d1e", seed: 23, skill: 0.81, scoreHash: "" },
    ],
  },
  {
    id: "road-signs",
    title: "Road signs, Indian set",
    task: "Classify 2,000 road-sign crops into 10 classes. The host didn't reveal the labels in time.",
    host: "0x9a3c6f0d2b5e8a1c4f7d0b3e6a9c2f5d8b1e4a7c",
    status: "unrevealed",
    prize: 150_000_000,
    budget: 60_000_000,
    fee: 1_000_000,
    deadline: "2026-10-12T18:00:00Z",
    labelsSeed: 7303,
    labelsHash: "0x0fea04ef52ce9aec1fe59217601290b0481d649512c47bf249d1a80759a5662f",
    committedAt: 17_950_610,
    entries: [
      { op: "0xe7d2a9c4b1f8063e5d2a7c9b4e1f8a3d6c0b5e2a", seed: 31, skill: 0.7, scoreHash: "" },
      { op: "0x19b4f7e2a5c8d0b3e6f9a2c5d8e1b4a7f0c3d6e9", seed: 32, skill: 0.66, scoreHash: "" },
    ],
  },
];

export const competition = (id: string) => COMPETITIONS.find((c) => c.id === id) ?? null;

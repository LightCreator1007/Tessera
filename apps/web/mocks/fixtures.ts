// Demo data shaped exactly like the coordinator responses. Shown only when NEXT_PUBLIC_COORDINATOR_URL is unset, always under a "Demo data" label.
import type { Settlement, Draft, DraftRequest, ModelRecord, Workload,
  Config, Evidence, Health, Job, JobState, Node, NodeChain, Pool, Round, RoundStatus, RoundSummary, RoundVerdicts,
} from "@/lib/api/types";
import { toF64 } from "@/lib/api/metric";

function hex(seed: string, len = 64): string {
  let h = 2166136261;
  let out = "";
  while (out.length < len) {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    h = Math.imul(h ^ out.length, 2246822519);
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return "0x" + out.slice(0, len);
}
const addr = (s: string) => hex("addr" + s, 40);

export const OPS = ["ravi", "mei", "otto", "ines", "kofi", "lena", "tariq", "yuki"].map((n) => ({ name: n, op: addr(n) }));
const VERIFIERS = [addr("verifier-a"), addr("verifier-b")];
const REQ = [addr("req-lab"), addr("req-class"), addr("req-solo")];
const TOD = 1_000_000;
const NOW = Date.UTC(2026, 10, 4, 14, 0, 0) / 1000;

export const config: Config = {
  chainId: 84532,
  coordinator: addr("coordinator"),
  jobMarket: addr("jobmarket"),
  nodeRegistry: addr("registry"),
  threshold: 2,
  token: addr("usdc"),
  verifiers: VERIFIERS,
};
export const health: Health = { block: 18_204_551, chainId: 84532, ok: true, storeOk: true, version: "0.1.0" };
export const pool: Pool = { online: 6, idle: 3, busy: 3 };

export const jobs: Job[] = [
  { id: 7, workload: "mlp-exact", status: "running", trust: "chain", budget: 120 * TOD, remaining: 78.4 * TOD, rounds: 20, currentRound: 8, modelSpecHash: hex("spec7"), requester: REQ[0], stakePerNode: 5 * TOD },
  { id: 6, workload: "cnn-torch", status: "running", trust: "hash-checked", budget: 300 * TOD, remaining: 261 * TOD, rounds: 12, currentRound: 2, modelSpecHash: hex("spec6"), requester: REQ[1], stakePerNode: 10 * TOD },
  { id: 5, workload: "mlp-exact", status: "open", trust: "chain", budget: 40 * TOD, remaining: 40 * TOD, rounds: 8, currentRound: null, modelSpecHash: hex("spec5"), requester: REQ[2], stakePerNode: 2 * TOD,
    waiting: { since: Math.floor(Date.now() / 1000) - 40 * 60, eligible: 1, quorum: 3, blocked: { busy: 2, stake: 1, offline: 1 }, abandonAfter: Math.floor(Date.now() / 1000) - 60 } },
  { id: 4, workload: "mlp-exact", status: "completed", trust: "chain", budget: 60 * TOD, remaining: 0, rounds: 12, currentRound: 12, modelSpecHash: hex("spec4"), requester: REQ[0], stakePerNode: 5 * TOD,
    published: { round: 11, keccak: hex("agg4-11"), state: "indexed", arkivKey: hex("arkiv4"), arkivTx: hex("arkivtx4"), swarmRef: hex("swarm4").slice(2) } },
  { id: 3, workload: "cnn-torch", status: "abandoned", trust: "untrusted", budget: 90 * TOD, remaining: 61.2 * TOD, rounds: 10, currentRound: 3, modelSpecHash: hex("spec3"), requester: REQ[1], stakePerNode: 10 * TOD },
];

function lossCurve(job: number, n: number, start = 2.31, floor = 0.18): JobState["rounds"] {
  return Array.from({ length: n }, (_, i) => {
    const wobble = Math.sin(i * 1.7 + job) * 0.03;
    const v = floor + (start - floor) * Math.exp(-i / 3.2) + wobble;
    return { round: i + 1, metric: i === 4 && job === 7 ? null : toF64(v), seconds: 140 + ((i * 37 + job * 11) % 60) };
  });
}
export const jobStates: Record<number, JobState> = {
  7: { job: 7, trust: "chain", rounds: lossCurve(7, 7) },
  6: { job: 6, trust: "hash-checked", rounds: lossCurve(6, 1, 2.4) },
  5: { job: 5, trust: "chain", rounds: [] },
  4: { job: 4, trust: "chain", rounds: lossCurve(4, 12, 2.2, 0.11) },
  3: { job: 3, trust: "untrusted", rounds: lossCurve(3, 2, 2.4) },
};

function statusFor(job: Job, r: number): RoundStatus {
  if (job.id === 7) {
    if (r === 8) return "committing";
    if (r === 5) return "reverted";
    if (r === 6) return "fallback";
    return "finalized";
  }
  if (job.id === 6) return r === 2 ? "verifying" : "finalized";
  if (job.id === 3) return r === 3 ? "voided" : "finalized";
  return "finalized";
}

const CULPRIT: Record<string, string> = { "7-5": OPS[3].op, "6-2": OPS[6].op };
function rosterFor(job: number, r: number) {
  const size = job === 6 ? 5 : 4;
  const culprit = CULPRIT[`${job}-${r}`];
  const pool = OPS.map((o) => o.op).filter((op) => op !== culprit);
  const seats = Array.from({ length: size }, (_, i) => pool[(i + r + job) % pool.length]);
  if (culprit) seats[2] = culprit;
  return seats.map((op, shard) => ({ op, shard }));
}

export function roundsFor(job: Job): RoundSummary[] {
  const n = job.currentRound ?? 0; // rails-allow: fixture round count
  return Array.from({ length: n }, (_, i) => {
    const r = i + 1;
    const status = statusFor(job, r);
    const settled = status === "finalized" || status === "fallback";
    return { round: r, status, startHash: hex(`start${job.id}-${r}`), aggregateHash: settled ? hex(`agg${job.id}-${r}`) : null };
  }).reverse();
}

export function roundFor(job: Job, r: number): Round | null {
  const s = roundsFor(job).find((x) => x.round === r);
  if (!s) return null;
  const roster = rosterFor(job.id, r);
  const ops = roster.map((x) => x.op);
  const committed = s.status === "committing" ? ops.slice(0, 2) : ops;
  const revealed = s.status === "committing" ? [] : s.status === "reverted" ? ops.slice(0, 3) : ops;
  const settled = s.status === "finalized" || s.status === "fallback";
  const perNode = Math.round(((job.budget - job.remaining) / Math.max(1, job.currentRound ?? 1)) / roster.length);
  return {
    ...s,
    job: job.id,
    seed: s.status === "committing" ? null : hex(`seed${job.id}-${r}`),
    outcome: settled ? "Accepted" : s.status === "reverted" ? "Reverted" : null,
    committed,
    revealed,
    roster,
    payouts: settled ? ops.map((op, i) => ({ op, amount: perNode + i * 1300 })) : [],
    confirmed: [],
    trust: job.trust,
  };
}

/** Settlement exists from verifying on; finalized rounds carry both co-signatures, a fallback round only one. */
export function settlementFor(job: Job, r: number): Settlement | null {
  const round = roundFor(job, r);
  if (!round || !["verifying", "finalized", "fallback", "reverted"].includes(round.status)) return null;
  const collected = round.status === "finalized" || round.status === "reverted" ? 2 : 1;
  return {
    jobId: job.id,
    roundId: r,
    outcome: round.status === "reverted" ? 1 : 0,
    aggregateHash: round.aggregateHash ?? hex(`agg${job.id}-${r}`),
    flaggedBitmap: round.status === "reverted" ? 4 : 0,
    aggEvidenceHash: hex(`aggev${job.id}-${r}`),
    payEvidenceHash: hex(`payev${job.id}-${r}`),
    payoutsHash: hex(`payouts${job.id}-${r}`),
    payouts: round.payouts,
    digest: hex(`digest${job.id}-${r}`),
    collected,
  };
}

export function verdictsFor(job: Job, r: number): RoundVerdicts {
  const s = roundsFor(job).find((x) => x.round === r)?.status;
  if (s === "committing" || s === "revealing" || s === "open") return VERIFIERS.map((v) => ({ verifier: v, verdict: "pending" }));
  if (s === "verifying") return [{ verifier: VERIFIERS[0], verdict: "pass" }, { verifier: VERIFIERS[1], verdict: "fail", target: rosterFor(job.id, r)[2].op }];
  if (s === "reverted") return VERIFIERS.map((v) => ({ verifier: v, verdict: "fail", target: rosterFor(job.id, r)[2].op }));
  if (s === "fallback") return [{ verifier: VERIFIERS[0], verdict: "pass" }, { verifier: VERIFIERS[1], verdict: "absent" }];
  return VERIFIERS.map((v) => ({ verifier: v, verdict: "pass" }));
}

export function evidenceFor(job: Job, r: number): Evidence | null {
  const round = roundFor(job, r);
  if (!round) return null;
  const settled = round.aggregateHash !== null;
  const ref = (k: string) => ({ hash: hex(k), url: `/v1/blobs/${hex(k)}` });
  return {
    job: job.id,
    round: r,
    trust: job.trust,
    aggregate: settled ? ref(`agg${job.id}-${r}`) : null,
    pay: settled ? ref(`pay${job.id}-${r}`) : null,
    reports: round.status === "committing" ? [] : verdictsFor(job, r).filter((v) => v.verdict !== "absent" && v.verdict !== "pending").map((v) => ref(`rep${job.id}-${r}-${v.verifier}`)),
  };
}

export const nodes: Node[] = OPS.map((o, i) => ({
  op: o.op,
  arch: i === 7 ? null : i % 3 === 0 ? "arm64 / M2" : "x86_64 / RTX 3060",
  online: i < 6,
  idle: i === 1 || i === 3 || i === 4,
  version: "0.1.0",
  workloads: i % 2 ? ["mlp-exact", "cnn-torch"] : ["mlp-exact"],
  prewarm: { image: null, datasets: [] },
}));

function historyFor(op: string): NodeChain["history"] {
  return jobs.flatMap((j) =>
    roundsFor(j)
      .slice()
      .reverse()
      .filter((r) => rosterFor(j.id, r.round).some((x) => x.op === op))
      .map((r) => {
        const culprit = CULPRIT[`${j.id}-${r.round}`] === op;
        const result: NodeChain["history"][number]["result"] =
          culprit && (r.status === "reverted" || r.status === "verifying") ? "slashed"
          : r.status === "finalized" ? "paid"
          : r.status === "fallback" ? "fallback"
          : r.status === "reverted" ? "reverted"
          : r.status === "voided" ? "voided"
          : "live";
        return { job: j.id, round: r.round, result };
      }),
  );
}

export const nodeChain: Record<string, NodeChain> = Object.fromEntries(
  OPS.map((o, i) => [
    o.op,
    {
      op: o.op,
      stake: i === 6 ? 2 * TOD : i === 7 ? null : 10 * TOD,
      graduated: i < 5,
      joinedAt: NOW - (i < 5 ? 30 : 0.4 + i * 0.1) * 86400,
      graduatedAt: i < 5 ? NOW - 23 * 86400 : null,
      probationSeconds: 7 * 86400,
      verifiedWorkSeconds: i < 5 ? 86_000 - i * 9000 : 2400 * (i - 4),
      missedReveals: i === 3 ? 2 : 0,
      earned: i === 7 ? null : 41.3 * TOD - i * 4.1 * TOD,
      penalties:
        i === 3
          ? [
              { job: 7, round: 5, kind: "Slashed", amount: 2.5 * TOD, at: NOW - 3600 * 5 },
              { job: 3, round: 2, kind: "NoReveal", amount: null, at: NOW - 86400 * 3 },
            ]
          : i === 6
            ? [{ job: 6, round: 2, kind: "Slashed", amount: 8 * TOD, at: NOW - 600 }]
            : [],
      history: historyFor(o.op),
    },
  ]),
);

export const DEMO_NOW = NOW;

export const workloads: Workload[] = [
  { id: "mlp-exact/1", replayClass: "exact", defaults: { epochs: 1, batch: 64, lr: 0.05 }, tier: "core" },
  { id: "cnn-torch/1", replayClass: "tolerance", defaults: { epochs: 1, batch: 32, lr: 0.01 }, tier: "stretch" },
];

export const models: ModelRecord[] = jobs.filter((j) => j.published?.state === "indexed").map((j) => ({
  arkivKey: j.published!.arkivKey!,
  owner: addr("arkiv-writer"),
  expiresAt: NOW + 30 * 86400,
  job: j.id,
  round: j.published!.round,
  keccak: j.published!.keccak,
  size: 407_552,
  chainId: config.chainId,
  jobMarket: config.jobMarket,
  workload: j.workload,
  datasetHash: hex(`dataset${j.id}`),
  url: null,
  swarmRef: j.published!.swarmRef ?? null,
}));

export function specFor(job: Job): Record<string, unknown> {
  return { workload: job.workload, rounds: job.rounds, shards: 4, batch: 64, lr: 0.05, dataset: { id: "mnist", hash: hex(`dataset${job.id}`) } };
}

export function draftFor(req: DraftRequest): Draft {
  const spec = { workload: req.workload, dataset: req.datasetHash, epochs: req.epochs, minQuorum: req.minQuorum ?? 3, maxPerRound: req.maxPerRound ?? 6, ...req.overrides };
  return {
    spec,
    modelSpecHash: hex(`draft-spec${JSON.stringify(spec)}`),
    initialWeightsHash: hex(`draft-w${req.workload}`),
    windows: { commit: 600, reveal: 300, verify: 600 },
    minStake: 5 * TOD,
    createJobCalldata: hex(`calldata${req.budget}`, 200),
  };
}

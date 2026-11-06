// Response shapes from services/coordinator/openapi.json (components.schemas), plus the chain-read shapes the web needs. Kept by hand until gen:api runs in CI.
export type Trust = "chain" | "hash-checked" | "untrusted";
export type JobStatus = "open" | "running" | "completed" | "abandoned" | "invalid";
export type RoundStatus =
  | "open"
  | "committing"
  | "revealing"
  | "verifying"
  | "finalized"
  | "reverted"
  | "voided"
  | "fallback";

export type Config = {
  chainId: number;
  coordinator: string;
  jobMarket: string;
  nodeRegistry: string;
  threshold: number;
  token: string;
  verifiers: string[];
};
export type Health = { block: number | null; chainId: number; ok: boolean; storeOk: boolean; version: string };
export type Job = {
  id: number;
  budget: number;
  remaining: number;
  currentRound: number | null;
  rounds: number;
  modelSpecHash: string;
  requester: string;
  stakePerNode: number;
  status: JobStatus;
  trust: Trust;
  workload: string;
  /** Why the job isn't opening rounds. Absent on coordinators that don't report it; null while rounds open normally. */
  waiting?: Waiting | null;
  /** Where the final model is indexed on Arkiv. Absent on coordinators without Arkiv; null until the job completes. */
  published?: Published | null;
};
/** The coordinator's read on a stuck job: seats it can fill against seats it needs, what holds the other nodes back, and when anyone may abandon it. Times are unix seconds. */
export type Waiting = { since: number; eligible: number; quorum: number; blocked: Partial<Record<BlockReason, number>>; abandonAfter: number };
export type BlockReason = "notJoined" | "stake" | "offline" | "busy" | "selftest" | "benched" | "credential" | "sameOwner";
/** GET /v1/owners/{owner}/history: chain events that moved an owner's money or standing, newest first. Amounts in token units, times in unix seconds. */
export type OwnerEvent = {
  kind: "joined" | "paid" | "claimed" | "leftover" | "forfeited" | "slashed" | "failure" | "noReveal" | "staked" | "unstaked" | "budget" | "refund";
  job: number | null;
  round: number | null;
  op: string | null;
  amount: number | null;
  detail: Record<string, unknown> | null;
  block: number;
  logIndex: number;
  tx: string;
  at: number;
};
/** GET /v1/identity/owners/{owner}: whether the owner joined with World ID, and any team exclusion with the confirmed failures behind it. */
export type OwnerIdentity = {
  owner: string;
  joined: boolean;
  credential: string | null;
  excluded: { reason: string; evidence: { job: number; round: number; operator: string; kind: string }[]; at: number } | null;
};
export type OwnerHistory = { owner: string; operators: string[]; events: OwnerEvent[]; next: string | null; indexedTo: number | null };
export type Published = {
  round: number;
  keccak: string;
  state: "pending" | "indexed" | "failed";
  arkivKey: string | null;
  arkivTx: string | null;
  /** 64 hex, no 0x: the model's bytes on Swarm, when Swarm is on. */
  swarmRef?: string | null;
};
/** GET /v1/models: one record read straight from Arkiv, not from the coordinator's own tables. */
export type ModelRecord = {
  arkivKey: string;
  owner: string;
  expiresAt: number;
  job: number;
  round: number;
  keccak: string;
  size: number;
  chainId: number;
  jobMarket: string;
  workload: string | null;
  datasetHash: string | null;
  url: string | null;
  swarmRef: string | null;
};
export type Workload = { id: string; replayClass: "exact" | "tolerance"; defaults: Record<string, unknown>; tier: "core" | "stretch" };
export type DraftRequest = { workload: string; datasetHash: string; /** Leave out: the draft prices the job from its spec. */ budget?: number; epochs: number; minQuorum?: number; maxPerRound?: number; overrides?: Record<string, unknown> };
export type Draft = { spec: Record<string, unknown>; modelSpecHash: string; initialWeightsHash: string; windows: Record<string, number>; /** Token units createJobCalldata asks for; 1 TOD pays for at least 1 Gop. */ budget: number; /** Float ops the budget buys: rounds x minQuorum x ops per node per round. */ computeOps: number; minStake: number; createJobCalldata: string };
/** The spec bytes as served, parsed, plus whether their keccak matches the job's on-chain modelSpecHash. */
export type Spec = { spec: Record<string, unknown>; keccak: string; matches: boolean };
export type RoundState = { round: number; metric: string | null; seconds: number | null };
export type JobState = { job: number; rounds: RoundState[]; trust: Trust };
export type Seat = { op: string; shard: number };
export type Payout = { op: string; amount: number };
export type RoundSummary = { round: number; status: RoundStatus; startHash: string; aggregateHash: string | null };
export type Round = RoundSummary & {
  job: number;
  seed: string | null;
  outcome: "Accepted" | "Reverted" | null;
  committed: string[];
  revealed: string[];
  roster: Seat[];
  payouts: Payout[];
  confirmed: Record<string, unknown>[];
  trust: Trust;
};
/** GET /v1/jobs/{id}/rounds/{r}/settlement: what the coordinator will post, and how many verifiers co-signed it so far. */
export type Settlement = {
  jobId: number;
  roundId: number;
  outcome: number; // contract enum: 0 Accepted, 1 Reverted
  aggregateHash: string;
  flaggedBitmap: number;
  aggEvidenceHash: string;
  payEvidenceHash: string;
  payoutsHash: string;
  payouts: Payout[];
  digest: string;
  collected: number;
};
export type EvidenceRef = { hash: string; url: string };
export type Evidence = {
  job: number;
  round: number;
  aggregate: EvidenceRef | null;
  pay: EvidenceRef | null;
  reports: EvidenceRef[];
  trust: Trust;
};
export type Node = {
  op: string;
  arch: string | null;
  idle: boolean;
  online: boolean;
  version: string;
  workloads: string[];
  prewarm: { image: string | null; datasets: string[] };
};
export type Pool = { online: number; idle: number; busy: number };

// Chain reads (JobMarket events, NodeRegistry.getNode). Demo-only until a chain is wired.
export type Verdict = "pass" | "fail" | "pending" | "absent";
export type RoundVerdicts = { verifier: string; verdict: Verdict; target?: string }[];
export type NodeChain = {
  op: string;
  stake: number | null;
  graduated: boolean;
  joinedAt: number;
  graduatedAt: number | null;
  probationSeconds: number;
  verifiedWorkSeconds: number;
  missedReveals: number;
  earned: number | null;
  penalties: { job: number; round: number; kind: "Slashed" | "NoReveal"; amount: number | null; at: number }[];
  /** Every round this node sat in, from RoundStarted rosters and settlement events. */
  history: { job: number; round: number; result: NodeRoundResult }[];
};
export type NodeRoundResult = "paid" | "fallback" | "slashed" | "reverted" | "voided" | "live";

// The local node, read through /api/node (apps/node/src/tod_node/api.py on :7777).
export type NodeEvent = { seq: number; ts: number; type: string; job: number | null; round: number | null; data: Record<string, unknown> };
export type NodeStatus = {
  dataDir: string;
  initialized: boolean;
  operator: string | null;
  daemon: { state: "running" | "stopped"; pid: number | null };
  lastEvent: NodeEvent | null;
  /** Reveals the running daemon owes right now. Null from a node that can't tell (CLI status, older builds). */
  owed?: OwedReveal[] | null;
};
/** A committed round whose reveal hasn't landed: stopping before it does costs `penalty` token units of stake. */
export type OwedReveal = { job: number; round: number; commitDeadline: number | null; revealDeadline: number | null; missed: number; penalty: number | null };
export type NodeHealth = { ok: boolean; loopAgeSeconds: number | null };

export type Source = "live" | "demo";
export type Sourced<T> = { data: T; source: Source };

/** GET /v1/competitions: one competition as the Competitions contract has it. Scores are counted onchain. */
export type LiveCompetition = {
  id: number; host: string; title: string; task: string; dataset: string; prize: number; deadline: number; revealWindow: number; items: number;
  labelsHash: string; status: "open" | "awaiting-labels" | "labels-hidden" | "refundable" | "scoring" | "ready-to-settle" | "settled";
  entries: number; entrants: string[]; scored: number; labelsRevealedAt: number | null;
  leaderboard: { entrant: string; score: number }[]; winner: string | null; bestScore: number | null;
  settled: { to: string; amount: number; refunded: boolean } | null; sharesPaid: number; createdBlock: number;
  /** Arkiv entity keys for this competition's listing and, once settled, its result; null when publishing is off. */
  arkiv?: { listing?: string; result?: string } | null;
};

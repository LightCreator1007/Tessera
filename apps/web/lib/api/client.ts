// Coordinator reads. Uses the live coordinator when NEXT_PUBLIC_COORDINATOR_URL is set, otherwise the demo fixtures; every result carries its source so the UI can label it.
// Live reads go to /api/coord on this origin and next.config rewrites them to the coordinator, which sends no CORS headers.
import * as fx from "@/mocks/fixtures";
import type {
  Config, Evidence, Health, Job, JobState, Node, NodeChain, Pool, Round, RoundSummary, RoundVerdicts, Settlement, Sourced,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_COORDINATOR_URL ? "/api/coord" : undefined;
export const isDemo = !BASE;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(path: string): Promise<Sourced<T>> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `${res.status} on ${path}`);
  return { data: (await res.json()) as T, source: "live" };
}

const demoDelay = () => new Promise((r) => setTimeout(r, 250 + Math.random() * 350));
// Base Sepolia makes a block every 2 s; the demo chain keeps that pace so the sidebar block counter ticks.
const DEMO_T0 = Date.now();
const demoBlock = () => (fx.health.block === null ? null : fx.health.block + Math.floor((Date.now() - DEMO_T0) / 2000));
async function demo<T>(make: () => T | null, what: string): Promise<Sourced<T>> {
  await demoDelay();
  const data = make();
  if (data === null) throw new ApiError(404, `${what} not found`);
  return { data, source: "demo" };
}

const findJob = (id: number) => fx.jobs.find((j) => j.id === id) ?? null;

export const api = {
  config: () => (BASE ? get<Config>("/v1/config") : demo(() => fx.config, "config")),
  health: () => (BASE ? get<Health>("/v1/health") : demo(() => ({ ...fx.health, block: demoBlock() }), "health")),
  pool: () => (BASE ? get<Pool>("/v1/pool") : demo(() => fx.pool, "pool")),
  jobs: () => (BASE ? get<Job[]>("/v1/jobs") : demo(() => fx.jobs, "jobs")),
  job: (id: number) => (BASE ? get<Job>(`/v1/jobs/${id}`) : demo(() => findJob(id), `Job ${id}`)),
  jobState: (id: number) => (BASE ? get<JobState>(`/v1/jobs/${id}/state`) : demo(() => fx.jobStates[id] ?? null, `Job ${id}`)),
  rounds: (id: number) =>
    BASE ? get<RoundSummary[]>(`/v1/jobs/${id}/rounds`) : demo(() => { const j = findJob(id); return j ? fx.roundsFor(j) : null; }, `Job ${id}`),
  round: (id: number, r: number) =>
    BASE ? get<Round>(`/v1/jobs/${id}/rounds/${r}`) : demo(() => { const j = findJob(id); return j ? fx.roundFor(j, r) : null; }, `Round ${r}`),
  evidence: (id: number, r: number) =>
    BASE ? get<Evidence>(`/v1/jobs/${id}/rounds/${r}/evidence`) : demo(() => { const j = findJob(id); return j ? fx.evidenceFor(j, r) : null; }, `Round ${r}`),
  settlement: (id: number, r: number) =>
    BASE
      ? get<Settlement>(`/v1/jobs/${id}/rounds/${r}/settlement`)
      : demo(() => { const j = findJob(id); return j ? fx.settlementFor(j, r) : null; }, `Round ${r}`),
  spec: (id: number) =>
    BASE
      ? get<Record<string, unknown>>(`/v1/jobs/${id}/spec`)
      : demo(() => { const j = findJob(id); return j ? { workload: j.workload, rounds: j.rounds, shards: 4, batch: 64, lr: 0.05, dataset: { id: "mnist", hash: j.modelSpecHash } } : null; }, `Job ${id}`),
  nodes: () => (BASE ? get<Node[]>("/v1/nodes") : demo(() => fx.nodes, "nodes")),
  // Chain reads below have no coordinator route; they come from JobMarket and NodeRegistry. Demo until lib/chain wires getLogs.
  verdicts: (id: number, r: number) => demo<RoundVerdicts>(() => { const j = findJob(id); return j ? fx.verdictsFor(j, r) : null; }, `Round ${r}`),
  nodeChain: (op: string) => demo<NodeChain>(() => fx.nodeChain[op.toLowerCase()] ?? fx.nodeChain[op] ?? null, "Node"),
};

// Coordinator reads. Uses the live coordinator when NEXT_PUBLIC_COORDINATOR_URL is set, otherwise the demo fixtures; every result carries its source so the UI can label it.
// Live reads go to /api/coord on this origin and next.config rewrites them to the coordinator, which sends no CORS headers.
import { keccak256 } from "viem";
import * as fx from "@/mocks/fixtures";
import type {
  Draft, DraftRequest, ModelRecord, NodeEvent, NodeHealth, NodeStatus, Spec, Workload,
  Config, Evidence, Health, Job, JobState, Node, NodeChain, Pool, Round, RoundSummary, RoundVerdicts, Settlement, Sourced,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_COORDINATOR_URL ? "/api/coord" : undefined;
export const isDemo = !BASE;

export type ErrorKind = "not_found" | "off" | "upstream" | "unreachable" | "bad_input" | "server";

/** A failed read, sorted into what the UI says about it: missing, switched off, a broken upstream, or no answer at all. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
  get kind(): ErrorKind {
    if (this.status === 0) return "unreachable";
    if (this.status === 404 || this.status === 409) return "not_found";
    if (this.status === 503) return "off";
    if (this.status === 502 || this.status === 504) return "upstream";
    if (this.status >= 400 && this.status < 500) return "bad_input";
    return "server";
  }
}

export const TIMEOUT_MS = 10_000;

/** fetch with a deadline; a hung coordinator becomes an "unreachable" error instead of a skeleton that never ends. */
export async function request(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiError(0, `no answer from ${url}`);
  }
}

async function get<T>(path: string): Promise<Sourced<T>> {
  const res = await request(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `${res.status} on ${path}`);
  try {
    return { data: (await res.json()) as T, source: "live" };
  } catch {
    throw new ApiError(502, `${path} did not return JSON`);
  }
}

async function getBytes(path: string): Promise<Sourced<Uint8Array>> {
  const res = await request(`${BASE}${path}`);
  if (!res.ok) throw new ApiError(res.status, `${res.status} on ${path}`);
  return { data: new Uint8Array(await res.arrayBuffer()), source: "live" };
}

async function post<T>(path: string, body: unknown): Promise<Sourced<T>> {
  const res = await request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(res.status, (await res.text().catch(() => "")) || `${res.status} on ${path}`);
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
  // The spec bytes are untrusted until their keccak matches the job's modelSpecHash on chain.
  spec: async (id: number, want: string): Promise<Sourced<Spec>> => {
    if (!BASE) return demo(() => { const j = findJob(id); return j ? { spec: fx.specFor(j), keccak: j.modelSpecHash, matches: true } : null; }, `Job ${id}`);
    const raw = await getBytes(`/v1/jobs/${id}/spec`);
    const keccak = keccak256(raw.data);
    let spec: Record<string, unknown>;
    try {
      spec = JSON.parse(new TextDecoder().decode(raw.data)) as Record<string, unknown>;
    } catch {
      throw new ApiError(502, "the spec is not JSON");
    }
    return { data: { spec, keccak, matches: keccak.toLowerCase() === want.toLowerCase() }, source: "live" };
  },
  workloads: () => (BASE ? get<Workload[]>("/v1/workloads") : demo(() => fx.workloads, "workloads")),
  // 503 when the coordinator has Arkiv off, 502 when Arkiv itself failed to answer.
  models: () => (BASE ? get<ModelRecord[]>("/v1/models") : demo(() => fx.models, "models")),
  draft: (req: DraftRequest) => (BASE ? post<Draft>("/v1/jobs/draft", req) : demo(() => fx.draftFor(req), "draft")),
  nodes: () => (BASE ? get<Node[]>("/v1/nodes") : demo(() => fx.nodes, "nodes")),
  // Chain reads below have no coordinator route; they come from JobMarket and NodeRegistry. Demo until lib/chain wires getLogs.
  verdicts: (id: number, r: number) => demo<RoundVerdicts>(() => { const j = findJob(id); return j ? fx.verdictsFor(j, r) : null; }, `Round ${r}`),
  nodeChain: (op: string) => demo<NodeChain>(() => fx.nodeChain[op.toLowerCase()] ?? fx.nodeChain[op] ?? null, "Node"),
};

/** URL of a published model's bytes. Clients check the keccak themselves; X-Keccak says which hash to expect. */
export const modelUrl = (keccak: string) => (BASE ? `${BASE}/v1/models/${keccak}` : null);

// The node on this machine, through the same-origin bridge in app/api/node. Never demo: no node means no node.
async function nodeGet<T>(path: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await request(`/api/node/${path}`, { cache: "no-store" }, timeoutMs);
  const body = await res.text();
  if (!res.ok) throw new NodeError(res.status, codeOf(body));
  return JSON.parse(body) as T;
}
const codeOf = (body: string) => { try { return String((JSON.parse(body) as { code?: string }).code ?? "unknown"); } catch { return "unknown"; } };

/** A bridge error keeps the node's own code: node_unreachable, no_local_node, cli_not_found, bad_token... */
export class NodeError extends ApiError {
  constructor(status: number, public code: string) {
    super(status, code);
  }
}

export const node = {
  status: () => nodeGet<NodeStatus>("status"),
  // 503 from the node means its loop has not ticked for 30 s; the body still says how long.
  health: async (): Promise<NodeHealth> => {
    const res = await request("/api/node/health", { cache: "no-store" });
    const body = await res.text();
    if (res.status === 503) return { ...(JSON.parse(body) as NodeHealth), ok: false };
    if (!res.ok) throw new NodeError(res.status, codeOf(body));
    return JSON.parse(body) as NodeHealth;
  },
  /** Long-poll: resolves when events past `since` exist or after `wait` seconds. NDJSON, one event per line. */
  events: async (since: number, wait = 20): Promise<NodeEvent[]> => {
    const res = await request(`/api/node/events?since=${since}&wait=${wait}`, { cache: "no-store" }, (wait + 10) * 1000);
    const body = await res.text();
    if (!res.ok) throw new NodeError(res.status, codeOf(body));
    return body.split("\n").filter(Boolean).map((l) => JSON.parse(l) as NodeEvent);
  },
  stop: async (): Promise<void> => {
    const res = await request("/api/node/stop", { method: "POST", cache: "no-store" });
    if (!res.ok) throw new NodeError(res.status, codeOf(await res.text()));
  },
};

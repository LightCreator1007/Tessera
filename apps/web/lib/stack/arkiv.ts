// Reads Tessera's public Arkiv records (models, shard lists, competitions) and the chain head, through the /api/arkiv proxy.
import { useQuery } from "@tanstack/react-query";

/** The coordinator's Arkiv writer. Readers must filter on it, since anyone can write any tag. */
export const ARKIV_WRITER = (process.env.NEXT_PUBLIC_ARKIV_WRITER || "0x8Bb9FE30662594A7b7c193100bf92696Abb9c200").toLowerCase();
export const ARKIV_EXPLORER = (process.env.NEXT_PUBLIC_ARKIV_EXPLORER || "https://rabdi.explorer.arkiv.network").replace(/\/$/, "");
export const BLOCK_SECONDS = 2;

export type Schema = "tod.model" | "tod.shards" | "tod.competition" | "tod.competition.result";
export const SCHEMAS: Schema[] = ["tod.shards", "tod.model", "tod.competition", "tod.competition.result"];
export const SCHEMA_LABEL: Record<Schema, string> = {
  "tod.shards": "Shard list",
  "tod.model": "Final model",
  "tod.competition": "Competition",
  "tod.competition.result": "Result",
};

export type Piece = { part: "train" | "val"; shard?: number; piece: number; start: number; len: number; keccak: string; size: number; swarmRef?: string };
export type Entity = {
  key: string;
  schema: Schema;
  owner: string;
  createdAt: number;
  expiresAt: number;
  attrs: Record<string, string | number>;
  /** The payload attribute decoded as JSON, or null when absent or not JSON. */
  payload: Record<string, unknown> | null;
};
export type Head = { block: number; at: number; seconds: number };

export class ArkivError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/arkiv", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params }) });
  } catch {
    throw new ArkivError("arkiv_unreachable");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ArkivError(body?.code ?? "arkiv_error");
  if (body?.error) throw new ArkivError(String(body.error.message ?? "arkiv_error"));
  return body.result as T;
}

const num = (v: string | number) => (typeof v === "number" ? v : v.startsWith("0x") ? parseInt(v, 16) : Number(v));
const bytesToText = (hex: string) => new TextDecoder().decode(Uint8Array.from((hex.slice(2).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16))));

type Raw = { key: string; owner: string; createdAt: string; expiresAt: string; attributes: { name: string; type: string; value: string }[] };

export function decode(r: Raw): Entity {
  const attrs: Record<string, string | number> = {};
  let payload: Entity["payload"] = null;
  for (const a of r.attributes ?? []) {
    if (a.name === "payload") {
      try {
        payload = JSON.parse(bytesToText(a.value));
      } catch {
        payload = null;
      }
    } else attrs[a.name] = a.type === "u64" ? num(a.value) : a.value;
  }
  return { key: r.key, schema: String(attrs["arkiv.schema"]) as Schema, owner: r.owner, createdAt: num(r.createdAt), expiresAt: num(r.expiresAt), attrs, payload };
}

/** The query string a reader can paste into arkiv_query to get the same records. */
export const queryFor = (schema?: Schema) => (schema ? `arkiv.schema = str('${schema}') AND ` : "") + `$owner = addr(${ARKIV_WRITER})`;

export const curlFor = (q: string) =>
  `curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["${q}",{"select":{"key":true,"expiresAt":true,"attributes":true},"limit":"0x40"}]}'`;

export async function records(): Promise<Entity[]> {
  const out: Entity[] = [];
  // Page through everything the writer has live; it is tens of records, so a few pages at most.
  for (let offset = 0; offset < 400; offset += 100) {
    const res = await rpc<{ data: Raw[] }>("arkiv_query", [queryFor(), { select: { key: true, owner: true, createdAt: true, expiresAt: true, attributes: true }, limit: "0x64", offset: "0x" + offset.toString(16) }]);
    const page = (res?.data ?? []).map(decode).filter((e) => SCHEMAS.includes(e.schema));
    out.push(...page);
    if ((res?.data ?? []).length < 100) break;
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function head(): Promise<Head> {
  const t = await rpc<{ current_block: number; current_block_time: number; duration: number }>("arkiv_getBlockTiming", []);
  return { block: t.current_block, at: t.current_block_time, seconds: t.duration || BLOCK_SECONDS };
}

export const useArkivRecords = () => useQuery({ queryKey: ["arkiv", "records"], queryFn: records, refetchInterval: 20_000, retry: 1 });
export const useArkivHead = () => useQuery({ queryKey: ["arkiv", "head"], queryFn: head, refetchInterval: 6_000, retry: 1 });

/** The head block right now, projected from the last read so the clock ticks between polls. */
export function projectBlock(h: Head | undefined, nowMs: number) {
  if (!h) return null;
  return h.block + Math.max(0, Math.floor((nowMs / 1000 - h.at) / h.seconds));
}

export const pieces = (e: Entity): Piece[] => (Array.isArray(e.payload?.pieces) ? (e.payload.pieces as Piece[]) : []);

/** One job's records on one JobMarket: its shard list and its final model, either of which may be missing. */
export type JobTrail = { id: string; job: number; jobMarket: string; chainId: number; datasetHash: string | null; shards: Entity | null; model: Entity | null };

export function trails(es: Entity[]): JobTrail[] {
  const by = new Map<string, JobTrail>();
  for (const e of es) {
    if (e.schema !== "tod.shards" && e.schema !== "tod.model") continue;
    const jm = String(e.attrs.jobMarket ?? "");
    const id = `${jm}:${e.attrs.job}`;
    const t = by.get(id) ?? { id, job: Number(e.attrs.job), jobMarket: jm, chainId: Number(e.attrs.chainId), datasetHash: null, shards: null, model: null };
    if (e.schema === "tod.shards") t.shards = e;
    else t.model = e;
    t.datasetHash ??= (e.attrs.datasetHash as string) ?? null;
    by.set(id, t);
  }
  // Jobs with both halves first, then newest.
  return [...by.values()].sort((a, b) => Number(!!b.model && !!b.shards) - Number(!!a.model && !!a.shards) || b.job - a.job);
}

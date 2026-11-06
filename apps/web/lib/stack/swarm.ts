// Walks a Swarm /bytes reference's real chunk tree through a public gateway, and downloads the bytes with a keccak check.
import { useQuery } from "@tanstack/react-query";
import { keccak256 } from "viem";

export const SWARM_GATEWAY = (process.env.NEXT_PUBLIC_SWARM_GATEWAY || "https://api.gateway.ethswarm.org").replace(/\/$/, "");
export const CHUNK = 4096;
/** Data children an intermediate chunk can hold at each erasure-coding level; the rest of its 128 refs are parity. */
const MAX_DATA: Record<number, number> = { 0: 128, 1: 119, 2: 107, 3: 97, 4: 38 };
export const LEVEL_LABEL: Record<number, string> = { 0: "none", 1: "medium", 2: "strong", 3: "insane", 4: "paranoid" };

export type Chunk = { ref: string; span: number; level: number; refs: string[]; data: number };
export type Node = { ref: string; kind: "root" | "inner" | "leaf"; parity: boolean; parent: number; depth: number };
export type Tree = { ref: string; span: number; level: number; nodes: Node[]; leaves: number; parity: number; inner: number; fetched: number };

/** A chunk is an 8-byte little-endian span then up to 4096 bytes. The span's top byte carries the erasure-coding level. */
export function parse(ref: string, buf: Uint8Array): Chunk {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lo = dv.getUint32(0, true);
  const hi = dv.getUint32(4, true);
  const top = hi >>> 24;
  const level = top >= 0x80 ? top - 0x80 : 0;
  const span = (hi & 0xffffff) * 2 ** 32 + lo;
  const body = buf.subarray(8);
  if (span <= CHUNK) return { ref, span, level, refs: [], data: 0 };
  const refs: string[] = [];
  for (let i = 0; i + 32 <= body.length; i += 32) refs.push([...body.subarray(i, i + 32)].map((b) => b.toString(16).padStart(2, "0")).join(""));
  // Each child under this chunk covers cap bytes; the data children are the ones needed to cover the span.
  const max = MAX_DATA[level] ?? 128;
  let cap = CHUNK;
  while (span > cap * max) cap *= max;
  return { ref, span, level, refs, data: Math.min(refs.length, Math.ceil(span / cap)) };
}

async function chunk(ref: string, signal?: AbortSignal): Promise<Chunk> {
  const res = await fetch(`${SWARM_GATEWAY}/chunks/${ref}`, { signal });
  if (!res.ok) throw new Error(`Swarm answered ${res.status} for chunk ${ref.slice(0, 8)}`);
  return parse(ref, new Uint8Array(await res.arrayBuffer()));
}

/** Fetches the root and every data intermediate (not the leaves: their addresses are already in the parents). */
export async function walk(ref: string, signal?: AbortSignal): Promise<Tree> {
  const root = await chunk(ref, signal);
  const nodes: Node[] = [{ ref, kind: "root", parity: false, parent: -1, depth: 0 }];
  let fetched = 1;
  const leafChildren = root.span <= CHUNK * (MAX_DATA[root.level] ?? 128);
  if (leafChildren) {
    root.refs.forEach((r, i) => nodes.push({ ref: r, kind: "leaf", parity: i >= root.data, parent: 0, depth: 1 }));
  } else {
    const inner = root.refs.map((r, i) => nodes.push({ ref: r, kind: "inner", parity: i >= root.data, parent: 0, depth: 1 }) - 1);
    // Parity intermediates hold parity bytes, not refs, so only the data ones are walked. Six at a time, to be kind to the gateway.
    const todo = inner.filter((ix) => !nodes[ix].parity);
    for (let i = 0; i < todo.length; i += 6) {
      const batch = await Promise.all(todo.slice(i, i + 6).map((ix) => chunk(nodes[ix].ref, signal).then((c) => [ix, c] as const)));
      fetched += batch.length;
      for (const [ix, c] of batch) c.refs.forEach((r, j) => nodes.push({ ref: r, kind: "leaf", parity: j >= c.data, parent: ix, depth: 2 }));
    }
  }
  const leaves = nodes.filter((n) => n.kind === "leaf");
  return {
    ref,
    span: root.span,
    level: root.level,
    nodes,
    leaves: leaves.filter((n) => !n.parity).length,
    parity: nodes.filter((n) => n.parity).length,
    inner: nodes.filter((n) => n.kind === "inner").length,
    fetched,
  };
}

export const useSwarmTree = (ref: string | null) =>
  useQuery({ queryKey: ["swarm", "tree", ref], queryFn: ({ signal }) => walk(ref!, signal), enabled: !!ref, staleTime: Infinity, gcTime: 600_000, retry: 1 });

export type Check = { kind: "idle" } | { kind: "fetching"; got: number; total: number | null } | { kind: "ok"; hash: string; ms: number } | { kind: "mismatch"; hash: string } | { kind: "error"; msg: string };

/** Downloads /bytes/{ref} from the gateway, streaming for progress, then compares its keccak with the one Arkiv recorded. */
export async function checkBytes(ref: string, want: string, total: number | null, set: (c: Check) => void, signal?: AbortSignal) {
  const t0 = performance.now();
  set({ kind: "fetching", got: 0, total });
  try {
    const res = await fetch(`${SWARM_GATEWAY}/bytes/${ref}`, { signal });
    if (!res.ok || !res.body) return set({ kind: "error", msg: `Swarm answered ${res.status}` });
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    let last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (got - last > 256 * 1024) {
        last = got;
        set({ kind: "fetching", got, total });
      }
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    const hash = keccak256(all);
    set(hash.toLowerCase() === want.toLowerCase() ? { kind: "ok", hash, ms: performance.now() - t0 } : { kind: "mismatch", hash });
  } catch (e) {
    if ((e as Error).name !== "AbortError") set({ kind: "error", msg: "The gateway didn't finish the download" });
  }
}

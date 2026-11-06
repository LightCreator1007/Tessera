// Same-origin, read-only proxy to the Arkiv RPC. The public endpoint rate-limits per caller and an access key must never
// reach the browser, so reads go through here: two read methods only, with a short shared cache in front.
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const RPC = (process.env.ARKIV_RPC_URL || "https://rpc.rabdi.db-chain.testnet.arkiv.network").replace(/\/$/, "");
const KEY = process.env.ARKIV_API_KEY; // optional, server-only; lifts the anonymous rate limit
const READS: Record<string, number> = { arkiv_getBlockTiming: 1_000, arkiv_query: 8_000 }; // method -> cache ms
const cache = new Map<string, { at: number; body: string }>();

export async function POST(req: NextRequest) {
  let call: { method?: unknown; params?: unknown };
  try {
    call = await req.json();
  } catch {
    return Response.json({ code: "bad_request" }, { status: 400 });
  }
  const method = typeof call.method === "string" ? call.method : "";
  const ttl = READS[method];
  if (ttl === undefined || !Array.isArray(call.params ?? [])) return Response.json({ code: "method_not_allowed" }, { status: 405 });
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: call.params ?? [] });
  const hit = cache.get(body);
  if (hit && Date.now() - hit.at < ttl) return new Response(hit.body, { headers: { "content-type": "application/json", "x-cache": "hit" } });
  let res: Response;
  try {
    res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json", ...(KEY ? { "X-API-KEY": KEY } : {}) },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return Response.json({ code: "arkiv_unreachable" }, { status: 502 });
  }
  const text = await res.text();
  if (!res.ok) return Response.json({ code: res.status === 429 ? "arkiv_rate_limited" : "arkiv_error", status: res.status }, { status: 502 });
  if (cache.size > 200) cache.clear();
  cache.set(body, { at: Date.now(), body: text });
  return new Response(text, { headers: { "content-type": "application/json", "x-cache": "miss" } });
}

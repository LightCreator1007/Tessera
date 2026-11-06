// Same-origin proxy to the local node: /api/node/{health,status,events} read its :7777 API, /selftest runs the CLI, POST /stop stops it.
import type { NextRequest } from "next/server";
import { bridgeEnabled, nodeGet, nodeStop, runSelftest, type BridgeResult } from "@/lib/node/bridge";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const send = (r: BridgeResult) => new Response(r.body, { status: r.status, headers: { "content-type": r.type, "cache-control": "no-store" } });

// Only a console running on the node's own machine may reach it; a hosted deploy turns the bridge off.
const local = (req: NextRequest) => bridgeEnabled && LOCAL_HOSTS.has(req.nextUrl.hostname);
const NO_NODE: BridgeResult = { status: 404, body: '{"code":"no_local_node"}', type: "application/json" };

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!local(req)) return send(NO_NODE);
  // Another site's page can POST here through the visitor's browser; it can't set a same-origin Origin header.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return send({ status: 403, body: '{"code":"cross_origin"}', type: "application/json" });
  const { path } = await ctx.params;
  if (path.join("/") === "stop") return send(await nodeStop());
  return send({ status: 404, body: '{"code":"not_found"}', type: "application/json" });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!local(req)) return send(NO_NODE);
  const { path } = await ctx.params;
  const what = path.join("/");
  if (what === "selftest") return send(await runSelftest());
  if (what === "health" || what === "status") return send(await nodeGet(what, ""));
  if (what === "events") {
    const since = Number(req.nextUrl.searchParams.get("since") || "0");
    const wait = Math.min(Number(req.nextUrl.searchParams.get("wait") || "0"), 25);
    if (!Number.isInteger(since) || since < 0 || !(wait >= 0)) return send({ status: 400, body: '{"code":"bad_input"}', type: "application/json" });
    return send(await nodeGet("events", `?since=${since}&wait=${wait}`, wait));
  }
  return send({ status: 404, body: '{"code":"not_found"}', type: "application/json" });
}

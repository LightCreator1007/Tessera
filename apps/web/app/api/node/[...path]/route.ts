// Same-origin proxy to the local node: /api/node/{health,status,events} read its :7777 API, /api/node/selftest runs the CLI.
import type { NextRequest } from "next/server";
import { bridgeEnabled, nodeGet, runSelftest, type BridgeResult } from "@/lib/node/bridge";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const send = (r: BridgeResult) => new Response(r.body, { status: r.status, headers: { "content-type": r.type, "cache-control": "no-store" } });

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  // Only a console running on the node's own machine may reach it; a hosted deploy turns the bridge off.
  if (!bridgeEnabled || !LOCAL_HOSTS.has(req.nextUrl.hostname)) return send({ status: 404, body: '{"code":"no_local_node"}', type: "application/json" });
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

// Same-origin proxy to the coordinator, which sends no CORS headers. Unlike a rewrite, it says when the coordinator didn't answer.
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const COORDINATOR = process.env.NEXT_PUBLIC_COORDINATOR_URL?.replace(/\/$/, "");
// Only the headers the coordinator reads or the browser needs; never forward cookies to it.
const PASS_REQ = ["accept", "content-type"];
const PASS_RES = ["content-type", "content-length", "x-keccak", "cache-control", "content-disposition", "x-content-type-options"];

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!COORDINATOR) return Response.json({ code: "no_coordinator" }, { status: 404 });
  const { path } = await ctx.params;
  const url = `${COORDINATOR}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const h of PASS_REQ) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      cache: "no-store",
      redirect: "manual", // /jobs/{id}/model is a 307 to a blob path the browser resolves through this proxy again
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ code: "coordinator_unreachable" }, { status: 502, headers: { "x-proxy": "tod" } });
  }
  const out = new Headers();
  for (const h of PASS_RES) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  const loc = res.headers.get("location");
  if (loc) out.set("location", loc.startsWith("/") ? `/api/coord${loc}` : loc);
  return new Response(res.body, { status: res.status, headers: out });
}

export { forward as GET, forward as POST, forward as HEAD };

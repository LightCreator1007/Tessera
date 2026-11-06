// Server-side bridge to the tod-node on this machine: reads its local API on :7777 and runs `tod-node selftest`.
import { execFile } from "node:child_process";

// The node API refuses any request carrying an Origin header (DNS-rebinding guard), so browsers can't call it.
// A server-side fetch sends none, which is why reads go through here.
const NODE_API = process.env.TOD_NODE_API || "http://127.0.0.1:7777";
const NODE_CLI = process.env.TOD_NODE_CLI || "tod-node";
export const bridgeEnabled = process.env.TOD_NODE_BRIDGE !== "off";

export type BridgeResult = { status: number; body: string; type: string };

const fail = (status: number, code: string): BridgeResult => ({ status, body: JSON.stringify({ code }), type: "application/json" });

export async function nodeGet(path: "health" | "status" | "events", query: string, waitSeconds = 0): Promise<BridgeResult> {
  try {
    const res = await fetch(`${NODE_API}/v1/${path}${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout((waitSeconds + 5) * 1000),
    });
    return { status: res.status, body: await res.text(), type: res.headers.get("content-type") ?? "application/json" };
  } catch {
    return fail(502, "node_unreachable");
  }
}

export type SelftestOut = { arch: string; expected: string; got: string; ok: boolean; workload: string };

let running: Promise<BridgeResult> | null = null;

/** Runs the CLI's self-test. A mismatch exits non-zero but still prints its JSON, so stdout is read either way. */
export function runSelftest(): Promise<BridgeResult> {
  // One run at a time; a page polling while the hash is computed shares the run already going.
  running ??= new Promise<BridgeResult>((resolve) => {
    execFile(NODE_CLI, ["selftest", "--json"], { timeout: 180_000 }, (err, stdout) => {
      try {
        const out = JSON.parse(stdout) as SelftestOut;
        resolve({ status: 200, body: JSON.stringify(out), type: "application/json" });
      } catch {
        resolve(fail(502, err && "code" in err && err.code === "ENOENT" ? "cli_not_found" : "selftest_failed_to_run"));
      }
    });
  }).finally(() => { running = null; });
  return running;
}

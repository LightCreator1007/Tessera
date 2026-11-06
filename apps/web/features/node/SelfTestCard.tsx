"use client";
// Install step, mirrored from the laptop: asks the local bridge to run `tod-node selftest` and turns "Waiting for your laptop" into a self-test result card. A determinism failure blocks pairing with no "continue anyway". After 2 minutes without contact it expands into checks, and the manual confirm stays as the fallback.
import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Button, PropRow, cx, TileBusy } from "@/components/primitives";
import { More } from "@/components/flow";
import { nodeUrl } from "@/lib/api/client";

// Each poll runs the self-test on this machine, so retries are spaced out; the bridge shares a run already going.
const POLL_MS = 10_000;
const GIVE_UP_MS = 120_000;

/** What the card shows. Speed, memory and job classes are not reported by the CLI yet, so live results leave them null. */
export type SelfTest = {
  device: string;
  tflops: number | null;
  deterministic: boolean;
  drift?: { op: string; expected: string; actual: string };
  memoryGb: number | null;
  classes: string[];
};

/** `tod-node selftest --json`, passed through by the bridge. */
type CliSelftest = { arch: string; expected: string; got: string; ok: boolean; workload: string };

function fromCli(c: CliSelftest): SelfTest {
  return {
    device: c.arch,
    tflops: null,
    deterministic: c.ok,
    drift: c.ok ? undefined : { op: c.workload, expected: c.expected, actual: c.got },
    memoryGb: null,
    classes: c.ok ? [c.workload] : [],
  };
}

export function SelfTestCard({ onPassed, manual, simulated, poll = true }: { onPassed: () => void; manual: () => void; simulated?: SelfTest | null; poll?: boolean }) {
  const [found, setRes] = useState<SelfTest | null>(null);
  const res = simulated ?? found;
  const [since] = useState(() => Date.now());
  const [late, setLate] = useState(false);

  useEffect(() => {
    if (res || !poll) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(nodeUrl("selftest"), { cache: "no-store" });
        if (r.ok && !stop) setRes(fromCli((await r.json()) as CliSelftest));
        else if (!stop && Date.now() - since > GIVE_UP_MS) setLate(true);
      } catch {
        if (!stop && Date.now() - since > GIVE_UP_MS) setLate(true);
      }
    };
    tick();
    const t = window.setInterval(tick, POLL_MS);
    return () => { stop = true; window.clearInterval(t); };
  }, [res, since, poll]);

  if (!res) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-rule p-4" role="status" aria-live="polite">
        <span className="flex items-center gap-2 text-sm text-ink"><TileBusy className="text-muted" />Waiting for your laptop</span>
        <p className="text-xs text-muted">This page checks the node on this machine every few seconds. Run the two commands above and the result shows here.</p>
        <More label={late ? "Still nothing after 2 minutes? Check these" : "Not showing up?"} open={late}>
          <p>Run <code className="font-mono text-ink">tod-node status</code>. If it says the node isn&apos;t initialized, run <code className="font-mono text-ink">init</code> again.</p>
          <p>Something else may be using port 7777, or a firewall may block local connections from the browser.</p>
          <p>If the self-test printed PASS in your terminal, you can confirm it yourself: <Button variant="ghost" onClick={manual}>It passed in my terminal</Button></p>
        </More>
      </div>
    );
  }

  const ok = res.deterministic;
  return (
    <div className={cx("flex animate-step-in flex-col gap-3 rounded-xl border p-4", ok ? "border-rule" : "border-danger/40 bg-danger-bg")}>
      <span className={cx("flex items-center gap-2 text-sm", ok ? "text-ok" : "text-danger")}>
        {ok ? <CircleCheck className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
        {ok ? "Self-test passed: this laptop reproduces the reference math bit for bit" : "Self-test failed: this laptop's math drifted from the reference"}
      </span>
      <dl className="flex flex-col divide-y divide-rule-row">
        <PropRow label="Device"><span className="text-xs">{res.device}</span></PropRow>
        <PropRow label="Speed">{res.tflops === null ? <span className="text-xs text-subtle">Not measured</span> : <span className="font-mono text-xs">{res.tflops.toFixed(1)} TFLOPS effective</span>}</PropRow>
        {ok && <PropRow label="Can take">{res.classes.length ? <span className="text-xs">{res.classes.join(", ")}</span> : <span className="text-xs text-warn">No matching job classes today. Your node will wait.</span>}</PropRow>}
        {res.drift && <PropRow label="Drifted at"><span className="font-mono text-xs text-danger">{res.drift.op}</span></PropRow>}
      </dl>
      {ok ? (
        <Button variant="primary" onClick={onPassed}>Continue to pairing</Button>
      ) : (
        <p className="text-xs text-muted">A node that can&apos;t reproduce the math would fail every replay and lose its bond, so pairing is blocked. Usual causes: a different PyTorch build, or Docker with under 4 GB of memory. Fix it and run <code className="font-mono text-ink">tod-node selftest</code> again; this card updates.</p>
      )}
    </div>
  );
}

export const SIMULATED: Record<"pass" | "drift" | "weak", SelfTest> = {
  pass: { device: "Apple M3, 16 GB", tflops: 3.4, deterministic: true, memoryGb: 16, classes: ["small CNN", "LoRA up to 1B"] },
  drift: { device: "Intel i5, 8 GB", tflops: 0.2, deterministic: false, drift: { op: "conv2d backward, step 37", expected: "0x9e41", actual: "0x9e40" }, memoryGb: 8, classes: [] },
  weak: { device: "Intel i3, 8 GB", tflops: 0.1, deterministic: true, memoryGb: 8, classes: [] },
};

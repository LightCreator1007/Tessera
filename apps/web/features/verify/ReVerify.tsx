"use client";
// Re-verify in this browser: recompute a hash the chain already holds and compare. Every state is shown, and a mismatch is never silent.
import { useState } from "react";
import { CircleAlert, CircleCheck, Flag, RotateCcw, ShieldCheck } from "lucide-react";
import { Button, HashChip, cx } from "@/components/primitives";

export type Progress = { phase: "download"; bytes: number; total: number | null } | { phase: "run"; step: number; of: number };
type State =
  | { s: "idle" }
  | { s: "busy"; p: Progress | null }
  | { s: "match"; got: string }
  | { s: "mismatch"; got: string }
  | { s: "error"; msg: string }
  | { s: "unsupported" };

const supported = () => typeof crypto !== "undefined" && !!crypto.subtle;

export function ReVerify({ expected, run, what = "this result", onReport }: { expected: string; run: (on: (p: Progress) => void) => Promise<string>; what?: string; onReport?: () => void }) {
  const [st, setSt] = useState<State>({ s: "idle" });
  const go = async () => {
    if (!supported()) return setSt({ s: "unsupported" });
    setSt({ s: "busy", p: null });
    try {
      const got = await run((p) => setSt({ s: "busy", p }));
      setSt(got.toLowerCase() === expected.toLowerCase() ? { s: "match", got } : { s: "mismatch", got });
    } catch (e) {
      setSt({ s: "error", msg: e instanceof Error ? e.message : "The download or the hash failed." });
    }
  };

  if (st.s === "idle") return <Button icon={ShieldCheck} onClick={go}>Re-verify in this browser</Button>;
  if (st.s === "unsupported") return <Note tone="warn" icon={CircleAlert} title="Can't run in this browser">Hashing needs Web Crypto, which this page can only use over https or on localhost.</Note>;
  if (st.s === "error") return <Note tone="danger" icon={CircleAlert} title="Re-verify didn't finish" action={<Button icon={RotateCcw} onClick={go}>Retry</Button>}>{st.msg}</Note>;
  if (st.s === "busy") {
    const p = st.p;
    const line = !p ? "Starting" : p.phase === "download" ? `Downloading ${mb(p.bytes)}${p.total ? ` of ${mb(p.total)}` : ""}` : `Replaying step ${p.step} of ${p.of}`;
    const pct = !p ? 0 : p.phase === "download" ? (p.total ? p.bytes / p.total : 0) : p.step / p.of;
    return (
      <div className="flex flex-col gap-2" role="status" aria-live="polite">
        <span className="font-mono text-xs uppercase tracking-wide text-muted">{line}</span>
        <span className="block h-1 w-full overflow-hidden bg-rule"><span className="block h-full bg-ink transition-width duration-200 ease-out" style={{ width: `${Math.round(pct * 100)}%` }} /></span>
      </div>
    );
  }
  const ok = st.s === "match";
  return (
    <Note
      tone={ok ? "ok" : "danger"}
      icon={ok ? CircleCheck : CircleAlert}
      title={ok ? "Match. Your browser got the same hash." : `Mismatch. Your browser got a different hash for ${what}.`}
      action={ok ? <Button variant="ghost" icon={RotateCcw} onClick={go}>Run again</Button> : onReport && <Button icon={Flag} onClick={onReport}>Report it</Button>}
    >
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2"><span className="w-16 text-xs text-muted">On chain</span><HashChip value={expected} label="on-chain hash" /></span>
        <span className="flex items-center gap-2"><span className="w-16 text-xs text-muted">Yours</span><HashChip value={st.got} label="your hash" /></span>
      </span>
    </Note>
  );
}

function Note({ tone, icon: Icon, title, children, action }: { tone: "ok" | "warn" | "danger"; icon: typeof CircleCheck; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  const cls = { ok: "border-ok/30 bg-ok-bg text-ok", warn: "border-warn/30 bg-warn-bg text-warn", danger: "border-danger/30 bg-danger-bg text-danger" }[tone];
  return (
    <div role="status" className={cx("flex animate-step-in flex-col gap-2 rounded-lg border p-3", cls)}>
      <span className="flex items-start gap-2"><Icon className="mt-0.5 size-4 shrink-0" aria-hidden /><span className="text-sm font-medium">{title}</span></span>
      {children && <div className="pl-6 text-sm text-muted">{children}</div>}
      {action && <div className="pl-6">{action}</div>}
    </div>
  );
}

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

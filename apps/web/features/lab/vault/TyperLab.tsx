// V4, after vault/typer: a label or hash lands letter by letter, each letter rolling through tile states before it settles.
"use client";

import { Button, TileBusy } from "@/components/primitives";
import { reducedMotion } from "@/lib/prefs";
import { useDialKit } from "dialkit";
import { useEffect, useRef, useState } from "react";
import { LabFrame, seeded } from "./Frame";

const STATES = ["pill", "inverse", "accent", "outline"] as const;
type Tone = "ok" | "fail" | "plain";

/** Renders `text` typing in: a wave crosses the line; each letter shows `rolls` random tile states, then the plain letter. */
export function Typer({ text, play, per = 28, rolls = 3, stepMs = 45, tone = "plain" }: { text: string; play: unknown; per?: number; rolls?: number; stepMs?: number; tone?: Tone }) {
  const [el, setEl] = useState(-1);
  const start = useRef(0);
  useEffect(() => {
    if (reducedMotion()) {
      setEl(Infinity);
      return;
    }
    start.current = performance.now();
    const end = text.length * per + rolls * stepMs + 20;
    let raf = 0;
    const tick = (now: number) => {
      const e = now - start.current;
      setEl(e);
      if (e < end) raf = requestAnimationFrame(tick);
      else setEl(Infinity);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [play, text, per, rolls, stepMs]);
  const rnd = seeded(text.length * 31 + 7);
  const picks = text.split("").map(() => Array.from({ length: rolls }, () => STATES[Math.floor(rnd() * STATES.length)]));
  return (
    <span className="ty" data-tone={tone} aria-label={text}>
      {text.split("").map((ch, i) => {
        const local = el - i * per;
        if (local < 0) return <span key={i} aria-hidden className="ty-l" data-s="wait">{ch === " " ? " " : ch}</span>;
        const k = Math.floor(local / stepMs);
        const s = k < rolls ? picks[i][k] : "done";
        return <span key={i} aria-hidden className="ty-l" data-s={s}>{ch === " " ? " " : ch}</span>;
      })}
    </span>
  );
}

const TYPER_CSS = `
  .ty { display: inline-flex; white-space: pre; }
  .ty-l { display: inline-block; border-radius: 2px; box-shadow: none; }
  .ty-l[data-s="wait"] { color: transparent; }
  .ty-l[data-s="pill"] { background: var(--mz-l4); color: var(--mz-l7); border-radius: 999px; }
  .ty-l[data-s="inverse"] { background: var(--mz-l7); color: var(--mz-ground); }
  .ty-l[data-s="accent"] { color: var(--mz-l5); }
  .ty-l[data-s="outline"] { box-shadow: inset 0 0 0 1px var(--mz-l5); color: var(--mz-l7); border-radius: 999px; }
  .ty[data-tone="fail"] .ty-l[data-s="done"] { color: var(--color-danger); }
  .ty[data-tone="ok"] .ty-l[data-s="done"] { color: inherit; }
`;

type Outcome = "confirm" | "revert" | "reject";

function TxDemo({ outcome, per, rolls, stepMs, waitMs }: { outcome: Outcome; per: number; rolls: number; stepMs: number; waitMs: number }) {
  const [state, setState] = useState<"idle" | "pending" | Outcome>("idle");
  const [play, setPlay] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const run = () => {
    if (state === "pending") return;
    setState("pending");
    timer.current = setTimeout(() => {
      setState(outcome);
      setPlay((p) => p + 1);
    }, waitMs);
  };
  const label = state === "confirm" ? "Claimed 4.20 TOD" : state === "revert" ? "Reverted, nothing moved" : "Claim 4.20 TOD";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" onClick={run} disabled={state === "pending"} className="min-w-48 font-mono" aria-live="polite">
        {state === "pending" ? <TileBusy /> : state === "idle" || state === "reject" ? label : <Typer text={label} play={play} per={per} rolls={rolls} stepMs={stepMs} tone={state === "revert" ? "fail" : "ok"} />}
      </Button>
      {state !== "idle" && state !== "pending" ? (
        <button type="button" className="font-mono text-xs text-subtle underline underline-offset-4 hover:text-ink" onClick={() => setState("idle")}>
          reset
        </button>
      ) : null}
      <span className="font-mono text-xs text-subtle">{state === "reject" ? "rejected in wallet: label falls back, no colour" : `outcome: ${outcome}`}</span>
    </div>
  );
}

function HashDemo({ per, rolls, stepMs }: { per: number; rolls: number; stepMs: number }) {
  const [hash, setHash] = useState<string | null>(null);
  const [play, setPlay] = useState(0);
  const freeze = () => {
    const r = seeded(Date.now() & 0xffff);
    setHash(`0x${Array.from({ length: 16 }, () => Math.floor(r() * 16).toString(16)).join("")}`);
    setPlay((p) => p + 1);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={freeze}>Freeze spec</Button>
      <span className="font-mono text-sm text-ink">{hash ? <Typer text={hash} play={play} per={per} rolls={rolls} stepMs={stepMs} /> : <span className="text-subtle">spec hash appears here</span>}</span>
    </div>
  );
}

function CopyDemo({ per, rolls, stepMs }: { per: number; rolls: number; stepMs: number }) {
  const cmd = "tod-node join --job 7";
  const [copied, setCopied] = useState(0);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!copied) return;
    setOk(true);
    const t = setTimeout(() => setOk(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(cmd).catch(() => undefined);
        setCopied((c) => c + 1);
      }}
      style={{ background: "var(--mz-ground)" }} className="flex w-full max-w-md items-center gap-3 border border-rule px-3 py-2 text-left font-mono text-sm text-ink hover:border-rule-strong"
      aria-label={`Copy ${cmd}`}
    >
      <span className={ok ? "text-bone" : "text-mosaic"}>{ok ? "ok" : "$"}</span>
      {copied ? <Typer text={cmd} play={copied} per={Math.max(8, per / 2)} rolls={Math.min(2, rolls)} stepMs={stepMs} /> : <span>{cmd}</span>}
      <span className="ml-auto text-xs text-subtle">{ok ? "copied" : "copy"}</span>
    </button>
  );
}

export function TyperLab() {
  const d = useDialKit("V4 Typer", {
    perLetter: [28, 4, 90, 1],
    rolls: [3, 1, 6, 1],
    stepMs: [45, 15, 120, 1],
    txWait: [1200, 200, 4000, 50],
    outcome: { type: "select", options: ["confirm", "revert", "reject"] },
  });
  return (
    <LabFrame
      n="V4"
      id="typer"
      title="Typer resolve for transactions, hashes and copy"
      source="typer"
      drives="The moment a value arrives: the tx resolves, the coordinator returns a hash, the command is copied. Never on a timer."
      where="useTx button labels (claim, stake, post job), the frozen spec hash in DraftStep, the Command block. An extension of Scramble, not a new component."
    >
      <style>{TYPER_CSS}</style>
      <div className="grid gap-6 border border-rule bg-card p-5">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-wide text-subtle">Transaction button</p>
          <TxDemo outcome={d.outcome as Outcome} per={d.perLetter} rolls={d.rolls} stepMs={d.stepMs} waitMs={d.txWait} />
        </div>
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-wide text-subtle">Hash landing</p>
          <HashDemo per={d.perLetter} rolls={d.rolls} stepMs={d.stepMs} />
        </div>
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-wide text-subtle">Copy command</p>
          <CopyDemo per={d.perLetter} rolls={d.rolls} stepMs={d.stepMs} />
        </div>
      </div>
    </LabFrame>
  );
}

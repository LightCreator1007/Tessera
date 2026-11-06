"use client";
// /demo: a recorded round replayed as a scrubbable timeline of seven beats. No wallet. Each beat says one thing, names its concept with a peek, and the node cards carry the state forward so the eye tracks one object per laptop. The recap is the peak: the reader re-verifies the honest hash and catches the lazy one in their own browser.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Cpu, Laptop, Pause, Play, Receipt, RotateCcw, Trophy } from "lucide-react";
import { Drawer } from "@/components/drawer";
import { NodeArt } from "@/components/pixel";
import { Button, DocsLink, Eyebrow, HashChip, Money, PageHeader, Pill, TrustLabel, cx, short } from "@/components/primitives";
import { Term } from "@/components/term";
import { DEMO_SEED, STEPS, runReplay } from "@/lib/learn/replay";
import { NodeVerdict } from "@/features/verify/NodeVerdict";
import { ReVerify } from "@/features/verify/ReVerify";
import { BEATS, BEAT_LABEL, DEMO_JOB, DEMO_ROUND, FLAG_AT, HASH, NODES, POT, REASON, REPLAY_SEGMENT, payFor, resultFor, type DemoNode } from "./script";

const BEAT_MS = 5000;
const at = (b: (typeof BEATS)[number]) => BEATS.indexOf(b);

export function DemoReplay() {
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState<DemoNode | null>(null);
  const last = BEATS.length - 1;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) setPlaying(true);
  }, []);
  useEffect(() => {
    if (!playing) return;
    if (beat >= last) { setPlaying(false); return; }
    const t = window.setTimeout(() => setBeat((b) => b + 1), BEAT_MS);
    return () => window.clearTimeout(t);
  }, [playing, beat, last]);

  const jump = useCallback((i: number) => { setPlaying(false); setBeat(Math.max(0, Math.min(last, i))); }, [last]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); jump(beat + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); jump(beat - 1); }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader icon={Receipt} title="demo" heading="Watch a lazy node get caught" meta={<TrustLabel trust="demo" />}>
        <DocsLink href="/docs/how-it-works">How a round is checked</DocsLink>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6">
        <p className="max-w-2xl text-sm text-muted">
          A recorded <Term k="round">round</Term> from job #{DEMO_JOB}: four laptops, two verifiers, about 40 seconds. Nothing here needs a wallet, and the last step runs a real check in your browser.
        </p>

        <div role="group" aria-label="Replay timeline" onKeyDown={onKey} className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" icon={ChevronLeft} onClick={() => jump(beat - 1)} disabled={beat === 0} aria-label="Previous step" />
            <Button
              variant="primary"
              icon={playing ? Pause : beat === last ? RotateCcw : Play}
              onClick={() => { if (beat === last) { setBeat(0); setPlaying(true); } else setPlaying((p) => !p); }}
            >
              {playing ? "Pause" : beat === last ? "Replay" : "Play"}
            </Button>
            <Button variant="ghost" icon={ChevronRight} onClick={() => jump(beat + 1)} disabled={beat === last} aria-label="Next step" />
            <span className="ml-auto font-mono text-xs uppercase tracking-wide text-subtle">step {beat + 1} of {BEATS.length} · arrow keys scrub</span>
          </div>
          <ol className="grid grid-cols-7 gap-1">
            {BEATS.map((b, i) => (
              <li key={b}>
                <button type="button" onClick={() => jump(i)} aria-current={i === beat ? "step" : undefined} className="group flex w-full flex-col gap-1.5 text-left">
                  <span className="relative block h-1 overflow-hidden rounded-full bg-rule">
                    {i < beat && <span className="absolute inset-0 bg-ink" />}
                    {i === beat && (playing ? <span key={`${beat}-p`} className="absolute inset-0 animate-beat-fill bg-ink" /> : <span className="absolute inset-0 bg-ink" />)}
                  </span>
                  <span className={cx("hidden font-mono text-xs uppercase tracking-wide sm:block", i === beat ? "text-ink" : "text-subtle group-hover:text-muted")}>{BEAT_LABEL[b]}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <Caption beat={beat} />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {NODES.map((n) => <NodeCard key={n.key} n={n} beat={beat} onOpen={() => setOpen(n)} />)}
        </div>

        {beat === at("detect") && <DriftPlot />}
        {beat >= at("settle") && <Payouts />}
        {beat === last && <Recap onOpen={setOpen} />}
      </div>

      {open && (
        <Drawer
          onClose={() => setOpen(null)}
          title={<div className="flex items-center gap-2.5"><Receipt className="size-4 text-muted" strokeWidth={1.5} aria-hidden /><span className="text-sm text-ink">Node {open.key}, round {DEMO_ROUND}</span><span className="font-mono text-xs text-subtle">job #{DEMO_JOB}</span></div>}
        >
          <NodeVerdict
            who={short(open.op)}
            result={resultFor(open, Math.max(beat, at("detect")))}
            segment={REPLAY_SEGMENT}
            checks={[{ name: "Verifier A", result: open.role === "lazy" ? "fail" : "pass" }, { name: "Verifier B", result: open.role === "lazy" ? "fail" : "pass" }]}
            reason={REASON[open.role]}
            money={open.role === "honest" ? { kind: "held", units: payFor(open) } : { kind: "forfeited", units: open.held }}
            evidence={open.role === "lazy" ? HASH.lazy : HASH.honest}
            reverify={<ReVerify expected={HASH.honest} what={`node ${open.key}'s weights`} run={(on) => runReplay(DEMO_SEED, (step) => on({ phase: "run", step, of: STEPS }), open.role === "lazy" ? { skipFrom: 412 } : {})} />}
          />
        </Drawer>
      )}
    </div>
  );
}

function Caption({ beat }: { beat: number }) {
  const lines: ReactNode[] = [
    <>Each laptop trains its own <Term k="shard">shard</Term> of this round&apos;s data. Node C is lazy: it will stop at step 412 and pad the rest. Node D is a poisoner: it will train for real, but steer the update.</>,
    <>Before anyone sees anyone else&apos;s work, each node posts a fingerprint of its result. That&apos;s the first half of <Term k="commit-reveal">commit, then reveal</Term>.</>,
    <>Now they reveal their weights. Each reveal has to hash to its commit, so nobody could copy a neighbour after the fact.</>,
    <>Two verifiers <Term k="replay">replay</Term> segment {REPLAY_SEGMENT.n} of {REPLAY_SEGMENT.of} for every node, bit for bit. Node C&apos;s weights after step 412 don&apos;t match. It&apos;s caught.</>,
    <>Node D replayed cleanly: the work was really done. <Term k="poison">Poison detection</Term> ranks every update against the others, and D&apos;s pulls 4.6 times further than normal. It&apos;s left out.</>,
    <>Honest nodes get a floor plus a share for how much they lowered validation loss, so the bars differ. C and D are <Term k="slash">slashed</Term>: they lose the earnings they had on hold, their <Term k="bond">bond</Term>.</>,
    <>That&apos;s the whole round. You can check it yourself: re-run the replay below and compare hashes with what the chain recorded.</>,
  ];
  return (
    <div key={beat} className="min-h-12 animate-step-in border-l-2 border-ink pl-4">
      <Eyebrow className="mb-1">{BEAT_LABEL[BEATS[beat]]}</Eyebrow>
      <p className="max-w-3xl text-sm text-ink">{lines[beat]}</p>
    </div>
  );
}

function NodeCard({ n, beat, onOpen }: { n: DemoNode; beat: number; onOpen: () => void }) {
  const caught = (n.role === "lazy" && beat >= at("replay")) || (n.role === "poison" && beat >= at("detect"));
  const state = beat === at("train") ? "training" : caught ? "slashed" : "idle";
  const progress = beat === at("train") ? (n.role === "lazy" ? 0.8 : 1) : 1;
  const pay = payFor(n);
  const row = (label: string, value: ReactNode, show: boolean) => (
    <div className={cx("flex min-h-7 items-center justify-between gap-2 text-xs transition-opacity duration-200 ease-out", show ? "opacity-100" : "opacity-0")} aria-hidden={!show}>
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
  return (
    <div className={cx("flex flex-col gap-3 rounded-xl border p-3 transition-colors duration-200 ease-out", caught ? "border-danger/40 bg-danger-bg" : "border-rule bg-surface")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink">Node {n.key}</span>
        <span className="font-mono text-xs text-subtle">{short(n.op, 4, 3)}</span>
      </div>
      <NodeArt op={n.op} state={state} size="lg" progress={progress} className="w-full p-2" />
      <div className="flex flex-col">
        {row("Commit", <HashChip value={n.commit} label={`node ${n.key} commit`} />, beat >= at("commit"))}
        {row("Reveal", <span className="text-ok">matches commit</span>, beat >= at("reveal"))}
        {row("Replay", n.role === "lazy" ? <Pill tone="danger">Mismatch</Pill> : <Pill tone="ok">Match</Pill>, beat >= at("replay"))}
        {row("Detect", n.role === "poison" ? <Pill tone="danger">Flagged</Pill> : <Pill tone="ok">In range</Pill>, beat >= at("detect"))}
        {row("Round pay", pay !== null ? <Money units={pay} /> : <span className="flex items-center gap-1 text-danger">-<Money units={n.held} /></span>, beat >= at("settle"))}
      </div>
      {beat >= at("replay") && (
        <button type="button" onClick={onOpen} className="animate-step-in self-start text-xs text-ink underline decoration-subtle underline-offset-4 hover:decoration-ink">
          Why? Open receipt
        </button>
      )}
    </div>
  );
}

function DriftPlot() {
  const MAX = 5;
  return (
    <section aria-label="Update drift from the median" className="animate-step-in rounded-xl border border-rule p-4">
      <Eyebrow className="mb-4">Distance from the median update</Eyebrow>
      <div className="relative h-16">
        <span className="absolute inset-x-0 top-1/2 h-px bg-rule" aria-hidden />
        <span className="absolute inset-y-0 border-l border-dashed border-danger" style={{ left: `${(FLAG_AT / MAX) * 100}%` }} aria-hidden />
        <span className="absolute -top-1 translate-x-1.5 font-mono text-xs uppercase tracking-wide text-danger" style={{ left: `${(FLAG_AT / MAX) * 100}%` }}>flag line</span>
        {NODES.map((n) => (
          <span key={n.key} className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: `${(n.drift / MAX) * 100}%` }}>
            <span className={cx("size-3 rounded-full ring-2 ring-surface", n.drift > FLAG_AT ? "bg-danger" : "bg-ink")} />
            <span className="font-mono text-xs text-muted">{n.key}</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">C sits in range here because its padding was small. Replay caught it, not detection. That&apos;s why both checks run.</p>
    </section>
  );
}

function Payouts() {
  const max = Math.max(...NODES.map(payFor).filter((v): v is number => v !== null));
  return (
    <section aria-label="Round pay" className="animate-step-in rounded-xl border border-rule p-4">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <Eyebrow>Round pay, from the job&apos;s escrow</Eyebrow>
        <span className="text-xs text-muted">Pot <Money units={POT} /></span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {NODES.map((n) => {
          const pay = payFor(n);
          return (
            <li key={n.key} className="grid grid-cols-12 items-center gap-3">
              <span className="col-span-2 text-sm text-ink sm:col-span-1">{n.key}</span>
              <span className="col-span-6 block h-2 overflow-hidden rounded-full bg-band sm:col-span-8">
                {pay !== null && <span className="block h-full origin-left animate-beat-fill rounded-full bg-ink" style={{ width: `${(pay / max) * 100}%`, animationDuration: "600ms", animationTimingFunction: "var(--ease-drawer)" }} />}
              </span>
              <span className="col-span-4 text-right text-xs sm:col-span-3">{pay !== null ? <Money units={pay} /> : <span className="text-danger">slashed, {n.role === "lazy" ? "replay" : "poison"}</span>}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Recap({ onOpen }: { onOpen: (n: DemoNode) => void }) {
  return (
    <section aria-label="Check it yourself" className="flex animate-rise-in flex-col gap-5 rounded-xl border border-rule bg-band p-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Eyebrow>Check it yourself</Eyebrow>
          <p className="text-sm text-muted">Re-run the replay of node A, then node C, here in your browser. A should hash to the value on chain. C shouldn&apos;t.</p>
          <div className="flex flex-col gap-3">
            <Replay label="Node A" lazy={false} />
            <Replay label="Node C" lazy />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Eyebrow>What next</Eyebrow>
          <Next icon={Laptop} href="/nodes/add" title="Lend your laptop" sub="About 5 minutes with the CLI. Earnings pay for your own jobs and entries." />
          <Next icon={Cpu} href="/jobs/new" title="Train a model" sub="Lock a budget. Pay only for rounds that pass." />
          <Next icon={Trophy} href="/competitions" title="See competitions" sub="Hosts commit their labels up front, so nobody can rig the score." />
          <button type="button" onClick={() => onOpen(NODES[2])} className="self-start text-xs text-muted underline decoration-subtle underline-offset-4 hover:text-ink">Open node C&apos;s receipt</button>
        </div>
      </div>
    </section>
  );
}

function Replay({ label, lazy }: { label: string; lazy: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-rule bg-surface p-3">
      <span className="text-sm text-ink">{label}</span>
      <ReVerify
        expected={HASH.honest}
        what={`${label}'s weights`}
        run={(on) => runReplay(DEMO_SEED, (step) => on({ phase: "run", step, of: STEPS }), lazy ? { skipFrom: 412 } : {})}
      />
    </div>
  );
}

function Next({ icon: Icon, href, title, sub }: { icon: typeof Laptop; href: string; title: string; sub: string }) {
  return (
    <Link href={href} className="flex items-start gap-3 rounded-lg border border-rule bg-surface px-3 py-2.5 transition-colors duration-150 ease-out hover:bg-hover">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
      <span className="flex flex-col">
        <span className="text-sm text-ink">{title}</span>
        <span className="text-xs text-muted">{sub}</span>
      </span>
    </Link>
  );
}

// Isometric diagrams placed where the app would use them, fed by the real types and demo fixtures (mocks/fixtures.ts):
// the node pool (/nodes), the current round (/jobs/[id]), a node's record (/nodes/[op]), the system on the home page
// and the join flow (/nodes/join). Each section names the route and the component it would replace.
"use client";

import { useMemo, useRef, useState } from "react";
import { formatToken } from "@/lib/money";
import { jobs, nodeChain, nodes, OPS, roundFor, verdictsFor } from "@/mocks/fixtures";
import type { NodeRoundResult, Round, RoundVerdicts } from "@/lib/api/types";
import { IsoMosaic, type IsoCell, type IsoLabel, type IsoScene } from "@/components/mosaic/iso";
import { Section, usePalette } from "../shell";

const nameOf = (op: string) => {
  const o = OPS.find((x) => x.op === op);
  return o ? o.name : op.slice(0, 6);
};

/** A footprint of unit cells, so a block reads as a stack of word tiles with seams. */
function box(out: IsoCell[], i: number, j: number, w: number, d: number, h: number, tone: number, z = 0, hole?: (a: number, b: number) => boolean) {
  for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) out.push(hole && hole(a, b) ? { i: i + a, j: j + b, z, h: 0, tone: 0, hole: true } : { i: i + a, j: j + b, z, h, tone });
}

function floor(out: IsoCell[], cols: number, rows: number, taken: Set<string>) {
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (!taken.has(`${i},${j}`)) out.push({ i, j, h: 0, tone: 0 });
}

function Where({ route, replaces }: { route: string; replaces: string }) {
  return (
    <p className="mz-fine" style={{ marginBottom: 12 }}>
      <span className="mz-kbd">{route}</span> replaces {replaces}
    </p>
  );
}

/* 1. /nodes: the pool as a city. Height is earned pay, a slash bites a hole out of the column, offline is a dark stub. */

function NodePool() {
  const pal = usePalette();
  const [sel, setSel] = useState(nodes[0].op);
  const maxEarned = Math.max(...nodes.map((n) => nodeChain[n.op].earned || 0));
  const scene: IsoScene = useMemo(() => {
    const cells: IsoCell[] = [];
    const labels: IsoLabel[] = [];
    const taken = new Set<string>();
    nodes.forEach((n, k) => {
      const ch = nodeChain[n.op];
      const i = 1 + (k % 4) * 3;
      const j = 1 + Math.floor(k / 4) * 3;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) taken.add(`${i + a},${j + b}`);
      const slashed = ch.penalties.some((p) => p.kind === "Slashed");
      const mine = n.op === sel;
      if (ch.earned === null) {
        box(cells, i, j, 2, 2, 0.06, mine ? 0.9 : 0.14);
        labels.push({ i: i + 2, j, z: 0.1, text: `${nameOf(n.op)} · earned not reported` });
        return;
      }
      const h = 0.25 + (ch.earned / maxEarned) * 3;
      const tone = mine ? 0.9 : !n.online ? 0.2 : n.idle ? 0.4 : 0.64;
      box(cells, i, j, 2, 2, h, tone, 0, slashed ? (a, b) => a === 1 && b === 1 : undefined);
      if (mine || slashed) labels.push({ i: i + 2, j, z: h, text: `${nameOf(n.op)} · ${formatToken(Math.round(ch.earned))}${slashed ? " · slashed" : ""}`, fail: slashed && !mine });
    });
    floor(cells, 13, 7, taken);
    return () => ({ cells, labels });
  }, [sel, maxEarned]);
  const online = nodes.filter((n) => n.online).length;
  const idle = nodes.filter((n) => n.online && n.idle).length;
  return (
    <Section title="1. The pool" note="One column per node. Height is what it has earned, a slash bites a corner out, offline nodes are dark stubs, a node with no earnings record is a flat plate rather than a zero.">
      <Where route="/nodes" replaces="the FleetCard grid of laptop art and the NetworkStrip counters on home" />
      <div className="mz-seg" role="radiogroup" aria-label="Node" style={{ marginBottom: 12 }}>
        {nodes.map((n) => (
          <button key={n.op} type="button" role="radio" aria-checked={sel === n.op} aria-pressed={sel === n.op} className="mz-btn mz-btn-sm mz-btn-ghost" onClick={() => setSel(n.op)}>
            {nameOf(n.op)}
          </button>
        ))}
      </div>
      <div className="mz-frame" style={{ height: 520 }}>
        <IsoMosaic scene={scene} cols={13} rows={7} maxH={3.4} label="Node pool as columns of earned pay" palette={pal} seed={21} gutter={0.26} build={1.2} />
        <span className="mz-caption">{`${nodes.length} nodes · ${online} online · ${idle} idle\nheight = earned`}</span>
      </div>
    </Section>
  );
}

/* 2. /jobs/[id]: the current round as four plates, the roster as pegs on each. */

const PLATES = ["commit", "reveal", "verify", "settle"] as const;

function plateState(r: Round, v: RoundVerdicts) {
  const live = r.status === "committing" ? 0 : r.status === "revealing" ? 1 : r.status === "verifying" ? 2 : 4;
  const failed = r.status === "reverted" || v.some((x) => x.verdict === "fail");
  return { live, failed, target: v.find((x) => x.target)?.target };
}

function RoundPlates() {
  const pal = usePalette();
  const job = jobs[0];
  const [rn, setRn] = useState(job.currentRound || 1);
  const r = roundFor(job, rn);
  const v = verdictsFor(job, rn);
  const scene: IsoScene = useMemo(() => {
    const cells: IsoCell[] = [];
    const labels: IsoLabel[] = [];
    if (!r) return () => ({ cells });
    const { live, failed, target } = plateState(r, v);
    const ops = r.roster.map((s) => s.op);
    const W = ops.length * 2 + 1;
    const maxPay = Math.max(1, ...r.payouts.map((p) => p.amount));
    PLATES.forEach((name, k) => {
      const z = k * 2.2;
      const done = k < live;
      const active = k === live;
      const dark = failed && k === 3 && !r.payouts.length;
      const plateTone = dark ? 0.12 : active ? 0.5 : done ? 0.36 : 0.2;
      for (let i = 0; i < W; i++) for (let j = 0; j < 2; j++) if (!(j === 1 && i % 2 === 1)) cells.push({ i, j, z, h: 0.2, tone: plateTone });
      ops.forEach((op, n) => {
        const i = 1 + n * 2;
        const peg = (h: number, tone: number) => cells.push({ i, j: 1, z, h, tone });
        if (k === 0) return r.committed.includes(op) ? peg(0.55, 0.64) : peg(0.2, plateTone);
        if (k === 1) return r.revealed.includes(op) ? peg(0.55, 0.64) : peg(0.2, plateTone);
        if (k === 2) {
          if (op === target) return cells.push({ i, j: 1, z, h: 0, tone: 0, hole: true });
          return live > 2 || r.status === "verifying" ? peg(0.55, 0.64) : peg(0.2, plateTone);
        }
        const pay = r.payouts.find((p) => p.op === op);
        return pay ? peg(0.4 + (pay.amount / maxPay) * 0.9, 0.9) : peg(0.2, plateTone);
      });
      const count = k === 0 ? `${r.committed.length}/${ops.length}` : k === 1 ? `${r.revealed.length}/${ops.length}` : k === 2 ? v.map((x) => x.verdict).join(" · ") : r.payouts.length ? `${r.payouts.length} paid` : dark ? "withheld" : "waiting";
      labels.push({ i: W, j: 0, z: z + 0.2, text: `${name} · ${count}${k === 2 && target ? ` · ${nameOf(target)} mismatch` : ""}`, fail: (k === 2 && !!target) || dark });
    });
    return () => ({ cells, labels });
  }, [r, v]);
  return (
    <Section title="2. The current round" note="An exploded view of one round: four plates bottom up, the roster as pegs. A missing peg has not committed or revealed yet, a hole is the node a verifier caught, settle pegs rise with each payout.">
      <Where route="/jobs/7 · overview" replaces="the five-tile PhaseStrip and the Done / Waiting / Missed roster table in CurrentRound" />
      <div className="mz-seg" role="radiogroup" aria-label="Round" style={{ marginBottom: 12 }}>
        {Array.from({ length: job.currentRound || 1 }, (_, k) => k + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rn === n} aria-pressed={rn === n} className="mz-btn mz-btn-sm mz-btn-ghost" onClick={() => setRn(n)}>
            r{n}
          </button>
        ))}
      </div>
      <div className="mz-frame" style={{ height: 600 }}>
        <IsoMosaic scene={scene} cols={(r ? r.roster.length : 4) * 2 + 1} rows={2} maxH={7.4} label={`Job ${job.id} round ${rn} as stacked stage plates`} palette={pal} seed={35} gutter={0.3} build={1} playKey={rn} />
        <span className="mz-caption" data-tone={r && plateState(r, v).failed ? "fail" : undefined}>{`Job ${job.id} · ${job.workload} · round ${rn}\nstatus ${r ? r.status : "not reported"}`}</span>
      </div>
    </Section>
  );
}

/* 3. /nodes/[op]: the node's record as a street, one column per round it sat in. */

const RESULT: Record<NodeRoundResult, { h: number; tone: number }> = {
  paid: { h: 1.3, tone: 0.56 },
  fallback: { h: 0.8, tone: 0.4 },
  reverted: { h: 0.35, tone: 0.24 },
  voided: { h: 0.2, tone: 0.16 },
  live: { h: 1, tone: 0.9 },
  slashed: { h: 0, tone: 0 },
};

function NodeRecord() {
  const pal = usePalette();
  const [op, setOp] = useState(OPS[3].op);
  const ch = nodeChain[op];
  const hist = ch.history;
  const cols = Math.max(8, hist.length * 2 + 1);
  const scene: IsoScene = useMemo(() => {
    const cells: IsoCell[] = [];
    const labels: IsoLabel[] = [];
    const taken = new Set<string>();
    hist.forEach((x, k) => {
      const i = 1 + k * 2;
      taken.add(`${i},1`).add(`${i},2`);
      if (x.result === "slashed") {
        cells.push({ i, j: 1, h: 0, tone: 0, hole: true }, { i, j: 2, h: 0, tone: 0, hole: true });
        labels.push({ i: i + 1, j: 1, z: 0, text: `job ${x.job} r${x.round} · slashed`, fail: true });
        return;
      }
      const s = RESULT[x.result];
      cells.push({ i, j: 1, h: s.h, tone: s.tone }, { i, j: 2, h: s.h, tone: s.tone });
      if (x.result === "live") labels.push({ i: i + 1, j: 1, z: s.h, text: `job ${x.job} r${x.round} · live` });
    });
    floor(cells, cols, 4, taken);
    return () => ({ cells, labels });
  }, [hist, cols]);
  const paid = hist.filter((x) => x.result === "paid").length;
  return (
    <Section title="3. A node's record" note="Every round the node sat in, oldest first, as a street. Paid rounds stand tall, fallback and reverted rounds are lower, a slash is a gap in the street, the live round is bone.">
      <Where route="/nodes/[op]" replaces="the flat RoundRecord tile grid and the separate penalties card" />
      <div className="mz-seg" role="radiogroup" aria-label="Node" style={{ marginBottom: 12 }}>
        {OPS.slice(0, 7).map((o) => (
          <button key={o.op} type="button" role="radio" aria-checked={op === o.op} aria-pressed={op === o.op} className="mz-btn mz-btn-sm mz-btn-ghost" onClick={() => setOp(o.op)}>
            {o.name}
          </button>
        ))}
      </div>
      <div className="mz-frame" style={{ height: 420 }}>
        <IsoMosaic scene={scene} cols={cols} rows={4} maxH={1.6} label={`Round record for ${nameOf(op)}`} palette={pal} seed={44} gutter={0.24} build={1} playKey={op} />
        <span className="mz-caption">{`${nameOf(op)} · ${hist.length} rounds · ${paid} paid\nearned ${ch.earned === null ? "not reported" : formatToken(Math.round(ch.earned))} · missed reveals ${ch.missedReveals}`}</span>
      </div>
    </Section>
  );
}

/* 4. Home: the system, driven by the live round of job 7. Laptops are the real roster. */

function LiveSystem() {
  const pal = usePalette();
  const job = jobs[0];
  const [rn, setRn] = useState(job.currentRound || 1);
  const r = roundFor(job, rn);
  const v = verdictsFor(job, rn);
  const W = 18;
  const D = 13;
  const scene: IsoScene = useMemo(() => {
    if (!r) return () => ({ cells: [] });
    const { live, target } = plateState(r, v);
    const ops = r.roster.map((s) => s.op);
    return (t) => {
      const cells: IsoCell[] = [];
      const labels: IsoLabel[] = [];
      const taken = new Set<string>();
      const mark = (i: number, j: number, w: number, d: number) => {
        for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) taken.add(`${i + a},${j + b}`);
      };
      const pulse = (k: number) => (Math.floor(t * 4 - k) % 4 === 0 ? 1.05 : 0.7);
      const lane = (i0: number, j0: number, i1: number, j1: number, on: boolean, k: number) => {
        let i = i0;
        let j = j0;
        let n = 0;
        while (i !== i1 || j !== j1) {
          if (!taken.has(`${i},${j}`)) {
            cells.push({ i, j, h: 0.06, tone: on ? pulse(n - k) : 0.2 });
            taken.add(`${i},${j}`);
          }
          if (i !== i1) i += Math.sign(i1 - i);
          else j += Math.sign(j1 - j);
          n++;
        }
      };
      ops.forEach((op, k) => {
        const j = 1 + k * 3;
        const caught = op === target;
        const on = live === 0 ? r.committed.includes(op) : true;
        box(cells, 1, j, 2, 2, 0.6, live === 0 && on ? 1.05 : 0.5, 0, caught ? (a, b) => (a + b) % 2 === 0 : undefined);
        mark(1, j, 2, 2);
        labels.push({ i: 1, j: j + 1, z: 0.6, text: `${nameOf(op)}${caught ? " · caught" : ""}`, fail: caught, left: true });
      });
      box(cells, 7, 4, 3, 3, 1.4, live === 1 ? 1.05 : 0.5);
      mark(7, 4, 3, 3);
      v.forEach((x, k) => {
        const j = 1 + k * 7;
        box(cells, 12, j, 2, 2, 1, x.verdict === "fail" ? 0.3 : live === 2 ? 1.05 : 0.5);
        mark(12, j, 2, 2);
        labels.push({ i: 14, j, z: 1, text: `verifier ${k ? "b" : "a"} · ${x.verdict}`, fail: x.verdict === "fail" });
      });
      box(cells, 15, 9, 3, 3, 2.2, live >= 4 && r.payouts.length ? 1.05 : 0.88);
      mark(15, 9, 3, 3);
      ops.forEach((_, k) => lane(3, 2 + k * 3, 7, 5, live === 1, k));
      lane(10, 5, 12, 2, live === 2, 0);
      lane(10, 5, 12, 8, live === 2, 0);
      lane(14, 2, 16, 9, live >= 3, 0);
      lane(14, 8, 16, 9, live >= 3, 0);
      floor(cells, W, D, taken);
      labels.push({ i: 10, j: 4, z: 1.4, text: "coordinator" }, { i: 18, j: 9, z: 2.2, text: `contract · ${r.payouts.length ? `${r.payouts.length} paid` : r.outcome || "holding"}` });
      return { cells, labels };
    };
  }, [r, v]);
  return (
    <Section title="4. How it works, live" note="The product explainer, but drawn from the live round: the real roster on the left, the coordinator, both verifiers and the contract. Whatever stage the round is in is the block that lights.">
      <Where route="/ (landing)" replaces="the pixel-art HeroBanner and the four counters; also fits /demo and /docs/how-it-works" />
      <div className="mz-seg" role="radiogroup" aria-label="Round" style={{ marginBottom: 12 }}>
        {[8, 7, 6, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rn === n} aria-pressed={rn === n} className="mz-btn mz-btn-sm mz-btn-ghost" onClick={() => setRn(n)}>
            r{n} {roundFor(job, n)?.status}
          </button>
        ))}
      </div>
      <div className="mz-frame" style={{ height: 600 }}>
        <IsoMosaic scene={scene} cols={W} rows={D} maxH={2.6} label="System map driven by the live round" palette={pal} seed={62} gutter={0.2} gutterLeft={0.1} build={1.2} playKey={rn} />
        <span className="mz-caption">{`Job ${job.id} · round ${rn}\n${r ? r.status : "not reported"}`}</span>
      </div>
    </Section>
  );
}

/* 5. /nodes/join: the join flow builds the scene. Each finished step adds a block or lights a lane. */

const JOIN = ["Connect", "Install", "Pair", "Verify", "Stake", "Start"];

function JoinBuild() {
  const pal = usePalette();
  const [step, setStep] = useState(2);
  const at = useRef(0);
  const clock = useRef(0);
  const scene: IsoScene = useMemo(
    () => (t) => {
      clock.current = t;
      const grow = Math.min(1, (t - at.current) / 0.5);
      const g = (k: number) => (k === step - 1 ? grow : 1);
      const cells: IsoCell[] = [];
      const labels: IsoLabel[] = [];
      const taken = new Set<string>();
      const add = (i: number, j: number, w: number, d: number, h: number, tone: number) => {
        box(cells, i, j, w, d, h, tone);
        for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) taken.add(`${i + a},${j + b}`);
      };
      const path = (pts: [number, number][], tone: number) => pts.forEach(([i, j]) => taken.has(`${i},${j}`) || (cells.push({ i, j, h: 0.06, tone }), taken.add(`${i},${j}`)));
      const run = (i0: number, i1: number, j: number) => Array.from({ length: Math.abs(i1 - i0) + 1 }, (_, n): [number, number] => [Math.min(i0, i1) + n, j]);
      if (step > 0) add(1, 5, 3, 3, 1.2 * g(0), step === 1 ? 1.05 : 0.88);
      if (step > 1) add(9, 5, 3, 3, 0.9 * g(1), step === 2 ? 1.05 : 0.56);
      if (step > 2) path(run(4, 8, 6), step === 3 ? 1.05 : 0.56);
      if (step > 3) add(6, 6, 1, 1, 0.5 * g(3) + 0.06, step === 4 ? 1.05 : 0.9);
      if (step > 4) add(1, 1, 3, 2, 2 * g(4), step === 5 ? 1.05 : 0.64);
      if (step > 4) path(run(2, 2, 3).concat(run(2, 2, 4)), 0.5);
      if (step > 5) {
        add(14, 1, 3, 3, 1.5 * g(5), 0.5);
        path([[10, 4], [10, 3], [10, 2], [11, 2], [12, 2], [13, 2]], 1.05);
      }
      floor(cells, 18, 10, taken);
      if (step > 0) labels.push({ i: 1, j: 8, z: 1.2, text: "your wallet", left: true });
      if (step > 1) labels.push({ i: 9, j: 8, z: 0.9, text: "this laptop", left: true });
      if (step > 3) labels.push({ i: 7, j: 6, z: 0.56, text: "world id" });
      if (step > 4) labels.push({ i: 1, j: 3, z: 2, text: "bond · 15 usdc", left: true });
      if (step > 5) labels.push({ i: 17, j: 1, z: 1.5, text: "coordinator" });
      return { cells, labels };
    },
    [step],
  );
  const go = (s: number) => {
    at.current = clock.current;
    setStep(s);
  };
  return (
    <Section title="5. Joining builds the scene" note="Each of the six join steps adds a piece: the wallet, the laptop, the pairing lane between them, the World ID seal on that lane, the bond, then the lane out to the coordinator. The newest piece rises in bone.">
      <Where route="/nodes/join" replaces="the WizardProgress step labels in JoinFlow" />
      <div className="mz-row" style={{ marginBottom: 12 }}>
        <div className="mz-seg" role="radiogroup" aria-label="Steps done">
          {JOIN.map((s, k) => (
            <button key={s} type="button" role="radio" aria-checked={step === k + 1} aria-pressed={step === k + 1} className="mz-btn mz-btn-sm mz-btn-ghost" onClick={() => go(k + 1)}>
              {String(k + 1).padStart(2, "0")} {s}
            </button>
          ))}
        </div>
        <button type="button" className="mz-btn mz-btn-sm mz-btn-ghost" onClick={() => go(0)}>
          Reset
        </button>
      </div>
      <div className="mz-frame" style={{ height: 520 }}>
        <IsoMosaic scene={scene} cols={18} rows={10} maxH={2.2} label={`Join flow, ${step} of 6 steps done`} palette={pal} seed={73} gutter={0.18} gutterLeft={0.12} build={0.8} />
        <span className="mz-caption">{`Join · ${step} of 6\n${step === 6 ? "node online, waiting for idle time" : step ? `${JOIN[step - 1]} done` : "nothing yet"}`}</span>
      </div>
    </Section>
  );
}

export function InAppPage() {
  return (
    <>
      <NodePool />
      <RoundPlates />
      <NodeRecord />
      <LiveSystem />
      <JoinBuild />
    </>
  );
}

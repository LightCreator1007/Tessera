// The isometric diagrams from the brand playground, fed by the app's real data: the node pool as a city of earned
// pay, a round as four stacked plates with the roster as pegs, a node's record as a street, the live system on the
// home page and the join flow building its own scene. All share IsoMosaic, so tone rules match the flat mosaic:
// paid is lit, the live thing is bone, voided is faint, a slash is a hole.
"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { formatToken } from "@/lib/money";
import { short } from "@/components/primitives";
import type { Node, NodeChain, NodeRoundResult, Round, RoundVerdicts } from "@/lib/api/types";
import { IsoMosaic, type IsoCell, type IsoLabel, type IsoScene } from "./iso";

function box(out: IsoCell[], i: number, j: number, w: number, d: number, h: number, tone: number, z = 0, hole?: (a: number, b: number) => boolean) {
  for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) out.push(hole && hole(a, b) ? { i: i + a, j: j + b, z, h: 0, tone: 0, hole: true } : { i: i + a, j: j + b, z, h, tone });
}
function floor(out: IsoCell[], cols: number, rows: number, taken: Set<string>) {
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (!taken.has(`${i},${j}`)) out.push({ i, j, h: 0, tone: 0 });
}
const money = (u: number) => formatToken(Math.round(u));

/* The pool: one column per node, height = earned. A slash bites a corner; offline is a dark stub; no record is a plate. */
export function PoolCity({ nodes, mine }: { nodes: Node[]; mine: string | null }) {
  const chains = useQueries({ queries: nodes.map((n) => ({ queryKey: ["nodeChain", n.op], queryFn: () => api.nodeChain(n.op) })) });
  const sig = chains.map((q) => (q.data ? `${q.data.data.earned}:${q.data.data.penalties.length}` : "-")).join("|");
  const dense = nodes.length > 24;
  const per = Math.max(2, Math.min(dense ? 12 : 6, Math.ceil(Math.sqrt(nodes.length * 2))));
  const stride = dense ? 2 : 3;
  const foot = dense ? 1 : 2;
  const cols = per * stride + 1;
  const rows = Math.ceil(nodes.length / per) * stride + 1;
  const scene: IsoScene = useMemo(() => {
    const data: (NodeChain | null)[] = chains.map((q) => (q.data ? q.data.data : null));
    const cells: IsoCell[] = [];
    const labels: IsoLabel[] = [];
    const taken = new Set<string>();
    const max = Math.max(1, ...data.map((c) => (c && c.earned !== null ? c.earned : 0)));
    nodes.forEach((n, k) => {
      const c = data[k];
      const i = 1 + (k % per) * stride;
      const j = 1 + Math.floor(k / per) * stride;
      for (let a = 0; a < foot; a++) for (let b = 0; b < foot; b++) taken.add(`${i + a},${j + b}`);
      const me = mine !== null && n.op.toLowerCase() === mine;
      const slashed = !!c && c.penalties.some((p) => p.kind === "Slashed");
      if (!c || c.earned === null) {
        box(cells, i, j, foot, foot, 0.06, me ? 0.9 : 0.14);
        if (me || !dense) labels.push({ i: i + foot, j, z: 0.1, text: `${short(n.op, 4, 4)} · earned not reported` });
        return;
      }
      const h = 0.25 + (c.earned / max) * 3;
      const tone = me ? 0.9 : !n.online ? 0.2 : n.idle ? 0.4 : 0.64;
      box(cells, i, j, foot, foot, h, tone, 0, slashed && foot > 1 ? (a, b) => a === 1 && b === 1 : undefined);
      if (me || (slashed && !dense)) labels.push({ i: i + foot, j, z: h, text: `${me ? "you · " : ""}${short(n.op, 4, 4)} · ${money(c.earned)}${slashed ? " · slashed" : ""}`, fail: slashed && !me });
    });
    floor(cells, cols, rows, taken);
    return () => ({ cells, labels });
    // `sig` summarises the chain queries, which are a new array on every render.
  }, [sig, nodes, mine, per, stride, foot, cols, rows]);
  return <IsoMosaic scene={scene} cols={cols} rows={rows} maxH={3.4} label={`Node pool: ${nodes.length} nodes, column height is earned pay`} seed={21} gutter={0.26} build={1.2} />;
}

/* A round: four plates (commit, reveal, verify, settle) bottom up, the roster as pegs on the front row. */
const PLATES = ["commit", "reveal", "verify", "settle"] as const;
export function roundStage(r: Round, v: RoundVerdicts) {
  const live = r.status === "committing" ? 0 : r.status === "revealing" ? 1 : r.status === "verifying" ? 2 : r.status === "open" ? -1 : 4;
  const failed = r.status === "reverted" || v.some((x) => x.verdict === "fail");
  return { live, failed, target: v.find((x) => x.target)?.target };
}
export function RoundPlates({ round: r, verdicts: v }: { round: Round; verdicts: RoundVerdicts }) {
  const W = r.roster.length * 2 + 1;
  const scene: IsoScene = useMemo(() => {
    const ops = r.roster.map((s) => s.op);
    const cells: IsoCell[] = [];
    const labels: IsoLabel[] = [];
    const { live, failed, target } = roundStage(r, v);
    const maxPay = Math.max(1, ...r.payouts.map((p) => p.amount));
    PLATES.forEach((name, k) => {
      const z = k * 2.2;
      const active = k === live;
      const dark = failed && k === 3 && !r.payouts.length;
      const plate = dark ? 0.12 : active ? 0.5 : k < live ? 0.36 : 0.2;
      for (let i = 0; i < W; i++) for (let j = 0; j < 2; j++) if (!(j === 1 && i % 2 === 1)) cells.push({ i, j, z, h: 0.2, tone: plate });
      ops.forEach((op, n) => {
        const i = 1 + n * 2;
        const peg = (h: number, t: number) => cells.push({ i, j: 1, z, h, tone: t });
        if (k === 0) return r.committed.includes(op) ? peg(0.55, 0.64) : peg(0.2, plate);
        if (k === 1) return r.revealed.includes(op) ? peg(0.55, 0.64) : peg(0.2, plate);
        if (k === 2) {
          if (op === target) return cells.push({ i, j: 1, z, h: 0, tone: 0, hole: true });
          return live > 2 || r.status === "verifying" ? peg(0.55, 0.64) : peg(0.2, plate);
        }
        const pay = r.payouts.find((p) => p.op === op);
        return pay ? peg(0.4 + (pay.amount / maxPay) * 0.9, 0.9) : peg(0.2, plate);
      });
      const count = k === 0 ? `${r.committed.length}/${ops.length}` : k === 1 ? `${r.revealed.length}/${ops.length}` : k === 2 ? (v.length ? v.map((x) => x.verdict).join(" · ") : "waiting") : r.payouts.length ? `${r.payouts.length} paid` : dark ? "withheld" : "waiting";
      labels.push({ i: W, j: 0, z: z + 0.2, text: `${name} · ${count}${k === 2 && target ? ` · ${short(target, 4, 4)} mismatch` : ""}${active ? " · now" : ""}`, fail: (k === 2 && !!target) || dark });
    });
    return () => ({ cells, labels });
  }, [r, v, W]);
  return <IsoMosaic scene={scene} cols={W} rows={2} maxH={7.4} label={`Round ${r.round}: ${r.status}`} seed={35} gutter={0.36} build={1} playKey={`${r.round}-${r.status}`} />;
}

/* A node's record: every round it sat in, oldest first, as a street; a slash is a gap, the live round is bone. */
const RESULT: Record<NodeRoundResult, { h: number; tone: number }> = {
  paid: { h: 1.3, tone: 0.56 },
  fallback: { h: 0.8, tone: 0.4 },
  reverted: { h: 0.35, tone: 0.24 },
  voided: { h: 0.2, tone: 0.16 },
  live: { h: 1, tone: 0.9 },
  slashed: { h: 0, tone: 0 },
};
export function RecordStreet({ chain }: { chain: NodeChain }) {
  const hist = chain.history;
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
  return <IsoMosaic scene={scene} cols={cols} rows={4} maxH={1.6} label={`Round record: ${hist.length} rounds`} seed={44} gutter={0.24} build={1} />;
}

/* The live system: the round's real roster, the coordinator, both verifiers and the contract; the stage lights. */
export function LiveSystem({ round: r, verdicts: v }: { round: Round; verdicts: RoundVerdicts }) {
  const W = 18;
  const D = Math.max(13, r.roster.length * 3 + 1);
  const scene: IsoScene = useMemo(() => {
    const { live, target } = roundStage(r, v);
    const ops = r.roster.map((s) => s.op);
    const vs: { verdict: string }[] = v.length ? v.slice(0, 2) : [{ verdict: "pending" }, { verdict: "pending" }];
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
        labels.push({ i: 1, j: j + 1, z: 0.6, text: `${short(op, 4, 4)}${caught ? " · caught" : ""}`, fail: caught, left: true });
      });
      const mid = Math.floor(D / 2) - 1;
      box(cells, 7, mid, 3, 3, 1.4, live === 1 ? 1.05 : 0.5);
      mark(7, mid, 3, 3);
      const vj = [1, D - 4];
      vs.forEach((x, k) => {
        box(cells, 12, vj[k], 2, 2, 1, x.verdict === "fail" ? 0.3 : live === 2 ? 1.05 : 0.5);
        mark(12, vj[k], 2, 2);
        labels.push({ i: 14, j: vj[k], z: 1, text: `verifier ${k ? "b" : "a"} · ${x.verdict}`, fail: x.verdict === "fail" });
      });
      box(cells, 15, mid, 3, 3, 2.2, live >= 4 && r.payouts.length ? 1.05 : 0.88);
      mark(15, mid, 3, 3);
      ops.forEach((_, k) => lane(3, 2 + k * 3, 7, mid + 1, live === 1, k));
      lane(10, mid + 1, 12, vj[0] + 1, live === 2, 0);
      lane(10, mid + 1, 12, vj[1], live === 2, 0);
      lane(14, vj[0] + 1, 16, mid, live >= 3, 0);
      lane(14, vj[1], 16, mid, live >= 3, 0);
      floor(cells, W, D, taken);
      labels.push({ i: 7, j: mid + 3, z: 0, text: "coordinator", left: true }, { i: 18, j: mid, z: 2.2, text: `contract · ${r.payouts.length ? `${r.payouts.length} paid` : r.outcome ? r.outcome.toLowerCase() : "holding the budget"}` });
      return { cells, labels };
    };
  }, [r, v, D]);
  return <IsoMosaic scene={scene} cols={W} rows={D} maxH={2.6} label={`Round ${r.round} live: ${r.status}`} seed={62} gutter={0.2} gutterLeft={0.12} build={1.2} playKey={`${r.round}-${r.status}`} />;
}

/* Joining builds the scene: wallet, laptop, pairing lane, World ID seal, bond, then the lane to the coordinator. */
export function JoinBuild({ done }: { done: number }) {
  const scene: IsoScene = useMemo(
    () => () => {
      const cells: IsoCell[] = [];
      const labels: IsoLabel[] = [];
      const taken = new Set<string>();
      const add = (i: number, j: number, w: number, d: number, h: number, tone: number) => {
        box(cells, i, j, w, d, h, tone);
        for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) taken.add(`${i + a},${j + b}`);
      };
      const path = (pts: [number, number][], tone: number) =>
        pts.forEach(([i, j]) => {
          if (taken.has(`${i},${j}`)) return;
          cells.push({ i, j, h: 0.06, tone });
          taken.add(`${i},${j}`);
        });
      const run = (i0: number, i1: number, j: number) => Array.from({ length: Math.abs(i1 - i0) + 1 }, (_, n): [number, number] => [Math.min(i0, i1) + n, j]);
      const newest = (k: number) => done === k + 1;
      if (done > 0) add(1, 5, 3, 3, 1.2, newest(0) ? 1.05 : 0.88);
      if (done > 1) add(9, 5, 3, 3, 0.9, newest(1) ? 1.05 : 0.56);
      if (done > 2) path(run(4, 8, 6), newest(2) ? 1.05 : 0.56);
      if (done > 3) add(6, 6, 1, 1, 0.56, newest(3) ? 1.05 : 0.9);
      if (done > 4) {
        add(1, 1, 3, 2, 2, newest(4) ? 1.05 : 0.64);
        path(run(2, 2, 3).concat(run(2, 2, 4)), 0.5);
      }
      if (done > 5) {
        add(14, 1, 3, 3, 1.5, 0.5);
        path([[10, 4], [10, 3], [10, 2], [11, 2], [12, 2], [13, 2]], 1.05);
      }
      floor(cells, 18, 10, taken);
      if (done > 0) labels.push({ i: 1, j: 8, z: 1.2, text: "your wallet", left: true });
      if (done > 1) labels.push({ i: 9, j: 8, z: 0.9, text: "this laptop", left: true });
      if (done > 3) labels.push({ i: 7, j: 6, z: 0.56, text: "world id" });
      if (done > 4) labels.push({ i: 1, j: 3, z: 2, text: "bond", left: true });
      if (done > 5) labels.push({ i: 17, j: 1, z: 1.5, text: "coordinator" });
      return { cells, labels };
    },
    [done],
  );
  return <IsoMosaic scene={scene} cols={18} rows={10} maxH={2.2} label={`Joining: ${done} of 6 steps done`} seed={73} gutter={0.16} gutterLeft={0.14} build={0.8} playKey={done} />;
}

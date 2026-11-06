// Diagrams, three takes. A: a round as four stacked words that light in order (verify cracks on a lazy node).
// B: who earned what, as a stacked bar chart built from word tiles. C: the network as the tiger, one cell per node.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB_SHORT, mulberry32, type FieldFn } from "@/components/mosaic/engine";
import { coverById, sampler, useGray } from "@/components/mosaic/figures";
import { tone } from "@/components/mosaic/fields";
import { lineAt, useTextGray } from "@/components/mosaic/type";
import { Section, usePalette } from "../shell";

const STAGES = [
  { w: "COMMIT", what: "The node commits a hash of its update" },
  { w: "REVEAL", what: "It reveals the update blob" },
  { w: "VERIFY", what: "Two verifiers replay a random slice" },
  { w: "SETTLE", what: "Paid by contribution" },
];

/** A: four words, one per stage. Done stages hold red, the live one dissolves to bone, a lazy node cracks VERIFY. */
function RoundWords() {
  const pal = usePalette();
  const [i, setI] = useState(0);
  const [lazy, setLazy] = useState(false);
  const at = useRef(0);
  const st = useRef({ i: 0, lazy: false });
  st.current = { i, lazy };
  useEffect(() => {
    const id = setInterval(() => {
      at.current = performance.now();
      setI((v) => (v + 1) % 5);
    }, 1500);
    return () => clearInterval(id);
  }, []);
  const g = useTextGray(STAGES.map((s) => s.w).join("\n"), 700);
  const scale = 0.94;
  const field: FieldFn = useMemo(() => {
    const s = sampler(g, { fit: "contain", scale, ax: 0.06, ay: 0.5 });
    return (tile, c) => {
      const v = s(tile, c);
      if (v < 0.4) return 0;
      const { i: k, lazy: z } = st.current;
      const line = lineAt(tile.cy, c.H, 4, scale);
      if (z && line === 2 && k >= 2) {
        const crack = c.W * 0.22 + Math.sin(tile.cy / 9) * 18 + (tile.cy / c.H) * 40;
        if (Math.abs(tile.cx - crack) < 14) return -1;
        return 0.3;
      }
      if (z && line === 3 && k >= 2) return 0.12;
      if (line < k) return 0.5;
      if (line > k) return 0.17;
      const age = Math.min(1, (performance.now() - at.current) / 600);
      if (tile.r >= age) return 0.5;
      return age < 1 && tile.r > age - 0.15 ? 1.05 : 0.86;
    };
  }, [g]);
  const failed = lazy && i >= 2;
  const cap = i >= 4 ? "Round 12 closed" : failed ? "Replay mismatch at step 412\nΔ 0.031 > tol 0.001 · slashed" : `${String(i + 1).padStart(2, "0")} / 04\n${STAGES[i].what}`;
  return (
    <Section title="A. A round, in four words" note="Simple. The protocol is its own diagram: COMMIT, REVEAL, VERIFY, SETTLE light in order. Turn on the lazy node.">
      <div className="mz-row" style={{ marginBottom: 12 }}>
        <button type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={lazy} onClick={() => setLazy((v) => !v)}>
          lazy node
        </button>
      </div>
      <div className="mz-frame" style={{ height: 640 }}>
        <Mosaic field={field} label="Round stages: commit, reveal, verify, settle" vocab={VOCAB_SHORT} cell={8} seed={52} palette={pal} />
        <span className="mz-caption mz-caption-right" data-tone={failed ? "fail" : undefined}>
          {cap}
        </span>
      </div>
    </Section>
  );
}

const ROUNDS = 24;
const NODES = 5;
const YOU = 2;
const SLASH = { round: 9, node: 3 };

function contributions() {
  const r = mulberry32(17);
  return Array.from({ length: ROUNDS }, () => {
    const parts = Array.from({ length: NODES }, () => 0.2 + r());
    const total = 0.35 + r() * 0.6;
    const sum = parts.reduce((a, b) => a + b, 0);
    return parts.map((p) => (p / sum) * total);
  });
}

/** B: a stacked bar per round, each segment a node's share. Yours is bone; a slashed share is a hole. */
function EarningsChart() {
  const pal = usePalette();
  const data = useMemo(contributions, []);
  const LV = [0.3, 0.42, 0.9, 0.56, 0.66];
  const field: FieldFn = useMemo(
    () => (tile, c) => {
      const mx = 16;
      const top = 24;
      const bottom = 30;
      const cw = (c.W - mx * 2) / ROUNDS;
      const col = Math.floor((tile.cx - mx) / cw);
      if (col < 0 || col >= ROUNDS) return 0;
      if ((tile.cx - mx) / cw - col > 0.78) return 0;
      const shown = Math.floor((c.t / 0.45) % (ROUNDS + 6));
      if (col > shown) return 0;
      const ph = c.H - top - bottom;
      const y = (c.H - bottom - tile.cy) / ph;
      if (y < 0) return 0;
      let acc = 0;
      for (let n = 0; n < NODES; n++) {
        acc += data[col][n];
        if (y < acc) {
          if (col === SLASH.round && n === SLASH.node) return -1;
          return col === shown ? 1.05 : LV[n];
        }
      }
      return 0;
    },
    [data],
  );
  return (
    <Section title="B. Who earned what" note="Complex. A stacked bar per round built from word tiles. Your share is bone; the hole in round 10 is a slashed share.">
      <div className="mz-frame" style={{ height: 380 }}>
        <Mosaic field={field} label="Earnings per round by node" cell={8} seed={64} palette={pal} empty={0.12} />
        <span className="mz-caption">{"Rounds 1-24 · job 07\nyou: 31% of paid work"}</span>
      </div>
      <div className="mz-legend">
        <span><i className="mz-sw-active" />you, 0x8a4F</span>
        <span><i className="mz-sw-done" />other nodes</span>
        <span><i className="mz-sw-fail" />slashed share</span>
      </div>
    </Section>
  );
}

/** C: the tiger cut into an 8 x 6 grid; each cell is a node. Idle cells fade, slashed cells are holes, yours is bone. */
function TigerPool() {
  const pal = usePalette();
  const c = coverById("tiger");
  const g = useGray(c.src);
  const cells = useMemo(() => {
    const r = mulberry32(5);
    return Array.from({ length: 48 }, (_, k) => (k === 27 ? "you" : k === 14 || k === 38 ? "slashed" : r() < 0.3 ? "idle" : "busy"));
  }, []);
  const field: FieldFn = useMemo(() => {
    const s = sampler(g, { fit: "cover", scale: 1.55, ax: 0.5, ay: 0.4 });
    return (tile, cx) => {
      const v = tone(s(tile, cx), c.tone);
      const col = Math.min(7, Math.floor((tile.cx / cx.W) * 8));
      const row = Math.min(5, Math.floor((tile.cy / cx.H) * 6));
      const st = cells[row * 8 + col];
      const yx = ((27 % 8) + 0.5) * (cx.W / 8);
      const yy = (Math.floor(27 / 8) + 0.5) * (cx.H / 6);
      const front = (cx.t % 3.4) * cx.W * 0.42;
      const d = Math.hypot(tile.cx - yx, (tile.cy - yy) * 1.3);
      const wave = Math.exp(-(((d - front) / 24) ** 2)) * Math.max(0, 1 - front / cx.W);
      if (st === "slashed") return v > 0.12 ? -1 : 0;
      if (st === "you") return v > 0.1 ? Math.max(v, 0.9) : 0.28;
      const base = st === "idle" ? v * 0.32 : v;
      return v > 0.1 ? Math.max(base, base + wave * 0.45) : wave * 0.3;
    };
  }, [g, c.tone, cells]);
  return (
    <Section title="C. The network is the animal" note="Each cell of the tiger is a node. Busy nodes draw it, idle ones fade, slashed ones leave holes; accepted rounds ripple out from yours.">
      <div className="mz-frame" style={{ height: 560 }}>
        <Mosaic field={field} label="Node pool drawn as a tiger" cell={9} seed={71} palette={pal} />
        <span className="mz-caption">{"48 nodes · 33 busy · 2 slashed\nyou: 0x8a4F, round 12 accepted"}</span>
      </div>
    </Section>
  );
}

export function DiagramsPage() {
  return (
    <>
      <RoundWords />
      <EarningsChart />
      <TigerPool />
    </>
  );
}

// Isometric diagrams, simple to complex. A: a print laid on the floor. B: the print as relief, a wave passing.
// C: the node pool as a city of earnings columns. D: a round as four stacked plates. E: the system as blocks and lanes.
"use client";

import { useMemo, useRef, useState } from "react";
import { mulberry32 } from "@/components/mosaic/engine";
import { coverById, useGray } from "@/components/mosaic/figures";
import { tone } from "@/components/mosaic/fields";
import { IsoMosaic, grayAt, type IsoCell, type IsoLabel, type IsoScene } from "@/components/mosaic/iso";
import { Section, usePalette } from "../shell";

function FloorPrint() {
  const pal = usePalette();
  const c = coverById("crow");
  const g = useGray(c.src);
  const N = 40;
  const scene: IsoScene = useMemo(() => {
    const cells: IsoCell[] = [];
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const v = g ? Math.min(1, tone(grayAt(g, i / N, j / N, 1.05, 0.35), c.tone) * 1.25) : 0;
        cells.push({ i, j, h: v > 0.1 ? 0.1 + v * 0.45 : 0, tone: v });
      }
    return () => ({ cells });
  }, [g, c.tone]);
  return (
    <Section title="A. The print on the floor" note="Simple. The crow cover laid flat on an isometric floor of word tiles. Tiles drop in on random delays; that is dissolve in 3D.">
      <div className="mz-frame" style={{ height: 520 }}>
        <IsoMosaic scene={scene} cols={N} rows={N} maxH={0.6} label="Crow print on an isometric tile floor" palette={pal} seed={3} build={2.2} />
        <span className="mz-caption">{"Cawing crow · S07 / E01\nfloor, 1600 tiles"}</span>
      </div>
    </Section>
  );
}

function Relief() {
  const pal = usePalette();
  const [fig, setFig] = useState("owl");
  const c = coverById(fig);
  const g = useGray(c.src);
  const N = 30;
  const scene: IsoScene = useMemo(() => {
    const base: number[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) base.push(g ? tone(grayAt(g, i / N, j / N, c.fit.scale, c.fit.ax, c.fit.ay), c.tone) : 0);
    return (t) => {
      const front = ((t * 9) % (N * 2.6)) - 4;
      const cells: IsoCell[] = [];
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          const v = base[i * N + j];
          const crest = Math.exp(-(((i + j) * 0.7 - front) ** 2) / 3);
          const h = v > 0.1 ? v * 2.2 + crest * 0.5 : crest * 0.12;
          cells.push({ i, j, h, tone: v > 0.1 && crest > 0.6 ? 1.05 : v });
        }
      return { cells };
    };
  }, [g, c]);
  return (
    <Section title="B. The print as relief" note="Complex. Tone becomes height, so the figure stands up off the floor. A bone crest rolls across it; use it for a long wait or a season close.">
      <div className="mz-seg" role="radiogroup" aria-label="Figure" style={{ marginBottom: 12 }}>
        {["owl", "tiger", "cat", "fuji"].map((id) => (
          <button key={id} type="button" role="radio" aria-checked={fig === id} className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={fig === id} onClick={() => setFig(id)}>
            {id}
          </button>
        ))}
      </div>
      <div className="mz-frame" style={{ height: 600 }}>
        <IsoMosaic scene={scene} cols={N} rows={N} maxH={2.9} label={`${c.title} as an isometric relief`} palette={pal} seed={9} playKey={fig} build={2.4} />
        <span className="mz-caption">{`${c.title}\nheight = ink`}</span>
      </div>
    </Section>
  );
}

const CITY = 10;
const YOU = { i: 6, j: 4 };

function NodeCity() {
  const pal = usePalette();
  const [round, setRound] = useState(12);
  const at = useRef(-10);
  const clock = useRef(0);
  const nodes = useMemo(() => {
    const r = mulberry32(31);
    return Array.from({ length: CITY * CITY }, (_, k) => {
      const i = Math.floor(k / CITY);
      const j = k % CITY;
      const kind = i === YOU.i && j === YOU.j ? "you" : (i === 2 && j === 7) || (i === 9 && j === 1) ? "slashed" : r() < 0.22 ? "idle" : "busy";
      return { i, j, kind, earn: 0.4 + r() * 1.6 };
    });
  }, []);
  const scene: IsoScene = useMemo(
    () => (t) => {
      clock.current = t;
      const age = t - at.current;
      const cells: IsoCell[] = [];
      const labels: IsoLabel[] = [];
      for (const n of nodes) {
        const grow = Math.min(1, Math.max(0, (round - 9) / 6));
        const d = Math.hypot(n.i - YOU.i, n.j - YOU.j);
        const wave = age < 3 ? Math.exp(-((d - age * 5) ** 2) / 1.5) : 0;
        if (n.kind === "slashed") {
          cells.push({ i: n.i, j: n.j, h: 0, tone: 0, hole: true });
          continue;
        }
        if (n.kind === "idle") {
          cells.push({ i: n.i, j: n.j, h: 0.15 + wave * 0.3, tone: 0.24 + wave * 0.4 });
          continue;
        }
        const h = n.kind === "you" ? 2.4 + grow * 0.8 : n.earn * (0.7 + grow * 0.4);
        cells.push({ i: n.i, j: n.j, h: h + wave * 0.5, tone: n.kind === "you" ? 0.9 : wave > 0.4 ? 1.05 : 0.38 + n.earn * 0.14 });
      }
      labels.push({ i: YOU.i + 1, j: YOU.j, z: 2.4 + Math.min(1, Math.max(0, (round - 9) / 6)) * 0.8, text: `you 0x8a4F · round ${round} accepted` });
      labels.push({ i: 10, j: 1.5, z: 0, text: "slashed: replay mismatch", fail: true });
      return { cells, labels };
    },
    [nodes, round],
  );
  return (
    <Section title="C. The pool as a city" note="Each node is a column; height is what it earned this job. Idle nodes are stubs, slashed nodes are holes in the floor. An accepted round sends a lit ring out from yours.">
      <div className="mz-row" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="mz-btn mz-btn-sm mz-btn-primary"
          onClick={() => {
            at.current = clock.current;
            setRound((r) => r + 1);
          }}
        >
          Accept round {round + 1}
        </button>
      </div>
      <div className="mz-frame" style={{ height: 560 }}>
        <IsoMosaic scene={scene} cols={CITY} rows={CITY} maxH={4} label="Node pool as isometric columns of earnings" palette={pal} seed={41} gutter={0.22} build={1.4} />
        <span className="mz-caption">{`100 nodes · 22 idle · 2 slashed\njob 07 · round ${round}`}</span>
      </div>
    </Section>
  );
}

const PLATES = ["commit", "reveal", "verify", "settle"];
const PN = 7;

function RoundStack() {
  const pal = usePalette();
  const [stage, setStage] = useState(1);
  const [lazy, setLazy] = useState(false);
  const at = useRef(0);
  const clock = useRef(0);
  const scene: IsoScene = useMemo(
    () => (t) => {
      clock.current = t;
      const lift = Math.min(1, (t - at.current) / 0.5);
      const cells: IsoCell[] = [];
      const labels: IsoLabel[] = [];
      PLATES.forEach((name, k) => {
        const failed = lazy && k === 2 && stage >= 2;
        const dead = lazy && k === 3 && stage >= 2;
        const active = k === stage && !failed;
        const z = k * 1.5 + (active ? 0.45 * (1 - Math.pow(1 - lift, 3)) : 0);
        for (let i = 0; i < PN; i++)
          for (let j = 0; j < PN; j++) {
            if (failed && Math.abs(i - j * 0.6 - 2 - Math.sin(j) * 0.8) < 0.8) {
              cells.push({ i, j, z, h: 0, tone: 0, hole: true });
              continue;
            }
            const sweep = active && (i + j) / (PN * 2) < lift;
            const tn = dead ? 0.12 : failed ? 0.3 : active ? (sweep ? 0.9 : 0.5) : k < stage ? 0.56 : 0.2;
            cells.push({ i, j, z, h: 0.32, tone: tn });
          }
        const tag = failed ? "verify: replay mismatch, slashed" : dead ? "settle: withheld" : `${String(k + 1).padStart(2, "0")} ${name}${active ? " · now" : k < stage ? " · done" : ""}`;
        labels.push({ i: PN, j: 0, z: z + 0.32, text: tag, fail: failed });
      });
      return { cells, labels };
    },
    [stage, lazy],
  );
  const go = (s: number) => {
    at.current = clock.current;
    setStage(s);
  };
  return (
    <Section title="D. A round as a stack" note="An exploded view: one plate per stage, bottom to top. Done plates hold red, the live one lifts and fills with bone, a lazy node cracks the verify plate and leaves settle dark.">
      <div className="mz-row" style={{ marginBottom: 12 }}>
        <div className="mz-seg" role="radiogroup" aria-label="Stage">
          {PLATES.map((p, k) => (
            <button key={p} type="button" role="radio" aria-checked={stage === k} aria-pressed={stage === k} className="mz-btn mz-btn-sm mz-btn-ghost" onClick={() => go(k)}>
              {p}
            </button>
          ))}
        </div>
        <button type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={lazy} onClick={() => setLazy((v) => !v)}>
          lazy node
        </button>
      </div>
      <div className="mz-frame" style={{ height: 620 }}>
        <IsoMosaic scene={scene} cols={PN} rows={PN} maxH={6.2} label="Round stages as stacked isometric plates" palette={pal} seed={57} gutter={0.32} build={1.2} />
        <span className="mz-caption">{"Round 12 · job 07\n4 stages, bottom up"}</span>
      </div>
    </Section>
  );
}

interface Block {
  id: string;
  i: number;
  j: number;
  w: number;
  d: number;
  h: number;
  tone: number;
}

const BLOCKS: Block[] = [
  { id: "laptop", i: 1, j: 2, w: 3, d: 3, h: 0.8, tone: 0.56 },
  { id: "coordinator", i: 8, j: 2, w: 3, d: 3, h: 1.6, tone: 0.5 },
  { id: "verifier a", i: 14, j: 1, w: 2, d: 2, h: 1.1, tone: 0.5 },
  { id: "verifier b", i: 14, j: 6, w: 2, d: 2, h: 1.1, tone: 0.5 },
  { id: "contract", i: 15, j: 11, w: 3, d: 3, h: 2.6, tone: 0.9 },
];

/** Lanes as floor-cell paths between block edges. */
function lane(a: [number, number], b: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  let [i, j] = a;
  while (i !== b[0]) {
    out.push([i, j]);
    i += Math.sign(b[0] - i);
  }
  while (j !== b[1]) {
    out.push([i, j]);
    j += Math.sign(b[1] - j);
  }
  out.push(b);
  return out;
}

const LANES = [lane([4, 3], [7, 3]), lane([11, 3], [13, 2]), lane([11, 3], [13, 7]), lane([15, 3], [16, 10]), lane([15, 8], [16, 10])];
const STEPS = ["Laptop reveals its update blob", "Coordinator assigns two verifiers", "Each replays a random slice", "Both attest on-chain; the contract pays"];

function SystemMap() {
  const pal = usePalette();
  const [fail, setFail] = useState(false);
  const [cap, setCap] = useState(0);
  const capRef = useRef(0);
  const W = 20;
  const D = 15;
  const scene: IsoScene = useMemo(
    () => (t) => {
      const cells: IsoCell[] = [];
      const lit = new Map<string, number>();
      const cyc = t % 6;
      const phase = Math.floor(cyc / 1.5);
      if (phase !== capRef.current) {
        capRef.current = phase;
        queueMicrotask(() => setCap(phase));
      }
      const path = (k: number, p: number, blocked = false) => {
        const L = LANES[k];
        const head = Math.floor(p * (L.length + 3));
        L.forEach(([i, j], n) => {
          const key = `${i},${j}`;
          if (blocked && n > L.length / 2) return lit.set(key, Math.max(lit.get(key) || 0.18, 0.18));
          const v = n === head ? 1.05 : n < head && n > head - 3 ? 0.7 : 0.3;
          lit.set(key, Math.max(lit.get(key) || 0, v));
        });
      };
      const p = (cyc % 1.5) / 1.5;
      path(0, phase === 0 ? p : phase > 0 ? 1.2 : 0);
      path(1, phase === 1 ? p : phase > 1 ? 1.2 : -1);
      path(2, phase === 1 ? p : phase > 1 ? 1.2 : -1);
      path(3, phase === 3 ? p : -1);
      path(4, phase === 3 ? p : -1, fail);
      const owner = new Map<string, Block>();
      for (const b of BLOCKS) for (let i = b.i; i < b.i + b.w; i++) for (let j = b.j; j < b.j + b.d; j++) owner.set(`${i},${j}`, b);
      for (let i = 0; i < W; i++)
        for (let j = 0; j < D; j++) {
          const b = owner.get(`${i},${j}`);
          if (b) {
            const broken = fail && b.id === "verifier b";
            const busy = (phase === 0 && b.id === "laptop") || (phase === 1 && b.id === "coordinator") || (phase === 2 && b.id.startsWith("verifier")) || (phase === 3 && b.id === "contract");
            if (broken && (i + j) % 2 === 0) {
              cells.push({ i, j, h: 0, tone: 0, hole: true });
              continue;
            }
            cells.push({ i, j, h: b.h, tone: broken ? 0.3 : busy ? 1.05 : b.tone });
            continue;
          }
          const v = lit.get(`${i},${j}`);
          cells.push({ i, j, h: v !== undefined ? 0.08 : 0, tone: v !== undefined ? v : 0 });
        }
      const labels: IsoLabel[] = BLOCKS.map((b) => ({ i: b.i + b.w, j: b.j, z: b.h, text: fail && b.id === "verifier b" ? "verifier b: mismatch" : b.id, fail: fail && b.id === "verifier b" }));
      return { cells, labels };
    },
    [fail],
  );
  return (
    <Section title="E. The system as a map" note="Complex. Laptop, coordinator, two verifiers and the contract as blocks on one floor; work travels the lanes as a lit packet. Break a verifier and its lane goes dark.">
      <div className="mz-row" style={{ marginBottom: 12 }}>
        <button type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={fail} onClick={() => setFail((v) => !v)}>
          verifier b disagrees
        </button>
      </div>
      <div className="mz-frame" style={{ height: 600 }}>
        <IsoMosaic scene={scene} cols={W} rows={D} maxH={3} label="System map: laptop, coordinator, verifiers and contract" palette={pal} seed={88} gutter={0.18} build={1.6} />
        <span className="mz-caption" data-tone={fail && cap === 3 ? "fail" : undefined}>
          {`${String(cap + 1).padStart(2, "0")} / 04\n${fail && cap === 3 ? "Verifier b disagrees: round goes to dispute" : STEPS[cap]}`}
        </span>
      </div>
    </Section>
  );
}

export function IsoPage() {
  return (
    <>
      <FloorPrint />
      <Relief />
      <NodeCity />
      <RoundStack />
      <SystemMap />
    </>
  );
}

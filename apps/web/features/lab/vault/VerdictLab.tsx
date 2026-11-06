// V2, after vault/eclipse-grid: one ring per node in a round; a disc slips out from behind it by the node's replay delta.
"use client";

import { useDialKit } from "dialkit";
import { useMemo, useState } from "react";
import { LabFrame, Readout, seeded } from "./Frame";

type Phase = "verifying" | "settled";
interface Cell {
  op: string;
  delta: number | null; // null = no submission
  step: number;
}

const PITCH = 56;
const R = 20;

function makeRound(n: number, tol: number, misRate: number, missRate: number, seed: number): Cell[] {
  const rnd = seeded(seed);
  return Array.from({ length: n }, (_, i) => {
    const op = `0x${Math.floor(rnd() * 0xffff).toString(16).padStart(4, "0")}`;
    const step = 200 + Math.floor(rnd() * 400);
    if (rnd() < missRate) return { op, delta: null, step };
    const bad = rnd() < misRate;
    // Honest nodes land well inside tolerance (most of them exactly), cheats or broken runs land well outside it.
    const delta = bad ? tol * (1.5 + rnd() * 9) : rnd() < 0.55 ? 0 : tol * rnd() * 0.9;
    return { op, delta, step };
  });
}

/** How far the disc slips, in units of R. Inside tolerance it stays a hairline (at most 0.16R); past it there is a jump to 0.45R, then log growth to a full eclipse, so the tolerance line is visible as a step. */
const slip = (delta: number, tol: number) => {
  const k = delta / tol;
  return k <= 1 ? k * 0.16 : Math.min(1, 0.45 + Math.log2(k) * 0.14);
};

export function VerdictLab() {
  const d = useDialKit(
    "V2 Verdict grid",
    {
      nodes: [24, 1, 72, 1],
      tolerance: [0.001, 0.0001, 0.01, 0.0001],
      mismatchRate: [0.12, 0, 1, 0.01],
      missingRate: [0.06, 0, 0.5, 0.01],
      phase: { type: "select", options: ["verifying", "settled"] },
      seed: [7, 1, 99, 1],
      stagger: [28, 0, 120, 1],
      replay: { type: "action" },
    },
    { onAction: () => setPlay((p) => p + 1) },
  );
  const [play, setPlay] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const phase = d.phase as Phase;
  const cells = useMemo(() => makeRound(d.nodes, d.tolerance, d.mismatchRate, d.missingRate, d.seed), [d.nodes, d.tolerance, d.mismatchRate, d.missingRate, d.seed]);
  const cols = Math.max(1, Math.min(12, Math.ceil(Math.sqrt(cells.length * 2))));
  const rows = Math.ceil(cells.length / cols);
  const W = cols * PITCH;
  const H = rows * PITCH;

  const counts = cells.reduce(
    (a, c) => {
      if (c.delta === null) a.missing++;
      else if (c.delta > d.tolerance) a.mismatch++;
      else a.match++;
      return a;
    },
    { match: 0, mismatch: 0, missing: 0 },
  );
  const f = focus === null ? null : cells[focus];
  const verdictOf = (c: Cell) => (c.delta === null ? "no submission" : c.delta > d.tolerance ? (phase === "settled" ? "slashed" : "mismatch") : phase === "settled" ? "paid" : c.delta === 0 ? "exact match" : "within tolerance");

  return (
    <LabFrame
      n="V2"
      id="verdict"
      title="Verdict grid: one eclipse per node"
      source="eclipse-grid"
      drives="Each node's replay delta over the round's tolerance. Exact match is an empty ring; drift is a thin crescent; past tolerance the disc slips out in vermilion. Settled: paid rings fill bone, slashed go void."
      where="Round receipt and the job page round panel, beside RoundPlates."
      aside={
        <div className="space-y-4">
          <Readout rows={[["nodes", cells.length], ["match", counts.match], ["mismatch", counts.mismatch], ["missing", counts.missing]]} />
          <div className="min-h-24 border-t border-rule pt-3">
            {f ? (
              <Readout
                rows={[
                  ["node", f.op],
                  ["delta", f.delta === null ? "n/a" : f.delta.toExponential(2)],
                  ["tolerance", d.tolerance.toExponential(1)],
                  ["verdict", verdictOf(f)],
                  ["step", f.delta !== null && f.delta > d.tolerance ? f.step : "n/a"],
                ]}
              />
            ) : (
              <p className="text-xs text-subtle">Hover or tab to a ring to read its node.</p>
            )}
          </div>
        </div>
      }
    >
      <div className="overflow-x-auto border border-rule p-4" style={{ background: "var(--mz-ground)" }}>
        <svg key={`${play}-${phase}`} viewBox={`0 0 ${W} ${H}`} className="vg mx-auto block w-full" style={{ maxWidth: W * 1.4 }} role="group" aria-label={`Verdicts for ${cells.length} nodes`}>
          {cells.map((c, i) => {
            const cx = (i % cols) * PITCH + PITCH / 2;
            const cy = Math.floor(i / cols) * PITCH + PITCH / 2;
            const bad = c.delta !== null && c.delta > d.tolerance;
            const off = c.delta === null ? 0 : slip(c.delta, d.tolerance) * R;
            const settled = phase === "settled";
            const delay = { animationDelay: `${i * d.stagger}ms` };
            const disc = bad ? "var(--mz-l5)" : "var(--mz-l3)";
            return (
              <g
                key={i}
                tabIndex={0}
                role="img"
                aria-label={`Node ${c.op}: ${verdictOf(c)}`}
                onMouseEnter={() => setFocus(i)}
                onFocus={() => setFocus(i)}
                className="vg-cell outline-none"
                style={delay}
              >
                {c.delta === null ? (
                  <circle cx={cx} cy={cy} r={R - 0.5} style={{ fill: "none", stroke: "var(--mz-l2)", strokeWidth: 1.5, strokeDasharray: "3 4" }} />
                ) : settled && bad ? (
                  <>
                    <circle cx={cx} cy={cy} r={R} style={{ fill: "var(--mz-void)", stroke: "var(--mz-l5)", strokeWidth: 1.5 }} />
                    <line x1={cx - R * 0.55} y1={cy - R * 0.55} x2={cx + R * 0.55} y2={cy + R * 0.55} style={{ stroke: "var(--mz-l5)", strokeWidth: 1.5 }} />
                  </>
                ) : settled ? (
                  <circle cx={cx} cy={cy} r={R} className="vg-fill" style={{ ...delay, fill: "var(--mz-l6)", stroke: "var(--mz-l6)", strokeWidth: 2 }} />
                ) : (
                  <>
                    <circle cx={cx} cy={cy} r={R} className="vg-slip" style={{ ...delay, fill: disc, ["--dx" as string]: `${off * 0.72}px`, ["--dy" as string]: `${off * 0.72}px` }} />
                    <circle cx={cx} cy={cy} r={R - 0.5} style={{ fill: "var(--mz-ground)", stroke: "var(--mz-l4)", strokeWidth: 1.5 }} />
                  </>
                )}
                {focus === i ? <circle cx={cx} cy={cy} r={R + 5} style={{ fill: "none", stroke: "var(--mz-l7)", strokeWidth: 1 }} /> : null}
              </g>
            );
          })}
        </svg>
        <style>{`
          .vg-cell { animation: vg-in 240ms steps(3) both; }
          .vg-slip { transform: translate(var(--dx), var(--dy)); animation: vg-slip 360ms steps(4) both; }
          .vg-fill { animation: vg-fill 300ms steps(3) both; }
          @keyframes vg-in { from { opacity: 0; } }
          @keyframes vg-slip { from { transform: translate(0, 0); } }
          @keyframes vg-fill { from { fill: var(--mz-ground); } }
          @media (prefers-reduced-motion: reduce) { .vg-cell, .vg-slip, .vg-fill { animation: none; } }
        `}</style>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs uppercase tracking-wide text-subtle">
        <li>empty ring = exact</li>
        <li>red crescent = drift, inside tolerance</li>
        <li className="text-mosaic">vermilion crescent = past tolerance</li>
        <li>dashed = no submission</li>
      </ul>
    </LabFrame>
  );
}

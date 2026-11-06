// V5, after vault/ripple-grid: when your node's round is accepted, rings spread out from your tile through the pool.
"use client";

import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB_SHORT, type FieldFn } from "@/components/mosaic/engine";
import { useDialKit } from "dialkit";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { LabFrame, Readout } from "./Frame";

export function RippleLab() {
  const d = useDialKit(
    "V5 Ripple",
    {
      speed: [0.55, 0.15, 1.5, 0.01],
      band: [46, 10, 140, 1],
      echoes: [2, 1, 4, 1],
      gap: [90, 30, 220, 1],
      peers: [0.1, 0, 0.4, 0.01],
      cell: [9, 6, 14, 1],
      replay: { type: "action" },
    },
    { onAction: () => setPlay((p) => p + 1) },
  );
  const [play, setPlay] = useState(1);
  const origin = useRef({ x: 0.36, y: 0.55 });

  const field = useMemo<FieldFn>(() => {
    return (tile, c) => {
      const ox = origin.current.x * c.W;
      const oy = origin.current.y * c.H;
      const dist = Math.hypot(tile.cx - ox, tile.cy - oy);
      // Your tile: the one under the origin stays bone the whole time; it is the "you" the brand reserves bone for.
      if (Math.abs(tile.cy - oy) < tile.h * 0.5 && Math.abs(tile.cx - ox) < tile.w / 2 + 34) return 1.05;
      const peer = tile.r < d.peers ? 0.3 : 0;
      const r = d.speed * c.t * Math.hypot(c.W, c.H);
      let v = 0;
      for (let k = 0; k < d.echoes; k++) {
        const x = (r - k * d.gap - dist) / d.band;
        if (x < 0 || x > 1) continue;
        // Front tiles flash bone, then step down the red ramp behind the front; each echo is one level quieter.
        const front = x < 0.22 ? 1.0 : x < 0.5 ? 0.7 : x < 0.8 ? 0.55 : 0.4;
        v = Math.max(v, front - k * 0.22);
      }
      return Math.max(v, peer);
    };
  }, [d.speed, d.band, d.echoes, d.gap, d.peers]);

  const click = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    origin.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    setPlay((p) => p + 1);
  };
  const duration = Math.min(4, (1 + (d.echoes * d.gap + d.band) / 900) / d.speed);

  return (
    <LabFrame
      n="V5"
      id="ripple"
      title="Accepted ripple from your tile"
      source="ripple-grid"
      drives="Your node's verdict landing as paid. Plays once per round (storage key per job and round), then the pool holds still."
      where="PoolCity and the pool view on the node page."
      aside={
        <div className="space-y-4">
          <p>Click anywhere in the pool to put your node there and play the moment again. Other nodes are the dim red tiles; the bone tile is you.</p>
          <Readout rows={[["duration", `${duration.toFixed(1)}s`], ["echoes", d.echoes], ["band", `${d.band}px`]]} />
          <p className="text-xs text-subtle">Reduced motion: the end frame, your tile lit and the pool at rest.</p>
        </div>
      }
    >
      <div onClick={click} className="relative h-72 cursor-crosshair overflow-hidden border border-rule md:h-96">
        <Mosaic field={field} label="Pool with a ripple from your node" cell={d.cell} vocab={VOCAB_SHORT} twinkle={0} empty={0.18} seed={23} playKey={play} duration={duration} />
        <ul className="pointer-events-none absolute right-0 top-0 bg-surface px-3 py-2 text-right font-mono text-xs uppercase leading-relaxed tracking-wide text-ink">
          <li>Accepted</li>
          <li>Job 07 · R12</li>
          <li>+4.20 TOD</li>
        </ul>
      </div>
    </LabFrame>
  );
}

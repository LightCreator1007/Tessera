// V6, after vault/pixel-scan: a diagonal band crosses the job cover; behind it the figure is settled, inside it tiles spray, ahead is unlit.
"use client";

import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB_SHORT, type FieldFn } from "@/components/mosaic/engine";
import { coverById, sampler, subjectFit, useGray } from "@/components/mosaic/figures";
import { useTextGray } from "@/components/mosaic/type";
import { Button } from "@/components/primitives";
import { useDialKitController } from "dialkit";
import { useMemo, useRef, useState } from "react";
import { LabFrame, Readout } from "./Frame";

const hash = (i: number, k: number) => {
  let h = (i * 374761393 + k * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const CONFIG = {
  mode: { type: "select" as const, options: ["progress", "reveal"] },
  subject: { type: "select" as const, options: ["tiger", "word", "crow", "fuji"] },
  word: "JOB 07",
  rounds: [8, 1, 40, 1] as [number, number, number, number],
  round: [3, 0, 40, 1] as [number, number, number, number],
  band: [0.16, 0.04, 0.4, 0.01] as [number, number, number, number],
  angle: [35, 0, 80, 1] as [number, number, number, number],
  spray: [12, 2, 30, 1] as [number, number, number, number],
  ghostAhead: true,
  revealSec: [1.2, 0.4, 3, 0.1] as [number, number, number, number],
  replay: { type: "action" as const },
};

export function BandLab() {
  const [play, setPlay] = useState(0);
  const ctl = useDialKitController("V6 Progress band", CONFIG, { onAction: () => setPlay((p) => p + 1) });
  const d = ctl.values;
  const shown = useRef({ pos: 0, last: 0 });

  const textG = useTextGray(d.word || "JOB 07", 800);
  const cover = coverById(d.subject === "word" ? "tiger" : d.subject);
  const coverG = useGray(d.subject === "word" ? null : cover.src);
  const g = d.subject === "word" ? textG : coverG;

  const round = Math.min(d.round, d.rounds);
  const target = round / d.rounds;
  const reveal = d.mode === "reveal";

  const field = useMemo<FieldFn>(() => {
    const isWord = d.subject === "word";
    const s = sampler(g, isWord ? { fit: "contain", scale: 0.84, ax: 0.5, ay: 0.5 } : subjectFit(cover));
    const a = (d.angle * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return (tile, c) => {
      if (tile.i === 0) {
        const dt = Math.max(0, Math.min(0.1, c.t - shown.current.last));
        shown.current.last = c.t;
        if (reveal) shown.current.pos = Math.min(1 + d.band, (c.t / d.revealSec) * (1 + d.band));
        else {
          // The band walks to the new round's position at a fixed rate, so a round advancing reads as one move.
          const want = target === 0 ? 0 : target + d.band * (target >= 1 ? 1 : 0.5);
          const diff = want - shown.current.pos;
          shown.current.pos += Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.6);
        }
      }
      // Position along the diagonal from bottom-left (0) to top-right (1).
      const u = tile.cx / c.W;
      const v = 1 - tile.cy / c.H;
      const sPos = (u * ca + v * sa) / (ca + sa);
      const pos = shown.current.pos;
      const ink = s(tile, c);
      const lit = isWord ? ink >= 0.4 : ink > 0.14;
      const settled = isWord ? 0.74 : 0.26 + ink * 0.55;
      if (sPos < pos - d.band) return lit ? settled : 0;
      if (sPos <= pos) {
        // Inside the band: a spray of red tones that re-rolls `spray` times a second; the figure's own tiles burn brighter.
        const k = Math.floor(c.t * d.spray);
        const h = hash(tile.i, k);
        if (!lit && h > 0.45) return 0;
        const edge = (pos - sPos) / d.band; // 0 at the leading edge
        return edge < 0.15 && lit ? 1.0 : 0.36 + h * (lit ? 0.6 : 0.3);
      }
      return lit && d.ghostAhead ? 0.12 : 0;
    };
  }, [g, cover, d.subject, d.angle, d.band, d.spray, d.ghostAhead, d.revealSec, reveal, target]);

  return (
    <LabFrame
      n="V6"
      id="band"
      title="Progress band across the job cover"
      source="pixel-scan"
      drives="Progress mode: band position = current round / total, walking to each new round. Reveal mode: a once-only 1.2s pass for a receipt or a newly collected poster."
      where="Job CoverBand while training (replaces loader B's develop), ReceiptHero first view, the profile poster shelf."
      aside={
        <div className="space-y-4">
          <Readout rows={[["mode", d.mode], ["round", `${round} of ${d.rounds}`], ["progress", `${Math.round(target * 100)}%`]]} />
          {reveal ? (
            <Button onClick={() => setPlay((p) => p + 1)}>Replay reveal</Button>
          ) : (
            <div className="flex gap-2">
              <Button onClick={() => ctl.setValue("round", Math.max(0, round - 1))} disabled={round <= 0}>Round −1</Button>
              <Button variant="primary" onClick={() => ctl.setValue("round", Math.min(d.rounds, round + 1))} disabled={round >= d.rounds}>Round +1</Button>
            </div>
          )}
          <p className="text-xs text-subtle">Reduced motion: the band sits at its target with the spray frozen.</p>
        </div>
      }
    >
      <div className="relative h-72 overflow-hidden border border-rule md:h-96">
        <Mosaic field={field} label="Job cover with a progress band" cell={6} vocab={VOCAB_SHORT} twinkle={0.05} empty={0.3} seed={31} playKey={`${play}-${d.mode}`} />
        <div className="pointer-events-none absolute bottom-0 left-0 bg-surface px-4 pb-3 pt-2">
          <p className="text-2xl font-medium tracking-tight text-ink">mlp-exact</p>
        </div>
        <ul className="pointer-events-none absolute right-0 top-0 bg-surface px-3 py-2 text-right font-mono text-xs uppercase leading-relaxed tracking-wide text-ink">
          <li>Training</li>
          <li>Round {round} / {d.rounds}</li>
        </ul>
      </div>
    </LabFrame>
  );
}

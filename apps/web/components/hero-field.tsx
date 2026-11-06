"use client";
// Full-bleed hero field: rows of protocol words whose tiles draw the live job's loss curve across the card. The curve is the real series (warm bands for high loss, lime for low), rounds with no metric break it, the newest point glows cream. Deterministic: no random tone picks.
import { useMemo } from "react";
import { cx } from "./primitives";

const WORDS = ["SHARD", "COMMIT", "REVEAL", "REPLAY", "SEED", "STAKE", "VERIFY", "PAY", "ROUND", "LOSS", "GRAD", "NODE", "IDLE", "HASH", "BLOB", "EPOCH", "WEIGHTS", "ATTEST", "FINAL", "SLASH"];

type Tone = "void" | "off" | "coral" | "coral-dim" | "amber" | "amber-dim" | "lime" | "lime-dim" | "gap" | "head";
const TONE: Record<Tone, string> = {
  void: "text-px-off",
  off: "bg-px-off text-px-frame-dim",
  coral: "bg-px-coral text-brand-ink",
  "coral-dim": "bg-px-coral-dim text-px-coral",
  amber: "bg-px-amber text-brand-ink",
  "amber-dim": "bg-px-amber-dim text-px-amber",
  lime: "bg-px-lime text-brand-ink",
  "lime-dim": "bg-px-lime-dim text-px-lime",
  gap: "text-px-frame-dim line-through",
  head: "bg-brand-cream text-brand-ink tile-flicker",
};

/** The curve as y(x) in unit space (y down), from the real series; null where a round has no metric. */
function curveAt(vals: (number | null)[], x: number, start: number): number | null {
  const defined = vals.filter((v): v is number => v !== null);
  const lo = Math.min(...defined);
  const hi = Math.max(...defined);
  const u = (x - start) / (1 - start);
  const pos = u * (vals.length - 1);
  const near = vals[Math.round(pos)];
  if (near === null) return null;
  const a = vals[Math.floor(pos)];
  const b = vals[Math.ceil(pos)];
  const v = a !== null && b !== null ? a + (b - a) * (pos - Math.floor(pos)) : near;
  return 0.12 + 0.72 * ((hi - v) / (hi - lo || 1));
}

export function HeroField({ curve, rows = 22, cols = 150, start = 0.38, className }: { curve: (number | null)[]; rows?: number; cols?: number; start?: number; className?: string }) {
  const series = curve.some((v) => v !== null) ? curve : Array.from({ length: 12 }, (_, i) => 0.1 + 0.72 * Math.exp(-i / 3.5));
  const grid = useMemo(() => {
    let k = 0;
    return Array.from({ length: rows }, (_, row) => {
      const out: { w: string; tone: Tone }[] = [];
      let c = 0;
      while (c < cols) {
        const w = WORDS[k++ % WORDS.length];
        const x = (c + w.length / 2) / cols;
        const y = (row + 0.5) / rows;
        let tone: Tone = "void";
        if (x >= start) {
          const cy = curveAt(series, x, start);
          if (cy === null) tone = "gap";
          else {
            const u = (x - start) / (1 - start);
            const band = 0.06 + 0.06 * (1 - u);
            const f = Math.abs(y - cy) / band;
            const hue = cy < 0.4 ? "coral" : cy < 0.62 ? "amber" : "lime";
            if (u > 0.93 && f < 0.7) tone = "head";
            else if (f < 0.55) tone = hue;
            else if (y > cy && f < 1.4) tone = `${hue}-dim` as Tone;
            else if (y > cy && f < 2.6) tone = "off";
          }
        }
        out.push({ w, tone });
        c += w.length + 1;
      }
      return out;
    });
  }, [series, rows, cols, start]);

  return (
    <div aria-hidden className={cx("pointer-events-none select-none overflow-hidden", className)}>
      {grid.map((line, i) => (
        <div key={i} className="flex gap-px pb-px">
          {line.map((t, j) => (
            <span key={j} className={cx("mosaic-tile", TONE[t.tone], t.tone === "void" && "tile-word")}>{t.w}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

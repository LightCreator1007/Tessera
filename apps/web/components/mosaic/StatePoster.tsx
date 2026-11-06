// The state words from the brand playground as compact posters: EMPTY is a ghost, OFFLINE goes dark tile by tile,
// SLASHED cracks, PAID glints. Kept free of the primitives module so EmptyState can import it without a cycle.
"use client";

import { useMemo } from "react";
import { Mosaic } from "./Mosaic";
import { VOCAB_SHORT, type FieldFn } from "./engine";
import { sampler } from "./figures";
import { useTextGray } from "./type";

export type StateKind = "empty" | "offline" | "slashed" | "paid";

const TINY = VOCAB_SHORT.filter((w) => w.length <= 3);

function useStateField(word: string, kind: StateKind): FieldFn {
  const g = useTextGray(word, 800);
  return useMemo(() => {
    const s = sampler(g, { fit: "contain", scale: 0.9, ax: 0.5, ay: 0.5 });
    return (tile, c) => {
      const on = s(tile, c) >= 0.4;
      const dark = kind === "offline" && tile.r < Math.min(0.85, (c.t % 10) / 7);
      if (!on) return dark ? -1 : 0;
      if (!(tile.r < c.t / 1.1)) return 0;
      if (kind === "empty") return 0.32;
      if (kind === "offline") return dark ? -1 : 0.42;
      if (kind === "paid") return tile.r > c.t / 1.1 - 0.12 ? 1.05 : 0.88;
      const crack = c.W * 0.5 + Math.sin(tile.cy / 5) * 6 + (tile.cy - c.H / 2) * 0.5;
      return Math.abs(tile.cx - crack) < 6 ? -1 : tile.cx > crack ? 0.38 : 0.62;
    };
  }, [g, kind]);
}

export function StatePoster({ word, kind, className }: { word: string; kind: StateKind; className?: string }) {
  const field = useStateField(word, kind);
  return (
    <div aria-hidden className={["relative overflow-hidden", className].filter(Boolean).join(" ")}>
      <Mosaic field={field} label="" vocab={TINY} cell={6} seed={word.length * 13 + 1} twinkle={kind === "empty" ? 0.04 : 0.1} empty={0.35} />
    </div>
  );
}

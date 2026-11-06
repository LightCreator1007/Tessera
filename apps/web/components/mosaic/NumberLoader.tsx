// Loader A from the brand playground: for a determinate wait, the number is the loader. The percentage is set in
// mosaic type and fills from the bottom; the head row is bone and the unfilled part waits as faint texture.
"use client";

import { useMemo } from "react";
import { Mosaic } from "./Mosaic";
import { VOCAB_SHORT, type FieldFn } from "./engine";
import { sampler } from "./figures";
import { useTextGray } from "./type";
import { cx } from "@/components/primitives";

const TINY = VOCAB_SHORT.filter((w) => w.length <= 3);

export function NumberLoader({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const text = `${Math.floor(v * 100)}%`;
  const g = useTextGray(text, 800);
  const field: FieldFn = useMemo(() => {
    const s = sampler(g, { fit: "contain", scale: 0.86, ax: 0.5, ay: 0.5 });
    return (tile, c) => {
      if (s(tile, c) < 0.4) return 0;
      const fill = c.H * (0.93 - v * 0.86);
      if (tile.cy < fill) return 0.42;
      return tile.cy < fill + tile.h * 1.5 ? 1.05 : 0.66;
    };
  }, [g, v]);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(v * 100)} className={cx("relative overflow-hidden border border-rule bg-surface", className)}>
      <Mosaic field={field} label={`${label}: ${text}`} vocab={TINY} cell={6} seed={41} twinkle={0.06} playKey={text} />
    </div>
  );
}

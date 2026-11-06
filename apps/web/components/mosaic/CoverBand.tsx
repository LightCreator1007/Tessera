// A page-header cover: the item's poster across the content column with the title set over it in display type and a
// mono metadata block in the corner, both on ground-coloured plates so the lit tiles never run through the text.
// With `develop` (0..1) the poster develops like a print in a tray, highlights first, the edge in bone: loader B.
"use client";

import { useMemo, type ReactNode } from "react";
import { PosterThumb } from "./PosterCard";
import { sampler, subjectFit, useGray, type Cover } from "./figures";
import { tone } from "./fields";
import type { FieldFn } from "./engine";

/** The banner is wide and the title plate sits bottom left, so the figure is contained against the right edge. */
const BAND_FIT = { ax: 0.88, pad: 0.08 };

function useDevelopField(cover: Cover, develop: number | undefined): FieldFn | undefined {
  const g = useGray(develop === undefined ? null : cover.src);
  return useMemo(() => {
    if (develop === undefined) return undefined;
    const s = sampler(g, subjectFit(cover, BAND_FIT));
    const th = 1 - Math.max(0.08, develop);
    return (tile, c) => {
      const v = tone(s(tile, c), cover.tone);
      if (v < 0.1 || v < th - 0.06) return 0;
      const edge = develop < 1 && v < th + 0.05;
      return edge ? (tile.r < (c.t % 2) / 2 ? 1.05 : 0.9) : v;
    };
  }, [g, cover, develop]);
}

export function CoverBand({ cover, live, title, meta, label, develop }: { cover: Cover; live?: boolean; title: ReactNode; meta: string[]; label: string; develop?: number }) {
  const field = useDevelopField(cover, develop);
  return (
    <div className="relative h-56 overflow-hidden border border-rule md:h-64">
      <PosterThumb cover={cover} live={live} field={field} label={label} cell={6} fit={BAND_FIT} className="absolute inset-0" />
      <div className="absolute bottom-0 left-0 bg-surface px-4 pb-3 pt-2 md:px-5">
        <h1 className="text-2xl font-medium tracking-tight text-ink">{title}</h1>
      </div>
      <ul className="absolute right-0 top-0 bg-surface px-3 py-2 text-right font-mono text-xs uppercase leading-relaxed tracking-wide text-ink">
        {meta.map((m) => <li key={m}>{m}</li>)}
      </ul>
    </div>
  );
}

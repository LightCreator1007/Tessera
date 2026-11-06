// Login layout C's backdrop: a sparse, slowly twinkling field of faint word tiles that a terminal box sits on.
"use client";

import { Mosaic } from "./Mosaic";
import type { FieldFn } from "./engine";

const tex: FieldFn = (tile, c) => (tile.r < 0.03 + 0.012 * Math.sin(c.t * 0.8 + tile.row) ? 0.2 : 0);

export function TermTexture({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <Mosaic field={tex} label="" cell={10} seed={21} twinkle={0.08} empty={0.3} wake={false} />
    </div>
  );
}

// The index card from the brand playground as an app pattern: a live word-mosaic poster on top, then a red index
// number, the title in display type and one mono note line. Thumbnails dissolve in once and hold still; only a
// live item keeps twinkling, so a list of twenty cards costs one animation, not twenty.
"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useTextGray } from "./type";
import { sampler } from "./figures";
import { VOCAB_FINE, VOCAB_SHORT } from "./engine";
import { Mosaic } from "./Mosaic";
import { coverFor, figureField, subjectFit, useGray, type Cover } from "./figures";
import type { Fit } from "./fields";
import type { FieldFn } from "./engine";
import { cx } from "@/components/primitives";

/** Figure posters default to the fine vocabulary and a subject fit: the whole animal, drawn in narrow tiles.
 * hold: a live poster that has paused. Its clock keeps running so nothing re-dissolves, but twinkle stops. */
export function PosterThumb({ cover, live, hold, field, label, className, cell = 6, vocab, fit }: { cover?: Cover; live?: boolean; hold?: boolean; field?: FieldFn; label: string; className?: string; cell?: number; vocab?: string[]; fit?: Partial<Fit> }) {
  const c = cover ?? coverFor(label);
  const g = useGray(field ? null : c.src);
  const fitKey = JSON.stringify(fit ?? {});
  // Callers pass `fit` inline, so its JSON is the memo key; a new object each render must not rebuild the field.
  const fig = useMemo(() => field ?? figureField(g, subjectFit(c, JSON.parse(fitKey)), c.tone, "dissolve", c.focus), [field, g, c, fitKey]);
  return (
    <div className={cx("overflow-hidden bg-sunken", !(className ?? "").split(" ").includes("absolute") && "relative", className)}>
      <Mosaic field={fig} label={label} cell={cell} seed={label.length * 7 + 3} twinkle={live && !hold ? 0.12 : 0} duration={live ? Infinity : 2.6} vocab={vocab ?? (field ? undefined : VOCAB_FINE)} />
    </div>
  );
}

/** Without href it is a static card, for records that aren't yours to act on. */
export function PosterCard({ href, n, title, note, cover, live, tag, art, thumb = "h-48", dim }: { href?: string; n: string; title: ReactNode; note: ReactNode; cover?: Cover; live?: boolean; tag?: ReactNode; art?: ReactNode; thumb?: string; dim?: boolean }) {
  const body = (
    <>
      {art ?? <PosterThumb cover={cover} live={live} label={`${typeof title === "string" ? title : n} poster`} className={cx(thumb, "border-b border-rule", dim && "opacity-25 grayscale")} />}
      <span className="grid flex-1 content-start gap-1.5 px-4 pb-4 pt-3">
        <span className="flex h-6 items-center justify-between gap-2">
          <span className="font-mono text-xs text-mosaic">{n}</span>
          {tag}
        </span>
        <span className="text-xl font-medium tracking-tight text-ink">{title}</span>
        <span className="font-mono text-xs leading-relaxed text-muted">{note}</span>
      </span>
    </>
  );
  if (!href) return <div className="flex flex-1 flex-col border border-rule bg-card">{body}</div>;
  return <Link href={href} className="group flex flex-1 flex-col border border-rule bg-card transition-colors hover:border-rule-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mosaic">{body}</Link>;
}

/** A word set in giant mosaic type (short-word tiles so the letters stay legible), dissolving in; lit when on.
 * held: lit but paused, one tone level down (0.74 to 0.6 crosses one threshold), so the poster holds its breath. */
export function useWordField(word: string, on = true, held = false): FieldFn {
  const g = useTextGray(word, 700);
  return useMemo(() => {
    const s = sampler(g, { fit: "contain", scale: 0.94, ax: 0.5, ay: 0.5 });
    return (tile, c) => {
      if (!(tile.r < c.t / 1.2)) return 0;
      return s(tile, c) < 0.4 ? 0 : on ? (held ? 0.6 : 0.74) : 0.3;
    };
  }, [g, on, held]);
}

export { VOCAB_SHORT };

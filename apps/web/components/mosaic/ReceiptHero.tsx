// The round receipt from the brand playground: the amount (or the outcome word) as giant mosaic type on the left,
// and on the right the written account of what happened, why and what comes next, above the proof rows.
"use client";

import { useMemo, type ReactNode } from "react";
import { Mosaic } from "./Mosaic";
import { VOCAB_SHORT, type FieldFn } from "./engine";
import { sampler } from "./figures";
import { useTextGray } from "./type";
import { cx } from "@/components/primitives";

export type ReceiptTone = "ok" | "fail" | "faint";

function useReceiptField(word: string, kind: ReceiptTone): FieldFn {
  const g = useTextGray(word, 700);
  return useMemo(() => {
    const s = sampler(g, { fit: "contain", scale: 0.84, ax: 0.5, ay: 0.5 });
    return (tile, c) => {
      if (!(tile.r < c.t / 1.1) || s(tile, c) < 0.4) return 0;
      if (kind === "faint") return 0.3;
      if (kind === "fail") {
        const crack = c.W * 0.52 + Math.sin(tile.cy / 6) * 8 + (tile.cy - c.H / 2) * 0.35;
        return Math.abs(tile.cx - crack) < 8 ? -1 : tile.cx > crack ? 0.38 : 0.62;
      }
      return tile.r > c.t / 1.1 - 0.12 ? 1.05 : 0.88;
    };
  }, [g, kind]);
}

export function ReceiptHero({ word, tone, head, body, rows, label }: { word: string; tone: ReceiptTone; head: string; body: ReactNode; rows: [string, ReactNode][]; label: string }) {
  const field = useReceiptField(word, tone);
  return (
    <section aria-label={label} className="grid overflow-hidden border border-rule bg-card md:grid-cols-5">
      <div className="relative h-48 border-b border-rule bg-surface md:col-span-3 md:h-auto md:min-h-56 md:border-b-0 md:border-r">
        <Mosaic field={field} label={label} vocab={VOCAB_SHORT} cell={8} seed={word.length * 11 + 5} twinkle={tone === "ok" ? 0.12 : 0.04} playKey={word} />
      </div>
      <div className="flex flex-col gap-3 p-4 md:col-span-2">
        <span className={cx("font-mono text-xs uppercase tracking-wide", tone === "ok" ? "text-ok" : tone === "fail" ? "text-danger" : "text-muted")}>{head}</span>
        <div className="text-sm leading-relaxed text-ink">{body}</div>
        <dl className="mt-auto grid gap-1.5 border-t border-rule pt-3 font-mono text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-subtle">{k}</dt>
              <dd className="min-w-0 truncate text-right text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

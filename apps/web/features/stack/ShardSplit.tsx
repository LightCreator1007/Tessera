"use client";
// The splitting diagram: one dataset cut into contiguous train shards plus a validation slice, each a file on Swarm.
import type { Piece } from "@/lib/stack/arkiv";
import { cx } from "@/components/primitives";

const SHARD_FILL = ["bg-red-3", "bg-red-4", "bg-red-5", "bg-red-2", "bg-red-1"];
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
export const pieceName = (p: Piece) => (p.part === "val" ? "val" : `shard ${p.shard}`) + (p.piece > 0 ? ` · part ${p.piece + 1}` : "");

export function ShardSplit({ pieces, selected, onSelect }: { pieces: Piece[]; selected: number; onSelect: (i: number) => void }) {
  const rows = pieces.reduce((s, p) => s + p.len, 0);
  const train = pieces.filter((p) => p.part === "train");
  const shards = new Set(train.map((p) => p.shard)).size;
  return (
    <div className="flex flex-col gap-3">
      {/* The whole dataset, then the same rows cut. Widths are row counts, so the cut is to scale. */}
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 font-mono sm:w-20 text-xs uppercase tracking-wide text-subtle">dataset</span>
        <div className="h-3 flex-1 rounded-xs bg-band" aria-hidden />
        <span className="w-24 shrink-0 text-right font-mono text-xs tabular text-muted">{rows.toLocaleString()} rows</span>
      </div>
      <div className="flex items-stretch gap-3">
        <span className="w-14 shrink-0 pt-3 font-mono sm:w-20 text-xs uppercase tracking-wide text-subtle">cut into</span>
        <div className="flex min-w-0 flex-1 gap-1" role="listbox" aria-label="Shard files">
          {pieces.map((p, i) => (
            <button
              key={`${p.part}${p.shard}.${p.piece}`}
              role="option"
              aria-selected={i === selected}
              onClick={() => onSelect(i)}
              style={{ flexGrow: p.len, animationDelay: `${i * 90}ms` }}
              className={cx(
                "animate-pop-in group flex min-w-0 basis-0 flex-col gap-1.5 rounded-sm p-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink",
                i === selected ? "bg-active" : "hover:bg-hover",
              )}
            >
              <span className={cx("h-10 w-full rounded-xs", p.part === "val" ? "bg-bone" : SHARD_FILL[Number(p.shard) % SHARD_FILL.length], i === selected && "ring-1 ring-ink")} />
              <span className="truncate text-xs font-medium text-ink">{pieceName(p)}</span>
              <span className="truncate font-mono text-xs tabular text-muted">{p.len.toLocaleString()} rows</span>
              <span className="truncate font-mono text-xs tabular text-subtle">{mb(p.size)}</span>
            </button>
          ))}
        </div>
        <span className="hidden w-24 shrink-0 sm:block" aria-hidden />
      </div>
      <p className="text-xs text-muted">
        {shards} train shard{shards === 1 ? "" : "s"}, one per seat in the round, plus the validation slice. The cut is contiguous and deterministic: the train rows split evenly, the first shards taking one extra row when it doesn&apos;t divide. Anyone can rebuild these files from the public dataset and get the same keccak.
      </p>
    </div>
  );
}

"use client";
// Pixel art engine. Every mosaic in the app is a drawn sprite or a picture of real data (a loss curve, round outcomes, node state), never noise. Colours come from the --px-* palette slots, so the palette dial recolours all art at once.
import Link from "next/link";
import { cx } from "./primitives";

export const HUES = ["coral", "amber", "lime", "teal", "sky", "violet", "rose"] as const;
export type Hue = (typeof HUES)[number];

const FILL = {
  coral: "fill-px-coral", "coral-dim": "fill-px-coral-dim",
  amber: "fill-px-amber", "amber-dim": "fill-px-amber-dim",
  lime: "fill-px-lime", "lime-dim": "fill-px-lime-dim",
  teal: "fill-px-teal", "teal-dim": "fill-px-teal-dim",
  sky: "fill-px-sky", "sky-dim": "fill-px-sky-dim",
  violet: "fill-px-violet", "violet-dim": "fill-px-violet-dim",
  rose: "fill-px-rose", "rose-dim": "fill-px-rose-dim",
  off: "fill-px-off", frame: "fill-px-frame", "frame-dim": "fill-px-frame-dim", cream: "fill-brand-cream", ink: "fill-brand-ink",
  ok: "fill-ok", warn: "fill-warn", danger: "fill-danger", pending: "fill-pending",
} as const;
export type Paint = keyof typeof FILL;
type Ink = { fill: Paint; live?: boolean; text?: Paint };
export type Palette = Record<string, Paint | Ink>;

const ink = (p: Paint | Ink): Ink => (typeof p === "string" ? { fill: p } : p);

/** A protocol vocabulary read in order, so word tiles spell the protocol rather than scatter letters. */
const WORDS = ["SEED", "SHRD", "TRN", "CMIT", "RVEL", "RPLY", "VRFY", "PAY", "LOSS", "GRAD", "NODE", "STAK", "HASH", "BLOB", "EPCH", "SLSH", "IDLE", "R08", "W01", "FINL"];

export function PixelArt({ grid, palette, className, label, words, gap = 0.14 }: { grid: string[]; palette: Palette; className?: string; label?: string; words?: boolean; gap?: number }) {
  const h = grid.length;
  const w = Math.max(...grid.map((r) => r.length));
  const cw = words ? 26 : 1;
  const ch = words ? 15 : 1;
  const g = words ? 1.6 : gap;
  let k = 0;
  return (
    <svg
      viewBox={`0 0 ${w * cw} ${h * ch}`}
      className={cx("block", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      preserveAspectRatio="xMidYMid meet"
    >
      {grid.flatMap((row, y) =>
        Array.from(row).map((c, x) => {
          const word = WORDS[k++ % WORDS.length];
          const p = palette[c];
          if (c === "." || !p) {
            return words ? (
              <text key={`${x}-${y}`} x={x * cw + cw / 2} y={y * ch + ch * 0.68} textAnchor="middle" fontSize="7" className="tile-word fill-px-off font-mono">{word}</text>
            ) : null;
          }
          const t = ink(p);
          return (
            <g key={`${x}-${y}`} className={t.live ? "tile-flicker" : undefined}>
              <rect x={x * cw + g / 2} y={y * ch + g / 2} width={cw - g} height={ch - g} rx={words ? 1.5 : 0.12} className={FILL[t.fill]} />
              {words && <text x={x * cw + cw / 2} y={y * ch + ch * 0.68} textAnchor="middle" fontSize="7" className={cx("tile-word font-mono", FILL[t.text ?? "ink"])}>{word}</text>}
            </g>
          );
        }),
      )}
    </svg>
  );
}

/** Stable colour identity for an address: the same node is always the same hue. */
export function hueFor(addr: string): Hue {
  const n = parseInt(addr.slice(2, 10), 16);
  return HUES[(Number.isFinite(n) ? n : addr.length) % HUES.length];
}

export type ScreenState = "training" | "idle" | "offline" | "slashed";

/**
 * A laptop whose screen shows what the machine is doing. Training draws the loss curve (real points when given,
 * null rounds as a dashed gap), idle draws a sleeping Z, offline is a dark screen, slashed is a cross.
 */
export function laptop({ w, h, state, curve, progress = 1 }: { w: number; h: number; state: ScreenState; curve?: (number | null)[]; progress?: number }): string[] {
  const sh = h - 2;
  const g = Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
  for (let y = 0; y < sh; y++) for (let x = 1; x < w - 1; x++) g[y][x] = y === 0 || y === sh - 1 || x === 1 || x === w - 2 ? "F" : "o";
  for (let x = 0; x < w; x++) g[sh][x] = "F";
  for (let x = 1; x < w - 1; x++) g[sh + 1][x] = "f";
  const iw = w - 4;
  const ih = sh - 2;
  const at = (x: number, y: number, c: string) => { if (x >= 0 && x < iw && y >= 0 && y < ih) g[y + 1][x + 2] = c; };

  if (state === "training") {
    const vals = curve && curve.some((v) => v !== null) ? curve : Array.from({ length: 12 }, (_, i) => 0.1 + 0.72 * Math.exp(-i / 3.5));
    const defined = vals.filter((v): v is number => v !== null);
    const lo = Math.min(...defined);
    const hi = Math.max(...defined);
    const span = hi - lo || 1;
    const used = Math.max(2, Math.min(iw, Math.round(iw * progress)));
    let head: [number, number] | null = null;
    for (let x = 0; x < used; x++) {
      const pos = (x / (used - 1)) * (vals.length - 1);
      const near = vals[Math.round(pos)];
      if (near === null) {
        for (let y = 0; y < ih; y += 2) at(x, y, "n");
        continue;
      }
      const a = vals[Math.floor(pos)];
      const b = vals[Math.ceil(pos)];
      const v = a !== null && b !== null ? a + (b - a) * (pos - Math.floor(pos)) : near;
      const y = Math.round((1 - (v - lo) / span) * (ih - 1));
      at(x, y, "c");
      for (let yy = y + 1; yy < ih; yy++) at(x, yy, "d");
      head = [x, y];
    }
    if (head) at(head[0], head[1], "h");
  } else if (state === "idle") {
    const cx0 = Math.floor(iw / 2) - 1;
    const cy0 = Math.floor(ih / 2) - 1;
    ["zzz", "..z", ".z.", "z..", "zzz"].slice(ih < 6 ? 2 : 0).forEach((r, dy, arr) => {
      const top = arr.length === 5 ? cy0 - 1 : cy0;
      Array.from(r).forEach((c, dx) => c === "z" && at(cx0 + dx, top + dy, "z"));
    });
    for (let x = 0; x < iw; x += 2) at(x, ih - 1, "d");
  } else if (state === "slashed") {
    for (let i = 0; i < Math.min(iw, ih); i++) {
      const x0 = Math.floor((iw - Math.min(iw, ih)) / 2);
      at(x0 + i, i, "x");
      at(x0 + Math.min(iw, ih) - 1 - i, i, "x");
    }
  }
  return g.map((r) => r.join(""));
}

export function laptopPalette(hue: Hue): Palette {
  return {
    F: "frame",
    f: "frame-dim",
    o: "off",
    c: hue,
    d: `${hue}-dim` as Paint,
    h: { fill: "cream", live: true },
    n: "frame-dim",
    z: hue,
    x: "danger",
  };
}

/** A node as a small pixel laptop on its dark plate, in its own hue. */
export function NodeArt({ op, state, size = "sm", className, curve, progress }: { op: string; state: ScreenState; size?: "sm" | "lg"; className?: string; curve?: (number | null)[]; progress?: number }) {
  const hue = hueFor(op);
  const seed = parseInt(op.slice(10, 14), 16) || 7;
  // Without a real series, each node draws its own decay (steepness and floor from its address), so no two screens match.
  curve ??= Array.from({ length: 14 }, (_, i) => 0.08 + (seed % 4) * 0.05 + 0.7 * Math.exp(-i / (1.6 + (seed % 5) * 0.7)));
  const grid = size === "sm" ? laptop({ w: 13, h: 10, state, curve, progress }) : laptop({ w: 30, h: 20, state, curve, progress });
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-md bg-brand-ink", size === "sm" ? "size-6 p-0.5" : "p-4", className)}>
      <PixelArt grid={grid} palette={laptopPalette(hue)} className="h-full w-full" label={size === "lg" ? `Node is ${state}` : undefined} />
    </span>
  );
}

/** Workload sprites: a dense MLP drawn as narrowing layers, a CNN as a kernel sliding over an image. */
const WORKLOAD: Record<string, { grid: string[]; hue: Hue }> = {
  "mlp-exact": { hue: "sky", grid: [".a.a.a.a.", ".........", "..b.b.b..", ".........", "...a.a...", ".........", "....h...."] },
  "cnn-torch": { hue: "violet", grid: ["bbbbbbbb", "baaabbbb", "bahabbbb", "baaabbbb", "bbbbbbbb", "bbbbbaab", "bbbbbaab", "bbbbbbbb"] },
};
export function WorkloadArt({ workload, className }: { workload: string; className?: string }) {
  const w = WORKLOAD[workload] ?? { hue: "teal" as Hue, grid: ["aaa", "aha", "aaa"] };
  return (
    <span className={cx("inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-ink p-1", className)}>
      <PixelArt grid={w.grid} palette={{ a: w.hue, b: `${w.hue}-dim` as Paint, h: { fill: "cream", live: true } }} className="h-full w-full" />
    </span>
  );
}

/** Logo: three tiles stepping down a diagonal, a loss curve at 3x3. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("inline-flex size-8 shrink-0 rounded-md bg-brand-ink p-1.5", className)}>
      <PixelArt grid={["a..", "bc.", "dde"]} palette={{ a: "coral", b: "amber-dim", c: "amber", d: "lime-dim", e: "lime" }} gap={0.22} className="h-full w-full" />
    </span>
  );
}

/** A row or grid of tiles, one per item, for count meters (nodes online, threshold, rounds settled). */
export function TileMeter({ tiles, cols, className, label }: { tiles: (Paint | Ink)[]; cols: number; className?: string; label?: string }) {
  const rows: string[] = [];
  const pal: Palette = {};
  tiles.forEach((t, i) => {
    const ch = String.fromCharCode(i < 26 ? 65 + i : 97 + ((i - 26) % 26));
    pal[ch] = t;
    const r = Math.floor(i / cols);
    rows[r] = (rows[r] ?? "") + ch;
  });
  return <PixelArt grid={rows} palette={pal} gap={0.24} className={className} label={label} />;
}

const ROUND_TILE: Record<string, string> = {
  finalized: "bg-ok",
  fallback: "bg-warn",
  reverted: "bg-danger",
  voided: "bg-warn",
  open: "bg-brand tile-flicker",
  committing: "bg-brand tile-flicker",
  revealing: "bg-brand tile-flicker",
  verifying: "bg-brand tile-flicker",
};
const ROUND_WORD: Record<string, string> = { finalized: "paid", fallback: "paid on fallback", reverted: "reverted", voided: "voided", open: "open", committing: "committing", revealing: "revealing", verifying: "replaying" };

/** One tile per round of the job: settled rounds in their outcome colour, the live round pulsing, future rounds empty. */
export function RoundTrack({ total, rounds, hrefFor, size = "sm", className }: { total: number; rounds: { round: number; status: string }[]; hrefFor?: (r: number) => string; size?: "sm" | "lg"; className?: string }) {
  const by = new Map(rounds.map((r) => [r.round, r.status]));
  return (
    <ol className={cx("flex gap-0.5", size === "lg" && "gap-1", className)} aria-label={`${rounds.length} of ${total} rounds`}>
      {Array.from({ length: total }, (_, i) => {
        const r = i + 1;
        const s = by.get(r);
        const cls = cx(size === "sm" ? "h-3 w-1.5 rounded-xs" : "h-3 flex-1 rounded-xs", s ? (size === "lg" && s === "finalized" ? "bg-ok/45" : ROUND_TILE[s]) : "bg-band");
        const title = `Round ${r}: ${s ? ROUND_WORD[s] : "not started"}`;
        return (
          <li key={r} className={cx(size === "lg" && "flex flex-1")}>
            {s && hrefFor ? (
              <Link href={hrefFor(r)} title={title} className={cx("relative z-10 block transition-opacity hover:opacity-70", cls)}><span className="sr-only">{title}</span></Link>
            ) : (
              <span title={title} className={cx("block", cls)}><span className="sr-only">{title}</span></span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

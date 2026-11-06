// Field builders for the variants playground: one figure drawn several ways (develop, wavefront, silhouette, flat,
// boxed, scanline, per-check thirds), all on the subject fit, plus a mosaic-type overlay for words set beside a figure.
import type { FieldCtx, FieldFn, Tile } from "@/components/mosaic/engine";
import { clamp, dissolve, fitSampler, radial, sdBox, tone, type Fit, type Gray, type Tone } from "@/components/mosaic/fields";

/** Loop length of every animated variant, in seconds; the check overlays use the same clock. */
export const LOOP = 7;
export const PASS = [0.7, 1.4, 2.1];
export const DONE = 2.6;

export type Mode = "develop" | "radial" | "dissolve" | "silhouette" | "flat" | "thirds" | "scan" | "still";

type Rect = { x: number; y: number; w: number; h: number };
type Region = (W: number, H: number) => Rect;

/** A fit sampler that can be confined to a region of the canvas (an inset box), rebuilt only on resize. */
export function regionSampler(g: Gray | null, fit: Fit, region?: Region) {
  let key = "";
  let s: ((t: Tile) => number) | null = null;
  let r: Rect = { x: 0, y: 0, w: 0, h: 0 };
  return (tile: Tile, c: FieldCtx) => {
    if (!g) return 0;
    const k = `${c.W}x${c.H}`;
    if (k !== key || !s) {
      key = k;
      r = region ? region(c.W, c.H) : { x: 0, y: 0, w: c.W, h: c.H };
      s = fitSampler(g, r.w, r.h, fit);
    }
    if (!region) return s(tile);
    if (tile.cx < r.x || tile.cx > r.x + r.w || tile.cy < r.y || tile.cy > r.y + r.h) return 0;
    return s({ ...tile, x: tile.x - r.x, cx: tile.cx - r.x, y: tile.y - r.y, cy: tile.cy - r.y });
  };
}

export interface FigOpts {
  mode: Mode;
  focus?: [number, number];
  /** Inset box: the figure is fitted inside it and the box itself is lit one level. */
  box?: Region;
  /** Faint lit field behind the figure, fading from the right edge to this x share (banner "lit" variant). */
  glowFrom?: number;
  /** A circle mask (seal variant): only tiles inside the ring draw the figure, and the ring is lit. */
  seal?: boolean;
}

export function figure(g: Gray | null, fit: Fit, tn: Tone, o: FigOpts): FieldFn {
  const s = regionSampler(g, fit, o.box);
  const focus = o.focus ?? [0.7, 0.4];
  return (tile, c) => {
    const t = c.t % LOOP;
    let v = tone(s(tile, c), tn);
    let ground = 0;
    if (o.box) {
      const r = o.box(c.W, c.H);
      const sd = sdBox(tile.cx, tile.cy, r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2);
      if (sd < 0) ground = sd > -tile.h ? 0.3 : 0.13;
    }
    if (o.glowFrom !== undefined) ground = Math.max(ground, clamp((tile.cx / c.W - o.glowFrom) / (1 - o.glowFrom)) * 0.16);
    if (o.seal) {
      const R = Math.min(c.W, c.H) * 0.44;
      const d = Math.hypot(tile.cx - c.W / 2, tile.cy - c.H / 2);
      if (Math.abs(d - R) < tile.h * 0.9) return dissolve(tile, t, 0, 0.6) ? 0.66 : 0;
      if (d > R) return 0;
      ground = 0.13;
    }
    switch (o.mode) {
      case "still":
        return Math.max(v, ground);
      case "dissolve":
        return dissolve(tile, t, 0, 1.4) ? Math.max(v, ground) : 0;
      case "radial":
        return radial(tile, { ...c, t }, Math.max(v, ground), focus[0] * c.W, focus[1] * c.H, Math.max(c.W, c.H) / 1.4);
      case "develop": {
        const p = clamp(t / DONE);
        const th = 1 - Math.max(0.12, p);
        if (v < 0.1 || v < th - 0.06) return dissolve(tile, t, 0, 0.8) ? ground : 0;
        return p < 1 && v < th + 0.05 ? 1.05 : v;
      }
      case "silhouette":
        if (!dissolve(tile, t, 0, 1.1)) return 0;
        if (v > 0.24) return -1;
        if (v > 0.12) return t > DONE ? 1.05 : 0.6;
        return 0.26;
      case "flat":
        if (!dissolve(tile, t, 0, 1)) return 0;
        return v > 0.5 ? 0.9 : v > 0.2 ? 0.52 : ground;
      case "thirds": {
        const k = Math.min(2, Math.floor((tile.cx / c.W) * 3));
        if (t < PASS[k] || !dissolve(tile, t, PASS[k], 0.45)) return 0;
        v = Math.max(v, ground);
        if (t < DONE) return v;
        const d = Math.hypot(tile.cx - c.W * focus[0], (tile.cy - c.H * focus[1]) * 1.6);
        const edge = Math.exp(-(((d - (t - DONE) * c.W * 0.9) / 30) ** 2));
        return Math.max(v, v > 0.08 ? edge * 1.05 : edge * 0.3);
      }
      case "scan": {
        const y = clamp(t / DONE) * c.H;
        if (tile.cy > y + tile.h) return 0;
        if (tile.cy > y - tile.h) return v > 0.1 ? 1.05 : 0.42;
        return Math.max(v, ground);
      }
    }
  };
}

/** Words in mosaic type laid over another field inside a region; the text wins where it has ink. */
export function withType(base: FieldFn, g: Gray | null, region: Region, level = 0.74): FieldFn {
  const s = regionSampler(g, { fit: "contain", scale: 1, ax: 0, ay: 0.5 }, region);
  return (tile, c) => {
    if (g && s(tile, c) >= 0.4) return dissolve(tile, c.t % LOOP, 0, 1) ? level : 0;
    return base(tile, c);
  };
}

/** A 5 by 5 mirrored identicon as a field: each tile takes the level of the grid cell under its centre. */
export function identiconCells(value: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619) >>> 0;
  const h2 = Math.imul(h ^ 0x9e3779b9, 2246822507) >>> 0;
  const cols = 3;
  const half: number[] = [];
  for (let i = 0; i < 5 * cols; i++) {
    const n = i < 8 ? (h >>> (i * 4)) & 15 : (h2 >>> ((i - 8) * 4)) & 15;
    half.push(n < 6 ? 0 : n > 13 ? 6 : 2 + (n % 4));
  }
  const out: number[] = [];
  for (let r = 0; r < 5; r++) for (let x = 0; x < 5; x++) out.push(half[r * cols + (x < 3 ? x : 4 - x)]);
  return out;
}

export function paletteOf(value: string, palettes: readonly string[]) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 33 + value.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

const LEVEL_TONE = [0, 0.15, 0.3, 0.43, 0.57, 0.72, 0.88];

export function identiconField(value: string): FieldFn {
  const cells = identiconCells(value);
  return (tile, c) => {
    const x = Math.min(4, Math.floor((tile.cx / c.W) * 5));
    const y = Math.min(4, Math.floor((tile.cy / c.H) * 5));
    return LEVEL_TONE[cells[y * 5 + x]];
  };
}

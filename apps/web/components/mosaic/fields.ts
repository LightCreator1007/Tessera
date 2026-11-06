// Field builders for the word mosaic: grey maps from images (bundled prints or a dropped file), tone shaping,
// fitting a map into a canvas, reveal masks and small signed-distance shapes for diagrams.
import type { FieldCtx, Tile } from "./engine";

export interface Gray {
  w: number;
  h: number;
  data: Float32Array;
}

export type ImageMode = "ink" | "light" | "dark";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`could not load ${src}`));
    img.src = src;
  });
}

function toGray(src: CanvasImageSource, w: number, h: number, filter = "none"): Float32Array {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.filter = filter;
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  return out;
}

/** Stretch so the 2nd and 99th percentiles land on 0 and 1; paper grain and a single bright pixel stop dominating. */
function autoContrast(d: Float32Array) {
  const s = Array.from(d).sort((a, b) => a - b);
  const lo = s[Math.floor(s.length * 0.02)];
  const hi = s[Math.floor(s.length * 0.99)];
  const k = hi - lo > 1e-4 ? 1 / (hi - lo) : 1;
  for (let i = 0; i < d.length; i++) d[i] = Math.min(1, Math.max(0, (d[i] - lo) * k));
}

/**
 * Bundled maps in /public/mosaic are ink-density maps prepared offline and stored as text, because the repo takes no
 * binary files: a "w h" header, then one line per row with two hex digits (0-255) per pixel.
 */
export async function loadGray(src: string): Promise<Gray> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`could not load ${src}`);
  const [head, ...rows] = (await res.text()).trim().split("\n");
  const [w, h] = head.split(" ").map(Number);
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) data[y * w + x] = parseInt(row.slice(x * 2, x * 2 + 2), 16) / 255;
  }
  return { w, h, data };
}

/**
 * Any image to a tone map. "ink" keeps what is darker than the local paper (prints, drawings, Pinterest art on light
 * grounds); "light" keeps bright subjects on dark grounds; "dark" is plain inverted luminance.
 */
export async function imageToGray(src: string, mode: ImageMode): Promise<Gray> {
  const img = await loadImage(src);
  const w = 320;
  const h = Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth));
  const lum = toGray(img, w, h);
  const out = new Float32Array(lum.length);
  if (mode === "ink") {
    const bg = toGray(img, w, h, `blur(${Math.round(w / 9)}px)`);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, bg[i] - lum[i]);
  } else {
    for (let i = 0; i < out.length; i++) out[i] = mode === "light" ? lum[i] : 1 - lum[i];
  }
  autoContrast(out);
  return { w, h, data: out };
}

export interface Fit {
  /** "subject" fits the ink's bounding box (not the whole image) inside the canvas, so the figure is never cropped. */
  fit: "cover" | "contain" | "subject";
  scale: number;
  ax: number; // 0..1 horizontal anchor
  ay: number; // 0..1 vertical anchor
  /** "subject" only: margin on each side, as a share of the canvas. */
  pad?: number;
}

export const FIT: Fit = { fit: "cover", scale: 1, ax: 0.5, ay: 0.5 };

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boxes = new WeakMap<Gray, Box>();

/**
 * Where the figure actually is in a map: the 1st to 99th percentile of ink mass along each axis. Prints carry paper
 * margins and stray specks, so the raw extent of non-zero pixels would be most of the image.
 */
export function subjectBox(g: Gray, thresh = 0.18): Box {
  const hit = boxes.get(g);
  if (hit) return hit;
  const col = new Float64Array(g.w);
  const row = new Float64Array(g.h);
  let total = 0;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const v = g.data[y * g.w + x];
      if (v < thresh) continue;
      col[x] += v;
      row[y] += v;
      total += v;
    }
  const span = (m: Float64Array): [number, number] => {
    if (total <= 0) return [0, m.length];
    let acc = 0;
    let a = 0;
    let b = m.length;
    for (let i = 0; i < m.length; i++) {
      acc += m[i];
      if (acc >= total * 0.01) {
        a = i;
        break;
      }
    }
    acc = 0;
    for (let i = m.length - 1; i >= 0; i--) {
      acc += m[i];
      if (acc >= total * 0.01) {
        b = i + 1;
        break;
      }
    }
    return b > a ? [a, b] : [0, m.length];
  };
  const [x0, x1] = span(col);
  const [y0, y1] = span(row);
  const box = { x0, y0, x1, y1 };
  boxes.set(g, box);
  return box;
}

/** Scale and offset that place map pixels in canvas pixels for a fit. Exported so overlays can find the figure. */
export function fitTransform(g: Gray, W: number, H: number, f: Fit) {
  if (f.fit === "subject") {
    const b = subjectBox(g);
    const pad = f.pad ?? 0.06;
    const aw = Math.max(1, W * (1 - 2 * pad));
    const ah = Math.max(1, H * (1 - 2 * pad));
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const s = Math.min(aw / bw, ah / bh) * Math.min(1, f.scale);
    return { s, x0: W * pad + (aw - bw * s) * f.ax - b.x0 * s, y0: H * pad + (ah - bh * s) * f.ay - b.y0 * s };
  }
  const base = f.fit === "cover" ? Math.max(W / g.w, H / g.h) : Math.min(W / g.w, H / g.h);
  const s = base * f.scale;
  return { s, x0: (W - g.w * s) * f.ax, y0: (H - g.h * s) * f.ay };
}

/** Sampler in canvas pixels. Averages a 3 by 2 grid over the tile (a box filter), so wide tiles do not alias. */
export function fitSampler(g: Gray, W: number, H: number, f: Fit) {
  const { s, x0, y0 } = fitTransform(g, W, H, f);
  const at = (x: number, y: number) => {
    const u = Math.floor((x - x0) / s);
    const v = Math.floor((y - y0) / s);
    if (u < 0 || v < 0 || u >= g.w || v >= g.h) return 0;
    return g.data[v * g.w + u];
  };
  return (t: Tile) => {
    const ya = t.y + t.h * 0.3;
    const yb = t.y + t.h * 0.7;
    const xa = t.x + t.w * 0.2;
    const xb = t.x + t.w * 0.8;
    return (at(xa, ya) + at(t.cx, ya) + at(xb, ya) + at(xa, yb) + at(t.cx, yb) + at(xb, yb)) / 6;
  };
}

export interface Tone {
  contrast: number;
  gamma: number;
  lift: number;
}

export const TONE: Tone = { contrast: 1.5, gamma: 1.05, lift: -0.1 };

export function tone(v: number, t: Tone) {
  const c = (v - 0.5) * t.contrast + 0.5 + t.lift;
  return Math.pow(Math.min(1, Math.max(0, c)), t.gamma);
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Radial reveal from (px, py). Tiles inside the front show the figure; a band at the front flashes to the bone glint.
 * Returns the tone to draw.
 */
export function radial(tile: Tile, c: FieldCtx, v: number, px: number, py: number, speed: number, start = 0) {
  const d = Math.hypot(tile.cx - px, (tile.cy - py) * 1.6);
  const front = (c.t - start) * speed;
  if (d > front + 6) return 0;
  const edge = Math.exp(-(((d - front) / 26) ** 2));
  return Math.max(v, v > 0.08 ? edge * 1.05 : edge * 0.3);
}

/** Dissolve: each tile switches on at its own random moment inside [start, start + dur]. */
export function dissolve(tile: Tile, t: number, start: number, dur: number) {
  return tile.r < (t - start) / dur;
}

export function sdSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const h = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - ax - dx * h, py - ay - dy * h);
}

export function sdBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number) {
  const qx = Math.abs(px - cx) - hw;
  const qy = Math.abs(py - cy) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

// The cover figures (public-domain Japanese prints, prepared as ink-density maps in /public/mosaic) and the field
// builders that turn a figure or a flow graph into a mosaic field.
"use client";

import { useEffect, useState } from "react";
import type { FieldCtx, FieldFn, Tile } from "./engine";
import { FIT, TONE, clamp, dissolve, fitSampler, loadGray, radial, sdBox, sdSegment, tone, type Fit, type Gray, type Tone } from "./fields";

export interface Cover {
  id: string;
  title: string;
  src: string;
  meta: string;
  credit: string;
  fit: Fit;
  tone: Tone;
  focus: [number, number];
}

export const COVERS: Cover[] = [
  { id: "crow", title: "Cawing Crow", src: "/mosaic/crow.gray", meta: "First round\nS07 / E01\nNode 0x8a4F", credit: "Ohara Koson, Cawing crow", fit: { ...FIT, scale: 1.05, ax: 0.35 }, tone: TONE, focus: [0.75, 0.25] },
  { id: "tiger", title: "Tiger Descent", src: "/mosaic/tiger.gray", meta: "Job 0x2F\nS07 / E12\nResNet-mini", credit: "Kishi Ganku, Tiger", fit: { ...FIT, scale: 1.55, ay: 0.4 }, tone: { contrast: 1.6, gamma: 1, lift: -0.12 }, focus: [0.5, 0.35] },
  { id: "owl", title: "Night Owl", src: "/mosaic/owl.gray", meta: "Verifier\nS07 / E09\nReplay ok", credit: "Ohara Koson, Owl on ginkgo branch", fit: { ...FIT, ax: 0.6 }, tone: { contrast: 1.6, gamma: 1.1, lift: -0.15 }, focus: [0.62, 0.45] },
  { id: "heron", title: "Grey Heron", src: "/mosaic/heron.gray", meta: "Idle node\nS06 / E30\nWaiting", credit: "Ohara Koson, Heron in downpour", fit: { ...FIT, scale: 1.05 }, tone: TONE, focus: [0.45, 0.3] },
  { id: "fuji", title: "Dragon Over Fuji", src: "/mosaic/fuji.gray", meta: "Season close\nS07 / E40\nModel ready", credit: "Katsushika Hokusai, Dragon over Fuji", fit: { ...FIT }, tone: { contrast: 1.7, gamma: 1.1, lift: -0.18 }, focus: [0.6, 0.15] },
  { id: "cat", title: "Cat & Mouse", src: "/mosaic/cat.gray", meta: "Slash caught\nS07 / E17\nReplay mismatch", credit: "Ohara Koson, Cat catching a mouse", fit: { ...FIT, scale: 1.05 }, tone: TONE, focus: [0.55, 0.6] },
  { id: "nightheron", title: "Snow Heron", src: "/mosaic/nightheron.gray", meta: "Settled\nS07 / E22\n+4.20 TOD", credit: "Ohara Koson, Night heron on a snowy branch", fit: { ...FIT }, tone: TONE, focus: [0.5, 0.4] },
];

/**
 * The fit every figure surface uses: the figure's ink box contained in the canvas with a margin, never cropped.
 * The cover's horizontal anchor is kept (the crow faces right, so it sits left) unless a surface overrides it.
 */
export function subjectFit(cover: Cover, over: Partial<Fit> = {}): Fit {
  return { fit: "subject", scale: 1, ax: cover.fit.ax, ay: 0.5, pad: 0.07, ...over };
}

export const coverById = (id: string) => COVERS.find((c) => c.id === id) || COVERS[0];

const cache = new Map<string, Promise<Gray>>();

/** Loads a figure map once per page; null while loading or if the file is missing (the mosaic then shows texture only). */
export function useGray(src: string | null | undefined): Gray | null {
  const [g, setG] = useState<Gray | null>(null);
  useEffect(() => {
    if (!src) {
      setG(null);
      return;
    }
    let live = true;
    let p = cache.get(src);
    if (!p) {
      p = loadGray(src);
      cache.set(src, p);
    }
    p.then((x) => live && setG(x)).catch(() => live && setG(null));
    return () => {
      live = false;
    };
  }, [src]);
  return g;
}

/** A sampler that rebuilds its fit only when the canvas size changes. */
export function sampler(g: Gray | null, fit: Fit) {
  let key = "";
  let s: ((t: Tile) => number) | null = null;
  return (tile: Tile, c: FieldCtx) => {
    if (!g) return 0;
    const k = `${c.W}x${c.H}`;
    if (k !== key || !s) {
      key = k;
      s = fitSampler(g, c.W, c.H, fit);
    }
    return s(tile);
  };
}

export type Reveal = "radial" | "dissolve" | "none";

/** A figure that reveals from its focus point with a bone wavefront, or dissolves in tile by tile. */
export function figureField(g: Gray | null, fit: Fit, tn: Tone, reveal: Reveal, focus: [number, number], opts: { gain?: number; cap?: number } = {}): FieldFn {
  const s = sampler(g, fit);
  const gain = opts.gain === undefined ? 1 : opts.gain;
  const cap = opts.cap === undefined ? 2 : opts.cap;
  return (tile, c) => {
    const v = Math.min(cap, tone(s(tile, c), tn) * gain);
    if (reveal === "none") return v;
    if (reveal === "dissolve") return dissolve(tile, c.t, 0, 1.2) ? v : 0;
    return radial(tile, c, v, focus[0] * c.W, focus[1] * c.H, Math.max(c.W, c.H) / 1.1);
  };
}

export type NodeState = "todo" | "active" | "done" | "fail";

export interface FlowNode {
  id: string;
  label: string;
  sub?: string;
  x: number; // centre, 0..1
  y: number;
  w: number; // size, 0..1 of canvas
  h: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  via?: [number, number][];
}

const TONE_OF: Record<NodeState, number> = { todo: 0.27, done: 0.56, active: 0.7, fail: 0.3 };

/**
 * A flow graph as a field: boxes lit by state, lanes between them, packets travelling along the `flowing` edges,
 * a stepped pulse on the active box and a crack of void tiles through a failed one.
 */
export function flowField(nodes: FlowNode[], edges: FlowEdge[], states: Record<string, NodeState>, flowing: string[], speed = 0.55): FieldFn {
  let key = "";
  let boxes: { n: FlowNode; cx: number; cy: number; hw: number; hh: number; st: NodeState }[] = [];
  let lanes: { pts: [number, number][]; len: number; done: boolean; flow: boolean }[] = [];
  const build = (W: number, H: number) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    boxes = nodes.map((n) => ({ n, cx: n.x * W, cy: n.y * H, hw: (n.w * W) / 2, hh: (n.h * H) / 2, st: states[n.id] || "todo" }));
    lanes = edges.map((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      const pts: [number, number][] = [];
      if (a) pts.push([a.x * W, a.y * H]);
      for (const [x, y] of e.via || []) pts.push([x * W, y * H]);
      if (b) pts.push([b.x * W, b.y * H]);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const sa = states[e.from];
      return { pts, len, done: sa === "done" && (states[e.to] === "done" || states[e.to] === "active"), flow: flowing.includes(`${e.from}>${e.to}`) };
    });
  };
  const at = (pts: [number, number][], len: number, f: number): [number, number] => {
    let d = f * len;
    for (let i = 1; i < pts.length; i++) {
      const sl = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d <= sl) {
        const k = sl ? d / sl : 0;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
      }
      d -= sl;
    }
    return pts[pts.length - 1];
  };
  return (tile, c) => {
    const k = `${c.W}x${c.H}`;
    if (k !== key) {
      key = k;
      build(c.W, c.H);
    }
    let v = 0;
    const lane = Math.max(3, tile.h * 0.45);
    for (const l of lanes) {
      let d = Infinity;
      for (let i = 1; i < l.pts.length; i++) d = Math.min(d, sdSegment(tile.cx, tile.cy, l.pts[i - 1][0], l.pts[i - 1][1], l.pts[i][0], l.pts[i][1]));
      if (d < lane) v = Math.max(v, l.done ? 0.25 : 0.11);
      if (l.flow && l.len > 0) {
        const f = ((c.t * speed * 220) / l.len) % 1;
        const [px, py] = at(l.pts, l.len, f);
        const pd = Math.hypot(tile.cx - px, (tile.cy - py) * 1.4);
        if (pd < 34) v = Math.max(v, 1.05 - pd / 40);
      }
    }
    for (const b of boxes) {
      const sd = sdBox(tile.cx, tile.cy, b.cx, b.cy, b.hw, b.hh);
      if (sd >= 0) continue;
      if (b.st === "fail") {
        const crackX = b.cx + Math.sin((tile.cy - b.cy) / 9) * b.hw * 0.25;
        if (Math.abs(tile.cx - crackX) < tile.h * 0.9) return -1;
        return tile.cx > crackX ? 0.2 : 0.32;
      }
      let base = TONE_OF[b.st];
      if (b.st === "active") base = Math.floor(c.t * 2.5) % 2 ? 0.72 : 0.6;
      const rim = sd > -tile.h * 0.9;
      v = Math.max(v, rim && b.st === "active" ? 0.9 : rim && b.st === "todo" ? 0.37 : base);
    }
    return v;
  };
}

/** A round seal: ring, faint disc and a check. `broken` cracks it and dims the far half. */
export function sealField(broken: boolean): FieldFn {
  return (tile, c) => {
    const cx = c.W / 2;
    const cy = c.H / 2;
    const R = Math.min(c.W, c.H) * 0.34;
    const d = Math.hypot(tile.cx - cx, tile.cy - cy);
    let v = 0;
    if (Math.abs(d - R) < R * 0.13) v = 0.7;
    else if (d < R * 0.82) v = 0.24;
    const s = R * 0.42;
    const check = Math.min(sdSegment(tile.cx, tile.cy, cx - s, cy, cx - s * 0.25, cy + s * 0.65), sdSegment(tile.cx, tile.cy, cx - s * 0.25, cy + s * 0.65, cx + s, cy - s * 0.6));
    if (!broken && check < tile.h * 0.9) v = 0.92;
    if (broken && c.t > 0.9) {
      const crackX = cx + Math.sin((tile.cy - cy) / 11) * R * 0.18 + (tile.cy - cy) * 0.15;
      if (Math.abs(tile.cx - crackX) < tile.h * 0.8 && d < R * 1.2) return -1;
      if (tile.cx > crackX) v *= 0.45;
    }
    if (!dissolve(tile, c.t, 0, 0.8)) return 0;
    if (!broken) return radial(tile, c, v, cx, cy, Math.max(c.W, c.H) / 1.2, 0.8);
    return clamp(v);
  };
}

/** A stable figure for anything with an id (job 7 is always the same animal), so a thing keeps its poster everywhere. */
export function coverFor(id: number | string): Cover {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length];
}

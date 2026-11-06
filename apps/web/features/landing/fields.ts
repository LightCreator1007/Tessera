// Field functions for the landing page: a pointer wake that lights tiles under the cursor, and the four-step round story.
"use client";

import { useRef, type PointerEvent } from "react";
import type { FieldCtx, FieldFn, Tile } from "@/components/mosaic/engine";
import { clamp, sdBox } from "@/components/mosaic/fields";

interface Pt {
  x: number;
  y: number;
  t: number;
}

const LIFE = 1.4; // seconds a wake point stays lit

/** Pointer wake: recent pointer positions light a soft brush of tiles that rises fast and fades slow. */
export function useWake(radius = 70) {
  const pts = useRef<Pt[]>([]);
  const move = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
    const last = pts.current[pts.current.length - 1];
    // Fill fast strokes so the wake reads as a line, not dots.
    if (last && performance.now() - last.t < 80) {
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      const n = Math.min(6, Math.floor(d / (radius * 0.5)));
      for (let i = 1; i <= n; i++) pts.current.push({ x: last.x + ((p.x - last.x) * i) / (n + 1), y: last.y + ((p.y - last.y) * i) / (n + 1), t: p.t });
    }
    pts.current.push(p);
    if (pts.current.length > 40) pts.current.splice(0, pts.current.length - 40);
  };
  const wake = (tile: Tile) => {
    const now = performance.now();
    let m = 0;
    for (const p of pts.current) {
      const age = (now - p.t) / 1000;
      if (age > LIFE) continue;
      const d = Math.hypot(tile.cx - p.x, (tile.cy - p.y) * 1.5);
      if (d > radius * 2) continue;
      m = Math.max(m, Math.exp(-((d / radius) ** 2)) * (1 - age / LIFE));
    }
    return m;
  };
  // Stable across renders, so fields built from it are memoised once.
  const api = useRef({ move, wake });
  return api.current;
}

/** Combine a base tone with the wake: the brush lifts tiles through the red ramp, its core touches bone. */
export function withWake(base: FieldFn, wake: (t: Tile) => number, gain = 1): FieldFn {
  return (tile, c) => {
    const v = base(tile, c);
    if (v < 0) return v;
    const w = wake(tile) * gain;
    if (w < 0.05) return v;
    return Math.max(v, w > 0.82 ? 0.9 + w * 0.1 : 0.12 + w * 0.6);
  };
}

/** Six laptops in a 3 x 2 grid, in canvas fractions. Index 3 is the lazy one. */
export const LAZY = 3;
const BLOCKS = [0, 1, 2, 3, 4, 5].map((i) => ({ cx: 0.2 + (i % 3) * 0.3, cy: 0.3 + Math.floor(i / 3) * 0.42, hw: 0.115, hh: 0.16 }));
const SPEED = [1, 0.82, 1.12, 1.6, 0.9, 1.05];

/** The round story: train, commit, replay, settle. `step` and `since` (ms) are read live from refs. */
export function roundField(step: () => number, since: () => number): FieldFn {
  return (tile: Tile, c: FieldCtx) => {
    const px = tile.cx / c.W;
    const py = tile.cy / c.H;
    const s = step();
    const p = (performance.now() - since()) / 1000;
    for (let b = 0; b < BLOCKS.length; b++) {
      const k = BLOCKS[b];
      const d = sdBox(px, py * (c.H / c.W), k.cx, k.cy * (c.H / c.W), k.hw, k.hh * (c.H / c.W));
      if (d > 0.006) continue;
      const edge = d > -0.012;
      const u = clamp((k.cy + k.hh - py) / (2 * k.hh)); // 0 at the bottom of the block, 1 at the top
      const lazy = b === LAZY;
      if (s === 0) {
        const fill = clamp(p * 0.42 * SPEED[b]);
        if (u > fill) return edge ? 0.12 : 0;
        // The lazy node races to the top with dim padding instead of trained weights.
        if (lazy) return u > 0.3 ? 0.24 : 0.5;
        return u > fill - 0.07 && fill < 1 ? 0.9 : 0.42 + tile.r * 0.12;
      }
      const body = lazy ? (u > 0.3 ? 0.24 : 0.5) : 0.42 + tile.r * 0.12;
      if (s === 1) {
        // A seal lands on each block in turn: the fingerprint posted before anyone reveals.
        const sealed = p > 0.25 + b * 0.22;
        if (u > 0.86) return sealed ? (edge ? 0.86 : 1) : 0.3;
        return body;
      }
      if (s === 2) {
        const scan = p * 0.55 - 0.1; // band x position
        const passed = scan > k.cx + k.hw;
        const inBand = Math.abs(px - scan) < 0.03;
        if (lazy && passed) return edge ? 0.7 : -1;
        if (inBand) return 0.8;
        return u > 0.86 ? 0.86 : body;
      }
      // Settle: honest blocks turn bone in order; the lazy one stays a hole.
      if (lazy) return edge ? 0.62 : -1;
      const paid = p > 0.2 + b * 0.16;
      return paid ? (tile.r > 0.75 ? 1 : 0.86) : body;
    }
    return 0;
  };
}

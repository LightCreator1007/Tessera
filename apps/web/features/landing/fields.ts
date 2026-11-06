// Pointer wake for the landing posters: recent pointer positions light the tiles under the cursor.
"use client";

import { useRef, type PointerEvent } from "react";
import type { FieldFn, Tile } from "@/components/mosaic/engine";

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

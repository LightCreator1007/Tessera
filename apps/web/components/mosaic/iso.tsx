// Isometric word mosaic: the same word tiles, laid on a 2:1 isometric grid and extruded into blocks. A scene is a
// function of time that returns cells (footprint i, j; base z; height h; tone) plus optional labels. Tone maps to the
// palette levels exactly like the flat mosaic, side faces are the top colour shaded with the void token, and every
// cell drops in on its own random delay (the iso version of dissolve) while a share of words twinkle. The camera is
// live: drag to orbit, shift-drag to pan, ctrl or cmd + scroll (or the buttons) to zoom, double-click to reset.
"use client";

import { reducedMotion, usePrefs } from "@/lib/prefs";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import { VOCAB_SHORT, mulberry32, quantize } from "./engine";
import type { Gray } from "./fields";

export interface IsoCell {
  i: number;
  j: number;
  z?: number;
  h: number;
  tone: number;
  /** A hole: draws as void, no block. */
  hole?: boolean;
}

export interface IsoLabel {
  i: number;
  j: number;
  z: number;
  text: string;
  fail?: boolean;
  /** Run the leader line to the left gutter instead of the right. */
  left?: boolean;
}

export interface IsoFrame {
  cells: IsoCell[];
  labels?: IsoLabel[];
}

export type IsoScene = (t: number) => IsoFrame;

interface Props {
  scene: IsoScene;
  cols: number;
  rows: number;
  /** Tallest stack the scene will reach, in block units, so the fit leaves room. */
  maxH: number;
  label: string;
  palette?: string;
  seed?: number;
  /** Seconds over which cells drop in. */
  build?: number;
  twinkle?: number;
  empty?: number;
  vocab?: string[];
  playKey?: string | number;
  /** Extra room on the right for labels, as a share of width. */
  gutter?: number;
  /** Extra room on the left for left labels, as a share of width. */
  gutterLeft?: number;
}

const ZR = 1.15; // block height in units of half tile width
// The classic 2:1 isometric view is yaw 45 degrees, pitch 30 degrees; the default camera reproduces it exactly.
const HOME = { yaw: Math.PI / 4, pitch: Math.PI / 6, zoom: 1, px: 0, py: 0 };
const PITCH = [0.2, 1.25] as const;
const ZOOM = [0.55, 2.6] as const;
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
type Cam = typeof HOME;

interface Colors {
  ground: string;
  void: string;
  rule: string;
  text: string;
  fail: string;
  bg: string[];
  fg: string[];
}

function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const bg = [v("--mz-l1")];
  const fg = [v("--mz-tex")];
  for (let l = 1; l <= 7; l++) {
    bg.push(v(`--mz-l${l}`));
    fg.push(v(`--mz-t${l}`));
  }
  return { ground: v("--mz-ground"), void: v("--mz-void"), rule: v("--mz-rule"), text: v("--mz-text"), fail: v("--mz-vermilion"), bg, fg };
}

const ease = (p: number) => 1 - Math.pow(1 - p, 3);
// A cell without z sits on the floor; this is geometry, not a missing reading.
const baseZ = (c: IsoCell) => (c.z === undefined ? 0 : c.z);

export function IsoMosaic({ scene, cols, rows, maxH, label, palette, seed = 7, build = 1.6, twinkle = 0.08, empty = 0.22, vocab = VOCAB_SHORT, playKey, gutter = 0, gutterLeft = 0 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const { motion } = usePrefs();
  // Camera lives in refs so dragging never re-renders React; `goal` is where it eases to, `cam` is where it is now.
  const cam = useRef<Cam>({ ...HOME });
  const goal = useRef<Cam>({ ...HOME });
  const kick = useRef<() => void>(() => {});
  const zoomBy = (f: number) => { goal.current.zoom = clamp(goal.current.zoom * f, ZOOM); kick.current(); };
  const reset = () => { goal.current = { ...HOME }; kick.current(); };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = reducedMotion();
    const rnd = mulberry32(seed);
    const n = cols * rows;
    const delay = Float32Array.from({ length: n }, () => rnd());
    const word = Uint16Array.from({ length: n }, () => Math.floor(rnd() * vocab.length));
    const flick = Float32Array.from({ length: n }, () => rnd());
    // Empty texture cells come in short runs along i, like the flat mosaic.
    const blank = new Uint8Array(n);
    for (let k = 0; k < n; k++) if (rnd() < empty / 3) for (let r = 0; r < 3 && k + r * rows < n; r++) blank[k + r * rows] = 1;
    const family = getComputedStyle(canvas).fontFamily || "monospace";
    let col = readColors(canvas);
    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      col = readColors(canvas);
    };
    resize();

    let tNow = 0;
    const draw = (t: number) => {
      tNow = t;
      const { cells, labels } = sceneRef.current(t);
      const c0 = cam.current;
      const span = cols + rows;
      const usableW = W * (1 - gutter - gutterLeft);
      const hw = Math.min(usableW / span, (H * 0.94) / (span * 0.5 + maxH * ZR)) * c0.zoom;
      const zh = hw * ZR;
      const cy = Math.cos(c0.yaw);
      const sy = Math.sin(c0.yaw);
      const s = hw * Math.SQRT2; // screen units per grid unit along the rotated axes
      const tilt = Math.sin(c0.pitch);
      const lift = (zh * Math.cos(c0.pitch)) / Math.cos(HOME.pitch);
      const mi = cols / 2;
      const mj = rows / 2;
      const ox = W * gutterLeft + usableW / 2 + c0.px;
      const oy = H / 2 + (maxH * lift) / 2 + c0.py;
      const P = (i: number, j: number, z: number): [number, number] => {
        const x = i - mi;
        const y = j - mj;
        return [ox + (x * cy - y * sy) * s, oy + (x * sy + y * cy) * s * tilt - z * lift];
      };
      // Depth: larger is nearer the viewer, so it paints later.
      const depth = (i: number, j: number) => (i - mi) * sy + (j - mj) * cy;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = col.ground;
      ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      const sorted = cells.slice().sort((a, b) => baseZ(a) - baseZ(b) || depth(a.i + 0.5, a.j + 0.5) - depth(b.i + 0.5, b.j + 0.5) || a.i - b.i);
      // A side face shows only when its outward normal points at the viewer. Light comes from screen left, so shade follows the normal's screen x
      // (at the home view this gives the old 0.32 and 0.58).
      const sides: { n: [number, number]; q: (c: IsoCell, z0: number, top: number) => [number, number][] }[] = [
        { n: [0, 1], q: (c, z0, top) => [P(c.i, c.j + 1, top), P(c.i + 1, c.j + 1, top), P(c.i + 1, c.j + 1, z0), P(c.i, c.j + 1, z0)] },
        { n: [1, 0], q: (c, z0, top) => [P(c.i + 1, c.j, top), P(c.i + 1, c.j + 1, top), P(c.i + 1, c.j + 1, z0), P(c.i + 1, c.j, z0)] },
        { n: [0, -1], q: (c, z0, top) => [P(c.i, c.j, top), P(c.i + 1, c.j, top), P(c.i + 1, c.j, z0), P(c.i, c.j, z0)] },
        { n: [-1, 0], q: (c, z0, top) => [P(c.i, c.j, top), P(c.i, c.j + 1, top), P(c.i, c.j + 1, z0), P(c.i, c.j, z0)] },
      ];
      const facing = sides
        .filter((f) => f.n[0] * sy + f.n[1] * cy > 0.001)
        .map((f) => ({ q: f.q, shade: 0.45 + 0.184 * (f.n[0] * cy - f.n[1] * sy) }));
      const poly = (pts: [number, number][], fill: string, shade: number) => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        if (shade > 0) {
          ctx.globalAlpha = shade;
          ctx.fillStyle = col.void;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = col.ground;
        ctx.stroke();
      };

      for (const c of sorted) {
        // Stacked layers share footprints, so the layer height shifts the index: each plate gets its own words and delays.
        const k = ((((c.i % cols) + cols) % cols) * rows + (((c.j % rows) + rows) % rows) + Math.round(baseZ(c) * 4) * 97) % n;
        const p = reduce ? 1 : Math.min(1, Math.max(0, (t - delay[k] * build) / 0.45));
        if (p <= 0) continue;
        const drop = (1 - ease(p)) * 2.2;
        const z0 = baseZ(c) + drop;
        const top = z0 + c.h;
        ctx.globalAlpha = p;
        if (c.hole) {
          poly([P(c.i, c.j, z0), P(c.i + 1, c.j, z0), P(c.i + 1, c.j + 1, z0), P(c.i, c.j + 1, z0)], col.void, 0);
          ctx.globalAlpha = 1;
          continue;
        }
        const lvl = c.tone < 0.1 ? 0 : quantize(c.tone, 0);
        const face = col.bg[lvl];
        if (c.h > 0.001) for (const f of facing) poly(f.q(c, z0, top), face, f.shade);
        const [x0, y0] = P(c.i, c.j, top);
        poly([[x0, y0], P(c.i + 1, c.j, top), P(c.i + 1, c.j + 1, top), P(c.i, c.j + 1, top)], lvl === 0 ? col.ground : face, 0);
        if (lvl === 0 && blank[k]) {
          ctx.globalAlpha = 1;
          continue;
        }
        // Word on the top face, written along the i axis in the face's own plane.
        const swaps = flick[k] < twinkle * 4 && !reduce ? Math.floor(t * 0.6 + flick[k] * 9) : 0;
        const w = vocab[(word[k] + swaps * 7) % vocab.length];
        // Map a 100x100 box onto the top face using its two edge vectors, so the word stays flat on the face at any angle.
        const [xi, yi] = P(c.i + 1, c.j, top);
        const [xj, yj] = P(c.i, c.j + 1, top);
        ctx.setTransform((dpr * (xi - x0)) / 100, (dpr * (yi - y0)) / 100, (dpr * (xj - x0)) / 100, (dpr * (yj - y0)) / 100, dpr * x0, dpr * y0);
        ctx.font = `600 ${Math.min(34, 132 / w.length)}px ${family}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = col.fg[lvl];
        ctx.fillText(w, 50, 52);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 1;
      }

      if (labels) {
        const lp = reduce ? 1 : Math.min(1, Math.max(0, (t - build) / 0.5));
        ctx.globalAlpha = lp;
        ctx.font = `500 11px ${family}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const xs = [P(0, 0, 0), P(cols, 0, 0), P(0, rows, 0), P(cols, rows, 0)].map((q) => q[0]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        // Once the camera turns, anchors on one side can land on the same row. Push each side's labels at least a
        // line apart, top to bottom, and bend the leader from the anchor to where its text ended up.
        const GAP = 15;
        const placed = labels.map((l) => {
          const [x, y] = P(l.i, l.j, l.z);
          return { l, x, y, ty: y, ex: l.left ? Math.min(x - 28, minX - 16) : Math.max(x + 28, maxX + 16) };
        });
        for (const side of [true, false]) {
          const group = placed.filter((p) => !!p.l.left === side).sort((a, b) => a.y - b.y);
          for (let k = 1; k < group.length; k++) group[k].ty = Math.max(group[k].ty, group[k - 1].ty + GAP);
        }
        for (const { l, x, y, ty, ex } of placed) {
          const knee = l.left ? ex + 10 : ex - 10;
          ctx.strokeStyle = l.fail ? col.fail : col.rule;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(knee, y);
          ctx.lineTo(ex, ty);
          ctx.stroke();
          ctx.fillStyle = l.fail ? col.fail : col.text;
          ctx.textAlign = l.left ? "right" : "left";
          ctx.fillText(l.text.toUpperCase(), l.left ? ex - 6 : ex + 6, ty);
        }
        ctx.globalAlpha = 1;
      }
    };

    let raf = 0;
    let start = 0;
    let last = 0;
    let visible = false;
    // Ease the camera toward its goal; returns true while it is still moving. Reduced motion jumps straight there.
    const settle = () => {
      const c = cam.current;
      const g = goal.current;
      const k = reduce ? 1 : 0.2;
      let moving = false;
      for (const key of ["yaw", "pitch", "zoom", "px", "py"] as const) {
        const d = g[key] - c[key];
        if (Math.abs(d) > 1e-4) { c[key] += d * k; moving = true; } else c[key] = g[key];
      }
      return moving;
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // The scene ticks at 30fps; a moving camera draws every frame so orbiting stays smooth.
      const moving = settle();
      if (!visible || (!moving && now - last < 33)) return;
      last = now;
      if (!start) start = now;
      draw((now - start) / 1000);
    };
    // With motion reduced there is no loop, so each camera change draws one frame in place.
    kick.current = () => { if (reduce) { settle(); draw(tNow || 99); } };

    let drag: { x: number; y: number; pan: boolean; id: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, id: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
      canvas.dataset.dragging = "";
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      const g = goal.current;
      if (drag.pan) { g.px += dx; g.py += dy; }
      else { g.yaw -= dx * 0.008; g.pitch = clamp(g.pitch + dy * 0.005, PITCH); }
      kick.current();
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      delete canvas.dataset.dragging;
    };
    // Plain scroll keeps scrolling the page; only a modified wheel (a trackpad pinch arrives as ctrl+wheel) zooms.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      goal.current.zoom = clamp(goal.current.zoom * Math.exp(-e.deltaY * 0.002), ZOOM);
      kick.current();
    };
    const dbl = () => { goal.current = { ...HOME }; kick.current(); };
    const keys: Record<string, (g: Cam) => void> = {
      ArrowLeft: (g) => { g.yaw += 0.15; },
      ArrowRight: (g) => { g.yaw -= 0.15; },
      ArrowUp: (g) => { g.pitch = clamp(g.pitch - 0.08, PITCH); },
      ArrowDown: (g) => { g.pitch = clamp(g.pitch + 0.08, PITCH); },
      "+": (g) => { g.zoom = clamp(g.zoom * 1.15, ZOOM); },
      "=": (g) => { g.zoom = clamp(g.zoom * 1.15, ZOOM); },
      "-": (g) => { g.zoom = clamp(g.zoom / 1.15, ZOOM); },
      "0": (g) => { Object.assign(g, HOME); },
    };
    const key = (e: KeyboardEvent) => {
      const step = keys[e.key];
      if (!step) return;
      e.preventDefault();
      step(goal.current);
      kick.current();
    };
    const menu = (e: MouseEvent) => e.preventDefault();
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", dbl);
    canvas.addEventListener("keydown", key);
    canvas.addEventListener("contextmenu", menu);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) draw(99);
    });
    ro.observe(canvas);
    if (reduce) draw(99);
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", dbl);
      canvas.removeEventListener("keydown", key);
      canvas.removeEventListener("contextmenu", menu);
    };
  }, [cols, rows, maxH, seed, build, twinkle, empty, vocab, palette, playKey, gutter, gutterLeft, motion]);

  const btn = "inline-flex size-7 items-center justify-center rounded-sm text-muted transition-colors duration-150 hover:bg-hover hover:text-ink";
  return (
    <div className="group/iso relative size-full">
      <canvas
        ref={ref}
        className="mz-canvas mz-orbit"
        role="img"
        tabIndex={0}
        aria-label={`${label}. Drag to orbit, shift-drag to pan, arrow keys rotate, plus and minus zoom, 0 resets.`}
      />
      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 opacity-60 transition-opacity duration-150 group-hover/iso:opacity-100 group-focus-within/iso:opacity-100">
        <span className="hidden font-mono text-xs uppercase tracking-wider text-subtle md:inline">drag to orbit · shift pan · ctrl scroll zoom</span>
        <div className="pointer-events-auto flex items-center rounded-md border border-rule bg-sunken p-0.5">
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" className={btn}><Minus className="size-3.5" aria-hidden /></button>
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in" className={btn}><Plus className="size-3.5" aria-hidden /></button>
          <button type="button" onClick={reset} aria-label="Reset view" className={btn}><RotateCcw className="size-3.5" aria-hidden /></button>
        </div>
      </div>
    </div>
  );
}

/** Sample a grey map at (u, v) in 0..1 with a square cover fit, averaged over a small cross so big cells do not alias. */
export function grayAt(g: Gray, u: number, v: number, scale = 1, ax = 0.5, ay = 0.5) {
  const s = Math.max(1 / g.w, 1 / g.h) / scale;
  const iw = 1 / s;
  const x0 = (g.w - iw) * ax;
  const y0 = (g.h - iw) * ay;
  const at = (uu: number, vv: number) => {
    const x = Math.floor(x0 + uu * iw);
    const y = Math.floor(y0 + vv * iw);
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return 0;
    return g.data[y * g.w + x];
  };
  const d = 0.35 / Math.max(g.w, g.h) / s;
  return (at(u, v) * 2 + at(u - d, v) + at(u + d, v) + at(u, v - d) + at(u, v + d)) / 6;
}

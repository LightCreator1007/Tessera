// Isometric word mosaic: the same word tiles, laid on a 2:1 isometric grid and extruded into blocks. A scene is a
// function of time that returns cells (footprint i, j; base z; height h; tone) plus optional labels. Tone maps to the
// palette levels exactly like the flat mosaic, side faces are the top colour shaded with the void token, and every
// cell drops in on its own random delay (the iso version of dissolve) while a share of words twinkle.
"use client";

import { reducedMotion, usePrefs } from "@/lib/prefs";
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

    const draw = (t: number) => {
      const { cells, labels } = sceneRef.current(t);
      const span = cols + rows;
      const usableW = W * (1 - gutter - gutterLeft);
      const hw = Math.min(usableW / span, (H * 0.94) / (span * 0.5 + maxH * ZR));
      const hh = hw / 2;
      const zh = hw * ZR;
      const ox = W * gutterLeft + usableW / 2 - ((cols - rows) * hw) / 2;
      const oy = (H - span * hh + maxH * zh) / 2;
      const P = (i: number, j: number, z: number): [number, number] => [ox + (i - j) * hw, oy + (i + j) * hh - z * zh];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = col.ground;
      ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      const sorted = cells.slice().sort((a, b) => baseZ(a) - baseZ(b) || a.i + a.j - (b.i + b.j) || a.i - b.i);
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
        if (c.h > 0.001) {
          poly([P(c.i, c.j + 1, top), P(c.i + 1, c.j + 1, top), P(c.i + 1, c.j + 1, z0), P(c.i, c.j + 1, z0)], face, 0.32);
          poly([P(c.i + 1, c.j, top), P(c.i + 1, c.j + 1, top), P(c.i + 1, c.j + 1, z0), P(c.i + 1, c.j, z0)], face, 0.58);
        }
        const [x0, y0] = P(c.i, c.j, top);
        poly([[x0, y0], P(c.i + 1, c.j, top), P(c.i + 1, c.j + 1, top), P(c.i, c.j + 1, top)], lvl === 0 ? col.ground : face, 0);
        if (lvl === 0 && blank[k]) {
          ctx.globalAlpha = 1;
          continue;
        }
        // Word on the top face, written along the i axis in the face's own plane.
        const swaps = flick[k] < twinkle * 4 && !reduce ? Math.floor(t * 0.6 + flick[k] * 9) : 0;
        const w = vocab[(word[k] + swaps * 7) % vocab.length];
        ctx.setTransform((dpr * hw) / 100, (dpr * hh) / 100, (-dpr * hw) / 100, (dpr * hh) / 100, dpr * x0, dpr * y0);
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
        for (const l of labels) {
          const [x, y] = P(l.i, l.j, l.z);
          const ex = l.left ? Math.min(x - 28, ox - rows * hw - 16) : Math.max(x + 28, ox + cols * hw + 16);
          ctx.strokeStyle = l.fail ? col.fail : col.rule;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(ex, y);
          ctx.stroke();
          ctx.fillStyle = l.fail ? col.fail : col.text;
          ctx.textAlign = l.left ? "right" : "left";
          ctx.fillText(l.text.toUpperCase(), l.left ? ex - 6 : ex + 6, y);
        }
        ctx.globalAlpha = 1;
      }
    };

    let raf = 0;
    let start = 0;
    let last = 0;
    let visible = false;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < 33) return;
      last = now;
      if (!start) start = now;
      draw((now - start) / 1000);
    };
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
    };
  }, [cols, rows, maxH, seed, build, twinkle, empty, vocab, palette, playKey, gutter, gutterLeft, motion]);

  return <canvas ref={ref} className="mz-canvas" role="img" aria-label={label} />;
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

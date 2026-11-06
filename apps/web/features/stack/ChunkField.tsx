"use client";
// Draws a Swarm file's real chunk tree on a canvas, and morphs it onto the address ring where each chunk's hash sends it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Tree } from "@/lib/stack/swarm";
import { reducedMotion } from "@/lib/prefs";

export type Layout = "tree" | "address";
type Pt = { x: number; y: number };

const TAU = Math.PI * 2;
const byte = (ref: string, i: number) => parseInt(ref.slice(i * 2, i * 2 + 2), 16);

/** Where each node sits in both layouts, in unit coordinates around the centre. */
function layouts(tree: Tree) {
  const n = tree.nodes.length;
  const tree_: Pt[] = new Array(n);
  const addr: Pt[] = new Array(n);
  const inner = tree.nodes.map((x, i) => (x.kind === "inner" ? i : -1)).filter((i) => i >= 0);
  const leaves = tree.nodes.map((x, i) => (x.kind === "leaf" ? i : -1)).filter((i) => i >= 0);
  const polar = (a: number, r: number): Pt => ({ x: Math.cos(a - Math.PI / 2) * r, y: Math.sin(a - Math.PI / 2) * r });
  tree_[0] = { x: 0, y: 0 };
  inner.forEach((ix, k) => (tree_[ix] = polar(((k + 0.5) / inner.length) * TAU, 0.3)));
  // Leaves run round the circle in file order, with a small gap between parents so each intermediate's fan reads as one block.
  const parents = new Set(leaves.map((ix) => tree.nodes[ix].parent));
  const gap = parents.size > 1 ? 6 : 0;
  const slots = leaves.length + parents.size * gap;
  const rows = leaves.length > 1200 ? 9 : leaves.length > 300 ? 5 : 2;
  let slot = 0;
  let prev = -2;
  leaves.forEach((ix, k) => {
    const p = tree.nodes[ix].parent;
    if (p !== prev) {
      if (prev !== -2) slot += gap;
      prev = p;
    }
    tree_[ix] = polar(((slot + 0.5) / slots) * TAU, 0.56 + (0.38 * (k % rows)) / Math.max(1, rows - 1));
    slot += 1;
  });
  tree.nodes.forEach((x, i) => {
    // Address ring: the first two bytes pick the angle (the neighbourhood), the third spreads the radius so dots don't stack.
    const a = ((byte(x.ref, 0) * 256 + byte(x.ref, 1)) / 65536) * TAU;
    const r = x.kind === "root" ? 0.5 : x.kind === "inner" ? 0.52 + 0.06 * (byte(x.ref, 2) / 255) : 0.6 + 0.34 * (byte(x.ref, 2) / 255);
    addr[i] = polar(a, r);
  });
  return { tree: tree_, addr };
}

/** Canvas can't use CSS variables, so it reads the token values once per draw setup. */
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function ChunkField({ tree, layout, onHover }: { tree: Tree; layout: Layout; onHover?: (i: number | null) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pos = useMemo(() => layouts(tree), [tree]);
  const [size, setSize] = useState(0);
  const state = useRef({ t: layout === "address" ? 1 : 0, grow: 0, hover: -1 });
  const target = layout === "address" ? 1 : 0;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    state.current.grow = reducedMotion() ? 1 : 0;
  }, [tree]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d")!;
    const col = {
      rule: token("--mz-rule"),
      data: token("--mz-l6"),
      parity: token("--mz-l5"),
      inner: token("--mz-l7"),
      dim: token("--ink-subtle"),
    };
    const R = size / 2 - 18;
    const cx = size / 2;
    const at = (i: number, t: number, g: number): Pt => {
      const a = pos.tree[i];
      const b = pos.addr[i];
      const k = ease(t);
      const s = g;
      return { x: cx + (a.x + (b.x - a.x) * k) * R * s, y: cx + (a.y + (b.y - a.y) * k) * R * s };
    };
    let raf = 0;
    const draw = () => {
      const st = state.current;
      const motion = !reducedMotion();
      st.t += motion ? (target - st.t) * 0.08 : target - st.t;
      if (Math.abs(target - st.t) < 0.002) st.t = target;
      st.grow = Math.min(1, st.grow + (motion ? 0.025 : 1));
      const g = ease(st.grow);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      // Guides: the 16 neighbourhoods by first hex digit, faded in as the address layout takes over.
      ctx.strokeStyle = col.rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cx, R * 0.97, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = st.t;
      ctx.font = "10px var(--font-mono), monospace";
      ctx.fillStyle = col.dim;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * 0.56, cx + Math.sin(a) * R * 0.56);
        ctx.lineTo(cx + Math.cos(a) * R * 0.97, cx + Math.sin(a) * R * 0.97);
        ctx.stroke();
        const m = a + TAU / 32;
        ctx.fillText(k.toString(16), cx + Math.cos(m) * (R + 10), cx + Math.sin(m) * (R + 10));
      }
      ctx.globalAlpha = 1;
      const nodes = tree.nodes;
      // Tree edges only while the tree layout shows; thousands of hairlines at low alpha read as the fan-out.
      if (st.t < 0.98) {
        ctx.strokeStyle = col.data;
        ctx.globalAlpha = (1 - st.t) * 0.1;
        ctx.beginPath();
        for (let i = 1; i < nodes.length; i++) {
          const p = at(nodes[i].parent, st.t, g);
          const q = at(i, st.t, g);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const dot = nodes.length > 1500 ? 1.6 : nodes.length > 400 ? 2.2 : 3.2;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const p = at(i, st.t, g);
        const s = n.kind === "root" ? 9 : n.kind === "inner" ? 5 : dot;
        ctx.fillStyle = n.parity ? col.parity : n.kind === "leaf" ? col.data : col.inner;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      if (st.hover >= 0) {
        const p = at(st.hover, st.t, g);
        ctx.strokeStyle = col.inner;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 6, p.y - 6, 12, 12);
      }
      if (st.t !== target || st.grow < 1) raf = requestAnimationFrame(draw);
    };
    draw();
    const move = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      let best = -1;
      let bd = 14 * 14;
      for (let i = 0; i < tree.nodes.length; i++) {
        const p = at(i, state.current.t, 1);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best !== state.current.hover) {
        state.current.hover = best;
        onHover?.(best >= 0 ? best : null);
        cancelAnimationFrame(raf);
        draw();
      }
    };
    const leave = () => {
      state.current.hover = -1;
      onHover?.(null);
      cancelAnimationFrame(raf);
      draw();
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerleave", leave);
    };
  }, [size, pos, tree, target, onHover]);

  return (
    <div ref={wrap} className="relative aspect-square w-full max-w-xl">
      <canvas
        ref={canvas}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${tree.leaves} data chunks and ${tree.parity} parity chunks, shown ${layout === "tree" ? "as a tree" : "on Swarm's address ring"}`}
      />
    </div>
  );
}

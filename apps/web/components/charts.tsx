"use client";
// Hand-drawn SVG charts in brand red: a gradient area under the line, a draw-in on first paint, and a crosshair that snaps to rounds. Unparseable or null metrics are gaps in the line, never zeros.
import { f64 } from "@/lib/api/metric";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { useEffect, useId, useRef, useState } from "react";
import type { RoundState } from "@/lib/api/types";
import { cx } from "./primitives";

type Pt = { x: number; y: number | null };
export function toPoints(rounds: RoundState[]): Pt[] {
  return rounds.map((r) => {
    return { x: r.round, y: f64(r.metric) };
  });
}

export function Sparkline({ points, width = 96, height = 24 }: { points: Pt[]; width?: number; height?: number }) {
  const gid = useId();
  const ys = points.flatMap((p) => (p.y === null ? [] : [p.y]));
  if (ys.length < 2) return <span className="text-xs italic text-subtle">{ys.length ? "1 point" : "No rounds yet"}</span>;
  const x = scaleLinear().domain([points[0].x, points[points.length - 1].x]).range([1, width - 3]);
  const y = scaleLinear().domain([Math.min(...ys), Math.max(...ys)]).range([height - 2, 2]);
  const defined = (p: Pt) => p.y !== null;
  const d = line<Pt>().defined(defined).curve(curveMonotoneX).x((p) => x(p.x)).y((p) => y(p.y!))(points) ?? "";
  const fill = area<Pt>().defined(defined).curve(curveMonotoneX).x((p) => x(p.x)).y0(height).y1((p) => y(p.y!))(points) ?? "";
  const last = [...points].reverse().find((p) => p.y !== null)!;
  return (
    <svg width={width} height={height} className="overflow-visible text-mosaic" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gid})`} className="chart-fade" />
      <path d={d} pathLength={1} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="chart-draw" />
      <circle cx={x(last.x)} cy={y(last.y!)} r="2.25" className="fill-brand-cream" />
    </svg>
  );
}

export function LossChart({ points, total, from = 1, height = 200 }: { points: Pt[]; total: number; from?: number; height?: number }) {
  const id = useId();
  const gid = `${id}-area`;
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(320);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = { l: 40, r: 16, t: 16, b: 24 };
  const ys = points.flatMap((p) => (p.y === null ? [] : [p.y]));
  if (ys.length === 0) {
    return (
      <div className="flex items-center justify-center border border-dashed border-rule px-4 text-center text-sm text-subtle" style={{ height }}>
        No loss reported yet. The first point appears when round 1 finalizes.
      </div>
    );
  }
  const to = from > 1 ? Math.max(points[points.length - 1]?.x ?? from + 1, from + 1) : Math.max(total, 2);
  const x = scaleLinear().domain([from, to]).range([pad.l, W - pad.r]);
  const y = scaleLinear().domain([0, Math.max(...ys) * 1.08]).nice().range([height - pad.b, pad.t]);
  const defined = (p: Pt) => p.y !== null;
  const mk = line<Pt>().defined(defined).curve(curveMonotoneX).x((p) => x(p.x)).y((p) => y(p.y!));
  const fill = area<Pt>().defined(defined).curve(curveMonotoneX).x((p) => x(p.x)).y0(height - pad.b).y1((p) => y(p.y!));
  const gaps = points.filter((p) => p.y === null);
  const ticksX = x.ticks(Math.min(to - from + 1, W < 480 ? 5 : 10)).filter(Number.isInteger);
  const reported = points.filter((p): p is { x: number; y: number } => p.y !== null);
  const latest = reported[reported.length - 1];
  const best = reported.reduce((b, p) => (p.y < b.y ? p : b), reported[0]);

  const h = hover === null ? null : points[hover];
  const prev = hover === null ? null : [...points.slice(0, hover)].reverse().find((p) => p.y !== null) ?? null;
  const delta = h && h.y !== null && prev && prev.y !== null ? h.y - prev.y : null;

  // Snap to the nearest round under the pointer, across the whole plot rather than per-point hit boxes.
  const nearest = (px: number) => {
    const at = x.invert(px);
    let k = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].x - at) < Math.abs(points[k].x - at)) k = i;
    return k;
  };
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(nearest(pad.l + ((e.clientX - r.left) / r.width) * (W - pad.l - pad.r)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    setHover((k) => Math.max(0, Math.min(points.length - 1, (k === null ? points.length - 1 : k + step))));
  };

  return (
    <figure ref={box} className="relative w-full min-w-0 outline-none" tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)} aria-describedby={id}>
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} className="block overflow-visible text-mosaic" role="img" aria-labelledby={id}>
        <title id={id}>Loss by round: {ys.length} of {total} rounds reported. Latest {ys[ys.length - 1].toFixed(4)}, best {best.y.toFixed(4)} at round {best.x}. Arrow keys step through rounds.</title>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="70%" stopColor="currentColor" stopOpacity="0.06" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-chart-grid" strokeDasharray="2 4" />
            <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-subtle font-mono text-xs tabular">{t.toFixed(1)}</text>
          </g>
        ))}
        {ticksX.map((t) => (
          <text key={t} x={x(t)} y={height - 6} textAnchor="middle" className={cx("font-mono text-xs tabular transition-colors duration-150", h?.x === t ? "fill-ink" : "fill-subtle")}>{t}</text>
        ))}
        {gaps.map((g) => (
          <g key={g.x}>
            <line x1={x(g.x)} x2={x(g.x)} y1={pad.t} y2={height - pad.b} className="stroke-warn" strokeDasharray="2 3" />
            <text x={x(g.x)} y={pad.t} dy="-4" textAnchor="middle" className="fill-warn font-mono text-xs">no metric</text>
          </g>
        ))}
        <path d={fill(points) ?? ""} fill={`url(#${gid})`} className="chart-fade" />
        <path d={mk(points) ?? ""} pathLength={1} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="chart-draw" />

        {/* Best round: a small flag, so the low point reads without hovering. */}
        {best !== latest && (
          <g className="chart-fade">
            <line x1={x(best.x)} x2={x(best.x)} y1={y(best.y) + 6} y2={height - pad.b} className="stroke-rule-strong" strokeDasharray="1 3" />
            <text x={x(best.x)} y={y(best.y) + 18} textAnchor="middle" className="fill-muted font-mono text-xs">best</text>
          </g>
        )}

        {h && (
          <g pointerEvents="none">
            <line x1={x(h.x)} x2={x(h.x)} y1={pad.t} y2={height - pad.b} className="stroke-rule-strong" />
            {h.y !== null && <line x1={pad.l} x2={W - pad.r} y1={y(h.y)} y2={y(h.y)} className="stroke-rule" strokeDasharray="2 3" />}
          </g>
        )}
        {reported.map((p) => {
          const on = h?.x === p.x;
          return <circle key={p.x} cx={x(p.x)} cy={y(p.y)} r={on ? 5 : 2.5} className={cx("stroke-surface", on ? "fill-brand-cream" : "fill-mosaic")} strokeWidth="2" />;
        })}
        {/* The latest round is live: a ring breathes out of it. */}
        <circle cx={x(latest.x)} cy={y(latest.y)} r="4" fill="none" stroke="currentColor" strokeWidth="1.5" className="chart-ping" />

        <rect x={pad.l} y={pad.t} width={Math.max(0, W - pad.l - pad.r)} height={height - pad.t - pad.b} fill="transparent" className="cursor-crosshair" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 z-10 flex animate-pop-in flex-col gap-0.5 rounded-sm border border-rule bg-raised px-2.5 py-1.5 font-mono text-xs tabular shadow-popover"
          style={{ left: `${(x(h.x) / W) * 100}%`, transform: `translateX(${x(h.x) > W * 0.75 ? "-105%" : x(h.x) < W * 0.25 ? "5%" : "-50%"})` }}
        >
          <span className="text-subtle">round {h.x}</span>
          <span className="text-sm text-ink">{h.y === null ? "not reported" : h.y.toFixed(4)}</span>
          {delta !== null && (
            <span className={delta <= 0 ? "text-trend-good" : "text-trend-bad"}>
              {delta <= 0 ? "▼" : "▲"} {Math.abs(delta).toFixed(4)} vs round {prev!.x}
            </span>
          )}
        </div>
      )}
    </figure>
  );
}

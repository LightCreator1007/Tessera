"use client";
// Hand-drawn SVG charts. Unparseable or null metrics are gaps in the line, never zeros.
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useEffect, useId, useRef, useState } from "react";
import type { RoundState } from "@/lib/api/types";

type Pt = { x: number; y: number | null };
export function toPoints(rounds: RoundState[]): Pt[] {
  return rounds.map((r) => {
    const n = r.metric === null ? NaN : Number(r.metric);
    return { x: r.round, y: Number.isFinite(n) ? n : null };
  });
}

export function Sparkline({ points, width = 96, height = 24 }: { points: Pt[]; width?: number; height?: number }) {
  const ys = points.flatMap((p) => (p.y === null ? [] : [p.y]));
  if (ys.length < 2) return <span className="text-xs italic text-subtle">{ys.length ? "1 point" : "No rounds yet"}</span>;
  const x = scaleLinear().domain([points[0].x, points[points.length - 1].x]).range([1, width - 3]);
  const y = scaleLinear().domain([Math.min(...ys), Math.max(...ys)]).range([height - 2, 2]);
  const d = line<Pt>().defined((p) => p.y !== null).x((p) => x(p.x)).y((p) => y(p.y!))(points) ?? "";
  const last = [...points].reverse().find((p) => p.y !== null)!;
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx={x(last.x)} cy={y(last.y!)} r="2" fill="currentColor" />
    </svg>
  );
}

export function LossChart({ points, total, from = 1, height = 200 }: { points: Pt[]; total: number; from?: number; height?: number }) {
  const id = useId();
  const [hover, setHover] = useState<Pt | null>(null);
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(320);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = { l: 40, r: 12, t: 12, b: 24 };
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
  const mk = line<Pt>().defined((p) => p.y !== null).x((p) => x(p.x)).y((p) => y(p.y!));
  const gaps = points.filter((p) => p.y === null);
  const ticksX = x.ticks(Math.min(to - from + 1, W < 480 ? 5 : 10)).filter(Number.isInteger);
  return (
    <figure ref={box} className="relative w-full min-w-0">
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} className="block overflow-visible" role="img" aria-labelledby={id}>
        <title id={id}>Loss by round: {ys.length} of {total} rounds reported. Latest {ys[ys.length - 1].toFixed(4)}.</title>
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-chart-grid" strokeDasharray="2 4" />
            <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-subtle font-mono text-xs tabular">{t.toFixed(1)}</text>
          </g>
        ))}
        {ticksX.map((t) => (
          <text key={t} x={x(t)} y={height - 6} textAnchor="middle" className="fill-subtle font-mono text-xs tabular">{t}</text>
        ))}
        {gaps.map((g) => (
          <g key={g.x}>
            <line x1={x(g.x)} x2={x(g.x)} y1={pad.t} y2={height - pad.b} className="stroke-warn" strokeDasharray="2 3" />
            <text x={x(g.x)} y={pad.t} dy="-2" textAnchor="middle" className="fill-warn font-mono text-xs">no metric</text>
          </g>
        ))}
        <path d={mk(points) ?? ""} fill="none" className="stroke-chart-ink" strokeWidth="1.5" strokeLinejoin="round" />
        {points.map((p) => p.y !== null && (
          <circle key={p.x} cx={x(p.x)} cy={y(p.y)} r={hover?.x === p.x ? 4 : 2.25} className="fill-raised stroke-chart-ink" strokeWidth="1.25" />
        ))}
        {points.map((p) => (
          <rect key={`h${p.x}`} x={x(p.x) - 12} y={pad.t} width="24" height={height - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute top-0 rounded-sm border border-rule bg-raised px-2 py-1 font-mono text-xs tabular shadow-sm" style={{ left: `${(x(hover.x) / W) * 100}%`, transform: "translateX(-50%)" }}>
          R{hover.x} · {hover.y === null ? "not reported" : hover.y.toFixed(4)}
        </div>
      )}
    </figure>
  );
}

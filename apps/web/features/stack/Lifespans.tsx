"use client";
// Arkiv's lifetimes: every live record as a bar from now to the block it expires, on a log axis so an hour and a month both read.
import { useEffect, useRef, useState } from "react";
import { scaleLog } from "d3-scale";
import { BLOCK_SECONDS, SCHEMAS, SCHEMA_LABEL, type Entity, type Schema } from "@/lib/stack/arkiv";

const FILL: Record<Schema, string> = {
  "tod.shards": "var(--mz-l4)",
  "tod.model": "var(--mz-l6)",
  "tod.competition": "var(--trust-chain)",
  "tod.competition.result": "var(--ok)",
};
const ROW = 10;
const LANE_GAP = 16;
const LABEL = 104;
const MIN = 60; // seconds; anything closer to expiry sits on the axis start
const MAX = 7_884_000 * BLOCK_SECONDS; // Arkiv's longest lifetime, about 182 days
const TICKS: [number, string][] = [[3600, "1h"], [86400, "1d"], [7 * 86400, "7d"], [30 * 86400, "30d"], [MAX, "182d max"]];

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Lifespans({ entities, now, selected, onSelect }: { entities: Entity[]; now: number; selected: string | null; onSelect: (key: string) => void }) {
  const [ref, w] = useWidth();
  const left = (e: Entity) => Math.max(0, (e.expiresAt - now) * BLOCK_SECONDS);
  const lanes = SCHEMAS.map((s) => ({ s, es: entities.filter((e) => e.schema === s).sort((a, b) => left(a) - left(b)) })).filter((l) => l.es.length);
  const x = scaleLog().domain([MIN, MAX]).range([LABEL, Math.max(LABEL + 10, w - 12)]).clamp(true);
  let y = 22;
  const placed = lanes.map((l) => {
    const top = y;
    y += l.es.length * ROW + LANE_GAP;
    return { ...l, top };
  });
  const h = y + 4;
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={h} role="img" aria-label={`${entities.length} live Arkiv records and the time each has left before it expires`}>
          {TICKS.map(([s, label]) => (
            <g key={label}>
              <line x1={x(s)} x2={x(s)} y1={14} y2={h} stroke="var(--rule-row)" />
              <text x={x(s)} y={9} textAnchor={s === MAX ? "end" : "middle"} fill="var(--ink-subtle)" fontSize={10} className="font-mono">{label}</text>
            </g>
          ))}
          <line x1={LABEL} x2={LABEL} y1={14} y2={h} stroke="var(--ink)" strokeDasharray="2 3" />
          <text x={LABEL} y={9} textAnchor="middle" fill="var(--ink)" fontSize={10} className="font-mono">now</text>
          {placed.map((l) => (
            <g key={l.s}>
              <text x={0} y={l.top + 8} fill="var(--ink-muted)" fontSize={10} className="font-mono uppercase tracking-wide">{SCHEMA_LABEL[l.s]}</text>
              <text x={0} y={l.top + 20} fill="var(--ink-subtle)" fontSize={10} className="font-mono">{l.es.length} live</text>
              {l.es.map((e, i) => {
                const end = x(Math.max(MIN, left(e)));
                const yy = l.top + i * ROW;
                const on = e.key === selected;
                return (
                  <g key={e.key} className="cursor-pointer" onClick={() => onSelect(e.key)}>
                    <title>{`${SCHEMA_LABEL[l.s]} ${e.attrs.job !== undefined ? `job #${e.attrs.job}` : `#${e.attrs.competition ?? "?"}`}: expires at block ${e.expiresAt.toLocaleString()}`}</title>
                    <rect x={LABEL} y={yy} width={w - LABEL} height={ROW} fill="transparent" />
                    <rect x={LABEL} y={yy + 2} width={Math.max(2, end - LABEL)} height={ROW - 4} rx={1} fill={FILL[l.s]} opacity={on ? 1 : selected ? 0.55 : 0.85} />
                    <rect x={end - 1} y={yy + 1} width={2} height={ROW - 2} fill="var(--ink)" opacity={on ? 1 : 0} />
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

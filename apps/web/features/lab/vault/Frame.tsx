// Shared section frame for the vault playground: number, source piece, what drives it and where it would go.
"use client";

import type { ReactNode } from "react";

export function LabFrame({ n, id, title, source, drives, where, children, aside }: { n: string; id: string; title: string; source: string; drives: string; where: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-rule pt-6">
      <header className="mb-4 grid gap-3 md:flex md:items-baseline md:gap-6">
        <span className="font-mono text-sm text-mosaic">{n}</span>
        <div className="md:flex-1">
          <h2 className="text-xl font-medium tracking-tight text-ink">{title}</h2>
          <dl className="mt-2 grid grid-cols-1 gap-1 text-sm text-muted sm:grid-cols-4">
            <dt className="font-mono text-xs uppercase tracking-wide text-subtle">Driven by</dt>
            <dd className="sm:col-span-3">{drives}</dd>
            <dt className="font-mono text-xs uppercase tracking-wide text-subtle">Would go</dt>
            <dd className="sm:col-span-3">{where}</dd>
          </dl>
        </div>
        <a href={`https://design.how/vault#${source}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-subtle underline decoration-rule underline-offset-4 hover:text-ink">
          vault/{source}
        </a>
      </header>
      <div className={aside ? "grid gap-4 lg:grid-cols-4" : ""}>
        <div className="min-w-0 lg:col-span-3">{children}</div>
        {aside ? <aside className="border border-rule bg-card p-4 text-sm text-muted">{aside}</aside> : null}
      </div>
    </section>
  );
}

/** A small mono key/value readout for the aside column. */
export function Readout({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="space-y-1.5 font-mono text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4">
          <dt className="uppercase tracking-wide text-subtle">{k}</dt>
          <dd className="whitespace-nowrap text-right text-ink tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Seeded random so a lab's fake data is stable across renders and replays. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

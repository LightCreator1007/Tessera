"use client";
// Brand hero, two variants (dev dial "hero"): "field" draws the live loss curve as a full-bleed word mosaic; "laptop" draws it on a word-mosaic laptop screen whose screen plots the live job's real loss curve (high loss coral, falling through amber to lime, a missing metric as a dashed gap, the live round in cream). Poster copy and a mono metadata stack beside it. Dismissible.
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { RoundStatus } from "@/lib/api/types";
import { PixelArt, laptop, type Palette } from "./pixel";
import { HeroField } from "./hero-field";
import { ROUND_LABEL } from "./primitives";

const KEY = "hero-dismissed";
const W = 26;
const H = 17;

/** Recolour the curve by height: the higher the loss, the warmer the band. */
function banded(grid: string[]): string[] {
  const top = 1;
  const ih = H - 4;
  return grid.map((row, y) => {
    const t = (y - top) / ih;
    const band = t < 0.34 ? ["A", "a"] : t < 0.67 ? ["B", "b"] : ["C", "e"];
    return row.replace(/c/g, band[0]).replace(/d/g, band[1]);
  });
}

const PAL: Palette = {
  F: { fill: "frame", text: "frame-dim" },
  f: { fill: "frame-dim", text: "off" },
  o: { fill: "off", text: "frame-dim" },
  A: { fill: "coral", text: "ink" },
  a: { fill: "coral-dim", text: "coral" },
  B: { fill: "amber", text: "ink" },
  b: { fill: "amber-dim", text: "amber" },
  C: { fill: "lime", text: "ink" },
  e: { fill: "lime-dim", text: "lime" },
  h: { fill: "cream", text: "ink", live: true },
  n: { fill: "frame-dim", text: "frame" },
};

export function HeroBanner({ round, job, status, nodes, curve, total, dismissible = true }: { round: number | null; job: number | null; status: RoundStatus | null; nodes: number | null; curve: (number | null)[]; total: number | null; dismissible?: boolean }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(dismissible && localStorage.getItem(KEY) === "1"), [dismissible]);
  const variant = useHtmlFlag("hero", "field");
  if (hidden) return null;
  const pad = (n: number | null) => (n === null ? "--" : String(n).padStart(2, "0"));
  const copy = (
    <div className="flex flex-col gap-6">
      <h2 className="max-w-xl text-xl font-medium tracking-tight sm:text-2xl">
        <span className="text-brand-cream">train on idle laptops.</span>
        <br />
        <span className="text-px-coral">pay for </span>
        <span className="text-px-amber">verified </span>
        <span className="text-px-lime">work.</span>
      </h2>
      <dl className="flex flex-col gap-0.5 font-mono text-sm uppercase tracking-widest text-brand-cream/80">
        <div className="flex gap-2"><dt className="sr-only">Job</dt><dd>job {pad(job)} / round {pad(round)}{total ? ` of ${total}` : ""}</dd></div>
        <div className="flex gap-2"><dt className="sr-only">Phase</dt><dd>{status ? ROUND_LABEL[status] : "no live round"}</dd></div>
        <div className="flex gap-2"><dt className="sr-only">Nodes</dt><dd>{nodes === null ? "--" : nodes} nodes online</dd></div>
      </dl>
    </div>
  );
  const actions = (
    <div className="flex flex-wrap items-center gap-4">
      <Link href="/jobs/new" className="inline-flex h-9 items-center rounded-md bg-brand-cream px-4 text-sm font-medium text-brand-ink hover:opacity-90">Train a model</Link>
      <Link href="/nodes/add" className="inline-flex h-9 items-center rounded-md border border-brand-cream/25 px-4 text-sm text-brand-cream hover:border-brand-cream/60">Lend your laptop</Link>
      <Link href="/demo" className="inline-flex items-center gap-1 border-b border-brand-cream/30 pb-0.5 text-sm text-brand-cream/80 hover:border-brand-cream">
        watch a cheater get caught, 40s <ArrowUpRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
  const dismiss = dismissible && (
    <button
      type="button"
      onClick={() => { localStorage.setItem(KEY, "1"); setHidden(true); }}
      aria-label="Dismiss"
      className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-md text-brand-cream/60 hover:text-brand-cream"
    >
      <X className="size-4" />
    </button>
  );

  if (variant === "field") {
    return (
      <section className="relative isolate overflow-hidden rounded-xl border border-rule bg-brand-ink" aria-label="ToD">
        <HeroField curve={curve} className="mosaic-mask absolute inset-0 -z-10 py-3" />
        {dismiss}
        <div className="flex min-h-80 flex-col justify-between gap-10 px-6 py-8 md:px-10 md:py-10">
          {copy}
          {actions}
        </div>
        <p className="absolute bottom-3 right-4 hidden font-mono text-xs uppercase tracking-wider text-brand-cream/45 md:block">live loss, job {pad(job)} · breaks are rounds with no metric</p>
      </section>
    );
  }

  const grid = banded(laptop({ w: W, h: H, state: "training", curve: curve.length ? curve : undefined }));
  return (
    <section className="relative isolate overflow-hidden rounded-xl border border-rule bg-brand-ink" aria-label="ToD">
      {dismiss}
      <div className="flex flex-col gap-8 p-6 md:p-8 lg:flex-row lg:items-center lg:gap-10">
        <div className="flex flex-col gap-6 lg:w-5/12">
          {copy}
          {actions}
        </div>
        <figure className="min-w-0 flex-1">
          <PixelArt words grid={grid} palette={PAL} className="w-full" label={`Loss curve of job ${pad(job)}, drawn as a laptop screen`} />
          <figcaption className="mt-2 font-mono text-xs uppercase tracking-wider text-brand-cream/50">live loss, job {pad(job)} · gaps are rounds with no metric</figcaption>
        </figure>
      </div>
    </section>
  );
}

/** Reads a data-* flag on <html> (set by the dev dials) and re-renders when it changes. */
function useHtmlFlag(name: string, fallback: string) {
  return useSyncExternalStore(
    (f) => { const o = new MutationObserver(f); o.observe(document.documentElement, { attributes: true, attributeFilter: [`data-${name}`] }); return () => o.disconnect(); },
    () => document.documentElement.getAttribute(`data-${name}`) ?? fallback,
    () => fallback,
  );
}

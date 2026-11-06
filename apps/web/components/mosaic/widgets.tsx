// DOM-sized mosaic pieces: tile progress strips, an indeterminate scanner, the inline word spinner, scrambling
// numbers, skeleton rows and the word-by-word toast headline.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VOCAB, mulberry32 } from "./engine";

function useReduced() {
  const [r, setR] = useState(false);
  useEffect(() => setR(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  return r;
}

export function useTick(ms: number, on = true) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return n;
}

function words(n: number, seed: number) {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => VOCAB[Math.floor(r() * VOCAB.length)]);
}

/** Determinate progress as lit word tiles. The head tile is the glint, the two behind it step down to red. */
export function TileProgress({ value, label, count = 28, seed = 3 }: { value: number; label: string; count?: number; seed?: number }) {
  const ws = useMemo(() => words(count, seed), [count, seed]);
  const lit = Math.round(Math.min(1, Math.max(0, value)) * count);
  return (
    <div className="mz-strip" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      {ws.map((w, i) => {
        const back = lit - 1 - i;
        const l = i >= lit ? 0 : back === 0 && lit < count ? 7 : back === 1 ? 5 : back === 2 ? 4 : 3;
        return (
          <span key={i} data-l={l}>
            {w}
          </span>
        );
      })}
    </div>
  );
}

/** Indeterminate: a lit band sweeps left to right in fixed steps. Reduced motion shows a steady half-lit strip. */
export function TileScanner({ label, count = 28, seed = 9, step = 70 }: { label: string; count?: number; seed?: number; step?: number }) {
  const reduced = useReduced();
  const ws = useMemo(() => words(count, seed), [count, seed]);
  const n = useTick(step, !reduced);
  const head = (n % (count + 8)) - 4;
  const ramp = [7, 5, 4, 3, 2, 1];
  return (
    <div className="mz-strip" role="status" aria-label={label}>
      {ws.map((w, i) => {
        const d = head - i;
        const l = reduced ? 2 : d >= 0 && d < ramp.length ? ramp[d] : 0;
        return (
          <span key={i} data-l={l}>
            {w}
          </span>
        );
      })}
    </div>
  );
}

/** Inline loader for buttons and rows: one tile cycling protocol words. */
export function WordSpinner({ step = 90 }: { step?: number }) {
  const reduced = useReduced();
  const n = useTick(step, !reduced);
  return (
    <span className="mz-spin" aria-hidden>
      {reduced ? "WORKING" : VOCAB[n % VOCAB.length]}
    </span>
  );
}

/** Numbers scramble through digits for a moment before landing, keeping their width (tabular mono). */
export function Scramble({ value, ms = 260 }: { value: string; ms?: number }) {
  const reduced = useReduced();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (reduced || prev.current === value) {
      setShown(value);
      prev.current = value;
      return;
    }
    prev.current = value;
    const start = performance.now();
    let raf = 0;
    const run = (now: number) => {
      const k = (now - start) / ms;
      if (k >= 1) {
        setShown(value);
        return;
      }
      const settled = Math.floor(k * value.length);
      setShown(value.split("").map((ch, i) => (i < settled || !/\d/.test(ch) ? ch : String(Math.floor(Math.random() * 10)))).join(""));
      raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduced]);
  return <span aria-live="polite">{shown}</span>;
}

/** Table skeleton with real column words instead of grey bars. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  const cols = ["NODE 0x....", "ROUND", "STATUS", "PAID"];
  return (
    <div className="mz-skel" role="status" aria-label="Loading rounds">
      {Array.from({ length: rows }, (_, r) => (
        <div className="mz-skel-row" key={r}>
          {cols.map((c, i) => (
            <span key={c} style={{ animationDelay: `${(r * 4 + i) * 60}ms` }}>
              {c}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A toast as a headline strip: each word is a tile and they land one step apart. */
export function TileToast({ text, tone = "ok", play }: { text: string; tone?: "ok" | "fail" | "info"; play: unknown }) {
  const ws = text.split(" ");
  const lv = tone === "fail" ? [5, 4, 3] : tone === "info" ? [2, 2, 1] : [6, 4, 3];
  return (
    <div className="mz-strip mz-toast" role="status" key={String(play)}>
      {ws.map((w, i) => (
        <span key={i} data-l={i === 0 ? lv[0] : i < 3 ? lv[1] : lv[2]} style={{ animationDelay: `${i * 60}ms` }}>
          {w}
        </span>
      ))}
    </div>
  );
}

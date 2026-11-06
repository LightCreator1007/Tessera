// React host for the word-mosaic canvas: owns the renderer, the animation clock, resize and reduced motion.
"use client";

import { reducedMotion, usePrefs } from "@/lib/prefs";
import { useEffect, useRef } from "react";
import { MosaicRenderer, VOCAB, type FieldFn } from "./engine";

export interface MosaicProps {
  field: FieldFn;
  label: string;
  cell?: number;
  /** Target row count; the row height shrinks to fit it (never above `cell`). */
  rows?: number;
  seed?: number;
  vocab?: string[];
  twinkle?: number;
  /** Share of texture cells left empty (0..1). */
  empty?: number;
  /** Seconds the clock runs; Infinity loops forever. Reduced motion renders the frame at this time instead. */
  duration?: number;
  /** Change to restart the clock (replay a reveal). */
  playKey?: unknown;
  /** Change to re-read palette tokens. */
  palette?: string;
  className?: string;
  canvasRef?: (c: HTMLCanvasElement | null) => void;
}

export function Mosaic({
  field,
  label,
  cell = 11,
  rows,
  seed = 7,
  vocab = VOCAB,
  twinkle = 0.12,
  empty = 0.22,
  duration = Infinity,
  playKey,
  palette,
  className,
  canvasRef,
}: MosaicProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const rend = useRef<MosaicRenderer | null>(null);
  const fieldRef = useRef(field);
  fieldRef.current = field;
  const clock = useRef({ start: 0, t: 0 });
  const { motion } = usePrefs();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let r: MosaicRenderer;
    let cancelled = false;
    const ro = new ResizeObserver(() => {
      if (!rend.current) return;
      rend.current.layout();
      rend.current.frame(fieldRef.current, clock.current.t);
    });
    document.fonts.ready.then(() => {
      if (cancelled) return;
      r = new MosaicRenderer(canvas, { cell, rows, seed, vocab, twinkle, empty });
      r.layout();
      rend.current = r;
      r.frame(fieldRef.current, clock.current.t);
      ro.observe(canvas);
    });
    return () => {
      cancelled = true;
      ro.disconnect();
      rend.current = null;
    };
  }, [cell, rows, seed, vocab, twinkle, empty]);

  useEffect(() => {
    rend.current?.repaint();
    rend.current?.frame(fieldRef.current, clock.current.t);
  }, [palette]);

  useEffect(() => {
    const reduce = reducedMotion();
    if (reduce) {
      clock.current.t = Number.isFinite(duration) ? duration : 4;
      const id = requestAnimationFrame(() => rend.current?.frame(fieldRef.current, clock.current.t));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    let started = false;
    let running = false;
    // The clock starts the first time the canvas is on screen, so a reveal below the fold plays when you reach it,
    // and a looping canvas off screen stops evaluating its field until it scrolls back.
    const tick = (now: number) => {
      const t = (now - clock.current.start) / 1000;
      clock.current.t = Math.min(t, duration);
      rend.current?.frame(fieldRef.current, clock.current.t);
      if (t < duration && running) raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      if (!running) return cancelAnimationFrame(raf);
      if (!started) {
        started = true;
        clock.current.start = performance.now();
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    });
    if (ref.current) io.observe(ref.current);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [playKey, duration, motion]);

  // Static props changed (a slider moved after the clock stopped): draw one frame with the new field.
  useEffect(() => {
    rend.current?.frame(fieldRef.current, clock.current.t);
  });

  return (
    <canvas
      ref={(c) => {
        ref.current = c;
        canvasRef?.(c);
      }}
      role="img"
      aria-label={label}
      className={`mz-canvas ${className ? className : ""}`}
    />
  );
}

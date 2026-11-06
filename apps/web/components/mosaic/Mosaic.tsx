// React host for the word-mosaic canvas: owns the renderer, the animation clock, resize and reduced motion.
"use client";

import { reducedMotion, usePrefs } from "@/lib/prefs";
import { useEffect, useRef } from "react";
import { MosaicRenderer, VOCAB, watchPointer, type FieldFn } from "./engine";

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
  /** Pointer wake (tiles light along the pointer's path and fade slowly). On for posters; off for texture behind working UI. */
  wake?: boolean;
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
  wake = true,
}: MosaicProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const rend = useRef<MosaicRenderer | null>(null);
  const fieldRef = useRef(field);
  fieldRef.current = field;
  const clock = useRef({ start: 0, t: 0 });
  const wakeRef = useRef(false);
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
      r.setWake(wakeRef.current);
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
    // The renderer may not exist yet (it waits for fonts), so it also picks this up when it is created.
    wakeRef.current = wake && !reduce;
    rend.current?.setWake(wakeRef.current);
    if (reduce) {
      clock.current.t = Number.isFinite(duration) ? duration : 4;
      const id = requestAnimationFrame(() => rend.current?.frame(fieldRef.current, clock.current.t));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    let started = false;
    let running = false;
    // The clock starts the first time the canvas is on screen, so a reveal below the fold plays when you reach it,
    // and a looping canvas off screen stops evaluating its field until it scrolls back. After the clock stops, frames
    // keep coming while the pointer is near or a wake is still fading, then stop again.
    const tick = (now: number) => {
      raf = 0;
      const t = (now - clock.current.start) / 1000;
      clock.current.t = Math.min(t, duration);
      const r = rend.current;
      r?.frame(fieldRef.current, clock.current.t);
      const more = t < duration || (r ? r.isAwake() || r.pointerNear() : false);
      if (more && running) raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      if (!running) {
        cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      if (!started) {
        started = true;
        clock.current.start = performance.now();
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    });
    if (ref.current) io.observe(ref.current);
    const unwatch = wakeRef.current
      ? watchPointer(() => {
          if (running && started && !raf && rend.current?.pointerNear()) raf = requestAnimationFrame(tick);
        })
      : () => undefined;
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      unwatch();
    };
  }, [playKey, duration, motion, wake]);

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

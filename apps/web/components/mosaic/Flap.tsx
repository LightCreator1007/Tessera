"use client";
// Split-flap numbers: when a value changes, its changed digits pass through one mosaic tile frame and land, right to
// left, the way the TUI block counter does. With glint, one bone sweep follows: money landed. A live number that
// visibly ticks is the proof a connection is alive, so these replace pulsing "live" dots.
import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "@/lib/prefs";
import { cx } from "@/components/primitives";

const LAND_MS = 450;
const STAGGER_MS = 50;

/** glint is read at the moment the text changes, so pass whether this change is a rise. */
export function Flap({ text, glint, className }: { text: string; glint?: boolean; className?: string }) {
  const prev = useRef(text);
  const turn = useRef(0);
  const [from, setFrom] = useState<{ text: string; turn: number; glint: boolean } | null>(null);

  useEffect(() => {
    if (prev.current === text) return;
    const old = prev.current;
    prev.current = text;
    if (reducedMotion() || old.length !== text.length) {
      setFrom(null);
      return;
    }
    turn.current += 1;
    setFrom({ text: old, turn: turn.current, glint: Boolean(glint) });
    const changed = [...text].filter((ch, i) => ch !== old[i]).length;
    const id = setTimeout(() => setFrom(null), LAND_MS + changed * STAGGER_MS + (glint ? 900 : 0));
    return () => clearTimeout(id);
  }, [text, glint]);

  if (!from) return <span className={className}>{text}</span>;
  const n = text.length;
  return (
    <span key={from.turn} className={cx(from.glint && "animate-glint", className)}>
      {[...text].map((ch, i) =>
        ch !== from.text[i] && /\d/.test(ch) ? (
          <span key={i} className="flap-digit" data-pass={String((Number(ch) + 3 + i) % 10)} style={{ animationDelay: `${(n - 1 - i) * STAGGER_MS}ms` }}>
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </span>
  );
}

/** The amount a value just rose by, for a few seconds after it rose; null otherwise. */
export function useGain(value: number, ms = 3000) {
  const prev = useRef(value);
  const [gain, setGain] = useState<number | null>(null);
  useEffect(() => {
    const rose = value - prev.current;
    prev.current = value;
    if (rose <= 0) return;
    setGain(rose);
    const id = setTimeout(() => setGain(null), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return gain;
}

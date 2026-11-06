"use client";
// Time left until a deadline, on the chain's clock: ticks each second in the last hour and each half minute before that.
import { useEffect, useRef, useState } from "react";

function left(ms: number) {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function Countdown({ to, clock = Date.now, verb = "Closes in", done = "Closing now" }: { to: number; clock?: () => number; verb?: string; done?: string }) {
  const [now, setNow] = useState<number | null>(null);
  // Callers pass a fresh closure each render; reading it through a ref keeps the interval from restarting every poll.
  const read = useRef(clock);
  useEffect(() => { read.current = clock; });
  useEffect(() => {
    const tick = () => setNow(read.current());
    tick();
    const id = setInterval(tick, to - read.current() < 3_600_000 ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [to]);
  if (now === null) return null;
  const t = left(to - now);
  return (
    <span role="timer" aria-live="off" className="font-mono text-xs tabular text-ink">
      {t ? `${verb} ${t}` : done}
    </span>
  );
}

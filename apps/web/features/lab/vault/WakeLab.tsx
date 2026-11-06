// V1, after vault/tile-field: a slow wave whose speed is network activity, plus a lobed pointer wake that rises fast and fades slow.
"use client";

import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB_SHORT, type FieldFn } from "@/components/mosaic/engine";
import { sdSegment, smooth } from "@/components/mosaic/fields";
import { coverById, sampler, subjectFit, useGray } from "@/components/mosaic/figures";
import { useTextGray } from "@/components/mosaic/type";
import { useDialKit } from "dialkit";
import { useMemo, useRef, type PointerEvent } from "react";
import { LabFrame, Readout } from "./Frame";

const FAR = -1e5;

export function WakeLab() {
  const d = useDialKit("V1 Wake", {
    subject: { type: "select", options: ["word", "crow", "tiger", "owl"] },
    word: "TESSERA",
    activity: [0.5, 0, 1, 0.01],
    reach: [70, 20, 180, 1],
    fade: [0.035, 0.005, 0.15, 0.005],
    wakeGain: [0.55, 0, 1, 0.01],
    glint: true,
    cell: [7, 5, 12, 1],
  });

  const ptr = useRef({ x: FAR, y: FAR, px: FAR, py: FAR, speed: 0, at: 0 });
  const wake = useRef(new Float32Array(0));
  const clock = useRef({ last: 0, scale: 1 });

  const textG = useTextGray(d.word || "TESSERA", 800);
  const cover = coverById(d.subject === "word" ? "crow" : d.subject);
  const coverG = useGray(d.subject === "word" ? null : cover.src);
  const g = d.subject === "word" ? textG : coverG;

  const field = useMemo<FieldFn>(() => {
    const s = sampler(g, d.subject === "word" ? { fit: "contain", scale: 0.86, ax: 0.5, ay: 0.5 } : subjectFit(cover));
    const isWord = d.subject === "word";
    return (tile, c) => {
      if (tile.i === 0) {
        // Per-frame bookkeeping on the first tile: real frame time keeps the fade the same at 60 and 120 Hz.
        const dt = Math.max(0, Math.min(0.1, c.t - clock.current.last));
        clock.current.last = c.t;
        clock.current.scale = dt * 60;
        ptr.current.speed *= Math.pow(0.9, clock.current.scale);
      }
      if (wake.current.length <= tile.i) {
        const next = new Float32Array(tile.i + 512);
        next.set(wake.current);
        wake.current = next;
      }
      const ink = s(tile, c);
      const lit = isWord ? ink >= 0.4 : ink > 0.12;

      // Four slow sines summed, smoothstepped into how awake this tile is. Activity sets the speed and the depth.
      const u = tile.cx / c.W;
      const v = tile.cy / c.H;
      const T = c.t * (0.15 + d.activity * 1.1);
      const sum = Math.sin(u * 5.1 + T) + Math.sin(v * 4.3 - T * 0.8 + u * 2) + Math.sin((u + v) * 3.7 + T * 0.6) + Math.sin((u - v) * 6.2 - T * 1.3);
      const wave = smooth(0.4, 2.4, sum) * d.activity;

      // Lobed brush along the pointer's last segment: reach wobbles with angle and time, and grows with speed.
      const p = ptr.current;
      const dist = sdSegment(tile.cx, tile.cy, p.px, p.py, p.x, p.y);
      const ang = Math.atan2(tile.cy - p.y, tile.cx - p.x);
      const reach = d.reach * (1 + 0.28 * Math.sin(3 * ang + c.t * 1.7)) * (1 + Math.min(p.speed / 1600, 1.2));
      const target = dist < reach ? 1 - dist / reach : 0;
      let w = wake.current[tile.i];
      w = target > w ? w + (target - w) * 0.55 : w * Math.pow(1 - d.fade, clock.current.scale);
      wake.current[tile.i] = w;

      if (lit) {
        const base = isWord ? 0.52 : 0.3 + ink * 0.45;
        const v2 = base + wave * 0.26 + w * d.wakeGain * 0.6;
        // Bone is earned: only the pointer's core reaches the glint, and only if glint is on.
        return d.glint ? v2 : Math.min(v2, 0.79);
      }
      return Math.min(0.62, wave * 0.16 + w * d.wakeGain * 0.7);
    };
  }, [g, cover, d.subject, d.activity, d.reach, d.fade, d.wakeGain, d.glint]);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const p = ptr.current;
    const now = performance.now();
    const dt = Math.max(1, now - p.at);
    const prevX = p.x === FAR ? x : p.x;
    const prevY = p.y === FAR ? y : p.y;
    const inst = (Math.hypot(x - prevX, y - prevY) / dt) * 1000;
    ptr.current = { x, y, px: prevX, py: prevY, speed: Math.max(p.speed, inst), at: now };
  };
  const leave = () => {
    ptr.current = { x: FAR, y: FAR, px: FAR, py: FAR, speed: 0, at: 0 };
  };

  const rounds = Math.round(d.activity * 24);
  return (
    <LabFrame
      n="V1"
      id="wake"
      title="Pointer wake on a live cover"
      source="tile-field"
      drives="Wave speed and depth from network activity (rounds settled per minute). The pointer adds a wake on top, posters only."
      where="Home hero, job CoverBand, /start role cards, Splash."
      aside={
        <div className="space-y-4">
          <p>Move across the poster. Slow moves leave a soft glow, fast flicks a longer, wider wake. Drag activity to 0 to see an idle network: the wave nearly stops and only the pointer moves anything.</p>
          <Readout rows={[["activity", `${rounds} rounds / min`], ["reach", `${d.reach}px`], ["fade", d.fade.toFixed(3)]]} />
          <p className="text-xs text-subtle">Reduced motion: wave drawn once at a fixed time, no pointer.</p>
        </div>
      }
    >
      <div onPointerMove={move} onPointerLeave={leave} className="relative h-72 touch-pan-y overflow-hidden border border-rule md:h-96">
        <Mosaic field={field} label="Poster with a pointer wake" cell={d.cell} vocab={VOCAB_SHORT} twinkle={0.06} empty={0.25} seed={11} wake={false} />
        <ul className="pointer-events-none absolute right-0 top-0 bg-surface px-3 py-2 text-right font-mono text-xs uppercase leading-relaxed tracking-wide text-ink">
          <li>Network</li>
          <li>{rounds} rounds / min</li>
        </ul>
      </div>
    </LabFrame>
  );
}

// V3, after vault/misprint-type: a replay mismatch printed off-register, the keyline slipping by the size of the miss.
"use client";

import { StatePoster } from "@/components/mosaic/StatePoster";
import { useDialKit } from "dialkit";
import { useState, type CSSProperties } from "react";
import { LabFrame, Readout } from "./Frame";

function Misprint({ word, off, squeeze, play, size }: { word: string; off: number; squeeze: number; play: number; size: number }) {
  const lines = word.split(" ");
  const text = (cls: string, style?: CSSProperties) => (
    <span aria-hidden className={`mp-text ${cls}`} style={{ fontSize: size, ...style }}>
      {lines.map((l, i) => (
        <span key={i} className="block">{l}</span>
      ))}
    </span>
  );
  return (
    <div className="relative grid h-full place-items-center overflow-hidden" style={{ background: "var(--mz-l4)" }} role="img" aria-label={word}>
      <div className="relative" style={{ transform: `scaleX(${squeeze})` }}>
        {text("mp-fill")}
        {text("mp-key absolute inset-0", { ["--mx" as string]: `${off}px`, ["--my" as string]: `${off * 0.6}px` })}
      </div>
      <span key={play} className="sr-only">{word}</span>
      <style>{`
        .mp-text { display: block; font-family: var(--font-sans); font-weight: 700; line-height: 0.86; letter-spacing: -0.02em; text-transform: uppercase; text-align: center; }
        .mp-fill { color: var(--mz-l7); }
        .mp-key { color: transparent; -webkit-text-stroke: 2px var(--mz-void); transform: translate(var(--mx), var(--my)); animation: mp-slip 320ms steps(4) both; }
        @keyframes mp-slip { from { transform: translate(0, 0); } }
        @media (prefers-reduced-motion: reduce) { .mp-key { animation: none; } }
      `}</style>
    </div>
  );
}

export function MisprintLab() {
  const d = useDialKit(
    "V3 Misprint",
    {
      word: "MISMATCH",
      delta: [0.031, 0, 0.2, 0.001],
      tolerance: [0.001, 0.0001, 0.05, 0.0001],
      maxOffset: [14, 2, 30, 1],
      squeeze: [0.55, 0.35, 1, 0.01],
      size: [128, 40, 180, 1],
      step: [412, 1, 2000, 1],
      replay: { type: "action" },
    },
    { onAction: () => setPlay((p) => p + 1) },
  );
  const [play, setPlay] = useState(0);
  const ratio = d.delta / d.tolerance;
  const bad = ratio > 1;
  // Log scale: 2x tolerance is a visible slip, 30x tolerance is near the cap.
  const off = bad ? Math.min(d.maxOffset, Math.max(2, (Math.log2(ratio) / 5) * d.maxOffset)) : 0;
  const word = bad ? d.word || "MISMATCH" : "MATCH";

  return (
    <LabFrame
      n="V3"
      id="misprint"
      title="Misprint for a replay that did not line up"
      source="misprint-type"
      drives="Keyline offset from delta / tolerance on a log scale. Inside tolerance the print is in register. Slashed keeps the crack, so mismatch and stake-taken read as different events."
      where="ReceiptHero headline and NodeVerdict when the verifier's replay disagrees."
      aside={
        <div className="space-y-4">
          <Readout rows={[["delta", d.delta.toFixed(3)], ["tolerance", d.tolerance.toFixed(4)], ["ratio", `${ratio.toFixed(1)}x`], ["offset", `${off.toFixed(1)}px`]]} />
          <p className="border-t border-rule pt-3 font-mono text-xs uppercase leading-relaxed tracking-wide text-ink">
            {bad ? (
              <>Replay mismatch at step {d.step}<br />Δ {d.delta.toFixed(3)} &gt; tol {d.tolerance.toFixed(4)}</>
            ) : (
              <>Replay matched<br />Δ {d.delta.toFixed(3)} ≤ tol {d.tolerance.toFixed(4)}</>
            )}
          </p>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div key={`${play}-${off}`} className="h-72 border border-rule md:col-span-2 md:h-80">
          <Misprint word={word} off={off} squeeze={d.squeeze} play={play} size={d.size} />
        </div>
        <figure className="flex flex-col border border-rule">
          <StatePoster word="SLASHED" kind="slashed" className="h-full min-h-40 flex-1" />
          <figcaption className="border-t border-rule px-3 py-2 font-mono text-xs uppercase tracking-wide text-subtle">For comparison: today&apos;s slashed crack</figcaption>
        </figure>
      </div>
    </LabFrame>
  );
}

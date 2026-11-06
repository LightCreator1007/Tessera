// Loaders, three takes. A: the number is the loader (a giant percentage fills from the bottom).
// B: the figure develops like a print in a tray, brightest tones first. C: the small inline set.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB_SHORT, type FieldFn } from "@/components/mosaic/engine";
import { coverById, sampler, useGray } from "@/components/mosaic/figures";
import { tone } from "@/components/mosaic/fields";
import { textGray, useTextGray } from "@/components/mosaic/type";
import { Section, usePalette } from "../shell";
import { Scramble } from "@/components/mosaic/widgets";
import { Skeleton, TileBusy } from "@/components/primitives";

function useProgress(ms: number, step: number) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setP((v) => (v >= 1 ? 0 : Math.min(1, v + step * (0.4 + Math.random())))), ms);
    return () => clearInterval(id);
  }, [ms, step]);
  return p;
}

/** A: digits rendered as tiles. Below the fill line they are lit; above it they wait as faint texture. */
function PercentLoader() {
  const pal = usePalette();
  const p = useProgress(160, 0.012);
  const ref = useRef(p);
  ref.current = p;
  const label = `${Math.round(p * 100)}%`;
  const ready = !!useTextGray("0%", 700);
  const field: FieldFn = useMemo(() => {
    if (!ready) return () => 0;
    const byLabel = new Map<string, ReturnType<typeof sampler>>();
    return (tile, c) => {
      const label = `${Math.round(ref.current * 100)}%`;
      let s = byLabel.get(label);
      if (!s) {
        s = sampler(textGray(label, 700), { fit: "contain", scale: 0.9, ax: 0.5, ay: 0.5 });
        byLabel.set(label, s);
      }
      const v = s(tile, c);
      if (v < 0.4) return 0;
      const fill = c.H * (0.9 - ref.current * 0.8);
      if (tile.cy < fill) return 0.16;
      return tile.cy < fill + tile.h * 1.5 ? 1.05 : 0.66;
    };
  }, [ready]);
  return (
    <Section title="A. The number is the loader" note="Simple. A determinate wait shows its own number in tiles, filling bottom-up. Head row is bone.">
      <div className="mz-frame" style={{ height: 360 }} role="progressbar" aria-label="Uploading blob" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
        <Mosaic field={field} label={`Upload ${label}`} vocab={VOCAB_SHORT} cell={8} seed={12} palette={pal} />
        <span className="mz-caption">{`Blob upload · shard 07\n${(p * 2.9).toFixed(1)} of 2.9 MB`}</span>
      </div>
    </Section>
  );
}

/** B: brightest tones appear first and darker ones follow, with the developing edge in bone. */
function DevelopLoader() {
  const pal = usePalette();
  const [fig, setFig] = useState("owl");
  const c = coverById(fig);
  const g = useGray(c.src);
  const p = useProgress(120, 0.008);
  const ref = useRef(p);
  ref.current = p;
  const field: FieldFn = useMemo(() => {
    const s = sampler(g, c.fit);
    return (tile, cx) => {
      const v = tone(s(tile, cx), c.tone);
      if (v < 0.1) return 0;
      const th = 1 - ref.current;
      if (v < th - 0.06) return 0;
      if (v < th + 0.04) return 1.05;
      return v;
    };
  }, [g, c]);
  return (
    <Section title="B. The figure develops" note="Complex. Training progress develops the job's poster like a print in a tray: highlights first, shadows last.">
      <div className="mz-seg" role="radiogroup" aria-label="Figure" style={{ marginBottom: 12 }}>
        {["owl", "tiger", "crow", "fuji"].map((id) => (
          <button key={id} type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={fig === id} onClick={() => setFig(id)}>
            {id}
          </button>
        ))}
      </div>
      <div className="mz-ob">
        <div className="mz-ob-art" role="progressbar" aria-label="Training round 12" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
          <Mosaic field={field} label={`${c.title}, developing`} cell={9} seed={23} palette={pal} />
        </div>
        <div className="mz-ob-panel">
          <div className="mz-ob-num">{Math.round(p * 100)}%</div>
          <h3 className="mz-auth-title">Training round 12</h3>
          <p className="mz-auth-lede">
            Step {Math.round(p * 512)} of 512 · 4 nodes · eta {Math.max(0, Math.round((1 - p) * 94))} s
          </p>
          <p className="mz-fine">The poster you get at the end is the one developing here.</p>
        </div>
      </div>
    </Section>
  );
}

const scanField: FieldFn = (tile, c) => {
  const bx = (((c.t * 0.55) % 1.4) - 0.2) * c.W;
  const d = Math.abs(tile.cx - bx);
  return d < 160 ? 1.05 * Math.exp(-((d / 70) ** 2)) : 0;
};

const dotsField: FieldFn = (tile, c) => {
  const k = Math.floor(c.t * 3) % 4;
  const slot = Math.floor((tile.cx / c.W) * 3);
  return slot < k ? 0.7 : slot === k ? 1.05 : 0;
};

/** C: the small set for inside buttons, rows and headers. */
function InlineSet() {
  const pal = usePalette();
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState(42.18);
  return (
    <Section title="C. Inline" note="Minimal, now in the app. A five-tile wave inside busy buttons, word-tile skeletons with a bone sweep, a scan band for waiting rows, a number that scrambles.">
      <div className="mz-inline-grid">
        <div className="mz-card">
          <div className="mz-label">Button, busy</div>
          <button type="button" className="mz-btn mz-btn-primary" aria-busy={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 2400); }}>
            {busy ? <><TileBusy /> Locking</> : "Lock budget"}
          </button>
        </div>
        <div className="mz-card">
          <div className="mz-label">Waiting for a verifier</div>
          <div style={{ height: 22 }} role="status" aria-label="Waiting for a verifier">
            <Mosaic field={scanField} label="Scanning" cell={11} seed={7} palette={pal} empty={0.3} />
          </div>
        </div>
        <div className="mz-card">
          <div className="mz-label">Skeleton, a table row loading</div>
          <div style={{ display: "grid", gap: 8 }}>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
        <div className="mz-card">
          <div className="mz-label">Three-tile ellipsis</div>
          <div style={{ height: 11, width: 72 }} role="status" aria-label="Working">
            <Mosaic field={dotsField} label="Working" cell={11} seed={9} palette={pal} empty={0} twinkle={0.5} />
          </div>
        </div>
        <div className="mz-card">
          <div className="mz-label">Balance</div>
          <div className="mz-big-num">
            <Scramble value={`${bal.toFixed(2)}`} />
          </div>
          <button type="button" className="mz-btn mz-btn-sm mz-btn-secondary" onClick={() => setBal((b) => b + 4.2)}>
            Round paid +4.20
          </button>
        </div>
      </div>
    </Section>
  );
}

export function LoadersPage() {
  return (
    <>
      <PercentLoader />
      <DevelopLoader />
      <InlineSet />
    </>
  );
}

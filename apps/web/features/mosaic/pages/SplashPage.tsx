// Splash: the figure assembles while the health checks run. Each check that passes lights one region; a failed check
// leaves its region as a ghost and says what broke. Two framings: the TUI node splash and the web cold start.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import type { FieldFn } from "@/components/mosaic/engine";
import { COVERS, coverById, sampler, useGray } from "@/components/mosaic/figures";
import { clamp, dissolve, tone } from "@/components/mosaic/fields";
import { Section, usePalette } from "../shell";
import { TileProgress } from "@/components/mosaic/widgets";

const CHECKS = [
  { k: "node api", ok: "127.0.0.1:7777", fail: "not running. start it with tod-node run" },
  { k: "coordinator", ok: "coordinator", fail: "unreachable. retrying in 5 s" },
  { k: "chain", ok: "84532 · blk 18,220,114", fail: "rpc timeout. switching endpoint" },
];
const PASS = [0.7, 1.4, 2.1];
const DONE = 2.6;

function splashField(g: ReturnType<typeof useGray>, id: string, fail: number | null, left: number): FieldFn {
  const c0 = coverById(id);
  const s = sampler(g, { fit: "contain", scale: 1.08, ax: 0.92, ay: 0.5 });
  return (tile, c) => {
    const v = tone(s(tile, c), c0.tone);
    const k = Math.floor(clamp((tile.cx / c.W - left) / (1 - left), 0, 0.999) * 3);
    if (c.t < PASS[k]) return 0;
    if (fail === k) return dissolve(tile, c.t, PASS[k], 0.5) ? Math.min(v * 0.4, 0.3) : 0;
    if (!dissolve(tile, c.t, PASS[k], 0.45)) return 0;
    if (fail !== null || c.t < DONE) return v;
    const d = Math.hypot(tile.cx - c.W * 0.7, (tile.cy - c.H * 0.5) * 1.6);
    const edge = Math.exp(-(((d - (c.t - DONE) * c.W * 0.9) / 30) ** 2));
    return Math.max(v, v > 0.08 ? edge * 1.05 : edge * 0.3);
  };
}

function useClock(play: unknown) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    setT(0);
    const id = setInterval(() => {
      const x = (performance.now() - start) / 1000;
      setT(x);
      if (x > 4) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [play]);
  return t;
}

function Controls({ fig, setFig, fail, setFail, replay }: { fig: string; setFig: (v: string) => void; fail: number | null; setFail: (v: number | null) => void; replay: () => void }) {
  return (
    <div className="mz-row" style={{ marginBottom: 12, justifyContent: "space-between" }}>
      <div className="mz-seg" role="radiogroup" aria-label="Figure">
        {COVERS.map((c) => (
          <button key={c.id} type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={fig === c.id} onClick={() => setFig(c.id)}>
            {c.id}
          </button>
        ))}
      </div>
      <div className="mz-seg" role="radiogroup" aria-label="Failing check">
        <button type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={fail === null} onClick={() => setFail(null)}>
          all pass
        </button>
        {CHECKS.map((c, i) => (
          <button key={c.k} type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={fail === i} onClick={() => setFail(i)}>
            fail {c.k}
          </button>
        ))}
        <button type="button" className="mz-btn mz-btn-sm mz-btn-secondary" onClick={replay}>
          Replay
        </button>
      </div>
    </div>
  );
}

export function SplashPage() {
  const pal = usePalette();
  const [fig, setFig] = useState("crow");
  const [fail, setFail] = useState<number | null>(null);
  const [play, setPlay] = useState(0);
  const g = useGray(coverById(fig).src);
  const key = `${play}-${fig}-${fail}-${g ? 1 : 0}`;
  const t = useClock(key);
  const tuiField = useMemo(() => splashField(g, fig, fail, 0.3), [g, fig, fail]);
  const webField = useMemo(() => splashField(g, fig, fail, 0), [g, fig, fail]);
  const loaded = Math.min(1, t / DONE) * (fail === null ? 1 : (fail + 0.5) / 3);

  return (
    <>
      <Section title="Node splash (TUI)" note="The loading state is the brand reveal. node api lights the left third, coordinator the middle, chain the right.">
        <Controls fig={fig} setFig={setFig} fail={fail} setFail={setFail} replay={() => setPlay((p) => p + 1)} />
        <div className="mz-frame mz-splash">
          <Mosaic field={tuiField} label="ToD splash" cell={12} seed={5} palette={pal} playKey={key} />
          <div className="mz-splash-copy">
            <h1 className="mz-display">ToD</h1>
            <div className="mz-meta" style={{ marginTop: 10 }}>{"Decentralised training / verified by replay\nNode 0x8a4F...91c2 / Base Sepolia / 0.2.0"}</div>
            <div className="mz-checks" role="list" aria-label="Health checks">
              {CHECKS.map((c, i) => {
                const s = t < PASS[i] ? "wait" : fail === i ? "fail" : "ok";
                return (
                  <div key={c.k} role="listitem" className="mz-check" data-s={s}>
                    <span className="mz-glyph">{s === "wait" ? "◌" : s === "ok" ? "✓" : "✗"}</span>
                    <span>{c.k}</span>
                    <span>{s === "wait" ? "connecting" : s === "ok" ? c.ok : c.fail}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <span className="mz-skip">Any key to skip</span>
        </div>
      </Section>

      <Section title="Web cold start" note="Same timeline, full bleed. The progress strip is the only chrome; it stops where the failed check is.">
        <div className="mz-frame mz-splash">
          <Mosaic field={webField} label="ToD web splash" cell={9} seed={11} palette={pal} playKey={key} />
          <div className="mz-splash-copy" style={{ left: "50%", top: "auto", bottom: 28, transform: "translateX(-50%)", width: 420, padding: 16 }}>
            <div className="mz-meta" style={{ marginBottom: 10 }}>
              {fail === null ? (t < DONE ? "Loading ToD" : "Ready") : `${CHECKS[fail].k} ${CHECKS[fail].fail}`}
            </div>
            <TileProgress value={loaded} label="Loading" count={22} />
          </div>
        </div>
      </Section>
    </>
  );
}

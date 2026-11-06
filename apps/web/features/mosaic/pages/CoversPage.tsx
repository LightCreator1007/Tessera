// Covers: a round poster per figure, plus a studio to tune one, drop in any image (a saved Pinterest pin works) and
// export the poster as a PNG with its title and metadata block.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { COVERS, figureField, useGray, type Cover, type Reveal } from "@/components/mosaic/figures";
import { imageToGray, type Gray, type ImageMode } from "@/components/mosaic/fields";
import { Hero, Section, usePalette } from "../shell";

type AnyCover = Cover & { gray?: Gray; raw?: string };

const hash = (s: string) => s.split("").reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

function CoverCard({ c, pressed, onPick }: { c: AnyCover; pressed: boolean; onPick: () => void }) {
  const pal = usePalette();
  const loaded = useGray(c.gray ? null : c.src);
  const g = c.gray || loaded;
  const [play, setPlay] = useState(0);
  const field = useMemo(() => figureField(g, c.fit, c.tone, "dissolve", c.focus), [g, c]);
  return (
    <button type="button" className="mz-cover" aria-pressed={pressed} onClick={onPick} onMouseEnter={() => setPlay((p) => p + 1)} aria-label={`${c.title}, open in studio`}>
      <Mosaic field={field} label={`${c.title} cover`} cell={8} seed={hash(c.id)} palette={pal} playKey={`${play}-${g ? 1 : 0}`} />
      <span className="mz-cover-title">{c.title}</span>
      <span className="mz-cover-meta">{c.meta}</span>
    </button>
  );
}

function Range({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="mz-control">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{fmt ? fmt(value) : value.toFixed(2)}</output>
    </label>
  );
}

function Studio({ c, onRemode }: { c: AnyCover; onRemode?: (m: ImageMode) => void }) {
  const pal = usePalette();
  const loaded = useGray(c.gray ? null : c.src);
  const g = c.gray || loaded;
  const [cell, setCell] = useState(11);
  const [contrast, setContrast] = useState(c.tone.contrast);
  const [gamma, setGamma] = useState(c.tone.gamma);
  const [lift, setLift] = useState(c.tone.lift);
  const [scale, setScale] = useState(c.fit.scale);
  const [ax, setAx] = useState(c.fit.ax);
  const [ay, setAy] = useState(c.fit.ay);
  const [seed, setSeed] = useState(hash(c.id) % 100);
  const [reveal, setReveal] = useState<Reveal>("dissolve");
  const [twinkle, setTwinkle] = useState(true);
  const [empty, setEmpty] = useState(0.22);
  const [play, setPlay] = useState(0);
  const [mode, setMode] = useState<ImageMode>("ink");
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const poster = useRef<HTMLDivElement | null>(null);

  const field = useMemo(
    () => figureField(g, { fit: "cover", scale, ax, ay }, { contrast, gamma, lift }, reveal, c.focus),
    [g, scale, ax, ay, contrast, gamma, lift, reveal, c.focus],
  );

  const exportPng = () => {
    const cv = canvas.current;
    const host = poster.current;
    if (!cv || !host) return;
    const s = cv.width / cv.getBoundingClientRect().width;
    const out = document.createElement("canvas");
    out.width = cv.width;
    out.height = cv.height;
    const x = out.getContext("2d");
    if (!x) return;
    x.drawImage(cv, 0, 0);
    const cs = getComputedStyle(host);
    const titleEl = host.querySelector(".mz-cover-title");
    const metaEl = host.querySelector(".mz-cover-meta");
    const sans = titleEl ? getComputedStyle(titleEl).fontFamily : "sans-serif";
    const mono = metaEl ? getComputedStyle(metaEl).fontFamily : "monospace";
    x.shadowColor = cs.getPropertyValue("--mz-ground").trim();
    x.shadowBlur = 8 * s;
    x.fillStyle = cs.getPropertyValue("--mz-head").trim();
    x.font = `500 ${54 * s}px ${sans}`;
    x.textBaseline = "top";
    x.fillText(c.title, 18 * s, 16 * s);
    x.fillStyle = cs.getPropertyValue("--mz-text").trim();
    x.font = `${11 * s}px ${mono}`;
    const lines = c.meta.toUpperCase().split("\n");
    const mw = Math.max(...lines.map((l) => x.measureText(l).width));
    lines.forEach((l, i) => x.fillText(l, out.width - 18 * s - mw, 78 * s + i * 16 * s));
    out.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `tod-${c.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };

  return (
    <div className="mz-studio">
      <div className="mz-poster" ref={poster}>
        <Mosaic
          field={field}
          label={`${c.title} poster`}
          cell={cell}
          seed={seed}
          palette={pal}
          playKey={`${play}-${g ? 1 : 0}-${reveal}`}
          twinkle={twinkle ? 0.12 : 0}
          empty={empty}
          canvasRef={(el) => {
            canvas.current = el;
          }}
        />
        <span className="mz-cover-title">{c.title}</span>
        <span className="mz-cover-meta">{c.meta}</span>
      </div>
      <div className="mz-controls">
        <div className="mz-label">{c.credit}</div>
        <Range label="Tile row" value={cell} min={6} max={20} step={1} onChange={setCell} fmt={(v) => `${v}px`} />
        <Range label="Contrast" value={contrast} min={0.4} max={3} step={0.05} onChange={setContrast} />
        <Range label="Gamma" value={gamma} min={0.3} max={2} step={0.05} onChange={setGamma} />
        <Range label="Lift" value={lift} min={-0.4} max={0.4} step={0.01} onChange={setLift} />
        <Range label="Scale" value={scale} min={0.6} max={2.5} step={0.05} onChange={setScale} />
        <Range label="Anchor X" value={ax} min={0} max={1} step={0.01} onChange={setAx} />
        <Range label="Anchor Y" value={ay} min={0} max={1} step={0.01} onChange={setAy} />
        <Range label="Empty" value={empty} min={0} max={0.7} step={0.01} onChange={setEmpty} />
        <Range label="Seed" value={seed} min={0} max={99} step={1} onChange={setSeed} fmt={(v) => String(v)} />
        <div className="mz-seg" role="radiogroup" aria-label="Reveal">
          {(["dissolve", "radial", "none"] as Reveal[]).map((r) => (
            <button key={r} type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={reveal === r} onClick={() => setReveal(r)}>
              {r}
            </button>
          ))}
          <button type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={twinkle} onClick={() => setTwinkle((v) => !v)}>
            twinkle
          </button>
        </div>
        {onRemode && (
          <div className="mz-seg" role="radiogroup" aria-label="How to read your image">
            {(["ink", "light", "dark"] as ImageMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className="mz-btn mz-btn-sm mz-btn-ghost"
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  onRemode(m);
                }}
              >
                {m === "ink" ? "ink on paper" : m === "light" ? "bright subject" : "dark subject"}
              </button>
            ))}
          </div>
        )}
        <div className="mz-row">
          <button type="button" className="mz-btn mz-btn-secondary" onClick={() => setPlay((p) => p + 1)}>
            Replay
          </button>
          <button type="button" className="mz-btn mz-btn-primary" onClick={exportPng}>
            Export PNG <span className="mz-kbd">E</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function CoversPage() {
  const [custom, setCustom] = useState<AnyCover[]>([]);
  const [sel, setSel] = useState("crow");
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all: AnyCover[] = [...COVERS, ...custom];
  const current = all.find((c) => c.id === sel) || all[0];

  const addFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setErr("That is not an image. Drop a PNG, JPG or WebP.");
      return;
    }
    setErr(null);
    setBusy(true);
    const raw = URL.createObjectURL(file);
    try {
      const gray = await imageToGray(raw, "ink");
      const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 22) || "Your image";
      const id = `upload-${Date.now()}`;
      setCustom((cs) => [
        ...cs,
        { id, title: name, src: raw, raw, gray, meta: "Your image\nS07 / E00\nDropped", credit: "Your image, read as ink on paper", fit: { fit: "cover", scale: 1, ax: 0.5, ay: 0.5 }, tone: { contrast: 1.2, gamma: 0.9, lift: 0 }, focus: [0.5, 0.4] },
      ]);
      setSel(id);
    } catch {
      setErr("Could not read that image. Try saving it again as PNG or JPG.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData ? e.clipboardData.files : []).find((x) => x.type.startsWith("image/"));
      if (f) addFile(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFile]);

  const remode = async (m: ImageMode) => {
    if (!current.raw) return;
    try {
      const gray = await imageToGray(current.raw, m);
      setCustom((cs) => cs.map((c) => (c.id === current.id ? { ...c, gray } : c)));
    } catch {
      setErr("Could not re-read that image.");
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) addFile(f);
  };

  return (
    <>
      <Hero title="Covers" meta={"Every round is a poster\nSeeded by the round hash\nShare as PNG"} />
      <Section title="Round posters" note="Dissolve in, then the words keep twinkling. Hover to replay. Click to open in the studio. Same seed, same poster.">
        <div className="mz-covers">
          {all.map((c) => (
            <CoverCard key={c.id} c={c} pressed={c.id === current.id} onPick={() => setSel(c.id)} />
          ))}
          <label className="mz-drop" data-over={over} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} style={{ display: "grid", alignContent: "center", aspectRatio: "3 / 4" }}>
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files && e.target.files[0] && addFile(e.target.files[0])} />
            {busy ? "Reading image" : "Drop an image, paste one, or click to pick. Save a Pinterest pin first, then drop the file here."}
            {err && <span style={{ display: "block", marginTop: 8 }} className="mz-state-body"><b>{err}</b></span>}
          </label>
        </div>
      </Section>
      <Section title="Studio" note="Tone curve, crop and tile size. Export bakes the title and metadata block into the PNG.">
        <Studio key={current.id} c={current} onRemode={current.raw ? remode : undefined} />
      </Section>
    </>
  );
}

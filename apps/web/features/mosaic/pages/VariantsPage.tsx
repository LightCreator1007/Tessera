// Variants: every surface that draws mosaic figure art, each shown as it rendered before the fit fix and then five
// candidate treatments. All five use the subject fit (the figure's ink box is contained, never cropped) and the fine
// vocabulary (tiles of one to three characters), which are the two defects this page exists to retire.
"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB, VOCAB_FINE, type FieldFn } from "@/components/mosaic/engine";
import { COVERS, coverById, figureField, subjectFit, useGray, type Cover } from "@/components/mosaic/figures";
import type { Fit } from "@/components/mosaic/fields";
import { useTextGray } from "@/components/mosaic/type";
import { Hero, PALETTES, Section, usePalette } from "../shell";
import { DONE, LOOP, PASS, figure, identiconCells, identiconField, paletteOf, withType, type FigOpts } from "../variantFields";
import "../variants.css";

const ADDRS = ["0x8a4F2b91c3E07d", "0x2F19aa0c77B3e1", "0xC0ffee5521A9b0", "0x7d3E91b0aa12F4", "0x000000000000a1", "0xBEEF0042d17c95"];

/** Seconds since the element first scrolled into view, looped, ticking a few times a second (overlay text only). */
function useVisibleClock(ref: React.RefObject<HTMLElement | null>) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let start = 0;
    let id = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || start) return;
      start = performance.now();
      id = window.setInterval(() => setT(((performance.now() - start) / 1000) % LOOP), 150);
    });
    if (ref.current) io.observe(ref.current);
    return () => {
      io.disconnect();
      clearInterval(id);
    };
  }, [ref]);
  return t;
}

function Variant({ n, title, note, children, before }: { n: string; title: string; note: string; children: ReactNode; before?: boolean }) {
  return (
    <figure className="mzv-variant" data-before={before ? "" : undefined}>
      {children}
      <figcaption className="mzv-cap">
        <span className="mzv-n">{n}</span>
        <span className="mzv-title">{title}</span>
        <span className="mzv-note">{note}</span>
      </figcaption>
    </figure>
  );
}

function Fig({ cover, fit, opts, cell = 7, rows, label, live = true }: { cover: Cover; fit: Fit; opts: FigOpts; cell?: number; rows?: number; label: string; live?: boolean }) {
  const pal = usePalette();
  const g = useGray(cover.src);
  const field = useMemo(() => figure(g, fit, cover.tone, { focus: cover.focus, ...opts }), [g, fit, cover, opts]);
  return <Mosaic field={field} label={label} cell={cell} rows={rows} vocab={VOCAB_FINE} seed={label.length * 5 + 1} twinkle={live ? 0.1 : 0} palette={pal} />;
}

/** The pre-fix render: cover fit with the per-figure zoom, long-word vocabulary, the old row height. */
function Before({ cover, cell, label, fit }: { cover: Cover; cell: number; label: string; fit?: Fit }) {
  const pal = usePalette();
  const g = useGray(cover.src);
  const field = useMemo(() => figureField(g, fit ?? { ...cover.fit, fit: "cover" }, cover.tone, "none", cover.focus), [g, cover, fit]);
  return <Mosaic field={field} label={label} cell={cell} vocab={VOCAB} seed={label.length * 5 + 1} twinkle={0.08} palette={pal} />;
}

function Checks({ t, tui }: { t: number; tui?: boolean }) {
  const rows = tui
    ? [["node api", "127.0.0.1:7777"], ["coordinator", "coordinator"], ["chain", "84532 · blk 18,220,114"]]
    : [["chain", "base sepolia · block 18,220,114"], ["coordinator", "ok · v0.4.2"], ["store", "blob store ok"]];
  return (
    <ol className="mz-checks">
      {rows.map(([k, ok], i) => {
        const s = t >= PASS[i] ? "ok" : "wait";
        return (
          <li key={k} className="mz-check" data-s={s}>
            <span className="mz-glyph">{s === "ok" ? "■" : "·"}</span>
            <span>{k}</span>
            <span>{s === "ok" ? ok : "…"}</span>
          </li>
        );
      })}
    </ol>
  );
}

const crow = coverById("crow");
const tiger = coverById("tiger");


function TuiFrame({ children, copy = "left", t }: { children: ReactNode; copy?: "left" | "bar" | "none"; t: number }) {
  return (
    <>
      <div className="mzv-tui-bar"><span>tod-node run</span><span>{t >= DONE ? "ready" : "starting"}</span></div>
      <div className="mzv-tui-body">
        {children}
        {copy === "left" && (
          <div className="mzv-copy">
            <span className="mzv-word">ToD</span>
            <Checks t={t} tui />
          </div>
        )}
      </div>
      {copy === "bar" && (
        <div className="mzv-tui-status">
          {["node api", "coordinator", "chain"].map((k, i) => <span key={k} data-s={t >= PASS[i] ? "ok" : "wait"}>{t >= PASS[i] ? "■" : "·"} {k}</span>)}
          <span className="mzv-skip">esc skip</span>
        </div>
      )}
    </>
  );
}

function TuiVariant({ n, title, note, render, copy }: { n: string; title: string; note: string; render: () => ReactNode; copy?: "left" | "bar" | "none" }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useVisibleClock(ref);
  return (
    <Variant n={n} title={title} note={note}>
      <div ref={ref} className="mz-frame mzv-tui">
        <TuiFrame t={t} copy={copy}>{render()}</TuiFrame>
      </div>
    </Variant>
  );
}

const F_TUI_RIGHT = subjectFit(crow, { ax: 0.9, pad: 0.08 });
const F_CENTER = subjectFit(crow, { ax: 0.5, pad: 0.1 });
const BOX_RIGHT = (W: number, H: number) => ({ x: W - H * 0.92 - H * 0.04, y: H * 0.04, w: H * 0.92, h: H * 0.92 });

function TuiSection() {
  return (
    <Section title="TUI splash" note="Node splash, terminal proportions (80 by 24). Checks drive the reveal.">
      <div className="mzv-grid mzv-grid-3">
        <Variant n="00" title="Before" note="Contain at 108 percent, cell 12, long words: the beak and tail clip, tiles read as bars." before>
          <div className="mz-frame mzv-tui"><div className="mzv-tui-body"><Before cover={crow} cell={12} label="TUI before" fit={{ fit: "contain", scale: 1.08, ax: 0.92, ay: 0.5 }} /></div></div>
        </Variant>
        <TuiVariant n="01" title="Develop, right" note="Prints in like a tray. Crow contained in the right 60 percent; log stays on clean ground." render={() => <Fig cover={crow} fit={F_TUI_RIGHT} opts={{ mode: "develop" }} label="TUI develop" cell={8} />} />
        <TuiVariant n="02" title="Per-check thirds" note="node api, coordinator, chain each light a third; a bone wavefront when all pass." render={() => <Fig cover={crow} fit={F_TUI_RIGHT} opts={{ mode: "thirds", focus: [0.75, 0.4] }} label="TUI thirds" cell={8} />} />
        <TuiVariant n="03" title="Scanline paint" note="Rows paint top to bottom like a terminal redraw. Status in the bottom bar, art centred." copy="bar" render={() => <Fig cover={crow} fit={F_CENTER} opts={{ mode: "scan" }} label="TUI scan" cell={7} />} />
        <TuiVariant n="04" title="Boxed plate" note="The crow sits in a square plate on the right, so the left column can hold a longer log." render={() => <Fig cover={crow} fit={{ ...F_CENTER, pad: 0.08 }} opts={{ mode: "dissolve", box: BOX_RIGHT }} label="TUI boxed" cell={6} />} />
        <TuiVariant n="05" title="Silhouette" note="Figure as void cut from a lit field, rim in bone. Strongest read at small terminal sizes." render={() => <Fig cover={crow} fit={F_TUI_RIGHT} opts={{ mode: "silhouette" }} label="TUI silhouette" cell={7} />} />
      </div>
    </Section>
  );
}


function WebVariant({ n, title, note, render, side = "left" }: { n: string; title: string; note: string; render: () => ReactNode; side?: "left" | "split" | "bottom" }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useVisibleClock(ref);
  return (
    <Variant n={n} title={title} note={note}>
      <div ref={ref} className={`mz-frame mzv-web mzv-side-${side}`}>
        {render()}
        <div className="mzv-copy">
          {side !== "bottom" && <span className="mzv-word">ToD</span>}
          <Checks t={t} />
        </div>
      </div>
    </Variant>
  );
}

function WordmarkSplash() {
  const pal = usePalette();
  const g = useGray(crow.src);
  const word = useTextGray("ToD", 700);
  const field = useMemo(() => withType(figure(g, subjectFit(crow, { ax: 0.95, pad: 0.08 }), crow.tone, { mode: "dissolve" }), word, (W, H) => ({ x: W * 0.05, y: H * 0.08, w: W * 0.42, h: H * 0.26 })), [g, word]);
  return <Mosaic field={field} label="web splash wordmark" cell={7} vocab={VOCAB_FINE} seed={21} twinkle={0.1} palette={pal} />;
}

function WebSection() {
  const right = subjectFit(crow, { ax: 0.85, pad: 0.08 });
  return (
    <Section title="Web splash" note="Cold start, 16:9. Once per session while chain, coordinator and blob store answer.">
      <div className="mzv-grid mzv-grid-3">
        <Variant n="00" title="Before" note="Cover fit over the full viewport, cell 10: the crow is cropped to a wing on most screens." before>
          <div className="mz-frame mzv-web"><Before cover={crow} cell={10} label="web before" /></div>
        </Variant>
        <WebVariant n="01" title="Develop, right (shipped)" note="Now in the app. Whole crow on the right half, highlights first, bone on the developing edge." render={() => <Fig cover={crow} fit={right} opts={{ mode: "develop" }} label="web develop" cell={7} />} />
        <WebVariant n="02" title="Wavefront" note="Reveals outward from the crow's eye with one bone band. Reads as the app waking up." render={() => <Fig cover={crow} fit={right} opts={{ mode: "radial", focus: [0.72, 0.35] }} label="web radial" cell={7} />} />
        <WebVariant n="03" title="Wordmark in mosaic" note="ToD set in lit tiles beside the crow; checks sit under it. One system for type and figure." render={() => <WordmarkSplash />} />
        <WebVariant n="04" title="Split plate" note="Left half quiet ground for the checks, crow in a framed plate on the right. Calmest option." side="split" render={() => <Fig cover={crow} fit={{ ...F_CENTER, pad: 0.06 }} opts={{ mode: "develop", box: (W, H) => ({ x: W * 0.52, y: H * 0.07, w: W * 0.44, h: H * 0.86 }) }} label="web split" cell={6} />} />
        <WebVariant n="05" title="Flat duotone" note="Two levels only, centred, checks in a bottom strip. Most graphic; survives any palette." side="bottom" render={() => <Fig cover={crow} fit={{ ...F_CENTER, pad: 0.14, ay: 0.3 }} opts={{ mode: "flat" }} label="web flat" cell={7} />} />
      </div>
    </Section>
  );
}


function BannerChrome({ children, title, meta, short }: { children: ReactNode; title: string; meta: string[]; short?: boolean }) {
  return (
    <div className={`mz-frame mzv-banner${short ? " mzv-banner-short" : ""}`}>
      {children}
      <div className="mzv-banner-title">{title}</div>
      <ul className="mzv-banner-meta">{meta.map((m) => <li key={m}>{m}</li>)}</ul>
    </div>
  );
}

function TypeBanner() {
  const pal = usePalette();
  const g = useGray(tiger.src);
  const word = useTextGray("JOB 0x2F", 700);
  const field = useMemo(() => withType(figure(g, subjectFit(tiger, { ax: 0.92, pad: 0.08 }), tiger.tone, { mode: "dissolve" }), word, (W, H) => ({ x: W * 0.03, y: H * 0.2, w: W * 0.5, h: H * 0.42 }), 0.88), [g, word]);
  return <Mosaic field={field} label="banner type" cell={6} vocab={VOCAB_FINE} seed={33} twinkle={0.08} palette={pal} />;
}

function BannerSection() {
  const meta = ["Job 0x2F", "S07 / E12", "ResNet-mini"];
  return (
    <Section title="Banner" note="CoverBand: job and profile page headers. Full content width, 256px tall.">
      <div className="mzv-grid mzv-grid-1">
        <Variant n="00" title="Before" note="Cover fit at 155 percent on the tiger: a wide band shows a stripe of fur, never the animal." before>
          <BannerChrome title="ResNet-mini on CIFAR" meta={meta}><Before cover={tiger} cell={8} label="banner before" /></BannerChrome>
        </Variant>
        <Variant n="01" title="Right-contained (shipped)" note="Now in the app. Whole tiger against the right edge, title plate bottom left on clean ground.">
          <BannerChrome title="ResNet-mini on CIFAR" meta={meta}><Fig cover={tiger} fit={subjectFit(tiger, { ax: 0.88, pad: 0.08 })} opts={{ mode: "dissolve" }} label="banner contained" cell={6} live={false} /></BannerChrome>
        </Variant>
        <Variant n="02" title="Lit field" note="A one-level glow builds from the right edge behind the figure, so the band has weight without crowding the title.">
          <BannerChrome title="ResNet-mini on CIFAR" meta={meta}><Fig cover={tiger} fit={subjectFit(tiger, { ax: 0.86, pad: 0.06 })} opts={{ mode: "dissolve", glowFrom: 0.35 }} label="banner glow" cell={6} live={false} /></BannerChrome>
        </Variant>
        <Variant n="03" title="Inset plate" note="Tiger framed in a square plate at the right, rest of the band is texture. Consistent crop across every job.">
          <BannerChrome title="ResNet-mini on CIFAR" meta={meta}><Fig cover={tiger} fit={{ ...subjectFit(tiger, { ax: 0.5, pad: 0.08 }) }} opts={{ mode: "dissolve", box: (W, H) => ({ x: W - H * 0.86 - H * 0.07, y: H * 0.07, w: H * 0.86, h: H * 0.86 }) }} label="banner inset" cell={5} live={false} /></BannerChrome>
        </Variant>
        <Variant n="04" title="Mosaic title" note="Job id set in lit tiles on the left, figure on the right. The banner becomes the title.">
          <BannerChrome title="" meta={meta}><TypeBanner /></BannerChrome>
        </Variant>
        <Variant n="05" title="Short flat" note="128px band, two-tone figure. For dense pages (profile, settings) where the header should not push content down.">
          <BannerChrome title="ResNet-mini on CIFAR" meta={meta} short><Fig cover={tiger} fit={subjectFit(tiger, { ax: 0.9, pad: 0.08 })} opts={{ mode: "flat" }} label="banner short" cell={5} live={false} /></BannerChrome>
        </Variant>
      </div>
    </Section>
  );
}


function IndexCover({ cover, n }: { cover: Cover; n: string }) {
  const pal = usePalette();
  const g = useGray(cover.src);
  const num = useTextGray(n, 700);
  const field = useMemo(() => withType(figure(g, subjectFit(cover, { ax: 0.95, pad: 0.08 }), cover.tone, { mode: "dissolve" }), num, (W, H) => ({ x: W * 0.06, y: H * 0.08, w: W * 0.34, h: H * 0.3 }), 0.88), [g, num, cover]);
  return <Mosaic field={field} label={`${cover.title} index`} cell={6} vocab={VOCAB_FINE} seed={n.length * 3} twinkle={0} palette={pal} />;
}

const CARD_COVERS = ["crow", "tiger", "owl"].map(coverById);

function CoverRow({ render }: { render: (c: Cover, i: number) => ReactNode }) {
  return (
    <div className="mzv-cards">
      {CARD_COVERS.map((c, i) => (
        <div key={c.id} className="mzv-card">
          <div className="mzv-card-art">{render(c, i)}</div>
          <div className="mzv-card-body"><span className="mzv-n">{`0${i + 1}`}</span><span>{c.title}</span></div>
        </div>
      ))}
    </div>
  );
}

function CoverSection() {
  return (
    <Section title="Cover" note="PosterCard thumbnail: jobs, competitions, docs, profile. Card width, 192px tall.">
      <div className="mzv-grid mzv-grid-1">
        <Variant n="00" title="Before" note="Cover fit, cell 7, long words. Tiger and crow lose heads; tiles are wider than a feather." before>
          <CoverRow render={(c) => <Before cover={c} cell={7} label={`${c.id} before`} />} />
        </Variant>
        <Variant n="01" title="Contained (shipped)" note="Now in the app. Whole animal, centred on its own anchor, 1 to 3 character tiles.">
          <CoverRow render={(c) => <Fig cover={c} fit={subjectFit(c)} opts={{ mode: "dissolve" }} label={`${c.id} v1`} cell={6} live={false} />} />
        </Variant>
        <Variant n="02" title="Silhouette" note="Animal as void on a lit field. Every card reads at a glance, even in a dense grid.">
          <CoverRow render={(c) => <Fig cover={c} fit={subjectFit(c, { pad: 0.1 })} opts={{ mode: "silhouette" }} label={`${c.id} v2`} cell={6} live={false} />} />
        </Variant>
        <Variant n="03" title="Plate" note="Figure inside an inset plate with a lit rim, like a mounted print. Grid of cards gets a rhythm.">
          <CoverRow render={(c) => <Fig cover={c} fit={subjectFit(c, { ax: 0.5, pad: 0.08 })} opts={{ mode: "dissolve", box: (W, H) => ({ x: W * 0.06, y: H * 0.08, w: W * 0.88, h: H * 0.84 }) }} label={`${c.id} v3`} cell={5} live={false} />} />
        </Variant>
        <Variant n="04" title="Index number" note="The card number in mosaic type top left, figure pushed right. Number and art become one mark.">
          <CoverRow render={(c, i) => <IndexCover cover={c} n={`0${i + 1}`} />} />
        </Variant>
        <Variant n="05" title="Flat duotone" note="Two levels. Quietest in a long list; the live card can switch back to full tone.">
          <CoverRow render={(c) => <Fig cover={c} fit={subjectFit(c, { pad: 0.1 })} opts={{ mode: "flat" }} label={`${c.id} v5`} cell={6} live={false} />} />
        </Variant>
      </div>
    </Section>
  );
}


function GateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mz-frame mzv-gate">
      <div className="mzv-gate-art">{children}</div>
      <div className="mzv-gate-copy">
        <span className="mzv-eyebrow">Sign in · one wallet, no account</span>
        <span className="mzv-gate-title">Your activity</span>
        <span className="mz-btn mz-btn-sm mz-btn-primary">Connect wallet</span>
      </div>
    </div>
  );
}

function SignInPoster() {
  const pal = usePalette();
  const g = useGray(crow.src);
  const word = useTextGray("SIGN IN", 700);
  const field = useMemo(() => withType(figure(g, subjectFit(crow, { ax: 0.5, ay: 0.15, pad: 0.06, scale: 0.78 }), crow.tone, { mode: "flat" }), word, (W, H) => ({ x: W * 0.08, y: H * 0.76, w: W * 0.84, h: H * 0.16 }), 0.88), [g, word]);
  return <Mosaic field={field} label="sign in poster" cell={6} vocab={VOCAB_FINE} seed={41} twinkle={0.1} palette={pal} />;
}

function GateSection() {
  return (
    <Section title="Connect gate" note="Any page that needs a wallet: activity, jobs, profile, node. Half of a split card.">
      <div className="mzv-grid mzv-grid-3">
        <Variant n="00" title="Before" note="Cover fit, cell 9: the crow fills the panel and its head leaves the frame." before>
          <GateFrame><Before cover={crow} cell={9} label="gate before" /></GateFrame>
        </Variant>
        <Variant n="01" title="Contained (shipped)" note="Now in the app. Whole crow, live twinkle, fine tiles.">
          <GateFrame><Fig cover={crow} fit={subjectFit(crow)} opts={{ mode: "still" }} label="gate v1" cell={7} /></GateFrame>
        </Variant>
        <Variant n="02" title="Wavefront loop" note="A slow reveal from the eye, every seven seconds. Draws the eye to the action without a spinner.">
          <GateFrame><Fig cover={crow} fit={subjectFit(crow)} opts={{ mode: "radial", focus: [0.62, 0.32] }} label="gate v2" cell={7} /></GateFrame>
        </Variant>
        <Variant n="03" title="Silhouette" note="Void figure on lit ground: the locked state, literally a gap waiting for your wallet.">
          <GateFrame><Fig cover={crow} fit={subjectFit(crow, { pad: 0.1 })} opts={{ mode: "silhouette" }} label="gate v3" cell={6} /></GateFrame>
        </Variant>
        <Variant n="04" title="Seal" note="Crow inside a lit ring, like a wax seal. Ties sign-in to signing.">
          <GateFrame><Fig cover={crow} fit={subjectFit(crow, { ax: 0.5, pad: 0.2 })} opts={{ mode: "dissolve", seal: true }} label="gate v4" cell={6} /></GateFrame>
        </Variant>
        <Variant n="05" title="SIGN IN poster" note="Flat crow above the words in mosaic type. The poster says the action; the button repeats it.">
          <GateFrame><SignInPoster /></GateFrame>
        </Variant>
      </div>
    </Section>
  );
}


const LVL = ["var(--mz-tex)", "var(--mz-l1)", "var(--mz-l2)", "var(--mz-l3)", "var(--mz-l4)", "var(--mz-l5)", "var(--mz-l6)"];

function Swatch({ pal, children }: { pal: string; children: ReactNode }) {
  return <span className={`mz mz-pal-${pal} mzv-sw`}>{children}</span>;
}

function GridIdenticon({ value, size }: { value: string; size: number }) {
  const cells = identiconCells(value);
  return (
    <span className="mzv-ident" style={{ width: size, height: size }} aria-hidden>
      {cells.map((l, i) => <span key={i} style={{ background: LVL[l] }} />)}
    </span>
  );
}

function TileIdenticon({ value, size }: { value: string; size: number }) {
  const field = useMemo(() => identiconField(value), [value]);
  return (
    <span className="mzv-badge-canvas" style={{ width: size, height: size }}>
      <Mosaic field={field} label="" cell={Math.max(4, Math.round(size / 9))} vocab={VOCAB_FINE} seed={value.length} twinkle={0} duration={1.2} empty={0} />
    </span>
  );
}

function FigureBadge({ value, size }: { value: string; size: number }) {
  const c = COVERS[parseInt(value.slice(-2), 16) % COVERS.length];
  const g = useGray(c.src);
  const field = useMemo(() => figure(g, subjectFit(c, { ax: 0.5, pad: 0.04 }), c.tone, { mode: "flat" }), [g, c]);
  return (
    <span className="mzv-badge-canvas" style={{ width: size, height: size }}>
      <Mosaic field={field} label="" cell={4} vocab={VOCAB_FINE} seed={value.length} twinkle={0} duration={1.2} empty={0} />
    </span>
  );
}

function TagBadge({ value }: { value: string }) {
  return <span className="mzv-tag">{value.slice(2, 4).toUpperCase()}<i>{value.slice(-2)}</i></span>;
}

const STATUS = [
  { w: "PAID", p: "bone" },
  { w: "VERIFIED", p: "ember" },
  { w: "LIVE", p: "lime" },
  { w: "SLASHED", p: "red" },
  { w: "IDLE", p: "red", dim: true },
];

function StatusBadge({ w, dim }: { w: string; dim?: boolean }) {
  const field = useMemo<FieldFn>(() => (tile, c) => (dim ? 0.15 : tile.r < 0.35 + 0.25 * Math.sin(c.t * 2 + tile.cx / 12) ? 0.45 : 0.28), [dim]);
  return (
    <span className="mzv-status">
      <span className="mzv-status-bg"><Mosaic field={field} label="" cell={4} vocab={VOCAB_FINE} seed={w.length * 3} twinkle={dim ? 0 : 0.3} empty={0} /></span>
      <span className="mzv-status-word">{w}</span>
    </span>
  );
}

function BadgeRow({ render }: { render: (a: string, pal: string) => ReactNode }) {
  return (
    <div className="mzv-badges">
      {ADDRS.map((a) => {
        const pal = paletteOf(a, PALETTES);
        return <Swatch key={a} pal={pal}>{render(a, pal)}</Swatch>;
      })}
    </div>
  );
}

function BadgeSection() {
  return (
    <Section title="Badges" note="Identicons (sidebar, settings, address chips, profile) and status marks. Palette picked per address from red, ember, bone, lime.">
      <div className="mzv-grid mzv-grid-1">
        <Variant n="00" title="Before" note="3 by 3 grid, one palette. Six addresses, many near-twins: too few cells to tell wallets apart." before>
          <div className="mzv-badges">{ADDRS.map((a) => <span key={a} className="mzv-old"><span style={{ background: LVL[(a.charCodeAt(4) % 4) + 2] }} /></span>)}</div>
        </Variant>
        <Variant n="01" title="5 by 5 mirrored" note="Twenty-five cells, mirrored, palette by address. Crisp at 16px, the size the address chip uses.">
          <BadgeRow render={(a) => <span className="mzv-sizes"><GridIdenticon value={a} size={16} /><GridIdenticon value={a} size={24} /><GridIdenticon value={a} size={40} /></span>} />
        </Variant>
        <Variant n="02" title="Tile identicon" note="Same pattern drawn in word tiles. For 32px and up: profile header, settings wallet row.">
          <BadgeRow render={(a) => <span className="mzv-sizes"><TileIdenticon value={a} size={32} /><TileIdenticon value={a} size={48} /></span>} />
        </Variant>
        <Variant n="03" title="Figure badge" note="Each address gets one of the seven prints, flat two-tone, whole animal. Memorable, but needs 40px+.">
          <BadgeRow render={(a) => <span className="mzv-sizes"><FigureBadge value={a} size={40} /><FigureBadge value={a} size={56} /></span>} />
        </Variant>
        <Variant n="04" title="Hex tag" note="First and last byte as a mono tag on the palette. Cheapest, readable, doubles as an address hint.">
          <BadgeRow render={(a) => <TagBadge value={a} />} />
        </Variant>
        <Variant n="05" title="Status marks" note="State chips on a live tile strip, palette by meaning: bone paid, ember verified, lime live, red slashed.">
          <div className="mzv-badges">{STATUS.map((s) => <Swatch key={s.w} pal={s.p}><StatusBadge w={s.w} dim={s.dim} /></Swatch>)}</div>
        </Variant>
      </div>
    </Section>
  );
}

export function VariantsPage() {
  return (
    <>
      <Hero title="Variants" meta={"Subject fit, fine tiles\nFive per surface\nBefore on the left"} />
      <TuiSection />
      <WebSection />
      <BannerSection />
      <CoverSection />
      <GateSection />
      <BadgeSection />
    </>
  );
}

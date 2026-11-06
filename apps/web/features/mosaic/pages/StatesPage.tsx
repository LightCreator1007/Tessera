// States, three takes. A: each state is one word poster (PAID, SLASHED, EMPTY, OFFLINE).
// B: mosaic buttons whose fill dissolves in from the cursor. C: the round receipt, accepted or slashed.
"use client";

import { Layers } from "lucide-react";
import { OfflineBanner } from "@/components/mosaic/OfflineBanner";
import { EmptyState } from "@/components/primitives";
import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB_SHORT, type FieldFn } from "@/components/mosaic/engine";
import { sampler } from "@/components/mosaic/figures";
import { textGray, useTextGray } from "@/components/mosaic/type";
import { Section, usePalette } from "../shell";

type Kind = "paid" | "slashed" | "empty" | "offline";

function wordField(word: string, kind: Kind): FieldFn {
  const s = sampler(textGray(word, 700), { fit: "contain", scale: 0.94, ax: 0.5, ay: 0.22 });
  return (tile, c) => {
    const v = s(tile, c);
    if (v < 0.4) return kind === "offline" && tile.r < Math.min(0.9, (c.t % 9) / 7) ? -1 : 0;
    if (!(tile.r < c.t / 1.2)) return 0;
    if (kind === "paid") return tile.r > c.t / 1.2 - 0.12 ? 1.05 : 0.88;
    if (kind === "empty") return 0.3;
    if (kind === "offline") return tile.r < Math.min(0.9, (c.t % 9) / 7) ? -1 : 0.4;
    const crack = c.W * 0.5 + Math.sin(tile.cy / 7) * 10 + (tile.cy - c.H * 0.36) * 0.6;
    if (Math.abs(tile.cx - crack) < 9) return -1;
    return tile.cx > crack ? 0.36 : 0.62;
  };
}

const POSTERS: { kind: Kind; word: string; meta: string; title: string; cta?: string; empty?: number }[] = [
  { kind: "paid", word: "PAID", meta: "+4.20 TOD\nRound 12\nJob 07", title: "Round 12 accepted", cta: "Share poster" },
  { kind: "slashed", word: "SLASHED", meta: "Replay mismatch\nStep 412\nΔ 0.031 > 0.001", title: "1.50 TOD withheld pay taken", cta: "Open evidence" },
  { kind: "empty", word: "EMPTY", meta: "No jobs\nfor this laptop\nright now", title: "Your node is waiting", cta: "Start node", empty: 0.5 },
  { kind: "offline", word: "OFFLINE", meta: "Coordinator\nunreachable\nretry in 5 s", title: "Showing data from 2 min ago", cta: "Retry now" },
];

function WordPoster({ p }: { p: (typeof POSTERS)[number] }) {
  const pal = usePalette();
  const ready = !!useTextGray(p.word, 700);
  const [play, setPlay] = useState(0);
  const field = useMemo(() => (ready ? wordField(p.word, p.kind) : () => 0), [ready, p.word, p.kind]);
  return (
    <div className="mz-state" style={{ height: 340 }}>
      <Mosaic field={field} label={`${p.word}: ${p.title}`} vocab={VOCAB_SHORT} cell={7} seed={p.word.length * 13} palette={pal} playKey={play} empty={p.empty} />
      <span className="mz-cover-meta" style={{ top: 12, right: 12 }}>
        {p.meta}
      </span>
      <div className="mz-state-copy">
        <span className="mz-state-title">{p.title}</span>
        {p.cta && (
          <button type="button" className={`mz-btn mz-btn-sm ${p.kind === "paid" || p.kind === "empty" ? "mz-btn-primary" : "mz-btn-ghost"}`} style={{ justifySelf: "start" }} onClick={() => setPlay((v) => v + 1)}>
            {p.cta}
          </button>
        )}
      </div>
    </div>
  );
}

type Tone = "bone" | "red" | "ghost";
const FILL: Record<Tone, number> = { bone: 0.88, red: 0.64, ghost: 0.3 };

/** A button that is a small mosaic. Hover dissolves the fill in from the cursor, leaving retracts it, press flashes. */
function MosaicButton({ children, tone = "bone", busy, disabled }: { children: ReactNode; tone?: Tone; busy?: boolean; disabled?: boolean }) {
  const pal = usePalette();
  const h = useRef({ on: false, at: 0, x: 0, y: 0, press: 0 });
  const [on, setOn] = useState(false);
  const field: FieldFn = useMemo(
    () => (tile, c) => {
      const s = h.current;
      const now = performance.now();
      if (disabled) return 0;
      if (busy) {
        const bx = (((now / 1000) * 0.8) % 1.3 - 0.15) * c.W;
        return Math.abs(tile.cx - bx) < 26 ? 1.05 : 0.18;
      }
      if (now - s.press < 140) return 1.05;
      const front = ((now - s.at) / 1000) * 520;
      const d = Math.hypot(tile.cx - s.x, tile.cy - s.y);
      const lit = s.on ? d < front + tile.r * 30 : d > front - tile.r * 30;
      return lit ? FILL[tone] : 0.12;
    },
    [tone, busy, disabled],
  );
  const at = (e: MouseEvent<HTMLButtonElement>, v: boolean) => {
    const b = e.currentTarget.getBoundingClientRect();
    h.current = { ...h.current, on: v, at: performance.now(), x: e.clientX - b.left, y: e.clientY - b.top };
    setOn(v);
  };
  return (
    <button
      type="button"
      className="mz-mbtn"
      data-tone={tone}
      data-on={on && !busy && !disabled}
      disabled={disabled}
      aria-busy={busy}
      onMouseEnter={(e) => at(e, true)}
      onMouseLeave={(e) => at(e, false)}
      onMouseDown={() => (h.current.press = performance.now())}
      onFocus={() => {
        h.current = { ...h.current, on: true, at: performance.now(), x: 0, y: 0 };
        setOn(true);
      }}
      onBlur={() => {
        h.current = { ...h.current, on: false, at: performance.now() };
        setOn(false);
      }}
    >
      <span className="mz-mbtn-bg" aria-hidden>
        <Mosaic field={field} label="" cell={11} seed={String(children).length * 7 + 3} palette={pal} empty={0.15} twinkle={0.3} />
      </span>
      <span className="mz-mbtn-label">{children}</span>
    </button>
  );
}

function Receipt() {
  const pal = usePalette();
  const [ok, setOk] = useState(true);
  const word = ok ? "+4.20" : "-1.50";
  const ready = !!useTextGray(word, 700);
  const field: FieldFn = useMemo(() => {
    if (!ready) return () => 0;
    const s = sampler(textGray(word, 700), { fit: "contain", scale: 0.84, ax: 0.5, ay: 0.5 });
    return (tile, c) => {
      const v = s(tile, c);
      if (v < 0.4) return 0;
      if (!(tile.r < c.t / 1)) return 0;
      if (!ok && Math.abs(tile.cx - c.W * 0.5 - Math.sin(tile.cy / 6) * 8) < 8) return -1;
      return ok ? (tile.r > c.t - 0.12 ? 1.05 : 0.88) : 0.62;
    };
  }, [ready, word, ok]);
  const rows = ok
    ? [["Job", "07 · resnet-mini"], ["Round", "12 of 40"], ["Your share", "31%"], ["Replayed by", "2 verifiers"], ["Tx", "0x9e1c...44ab"]]
    : [["Job", "07 · resnet-mini"], ["Round", "12 of 40"], ["Reason", "Replay mismatch at step 412"], ["Difference", "0.031 (tolerance 0.001)"], ["Evidence", "0x3f07...b2c9"]];
  return (
    <Section title="C. The receipt" note="Every round ends on one. The amount is the poster; the rows underneath are the proof.">
      <div className="mz-seg" style={{ marginBottom: 12 }}>
        <button type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={ok} onClick={() => setOk(true)}>
          accepted
        </button>
        <button type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={!ok} onClick={() => setOk(false)}>
          slashed
        </button>
      </div>
      <div className="mz-receipt">
        <div className="mz-receipt-art">
          <Mosaic field={field} label={`${word} TOD`} vocab={VOCAB_SHORT} cell={8} seed={ok ? 81 : 82} palette={pal} playKey={word} />
        </div>
        <dl className="mz-receipt-rows">
          <div className="mz-receipt-head" data-tone={ok ? "ok" : "fail"}>
            {ok ? "Accepted" : "Slashed"} · TOD
          </div>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

export function StatesPage() {
  return (
    <>
      <Section title="A. One word per state" note="Simple. The state word is the whole picture: PAID glints, SLASHED cracks, EMPTY is a ghost, OFFLINE goes dark tile by tile.">
        <div className="mz-posters">
          {POSTERS.map((p) => (
            <WordPoster key={p.kind} p={p} />
          ))}
        </div>
      </Section>
      <Section title="B. Mosaic buttons" note="Complex. Each button is a tiny mosaic. Hover and the fill dissolves in from where the cursor entered; leave and it retracts.">
        <div className="mz-card mz-row" style={{ gap: 16, padding: 24 }}>
          <MosaicButton>Start node</MosaicButton>
          <MosaicButton tone="red">Lock budget</MosaicButton>
          <MosaicButton tone="ghost">View receipt</MosaicButton>
          <MosaicButton busy>Signing</MosaicButton>
          <MosaicButton disabled>Stake 15 TOD</MosaicButton>
        </div>
      </Section>
      <Receipt />
      <Section title="D. As shipped in the app" note="The offline banner (coordinator unreachable, stale data stays) and an empty state in poster mode, exactly as the app renders them.">
        <div style={{ display: "grid", gap: 16 }}>
          <OfflineBanner onRetry={() => undefined}>Job history on chain is still readable.</OfflineBanner>
          <div className="mz-card"><EmptyState icon={Layers} poster="EMPTY" title="No jobs yet">Once someone locks a budget, the job shows up here within a block.</EmptyState></div>
        </div>
      </Section>
    </>
  );
}

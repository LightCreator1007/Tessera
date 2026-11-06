// Onboarding, three takes. A: the figure is your progress (each finished step dissolves in another sixth of the crow).
// B: the step name itself as giant mosaic type, cross-dissolving between steps. C: the /start role fork as three words.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB_SHORT, type FieldFn } from "@/components/mosaic/engine";
import { coverById, sampler, useGray } from "@/components/mosaic/figures";
import { tone } from "@/components/mosaic/fields";
import { lineAt, textGray, useTextGray } from "@/components/mosaic/type";
import { Section, usePalette } from "../shell";

const JOIN = [
  { id: "connect", label: "Connect", title: "Connect the wallet that gets paid", lede: "It stakes, collects pay and can withdraw. The laptop keeps a key of its own." },
  { id: "install", label: "Install", title: "Install the node", lede: "One terminal command. It runs a self-test that checks this laptop reproduces the reference math bit for bit.", fail: "Self-test mismatch at step 88. This laptop cannot join yet." },
  { id: "pair", label: "Pair", title: "Pair the laptop with your wallet", lede: "The laptop signs a short consent naming your wallet as owner. Codes last 10 minutes.", fail: "Code expired. Run tod pair for a fresh one." },
  { id: "verify", label: "Verify", title: "Prove you're one person", lede: "One person, one node, so nobody can run a fleet of fake laptops.", fail: "This World ID already backs another node." },
  { id: "stake", label: "Stake", title: "Stake your bond", lede: "15 TOD. Honest work never touches it.", fail: "Balance too low: 9.40 of 15 TOD." },
  { id: "start", label: "Start", title: "Start the node", lede: "It goes online and waits for idle time." },
];
const N = JOIN.length;

function StepTiles({ cur, fail, onPick }: { cur: number; fail: boolean; onPick: (i: number) => void }) {
  return (
    <div className="mz-steps" role="tablist" aria-label="Steps">
      {JOIN.map((s, i) => (
        <button key={s.id} type="button" role="tab" aria-selected={i === cur} className="mz-steptile" data-s={fail && i === cur ? "fail" : i < cur ? "done" : i === cur ? "active" : "todo"} onClick={() => onPick(i)}>
          {String(i + 1).padStart(2, "0")} {s.label}
        </button>
      ))}
    </div>
  );
}

/** A: finished steps reveal the tiles whose random key falls in their sixth. The sixth just earned dissolves in bone. */
function FigureProgress() {
  const pal = usePalette();
  const c = coverById("crow");
  const g = useGray(c.src);
  const [cur, setCur] = useState(0);
  const [fail, setFail] = useState(false);
  const state = useRef({ cur: 0, fail: false, at: 0 });
  state.current.cur = cur;
  state.current.fail = fail;
  const go = (i: number) => {
    state.current.at = performance.now();
    setFail(false);
    setCur(Math.max(0, Math.min(N, i)));
  };
  const field: FieldFn = useMemo(() => {
    const s = sampler(g, { fit: "cover", scale: 1.05, ax: 0.35, ay: 0.5 });
    return (tile, cx) => {
      const { cur: k0, fail: f, at } = state.current;
      const v = tone(s(tile, cx), c.tone);
      const k = tile.r * N;
      const age = (performance.now() - at) / 1000;
      if (k < k0 - 1) return v;
      if (k < k0) {
        const local = k - (k0 - 1);
        if (age > 0.9) return v;
        return local < age * 1.6 ? (v > 0.1 ? Math.max(v, 0.9) : 0.35) : 0;
      }
      if (f && k < k0 + 1) return v > 0.1 && Math.sin(tile.cy * 0.6 + tile.cx * 0.05) > 0.3 ? -1 : 0;
      return 0;
    };
  }, [g, c.tone]);
  const s = JOIN[Math.min(cur, N - 1)];
  const done = cur >= N;
  return (
    <Section title="A. The figure is your progress" note="Simple. Six steps, six sixths of the crow. Finish one and its tiles dissolve in; fail one and its sixth cracks.">
      <div className="mz-ob">
        <div className="mz-ob-art">
          <Mosaic field={field} label="Crow, partly revealed by onboarding progress" cell={10} seed={70} palette={pal} />
          <span className="mz-ob-pct">{Math.round((Math.min(cur, N) / N) * 100)}%</span>
        </div>
        <div className="mz-ob-panel">
          <StepTiles cur={cur} fail={fail} onPick={go} />
          <div className="mz-ob-num">{done ? "Done" : String(cur + 1).padStart(2, "0")}</div>
          <h3 className="mz-auth-title">{done ? "Your node is live" : s.title}</h3>
          <p className="mz-auth-lede">{done ? "The crow is whole. The node goes online when the laptop is idle." : fail && s.fail ? s.fail : s.lede}</p>
          <div className="mz-row">
            {!done && (
              <button type="button" className="mz-btn mz-btn-primary" onClick={() => go(cur + 1)}>
                {fail ? "Fixed, continue" : "Done, next"} <span className="mz-kbd">↵</span>
              </button>
            )}
            {!done && s.fail && !fail && (
              <button type="button" className="mz-btn mz-btn-ghost" onClick={() => { state.current.at = performance.now(); setFail(true); }}>
                Fail this step
              </button>
            )}
            <button type="button" className="mz-btn mz-btn-ghost" onClick={() => go(0)}>
              Restart
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}

/** B: the step name in giant type; the old word dissolves out while the new one dissolves in. */
function TypeSteps() {
  const pal = usePalette();
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const prev = useRef(0);
  const at = useRef(0);
  const ready = !!useTextGray(JOIN[0].label.toUpperCase(), 700);
  const pick = (k: number) => {
    prev.current = i;
    at.current = performance.now();
    setI(k);
  };
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      setI((v) => {
        prev.current = v;
        at.current = performance.now();
        return (v + 1) % N;
      });
    }, 2400);
    return () => clearInterval(id);
  }, [auto]);
  const field: FieldFn = useMemo(() => {
    if (!ready) return () => 0;
    const fit = { fit: "contain" as const, scale: 0.92, ax: 0.5, ay: 0.4 };
    const samplers = JOIN.map((s) => sampler(textGray(s.label.toUpperCase(), 700), fit));
    return (tile, c) => {
      const k = Math.min(1, (performance.now() - at.current) / 700);
      const showNew = tile.r < k;
      const v = (showNew ? samplers[i] : samplers[prev.current])(tile, c);
      if (v < 0.4) return 0;
      if (showNew && k < 1 && tile.r > k - 0.14) return 1.05;
      return showNew && i === N - 1 ? 0.84 : 0.64;
    };
  }, [ready, i]);
  return (
    <Section title="B. The step is the poster" note="Bold. One word per screen, set in tiles, cross-dissolving. Everything else is one line of mono.">
      <div className="mz-frame" style={{ height: 420 }}>
        <Mosaic field={field} label={`Step ${i + 1}: ${JOIN[i].label}`} vocab={VOCAB_SHORT} cell={8} seed={33} palette={pal} />
        <span className="mz-caption">{`Step ${String(i + 1).padStart(2, "0")} of 06\n${JOIN[i].title}`}</span>
      </div>
      <div className="mz-row" style={{ marginTop: 12 }}>
        <StepTiles cur={i} fail={false} onPick={(k) => { setAuto(false); pick(k); }} />
        <button type="button" className="mz-btn mz-btn-sm mz-btn-ghost" onClick={() => setAuto((a) => !a)}>
          {auto ? "Pause" : "Play"}
        </button>
      </div>
    </Section>
  );
}

const ROLES = [
  { id: "LEND", title: "Lend a laptop", body: "Your laptop trains verified jobs while you are away.", first: "Watch a replay catch a lazy node, 40 s" },
  { id: "TRAIN", title: "Train a model", body: "Lock a budget. Pay only for verified rounds.", first: "See how a round is checked" },
  { id: "HOST", title: "Host a competition", body: "Commit your labels first. Nobody can move the goalposts.", first: "Open a finished example" },
];

/** C: the role picker as three stacked words; the chosen one dissolves to lit, the others stay as faint texture. */
function RoleWords() {
  const pal = usePalette();
  const [role, setRole] = useState(0);
  const at = useRef(0);
  const g = useTextGray("LEND\nTRAIN\nHOST", 700);
  const pick = (k: number) => {
    at.current = performance.now();
    setRole(k);
  };
  const field: FieldFn = useMemo(() => {
    const s = sampler(g, { fit: "contain", scale: 0.94, ax: 0.1, ay: 0.5 });
    return (tile, c) => {
      const v = s(tile, c);
      if (v < 0.4) return 0;
      const line = lineAt(tile.cy, c.H, 3, 0.94);
      if (line !== role) return 0.17;
      const k = Math.min(1, (performance.now() - at.current) / 550);
      if (tile.r >= k) return 0.24;
      return k < 1 && tile.r > k - 0.15 ? 1.05 : 0.74;
    };
  }, [g, role]);
  const r = ROLES[role];
  return (
    <Section title="C. Three words" note="Minimal. /start as LEND, TRAIN, HOST. Click a word; it lights, and its first step is the only thing beside it.">
      <div className="mz-ob">
        <button
          type="button"
          className="mz-ob-art mz-ob-hit"
          aria-label={`Role: ${r.title}. Click the top, middle or bottom word to change`}
          onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            pick(Math.max(0, Math.min(2, Math.floor(((e.clientY - b.top) / b.height) * 3))));
          }}
        >
          <Mosaic field={field} label="Lend, train, host" vocab={VOCAB_SHORT} cell={8} seed={44} palette={pal} />
        </button>
        <div className="mz-ob-panel">
          <div className="mz-seg" role="radiogroup" aria-label="Role">
            {ROLES.map((x, k) => (
              <button key={x.id} type="button" role="radio" aria-checked={k === role} className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={k === role} onClick={() => pick(k)}>
                {x.id}
              </button>
            ))}
          </div>
          <h3 className="mz-auth-title">{r.title}</h3>
          <p className="mz-auth-lede">{r.body}</p>
          <button type="button" className="mz-btn mz-btn-primary" style={{ justifySelf: "start" }}>
            {r.first} →
          </button>
        </div>
      </div>
    </Section>
  );
}

export function OnboardingPage() {
  return (
    <>
      <FigureProgress />
      <TypeSteps />
      <RoleWords />
    </>
  );
}

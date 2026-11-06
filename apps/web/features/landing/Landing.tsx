// Public landing page: the crow hero, the scroll-driven round story, the cheat demo, the two sides and the close.
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB, VOCAB_SHORT, VOCAB_TRAIN, type FieldFn } from "@/components/mosaic/engine";
import { coverById, figureField, sampler, subjectFit, useGray } from "@/components/mosaic/figures";
import { clamp, dissolve, tone } from "@/components/mosaic/fields";
import { useTextGray } from "@/components/mosaic/type";
import { BrandMark } from "@/components/brand";
import { reducedMotion } from "@/lib/prefs";
import { roundField, useWake, withWake } from "./fields";
import "./landing.css";

export function Landing() {
  return (
    <div className="ld">
      <Nav />
      <main id="main">
        <Hero />
        <RoundStory />
        <CheatDemo />
        <Sides />
        <Close />
      </main>
      <Footer />
    </div>
  );
}

function Btn({ href, children, ghost }: { href: string; children: ReactNode; ghost?: boolean }) {
  return (
    <Link href={href} className={ghost ? "ld-btn ld-btn-ghost" : "ld-btn"}>
      {children}
    </Link>
  );
}

function Nav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`ld-nav ${solid ? "is-solid" : ""}`}>
      <Link href="/landing" className="flex items-center gap-2.5">
        <BrandMark className="size-7 p-1" />
        <span className="text-lg font-medium tracking-tight text-ink">Tessera</span>
      </Link>
      <nav className="ml-auto flex items-center gap-1 sm:gap-2">
        <a href="#round" className="ld-link hidden sm:inline-flex">How it works</a>
        <a href="#cheat" className="ld-link hidden sm:inline-flex">Try it</a>
        <Link href="/docs" className="ld-link hidden sm:inline-flex">Docs</Link>
        <Btn href="/">Open the app</Btn>
      </nav>
    </header>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  const crow = coverById("crow");
  const g = useGray(crow.src);
  const { move, wake } = useWake(64);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const field = useMemo(() => {
    const fit = subjectFit(crow, wide ? { ax: 0.9, pad: 0.07 } : { ax: 0.5, pad: 0.05 });
    return withWake(figureField(g, fit, crow.tone, "radial", wide ? [0.72, 0.4] : [0.55, 0.4]), wake);
  }, [g, crow, wide, wake]);

  return (
    <section className="ld-hero">
      <div className="ld-hero-art" onPointerMove={move}>
        <Mosaic field={field} label="A crow drawn in word tiles, developing from its eye" cell={wide ? 10 : 8} vocab={VOCAB} twinkle={0.1} />
      </div>
      <div className="ld-hero-copy">
        <h1 className="ld-display ld-rise" style={{ animationDelay: "0.5s" }}>
          Train models on laptops nobody is using.
        </h1>
        <p className="ld-lede ld-rise" style={{ animationDelay: "0.75s" }}>
          Post a training job and idle laptops do the work. Every round is replayed and checked before anyone gets paid.
        </p>
        <div className="ld-rise flex flex-wrap gap-3" style={{ animationDelay: "0.95s" }}>
          <Btn href="/jobs/new">Post a training job</Btn>
          <Btn href="/nodes/join" ghost>Run a node</Btn>
        </div>
      </div>
    </section>
  );
}

/* ---------- The round, scroll driven ---------- */

const STEPS = [
  { name: "Train", body: "Each laptop trains its own slice of the data. A round takes about two minutes." },
  { name: "Commit", body: "Every node posts a fingerprint of its result before anyone reveals theirs, so nobody can copy a neighbour." },
  { name: "Replay", body: "Verifiers re-run a random slice. It's picked after every commit is in, so there's no knowing which part gets checked." },
  { name: "Settle", body: "Work that replays exactly is paid on chain. Work that doesn't costs the node its stake." },
];

function RoundStory() {
  const ref = useRef<HTMLElement>(null);
  const stepRef = useRef(0);
  const sinceRef = useRef(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const reduce = reducedMotion();
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const p = clamp(-r.top / Math.max(1, r.height - window.innerHeight));
        const s = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length));
        if (s !== stepRef.current) {
          stepRef.current = s;
          sinceRef.current = reduce ? -1e9 : performance.now();
          setStep(s);
        }
      });
    };
    sinceRef.current = reduce ? -1e9 : performance.now();
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
    };
  }, []);

  const field = useMemo(() => roundField(() => stepRef.current, () => sinceRef.current), []);
  const go = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + ((i + 0.5) / STEPS.length) * (el.offsetHeight - window.innerHeight), behavior: reducedMotion() ? "auto" : "smooth" });
  };

  return (
    <section id="round" ref={ref} className="ld-round" style={{ height: `${STEPS.length * 85 + 40}svh` }}>
      <div className="ld-round-stick">
        <div className="ld-round-copy">
          <h2 className="ld-h2">How a round works</h2>
          <ol className="ld-steps">
            {STEPS.map((s, i) => (
              <li key={s.name} className={i === step ? "is-on" : i < step ? "is-past" : ""}>
                <button type="button" onClick={() => go(i)} aria-current={i === step ? "step" : undefined}>
                  <span className="ld-step-n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="ld-step-name">{s.name}</span>
                </button>
                <p className="ld-step-body">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="ld-round-art">
          <Mosaic field={field} label={`Six laptops in a round, at the ${STEPS[step].name.toLowerCase()} step`} cell={10} vocab={VOCAB_TRAIN} twinkle={0.06} empty={0.3} />
        </div>
      </div>
    </section>
  );
}

/* ---------- Try to cheat ---------- */

type Phase = "idle" | "train" | "commit" | "replay" | "settle";
const NODES = ["0x8a4F", "0x2b19", "0xc07E", "0x51dA", "0x9e33", "0xf4C2"];
const HASH = ["a3f9", "71c0", "e2b8", "0d5a", "9c41", "b67e"];
const ROWS = 5;
const WORDS = ["GRAD", "STEP", "LOSS", "BATCH", "EPOCH", "ADAM", "SEED", "SHARD", "LR", "DELTA", "SGD", "EVAL"];
const PAY = "+0.42";

function nodeWords(n: number) {
  return Array.from({ length: (ROWS - 1) * 2 }, (_, i) => WORDS[(i * 5 + n * 7) % WORDS.length]);
}

function CheatDemo() {
  const [lazy, setLazy] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const run = () => {
    timers.current.forEach(clearTimeout);
    const fast = reducedMotion();
    const seq: [Phase, number][] = fast ? [["settle", 0]] : [["train", 0], ["commit", 1900], ["replay", 2900], ["settle", 4500]];
    timers.current = seq.map(([p, ms]) => window.setTimeout(() => setPhase(p), ms));
  };
  const pick = (i: number) => {
    timers.current.forEach(clearTimeout);
    setPhase("idle");
    setLazy((l) => (l === i ? null : i));
  };
  const busy = phase !== "idle" && phase !== "settle";

  const result =
    phase !== "settle"
      ? null
      : lazy === null
        ? "Every replay matched. All six nodes are paid."
        : `Caught. ${NODES[lazy]} revealed padding instead of training, and the replay didn't match its fingerprint. Its stake is slashed. The other five are paid.`;

  return (
    <section id="cheat" className="ld-cheat">
      <div className="ld-wrap">
        <h2 className="ld-h2">Try to cheat it.</h2>
        <p className="ld-lede">Pick a node to skip its training, then run the round.</p>

        <div className={`ld-grid is-${phase}`}>
          {NODES.map((addr, n) => {
            const isLazy = lazy === n;
            const caught = isLazy && (phase === "settle" || phase === "replay");
            return (
              <div key={addr} className={`ld-node ${isLazy ? "is-lazy" : ""} ${caught ? "is-caught" : ""}`} style={{ ["--n" as string]: n }}>
                <button type="button" className="ld-node-head" aria-pressed={isLazy} disabled={busy} onClick={() => pick(n)}>
                  <span>{addr}</span>
                  <span className="ld-node-tag">{isLazy ? "skipping" : "honest"}</span>
                </button>
                <div className="ld-tiles" aria-hidden>
                  {/* The top row is the fingerprint: one tile that seals with the commit hash. */}
                  <span className="ld-tile is-top" style={{ ["--r" as string]: ROWS - 1 }}>
                    {phase === "idle" || phase === "train" ? "COMMIT" : `0x${HASH[n]}`}
                  </span>
                  {nodeWords(n).map((w, i) => {
                    const row = ROWS - 2 - Math.floor(i / 2); // 0 is the bottom row
                    return (
                      <span key={i} className={`ld-tile ${row < 2 ? "is-low" : ""}`} style={{ ["--r" as string]: row, flexGrow: w.length }}>
                        {w}
                      </span>
                    );
                  })}
                </div>
                <div className="ld-node-foot">{phase === "settle" ? (isLazy ? "slashed" : `${PAY} TOD`) : " "}</div>
              </div>
            );
          })}
          <div className="ld-scan" aria-hidden />
        </div>

        <div className="ld-cheat-bar">
          <button type="button" className="ld-btn" onClick={run} disabled={busy}>
            {phase === "settle" ? "Run it again" : busy ? "Running" : "Run the round"}
          </button>
          <p className="ld-result" aria-live="polite">{result}</p>
        </div>
      </div>
    </section>
  );
}

/* ---------- Two sides ---------- */

function Poster({ id, label, focus }: { id: string; label: string; focus: [number, number] }) {
  const cover = coverById(id);
  const g = useGray(cover.src);
  const { move, wake } = useWake(48);
  const field = useMemo(() => withWake(figureField(g, cover.fit, cover.tone, "radial", focus, { gain: 1.2 }), wake), [g, cover, focus, wake]);
  return (
    <div className="ld-poster" onPointerMove={move}>
      <Mosaic field={field} label={label} cell={8} vocab={VOCAB_SHORT} twinkle={0.08} />
    </div>
  );
}

const OWL_FOCUS: [number, number] = [0.62, 0.45];
const TIGER_FOCUS: [number, number] = [0.5, 0.35];

function Sides() {
  return (
    <section className="ld-sides">
      <div className="ld-wrap ld-sides-grid">
        <article className="ld-side">
          <Poster id="owl" label="An owl drawn in word tiles" focus={OWL_FOCUS} />
          <h3 className="ld-h3">Lend your laptop.</h3>
          <p className="ld-body">It trains verified jobs in the background. Prove once that you're one real person, and after a five-hour trial every round that checks out pays you.</p>
          <Btn href="/nodes/join">Run a node</Btn>
        </article>
        <article className="ld-side">
          <Poster id="tiger" label="A tiger drawn in word tiles" focus={TIGER_FOCUS} />
          <h3 className="ld-h3">Train a model.</h3>
          <p className="ld-body">Lock a budget and describe the job. Laptops train it, verifiers check every round, and you pay only for work that checks out.</p>
          <Btn href="/jobs/new">Post a training job</Btn>
        </article>
      </div>
    </section>
  );
}

/* ---------- Close ---------- */

function Close() {
  const g = useTextGray("Tessera", 600);
  const { move, wake } = useWake(56);
  const field: FieldFn = useMemo(() => {
    const s = sampler(g, { fit: "subject", scale: 1, ax: 0.5, ay: 0.5, pad: 0.05 });
    const base: FieldFn = (tile, c) => {
      const v = s(tile, c);
      if (v < 0.45) return 0;
      if (!dissolve(tile, c.t, 0, 1.4)) return 0;
      return tone(0.55 + tile.r * 0.25, { contrast: 1, gamma: 1, lift: 0 });
    };
    return withWake(base, wake, 1.1);
  }, [g, wake]);
  return (
    <section className="ld-close">
      <div className="ld-close-art" onPointerMove={move}>
        <Mosaic field={field} label="Tessera, set in word tiles" cell={9} vocab={VOCAB_SHORT} twinkle={0.06} empty={0.35} />
      </div>
      <div className="ld-wrap ld-close-copy">
        <p className="ld-lede">Every round replayed. Every payout on chain.</p>
        <Btn href="/">Open the app</Btn>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="ld-foot">
      <div className="ld-wrap flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="flex items-center gap-2 text-muted">
          <BrandMark className="size-6 p-1" />
          Tessera
        </span>
        <nav className="ml-auto flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/how-it-works" className="ld-link-plain">How it works</Link>
          <Link href="/docs" className="ld-link-plain">Docs</Link>
          <Link href="/docs/cli" className="ld-link-plain">CLI</Link>
          <a href="https://github.com/LightCreator1007/ToD" className="ld-link-plain">GitHub</a>
        </nav>
      </div>
    </footer>
  );
}

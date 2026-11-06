// Landing feature sections: why it beats renting a GPU, the round receipt, the sealed competition and the node CLI.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { VOCAB_SHORT } from "@/components/mosaic/engine";
import { sealField } from "@/components/mosaic/figures";
import { reducedMotion } from "@/lib/prefs";

/* ---------- Why ---------- */

const WHY: [string, string, string][] = [
  ["You pay for", "Hours you reserve, used or not", "Rounds that replay correctly"],
  ["Proof the work happened", "An invoice", "A re-run by two verifiers, settled on chain"],
  ["Who can supply compute", "Data centres", "Anyone with a laptop and a wallet"],
  ["What you get back", "Weights", "Weights, plus every round that made them"],
  ["When the work is wrong", "A support ticket", "The node loses its stake"],
];

export function Why() {
  return (
    <section className="ld-why">
      <div className="ld-wrap">
        <h2 className="ld-h2 ld-why-title">Why not just rent a GPU?</h2>
        <div className="ld-why-table" role="table" aria-label="Renting a GPU compared with Tessera">
          <div className="ld-why-row ld-why-head" role="row">
            <span role="columnheader" />
            <span role="columnheader">Renting a GPU</span>
            <span role="columnheader">Tessera</span>
          </div>
          {WHY.map(([k, a, b]) => (
            <div key={k} className="ld-why-row" role="row">
              <span role="rowheader" className="ld-why-k">{k}</span>
              <span role="cell" className="ld-why-a">{a}</span>
              <span role="cell" className="ld-why-b">{b}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Receipt ---------- */

const RECEIPT = [
  { op: "0x8a4F", delta: "0.0000", ok: true },
  { op: "0x2b19", delta: "0.0000", ok: true },
  { op: "0xc07E", delta: "0.0000", ok: true },
  { op: "0x51dA", delta: "0.3141", ok: false },
  { op: "0x9e33", delta: "0.0000", ok: true },
  { op: "0xf4C2", delta: "0.0000", ok: true },
];

export function Receipt() {
  const [open, setOpen] = useState<string | null>("0x51dA");
  return (
    <section className="ld-feature">
      <div className="ld-wrap ld-feature-grid">
        <div className="ld-feature-copy">
          <h2 className="ld-h2">Every round leaves a receipt.</h2>
          <p className="ld-body">Who trained, what the replay found and the transaction that paid them. When a node fails, the receipt says exactly why, so nobody has to take anyone's word for it.</p>
        </div>
        <div className="ld-receipt">
          <div className="ld-receipt-top">
            <div>
              <span className="ld-receipt-big">Round 412</span>
              <span className="ld-receipt-sub">Job 0x2F, ResNet-mini</span>
            </div>
            <span className="ld-receipt-state">Settled</span>
          </div>
          <dl className="ld-receipt-meta">
            <div><dt>Replayed slice</dt><dd>3 of 16</dd></div>
            <div><dt>Tolerance</dt><dd>0.001</dd></div>
            <div><dt>Paid</dt><dd>5 nodes</dd></div>
          </dl>
          <ul className="ld-receipt-rows">
            {RECEIPT.map((r) => {
              const isOpen = open === r.op;
              return (
                <li key={r.op} className={r.ok ? "" : "is-fail"}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.op)}>
                    <span className="ld-mono">{r.op}</span>
                    <span className="ld-mono ld-receipt-delta">{r.delta}</span>
                    <span className="ld-receipt-verdict">{r.ok ? "+0.42 TOD" : "Slashed"}</span>
                  </button>
                  <div className="ld-receipt-why" hidden={!isOpen}>
                    {r.ok
                      ? "Re-running slice 3 from the committed seed reproduced these weights exactly. Paid in tx 0x7c1e…a93b."
                      : "Re-running slice 3 gave weights 0.314 away from what this node revealed, far above the 0.001 tolerance. Its stake covers the check."}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------- Sealed competition ---------- */

export function Sealed() {
  const [broken, setBroken] = useState(false);
  const field = useMemo(() => sealField(broken), [broken]);
  return (
    <section className="ld-feature ld-feature-flip">
      <div className="ld-wrap ld-feature-grid">
        <div className="ld-seal">
          <Mosaic field={field} label={broken ? "A broken seal: the labels no longer match the commit" : "A sealed commit"} cell={9} vocab={VOCAB_SHORT} twinkle={0.05} playKey={broken} duration={3} />
        </div>
        <div className="ld-feature-copy">
          <h2 className="ld-h2">Run a competition nobody can rig.</h2>
          <p className="ld-body">Commit your test labels before anyone trains. The commit is a hash on chain, so nobody, including you, can change the scoring afterwards.</p>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" className="ld-btn ld-btn-ghost" onClick={() => setBroken((b) => !b)}>
              {broken ? "Put the labels back" : "Change one label"}
            </button>
            <p className="ld-hint" aria-live="polite">{broken ? "Rejected. The new labels don't hash to the commit." : " "}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Terminal ---------- */

const TERM: { cmd?: string; out?: string; ok?: boolean }[] = [
  { cmd: "tod-node init --network base-sepolia" },
  { out: "operator key created  0x8a4F…19c2" },
  { cmd: "tod-node selftest" },
  { out: "mlp-exact  result hash matches byte for byte", ok: true },
  { cmd: "tod-node run" },
  { out: "round 412  trained shard 3 of 16" },
  { out: "committed 0xa3f9…  revealed" },
  { out: "replay matched  +0.42 TOD", ok: true },
];

export function Terminal() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      setShown(TERM.length);
      return;
    }
    let id = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      let n = 0;
      const tick = () => {
        n++;
        setShown(n);
        if (n < TERM.length) id = window.setTimeout(tick, TERM[n]?.cmd ? 700 : 380);
      };
      id = window.setTimeout(tick, 300);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(id);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TERM.filter((l) => l.cmd).map((l) => l.cmd).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false); // Clipboard blocked: the commands stay on screen to select by hand.
    }
  };

  return (
    <section className="ld-feature">
      <div className="ld-wrap ld-feature-grid">
        <div className="ld-feature-copy">
          <h2 className="ld-h2">Three commands and your laptop is in.</h2>
          <p className="ld-body">Set up a key, prove your machine trains byte for byte, then start. Stopping finishes any reveal it owes first, so it never costs you stake.</p>
        </div>
        <div ref={ref} className="ld-term">
          <div className="ld-term-bar">
            <span className="ld-term-dots" aria-hidden><i /><i /><i /></span>
            <button type="button" className="ld-term-copy" onClick={copy}>{copied ? "Copied" : "Copy commands"}</button>
          </div>
          <pre className="ld-term-body" aria-label="Terminal session setting up a node">
            {TERM.slice(0, shown).map((l, i) => (
              <div key={i} className={l.cmd ? "ld-term-cmd" : l.ok ? "ld-term-ok" : "ld-term-out"}>
                {l.cmd ? <><span aria-hidden>$ </span>{l.cmd}</> : l.out}
              </div>
            ))}
            {shown < TERM.length && <span className="ld-term-caret" aria-hidden />}
          </pre>
        </div>
      </div>
    </section>
  );
}

// Login: three sign-in layouts for wallet connect (poster split, full-bleed figure, terminal) and every connect state
// from components/connect.tsx (pick, approve, rejected, wrong network, ready) drawn in the mosaic language.
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Mosaic } from "@/components/mosaic/Mosaic";
import type { FieldFn } from "@/components/mosaic/engine";
import { coverById, figureField, sealField, useGray } from "@/components/mosaic/figures";
import { Section, usePalette } from "../shell";
import { WordSpinner } from "@/components/mosaic/widgets";

const WALLETS = [
  { id: "browser", name: "Browser wallet", note: "MetaMask, Rabby or another extension" },
  { id: "coinbase", name: "Coinbase Wallet", note: "The app or the extension" },
  { id: "phone", name: "Phone wallet", note: "Scan a code with WalletConnect" },
];

type Stage = "pick" | "approve" | "rejected" | "network" | "ready";
type Outcome = "approve" | "reject" | "network";

const STEP_OF: Record<Stage, number> = { pick: 0, approve: 1, rejected: 1, network: 2, ready: 3 };

function Steps({ stage }: { stage: Stage }) {
  const n = STEP_OF[stage];
  const labels = ["Pick", "Approve", "Network", "Ready"];
  return (
    <div className="mz-steps" aria-label={`Step ${Math.min(n + 1, 4)} of 4`}>
      {labels.map((l, i) => (
        <span key={l} data-s={stage === "rejected" && i === 1 ? "fail" : i < n ? "done" : i === n ? "active" : "todo"}>
          {l}
        </span>
      ))}
    </div>
  );
}

/** The connect card, interactive: pick a wallet and the chosen outcome plays out. */
function ConnectFlow({ outcome, boxed }: { outcome: Outcome; boxed?: boolean }) {
  const [stage, setStage] = useState<Stage>("pick");
  const [choice, setChoice] = useState(WALLETS[0]);
  useEffect(() => {
    if (stage !== "approve") return;
    const id = setTimeout(() => setStage(outcome === "reject" ? "rejected" : outcome === "network" ? "network" : "ready"), 1800);
    return () => clearTimeout(id);
  }, [stage, outcome]);
  const go = (w: (typeof WALLETS)[number]) => {
    setChoice(w);
    setStage("approve");
  };
  return (
    <div className={`mz-auth ${boxed ? "mz-auth-boxed" : ""}`}>
      <Steps stage={stage} />
      {stage === "pick" && (
        <>
          <h2 className="mz-auth-title">Connect a wallet</h2>
          <p className="mz-auth-lede">Your wallet is your account. ToD sees your address and nothing else.</p>
          <div style={{ display: "grid", gap: 4 }}>
            {WALLETS.map((w, i) => (
              <button key={w.id} type="button" className="mz-option" onClick={() => go(w)}>
                <span className="mz-option-key">{i + 1}</span>
                <span>
                  <span className="mz-option-name">{w.name}</span>
                  <br />
                  <span className="mz-option-note">{w.note}</span>
                </span>
                <span className="mz-option-arrow" aria-hidden>
                  →
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="mz-btn mz-btn-ghost" style={{ justifySelf: "start" }}>
            No wallet? Watch the demo
          </button>
        </>
      )}
      {stage === "approve" && (
        <>
          <h2 className="mz-auth-title">Approve in {choice.name}</h2>
          <p className="mz-auth-lede">Open {choice.name} and approve the request. ToD sees your address and nothing else.</p>
          <div className="mz-row">
            <WordSpinner />
            <span className="mz-fine">Waiting for your wallet</span>
          </div>
          <button type="button" className="mz-btn mz-btn-ghost" style={{ justifySelf: "start" }} onClick={() => setStage("pick")}>
            ← Pick another wallet
          </button>
        </>
      )}
      {stage === "rejected" && (
        <>
          <h2 className="mz-auth-title">Request declined</h2>
          <p className="mz-auth-lede">{choice.name} said no, so nothing was shared. Try again, or pick another wallet.</p>
          <div className="mz-row">
            <button type="button" className="mz-btn mz-btn-primary" onClick={() => setStage("approve")}>
              Try again
            </button>
            <button type="button" className="mz-btn mz-btn-ghost" onClick={() => setStage("pick")}>
              Pick another
            </button>
          </div>
        </>
      )}
      {stage === "network" && (
        <>
          <h2 className="mz-auth-title">Switch to Base Sepolia</h2>
          <p className="mz-auth-lede">Your wallet is on another network. Everything here runs on Base Sepolia, a test network. No real money moves.</p>
          <button type="button" className="mz-btn mz-btn-primary" style={{ justifySelf: "start" }} onClick={() => setStage("ready")}>
            Switch network
          </button>
        </>
      )}
      {stage === "ready" && (
        <>
          <h2 className="mz-auth-title">Connected</h2>
          <p className="mz-auth-lede">0x8a4F...91c2 on Base Sepolia. You can lend a laptop, post a job or host a competition.</p>
          <div className="mz-row">
            <button type="button" className="mz-btn mz-btn-primary">
              Continue <span className="mz-kbd">↵</span>
            </button>
            <button type="button" className="mz-btn mz-btn-ghost" onClick={() => setStage("pick")}>
              Start over
            </button>
          </div>
        </>
      )}
      <p className="mz-fine">Base Sepolia test network · by connecting you agree to the terms</p>
    </div>
  );
}

function Figure({ id, cell = 10, reveal = "dissolve", gain, cap, seed = 3, duration = Infinity, twinkle = 0.12 }: { id: string; cell?: number; reveal?: "radial" | "dissolve" | "none"; gain?: number; cap?: number; seed?: number; duration?: number; twinkle?: number }) {
  const pal = usePalette();
  const c = coverById(id);
  const g = useGray(c.src);
  const field = useMemo(() => figureField(g, c.fit, c.tone, reveal, c.focus, { gain, cap }), [g, c, reveal, gain, cap]);
  return <Mosaic field={field} label={`${c.title} mosaic`} cell={cell} seed={seed} palette={pal} playKey={g ? 1 : 0} duration={duration} twinkle={twinkle} />;
}

function TerminalLogin() {
  const pal = usePalette();
  const [on, setOn] = useState(0);
  const tex: FieldFn = useMemo(() => (tile, c) => (tile.r < 0.02 + 0.01 * Math.sin(c.t + tile.row) ? 0.2 : 0), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") setOn((v) => (v + 1) % 3);
      if (e.key === "ArrowUp") setOn((v) => (v + 2) % 3);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="mz-login">
      <Mosaic field={tex} label="Texture" cell={10} seed={21} palette={pal} duration={Infinity} twinkle={0.08} />
      <div className="mz-term">
        <div className="mz-term-box" role="group" aria-label="Terminal sign in">
          <div>
            <span className="mz-prompt">$</span> tod login
          </div>
          <div className="mz-dim">ToD 0.2.0 · base sepolia · node 0x8a4F...91c2</div>
          <div style={{ margin: "10px 0 6px" }}>Connect the wallet that owns this node:</div>
          {WALLETS.map((w, i) => (
            <div key={w.id} className="mz-term-row" data-on={on === i} onMouseEnter={() => setOn(i)}>
              <span>[{i + 1}]</span>
              <span>{w.name}</span>
              <span className="mz-dim">{w.note}</span>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <span className="mz-dim">↑↓ choose · enter open · q quit</span> <span className="mz-cursor" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StateTile({ tag, title, body, children, art }: { tag: string; title: string; body: ReactNode; children?: ReactNode; art: ReactNode }) {
  return (
    <div className="mz-state">
      {art}
      <span className="mz-state-tag">{tag}</span>
      <div className="mz-state-copy">
        <span className="mz-state-title">{title}</span>
        <span className="mz-state-body">{body}</span>
        {children}
      </div>
    </div>
  );
}

function Seal({ broken, play }: { broken: boolean; play: number }) {
  const pal = usePalette();
  const f = useMemo(() => sealField(broken), [broken]);
  return <Mosaic field={f} label={broken ? "Broken seal" : "Seal"} cell={9} seed={broken ? 41 : 40} palette={pal} playKey={play} />;
}

export function LoginPage() {
  const [outcome, setOutcome] = useState<Outcome>("approve");
  const [play, setPlay] = useState(0);
  return (
    <>
      <div className="mz-row" style={{ justifyContent: "space-between" }}>
        <span className="mz-label">Outcome after you pick a wallet</span>
        <div className="mz-seg" role="radiogroup" aria-label="Simulated outcome">
          {(["approve", "reject", "network"] as Outcome[]).map((o) => (
            <button key={o} type="button" className="mz-btn mz-btn-sm mz-btn-ghost" aria-pressed={outcome === o} onClick={() => setOutcome(o)}>
              {o === "network" ? "wrong network" : o}
            </button>
          ))}
        </div>
      </div>

      <Section title="A. Poster split" note="Recommended. The figure carries the brand on the left; the form stays plain and fast on the right.">
        <div className="mz-login mz-login-split">
          <div className="mz-login-art">
            <Figure id="crow" cell={10} />
            <span className="mz-wordmark">ToD</span>
            <p className="mz-tagline">
              Train on idle laptops.
              <br />
              <em>Paid for verified work.</em>
            </p>
          </div>
          <div className="mz-login-panel">
            <ConnectFlow key={outcome} outcome={outcome} />
          </div>
        </div>
      </Section>

      <Section title="B. Full-bleed figure" note="Louder. The card sits on the mosaic as a solid ink block, never frosted glass.">
        <div className="mz-login">
          <Figure id="tiger" cell={9} seed={8} />
          <span className="mz-wordmark">ToD</span>
          <div className="mz-login-center">
            <ConnectFlow key={outcome} outcome={outcome} boxed />
          </div>
        </div>
      </Section>

      <Section title="C. Terminal" note="For the CLI audience. Texture only, no figure; the arrow keys work here.">
        <TerminalLogin />
      </Section>

      <Section title="Connect states" note="One frame per state of components/connect.tsx. The figure tells you the state before the words do.">
        <div className="mz-row" style={{ marginBottom: 12 }}>
          <button type="button" className="mz-btn mz-btn-sm mz-btn-secondary" onClick={() => setPlay((p) => p + 1)}>
            Replay
          </button>
        </div>
        <div className="mz-states">
          <StateTile tag="pick" title="Connect a wallet" body="Three choices, one decision on this screen." art={<Figure id="crow" cell={8} reveal="dissolve" gain={0.45} cap={0.4} seed={12} />}>
            <button type="button" className="mz-btn mz-btn-sm mz-btn-primary">
              Browser wallet
            </button>
          </StateTile>
          <StateTile tag="approve" title="Approve in your wallet" body="The owl watches while the wallet decides." art={<Figure id="owl" cell={8} reveal="dissolve" seed={13} twinkle={0.4} />}>
            <WordSpinner />
          </StateTile>
          <StateTile tag="rejected" title="Request declined" body={<><b>Nothing was shared.</b> Try again or pick another wallet.</>} art={<Seal broken play={play} />}>
            <button type="button" className="mz-btn mz-btn-sm mz-btn-primary">
              Try again
            </button>
          </StateTile>
          <StateTile tag="network" title="Switch to Base Sepolia" body="Your wallet is on another network." art={<Figure id="heron" cell={8} reveal="none" gain={0.5} cap={0.45} seed={14} />}>
            <button type="button" className="mz-btn mz-btn-sm mz-btn-primary">
              Switch network
            </button>
          </StateTile>
          <StateTile tag="ready" title="Connected" body="0x8a4F...91c2 on Base Sepolia." art={<Seal broken={false} play={play} />}>
            <button type="button" className="mz-btn mz-btn-sm mz-btn-primary">
              Continue
            </button>
          </StateTile>
        </div>
      </Section>
    </>
  );
}

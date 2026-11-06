"use client";
// The World ID step: one proof that a single person stands behind this wallet. World App's code is drawn as bone tiles in a viewfinder, the seal assembles when the coordinator records the proof and cracks when it refuses. Demo and dev-identity modes walk the same states without World App.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { proofOfHuman, useIDKitRequest, type IDKitResult } from "@worldcoin/idkit/hooks";
import { ArrowUpRight, Check, RotateCcw, ScanFace, Smartphone } from "lucide-react";
import { More } from "@/components/flow";
import { Button, Pill, cx, short } from "@/components/primitives";
import { Mosaic } from "@/components/mosaic/Mosaic";
import { PosterThumb } from "@/components/mosaic/PosterCard";
import { VOCAB_SHORT, type FieldFn } from "@/components/mosaic/engine";
import { coverById, sealField } from "@/components/mosaic/figures";
import { TileProgress, TileScanner } from "@/components/mosaic/widgets";
import {
  CREDENTIAL_LABEL, DEMO_CONFIG, IdentityError, rpContext, signalFor, useHuman, useIdentityConfig, useSubmitProof,
  type Credential, type FailKind, type IdentityConfig, type RpContext, type Verified,
} from "@/lib/identity";

type Stage = "idle" | "signing" | "scan" | "confirm" | "submitting" | "verified" | "failed";
type Fail = { kind: FailKind | "replayed" | "no_credential"; detail: string };

const PLACEHOLDER_RP: RpContext = { rp_id: "", nonce: "", created_at: 0, expires_at: 0, signature: "" };

/** IDKit's own error codes, in the same words as the coordinator's. */
function idkitFail(code: string | null): Fail {
  switch (code) {
    case "user_rejected": return { kind: "cancelled", detail: "" };
    case "max_verifications_reached":
    case "nullifier_replayed": return { kind: "replayed", detail: "" };
    case "credential_unavailable":
    case "world_id_4_not_available": return { kind: "no_credential", detail: "" };
    case "connection_failed": return { kind: "unreachable", detail: "World App didn't answer." };
    case "rp_signature_expired":
    case "timestamp_too_old": return { kind: "expired", detail: "" };
    case "unknown_rp":
    case "inactive_rp":
    case "invalid_rp_signature": return { kind: "off", detail: code };
    default: return { kind: "failed", detail: code ?? "" };
  }
}

const COPY: Record<Fail["kind"], { title: string; body: (d: string) => ReactNode; crack: boolean; retry: boolean; word: string }> = {
  cancelled: { title: "Closed in World App", body: () => "Nothing was shared. Start again when you're ready.", crack: false, retry: true, word: "CANCELLED" },
  linked_elsewhere: { title: "You're already linked to another wallet", body: (d) => <>{d ? <>World ID says {d.replace(/^this World ID is /, "you're ")}.</> : "This person is already linked to another wallet."} Connect that wallet instead. One person, one wallet is what keeps the pool fair.</>, crack: true, retry: false, word: "IN USE" },
  wallet_taken: { title: "This wallet belongs to someone else", body: () => "A different person already verified with this wallet. Use a wallet of your own.", crack: true, retry: false, word: "TAKEN" },
  replayed: { title: "World has already counted you here", body: () => "Your World ID was already used for Tessera, probably with another wallet. Connect the wallet you verified with first.", crack: true, retry: false, word: "COUNTED" },
  no_credential: { title: "Your World ID isn't Orb-verified yet", body: () => <>Tessera needs the Orb level, because a seat earns money. Orb verification takes a few minutes at a World Orb. <a className="text-ink underline decoration-subtle underline-offset-4 hover:decoration-ink" href="https://world.org/find-orb" target="_blank" rel="noreferrer">Find one near you</a>.</>, crack: false, retry: true, word: "NO ORB" },
  rate_limited: { title: "Too many tries", body: () => "Wait a minute, then try again.", crack: false, retry: true, word: "WAIT" },
  off: { title: "World ID isn't set up here", body: (d) => `This coordinator can't sign World ID requests yet${d ? ` (${d})` : ""}. Ask whoever runs it.`, crack: false, retry: false, word: "OFF" },
  rejected: { title: "World couldn't confirm it", body: (d) => `The proof didn't check out${d ? `: ${d}` : ""}. Try once more.`, crack: true, retry: true, word: "REJECTED" },
  excluded: { title: "This wallet is excluded", body: (d) => d || "It was excluded from the pool after a confirmed failure.", crack: true, retry: false, word: "EXCLUDED" },
  dev_refused: { title: "Dev identity is local only", body: () => "This coordinator runs dev identity off the local chain, which it refuses. It needs real World ID here.", crack: false, retry: false, word: "LOCAL" },
  unreachable: { title: "Couldn't reach the check", body: (d) => d || "The coordinator didn't answer. Check your connection and try again.", crack: false, retry: true, word: "OFFLINE" },
  expired: { title: "The code expired", body: () => "Codes last five minutes, so a photo of one can't be reused. Get a fresh one.", crack: false, retry: true, word: "EXPIRED" },
  failed: { title: "Something went wrong", body: (d) => `It didn't go through${d ? ` (${d})` : ""}. Try again.`, crack: true, retry: true, word: "FAILED" },
};

export function HumanCheck({ compact, onVerified, intro }: { compact?: boolean; onVerified?: (v: Verified) => void; intro?: ReactNode }) {
  const human = useHuman();
  const cfgQ = useIdentityConfig();
  const cfg: IdentityConfig = cfgQ.data ?? DEMO_CONFIG;
  const owner = human.owner;
  const submitProof = useSubmitProof();
  const [stage, setStage] = useState<Stage>("idle");
  const [fail, setFail] = useState<Fail | null>(null);
  const [rp, setRp] = useState<RpContext | null>(null);
  const [demoUri, setDemoUri] = useState<string | null>(null);
  const [done, setDone] = useState<Verified | null>(null);
  const [opening, setOpening] = useState(0);
  const sent = useRef<unknown>(null);

  const idk = useIDKitRequest({
    app_id: (cfg.appId || "app_unset") as `app_${string}`,
    action: cfg.action,
    rp_context: rp ?? PLACEHOLDER_RP,
    allow_legacy_proofs: true,
    preset: proofOfHuman({ signal: owner ? signalFor(owner) : "" }),
    environment: cfg.environment === "production" || cfg.environment === "sandbox" ? cfg.environment : "staging",
    polling: { interval: 1000, timeout: 300_000 },
  });

  // Opened only after the RP signature is in state, so the request carries it.
  useEffect(() => { if (opening) idk.open(); }, [opening]);

  const failWith = (f: Fail) => { setFail(f); setStage("failed"); };
  const submit = async (proof: unknown, demoFail?: FailKind) => {
    if (!owner) return;
    setStage("submitting");
    try {
      const v = await submitProof(owner, proof, demoFail);
      setDone(v);
      setStage("verified");
      onVerified?.(v);
    } catch (e) {
      failWith(e instanceof IdentityError ? { kind: e.kind, detail: e.message } : { kind: "failed", detail: "" });
    }
  };

  // IDKit drives the live stages: code ready, waiting on the person's approval, a result, or an error.
  useEffect(() => {
    if (cfg.mode !== "worldid") return;
    if (idk.isError && (stage === "scan" || stage === "confirm" || stage === "signing")) { failWith(idkitFail(idk.errorCode)); idk.reset(); return; }
    if (idk.isSuccess && idk.result && sent.current !== idk.result) { sent.current = idk.result; void submit(idk.result as IDKitResult); return; }
    if (idk.isAwaitingUserConfirmation && stage === "scan") setStage("confirm");
    else if (idk.connectorURI && stage === "signing") setStage("scan");
  });

  const start = async () => {
    if (!owner) return;
    setFail(null);
    setStage("signing");
    if (cfg.mode === "dev") return void submit({});
    try {
      const ctx = await rpContext(cfg);
      setRp(ctx);
      if (cfg.mode === "demo") {
        setDemoUri(`https://world.org/verify?t=wld&i=${ctx.created_at.toString(36)}-${Math.random().toString(36).slice(2, 10)}&k=demo`);
        setStage("scan");
      } else {
        setOpening((n) => n + 1);
      }
    } catch (e) {
      failWith(e instanceof IdentityError ? { kind: e.kind, detail: e.message } : { kind: "failed", detail: "" });
    }
  };
  const again = () => { idk.reset(); setRp(null); setDemoUri(null); setFail(null); setStage("idle"); };

  // Codes are short-lived on purpose: when the RP signature runs out, the open request is dead.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const counting = (stage === "scan" || stage === "confirm") && !!rp;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [counting]);
  const left = rp ? Math.max(0, rp.expires_at - now) : 0;
  useEffect(() => {
    if (counting && left === 0) { idk.reset(); failWith({ kind: "expired", detail: "" }); }
  }, [counting, left]);

  const uri = cfg.mode === "demo" ? demoUri : idk.connectorURI;
  const alreadyVerified = human.verified && stage === "idle";
  const shownStage: Stage = alreadyVerified ? "verified" : stage;
  const credential: Credential | null = done?.credential ?? human.status?.credential ?? null;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  const meta: string[] = !owner
    ? ["ONE PERSON", "WORLD ID", "NO WALLET"]
    : shownStage === "scan" ? ["SCAN WITH", "WORLD APP", mmss]
    : shownStage === "confirm" ? ["CONFIRM IN", "WORLD APP", mmss]
    : shownStage === "submitting" ? ["CHECKING", "THE PROOF", short(owner)]
    : shownStage === "verified" ? ["VERIFIED", (credential ? CREDENTIAL_LABEL[credential] : "WORLD ID").toUpperCase(), short(owner)]
    : shownStage === "failed" && fail ? ["NOT VERIFIED", COPY[fail.kind].word, short(owner)]
    : ["ONE PERSON", cfg.mode === "dev" ? "DEV IDENTITY" : "WORLD ID · ORB", short(owner)];

  const art = (
    <StageArt stage={shownStage} uri={uri} crack={shownStage === "failed" && !!fail && COPY[fail.kind].crack} compact={compact} meta={meta} />
  );

  const copy = (() => {
    if (!owner) return { title: "Connect a wallet first", body: <>The proof is tied to one wallet, so World ID needs to know which.</> };
    switch (shownStage) {
      case "signing": return { title: "Getting a code", body: <TileScanner label="Asking the coordinator to sign a World ID request" count={compact ? 14 : 20} /> };
      case "scan": return {
        title: "Scan with World App",
        body: <>Open World App, tap the scanner and point it at the code. It asks you to confirm, and nothing else leaves your phone.</>,
      };
      case "confirm": return { title: "Confirm in World App", body: <>World App is asking you to approve. This page moves on by itself.</> };
      case "submitting": return { title: "Checking the proof", body: <>The coordinator is asking World to confirm the proof, then records one person for this wallet.</> };
      case "verified": return {
        title: alreadyVerified ? "You're verified" : "Verified. You're one person",
        body: <>This wallet is the only one tied to you. You won&apos;t be asked again: joining the pool and entering competitions both read this.</>,
      };
      case "failed": return fail ? { title: COPY[fail.kind].title, body: COPY[fail.kind].body(fail.detail) } : { title: "", body: null };
      default: return {
        title: "Prove you're one person",
        body: intro ?? <>One person, one seat. World ID proves you&apos;re a unique human without telling Tessera who you are, so nobody can run a fleet of fake laptops or enter a competition twice.</>,
      };
    }
  })();

  const actions = (() => {
    if (!owner) return null;
    if (shownStage === "idle") return (
      <Button variant="primary" icon={ScanFace} onClick={start}>{cfg.mode === "dev" ? "Verify with dev identity" : "Verify with World ID"}</Button>
    );
    if (shownStage === "scan" && uri) return (
      <a href={uri} className="inline-flex h-9 items-center gap-2 rounded-md border border-rule px-3 text-sm text-ink transition-colors hover:border-rule-strong hover:bg-hover md:hidden">
        <Smartphone className="size-4" strokeWidth={1.5} aria-hidden /> Open World App
      </a>
    );
    if (shownStage === "failed" && fail && COPY[fail.kind].retry) return <Button variant="primary" icon={RotateCcw} onClick={again}>Try again</Button>;
    if (shownStage === "failed") return <Button variant="ghost" onClick={again}>Back</Button>;
    return null;
  })();

  const demo = cfg.mode === "demo" && owner && (shownStage === "scan" || shownStage === "idle") && (
    <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-rule pt-4">
      {shownStage === "idle" && <Chip onClick={() => failWith({ kind: "no_credential", detail: "" })}>no Orb yet</Chip>}
      {shownStage === "scan" && (
        <>
          <Chip onClick={() => { setStage("confirm"); setTimeout(() => void submit({}), 1300); }}>approve in World App</Chip>
          <Chip onClick={() => failWith({ kind: "cancelled", detail: "" })}>cancel</Chip>
          <Chip onClick={() => { setStage("confirm"); setTimeout(() => void submit({}, "linked_elsewhere"), 900); }}>already linked</Chip>
          <Chip onClick={() => void submit({}, "rejected")}>proof rejected</Chip>
        </>
      )}
    </div>
  );

  const body = (
    <div key={shownStage + (fail?.kind ?? "")} className={cx("animate-step-in flex min-w-0 flex-col", compact ? "gap-3" : "gap-6")}>
      <div className="flex flex-col gap-2">
        {!compact && <span className="font-mono text-xs uppercase tracking-wide text-mosaic">World ID · {cfg.mode === "dev" ? "dev identity, local chain" : "checked once"}</span>}
        {/* Inside a wizard the step already carries the idle title. */}
        {!(compact && shownStage === "idle") && <h2 className={cx("text-balance font-medium tracking-tight text-ink", compact ? "text-lg" : "text-xl")}>{copy.title}</h2>}
        <div className="max-w-md text-sm leading-relaxed text-muted">{copy.body}</div>
      </div>
      {counting && (
        <div className="flex max-w-sm flex-col gap-1.5">
          <TileProgress value={left / 300} label="Time left on this code" count={compact ? 14 : 20} seed={11} />
          <span className="font-mono text-xs tabular text-subtle">{mmss} left on this code</span>
        </div>
      )}
      {shownStage === "verified" && credential && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="ok">one person</Pill>
          <Pill tone={credential === "orb" ? "neutral" : "warn"}>{CREDENTIAL_LABEL[credential]}</Pill>
        </div>
      )}
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      {!compact && shownStage !== "verified" && (
        <More label="What does World ID see?">
          <p>World learns that a verified person approved a request from Tessera. Tessera learns one number that is the same every time you prove yourself here, and different in every other app. No name, no face, no address.</p>
          <p>The proof names this wallet, so it can&apos;t be copied to another one. If you lose this wallet, the number stays tied to it until whoever runs the coordinator moves it.</p>
        </More>
      )}
      {demo}
    </div>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative aspect-square w-full max-w-56 shrink-0 overflow-hidden border border-rule bg-sunken sm:w-48">{art}</div>
        {body}
      </div>
    );
  }
  return (
    <section aria-label="Prove you're one person" className="grid overflow-hidden border border-rule bg-card md:grid-cols-2">
      <div className="relative aspect-square border-b border-rule bg-sunken md:aspect-auto md:min-h-120 md:border-b-0 md:border-r">{art}</div>
      <div className="flex flex-col justify-center p-6 md:p-10">{body}</div>
    </section>
  );
}

/** The left panel: the owl watching while you get ready, the code in a viewfinder, then the seal. */
function StageArt({ stage, uri, crack, compact, meta }: { stage: Stage; uri: string | null; crack: boolean; compact?: boolean; meta: string[] }) {
  const sealing = stage === "confirm" || stage === "submitting";
  const seal = useMemo<FieldFn>(() => {
    const f = sealField(crack);
    // While the proof is checked the seal hangs at a low level, so it reads as forming, not formed.
    return sealing ? (tile, c) => { const v = f(tile, { ...c, t: Math.min(c.t, 0.85) }); return v > 0 ? v * 0.42 : v; } : f;
  }, [crack, sealing]);
  const cell = compact ? 5 : 8;
  return (
    <>
      {(stage === "idle" || stage === "signing" || stage === "scan") && (
        <PosterThumb cover={coverById("owl")} live={stage !== "scan"} hold={stage === "scan"} label="Night Owl poster" cell={compact ? 4 : 7} className={cx("absolute inset-0 transition-opacity duration-300", stage === "scan" && "opacity-40")} />
      )}
      {(sealing || stage === "verified" || stage === "failed") && (
        <div className="absolute inset-0">
          <Mosaic key={stage + String(crack)} field={seal} label={stage === "verified" ? "Seal: verified" : stage === "failed" ? "Seal: not verified" : "Seal forming"} vocab={VOCAB_SHORT} cell={cell} seed={41} twinkle={sealing ? 0.2 : 0.08} duration={stage === "failed" || stage === "verified" ? 2.2 : Infinity} />
        </div>
      )}
      {(stage === "signing" || stage === "scan") && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Viewfinder ready={stage === "scan"} size={compact ? 150 : 236}>
            {stage === "scan" && uri && <TileQR value={uri} />}
          </Viewfinder>
        </div>
      )}
      {stage === "verified" && (
        <span className="hq-stamp absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-xs bg-bone text-brand-ink" aria-hidden>
          <Check className="size-5" strokeWidth={2.5} />
        </span>
      )}
      {!compact && (
        <>
          <p aria-hidden className="pointer-events-none absolute left-5 top-4 select-none text-2xl font-medium leading-none tracking-tight text-field">One<br />person.</p>
          <dl className="absolute bottom-4 left-5 flex flex-col font-mono text-xs uppercase leading-relaxed tracking-wide text-ink">
            {meta.map((m, i) => (
              <dd key={`${i}-${m}`} className="animate-step-in" style={{ animationDelay: `${i * 70}ms` }}>
                <span className={cx("px-1", i > 0 ? "bg-surface/60" : stage === "verified" ? "bg-bone text-brand-ink" : stage === "failed" && crack ? "bg-mosaic text-brand-ink" : "bg-surface")}>{m}</span>
              </dd>
            ))}
          </dl>
        </>
      )}
    </>
  );
}

/** Four vermilion corners and a stepped scan line. The corners close in once the code is ready. */
function Viewfinder({ ready, size, children }: { ready: boolean; size: number; children?: ReactNode }) {
  return (
    <div className={cx("hq-finder relative", ready && "hq-ready")} style={{ width: size, height: size }}>
      {(["tl", "tr", "bl", "br"] as const).map((k) => <span key={k} className={`hq-corner hq-${k}`} aria-hidden />)}
      <div className="absolute inset-4">{children}</div>
      {ready && <span className="hq-scan" aria-hidden />}
    </div>
  );
}

/** World App's link as a QR made of bone tiles. Modules light ring by ring from the centre, in steps. */
function TileQR({ value }: { value: string }) {
  const q = useMemo(() => {
    const m = QRCode.create(value, { errorCorrectionLevel: "M" }).modules;
    const n = m.size;
    const mid = (n - 1) / 2;
    const cells: { x: number; y: number; d: number }[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (m.data[y * n + x]) cells.push({ x, y, d: Math.floor((Math.max(Math.abs(x - mid), Math.abs(y - mid)) / (mid + 1)) * 8) });
    }
    return { n, cells };
  }, [value]);
  const pad = 2;
  const box = q.n + pad * 2;
  return (
    <svg key={value} viewBox={`0 0 ${box} ${box}`} role="img" aria-label="World ID code. Scan it with World App." className="size-full" shapeRendering="crispEdges">
      <rect width={box} height={box} fill="var(--mz-l7)" className="hq-paper" />
      {q.cells.map((c) => (
        <rect key={`${c.x}.${c.y}`} x={c.x + pad + 0.04} y={c.y + pad + 0.04} width={0.92} height={0.92} fill="var(--mz-ground)" className="hq-mod" style={{ animationDelay: `${120 + c.d * 55}ms` }} />
      ))}
    </svg>
  );
}

function Chip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-7 items-center rounded-md border border-dashed border-demo px-2 font-mono text-xs text-demo hover:bg-hover">
      demo: {children}
    </button>
  );
}

/** A small "one person" status for menus and rows: verified with its credential, or the way to get there. */
export function HumanBadge({ href = "/welcome" }: { href?: string }) {
  const h = useHuman();
  if (!h.owner) return null;
  if (h.loading) return <span className="font-mono text-xs text-subtle">checking</span>;
  if (h.verified) return <Pill tone="ok">{h.status?.credential ? `one person · ${CREDENTIAL_LABEL[h.status.credential]}` : "one person"}</Pill>;
  return (
    <a href={href} className="inline-flex items-center gap-1 text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-ink">
      Verify you&apos;re one person <ArrowUpRight className="size-3.5" aria-hidden />
    </a>
  );
}

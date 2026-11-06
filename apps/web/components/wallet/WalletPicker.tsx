"use client";
// The wallet step: the wallets installed in this browser (EIP-6963) first, then the common ones that aren't installed, as install links. Approve in one, land on the app's network; the page or sheet around it decides where to go next.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, Download, Smartphone, Wallet } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { demoOutcome } from "@/lib/tx";
import { isDemo } from "@/lib/api/client";
import { GET_WALLETS, networkName, subscribeWallets, walletsServerSnapshot, walletsSnapshot, type WalletInfo } from "@/lib/chain/discover";
import { Button, TileBusy, cx } from "@/components/primitives";
import { More } from "@/components/flow";

/** Demo mode has no extensions to find, so it lists the usual three and walks the same screens. */
const DEMO_WALLETS: WalletInfo[] = [
  { id: "demo-mm", name: "MetaMask", icon: null, rdns: "io.metamask" },
  { id: "demo-cb", name: "Coinbase Wallet", icon: null, rdns: "com.coinbase.wallet" },
  { id: "demo-ph", name: "Phantom", icon: null, rdns: "app.phantom" },
];
const DEMO_SNAP = { wallets: DEMO_WALLETS, settled: true };
const noSub = () => () => {};
const demoSnap = () => DEMO_SNAP;
/** Always offered, installed or not. */
const OFFERED = GET_WALLETS.filter((g) => g.rdns !== "io.rabby");

type Stage = "pick" | "approve" | "rejected";
type View = Stage | "pending" | "failed" | "network" | "ready";

/** `plain` drops the card, for a host that already frames it (the sign-in sheet). */
export function WalletPicker({ title = "Connect a wallet", lede, eyebrow, plain }: { title?: string; lede?: string; eyebrow?: string; plain?: boolean }) {
  const w = useWallet();
  const found = useSyncExternalStore(isDemo ? noSub : subscribeWallets, isDemo ? demoSnap : walletsSnapshot, walletsServerSnapshot);
  const [stage, setStage] = useState<Stage>("pick");
  const [choice, setChoice] = useState<WalletInfo | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const pick = (o: WalletInfo) => {
    setChoice(o);
    setStage("approve");
    if (!isDemo) return w.connect(o.rdns);
    // Demo stands in for the extension's own popup.
    timer.current = setTimeout(() => {
      if (demoOutcome() === "reject") return setStage("rejected");
      w.connect(o.rdns);
    }, 1400);
  };
  const back = () => { if (timer.current) clearTimeout(timer.current); setStage("pick"); };

  const err = w.connectError;
  const shown = choice ?? w.walletInfo;
  const view: View =
    w.connected && w.wrongNetwork ? "network"
    : w.connected ? "ready"
    : stage === "approve" && err?.kind === "rejected" ? "rejected"
    : stage === "approve" && err?.kind === "pending" ? "pending"
    : stage === "approve" && err ? "failed"
    : stage;
  const net = networkName(w.targetChainId);
  const installed = found.wallets;
  const missing = OFFERED.filter((g) => !installed.some((i) => i.rdns === g.rdns));
  const none = found.settled && !installed.length;
  const heading = view === "pick" ? (none ? "Get a wallet to sign in" : title) : HEAD[view];
  const sub = view === "pick" ? (none ? NONE_LEDE : lede ?? LEDE.pick(shown, net)) : LEDE[view](shown, net);

  return (
    <section aria-labelledby="wallet-title" className={cx(!plain && "border border-rule bg-card")}>
      <div key={view} className={cx("animate-step-in flex flex-col gap-6", !plain && "max-w-xl p-6 md:p-8")}>
        <div className="flex items-start gap-3">
          {(view === "approve" || view === "rejected" || view === "pending" || view === "failed") && (
            <button type="button" onClick={back} aria-label="Back to wallets" className="-ml-2 mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink">
              <ArrowLeft className="size-4" />
            </button>
          )}
          <div className="flex min-w-0 flex-col gap-2">
            {eyebrow && <span className="font-mono text-xs uppercase tracking-wide text-mosaic">{eyebrow}</span>}
            <h2 id="wallet-title" className={cx("text-balance font-medium tracking-tight text-ink", plain ? "text-2xl" : "text-xl")}>{heading}</h2>
            <p className="max-w-md text-sm leading-relaxed text-muted">{sub}</p>
          </div>
        </div>

        {view === "pick" && (
          found.settled ? (
            <div className="flex flex-col gap-5">
              {installed.length > 0 && (
                <ul className="flex flex-col gap-2" aria-label="Wallets in this browser">
                  {installed.map((o, i) => (
                    <li key={o.id} className="animate-step-in" style={{ animationDelay: `${i * 60}ms` }}>
                      <Row onClick={() => pick(o)} mark={<WalletMark icon={o.icon} name={o.name} />} name={o.name}
                        note={w.walletInfo?.rdns === o.rdns ? "Used last time" : "Installed"} noteTone="ok" />
                    </li>
                  ))}
                </ul>
              )}
              {missing.length > 0 && (
                <div className="flex flex-col gap-2">
                  {installed.length > 0 && <span className="font-mono text-xs uppercase tracking-wide text-subtle">Other wallets</span>}
                  <ul className="flex flex-col gap-2" aria-label="Wallets you can install">
                    {missing.map((g, i) => (
                      <li key={g.rdns} className="animate-step-in" style={{ animationDelay: `${(installed.length + i) * 60}ms` }}>
                        <Row href={g.href} mark={<WalletMark icon={null} name={g.name} />} name={g.name} note="Not installed · get it" install />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {none && <PhoneHint />}
            </div>
          ) : (
            <div className="flex items-center gap-3 py-2 text-sm text-subtle" role="status"><TileBusy /> Looking for wallets in this browser</div>
          )
        )}

        {(view === "approve" || view === "pending") && (
          <div className="flex flex-col items-start gap-5">
            <WalletMark icon={shown?.icon ?? null} name={shown?.name ?? "Wallet"} large />
            <p className="flex items-center gap-3 text-sm text-subtle" role="status"><TileBusy /> {view === "pending" ? "Still waiting" : "Waiting"} for {shown?.name ?? "your wallet"}</p>
            {view === "pending" && <Button variant="ghost" onClick={() => shown && pick(shown)}>Ask again</Button>}
          </div>
        )}

        {(view === "rejected" || view === "failed") && (
          <div className="flex flex-col gap-4">
            {view === "failed" && err && <p className="border border-rule bg-raised px-3 py-2 font-mono text-xs text-muted">{err.message}</p>}
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => shown && pick(shown)}>Try again</Button>
              <Button variant="ghost" onClick={back}>Pick another wallet</Button>
            </div>
          </div>
        )}

        {view === "network" && (
          <div className="flex flex-col gap-4">
            {err && <p className="text-sm text-warn" role="alert">{err.message}</p>}
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={w.switchNetwork}>Switch to {net}</Button>
              <Button variant="ghost" onClick={() => { w.disconnect(); setStage("pick"); }}>Disconnect</Button>
            </div>
          </div>
        )}

        {view === "ready" && (
          <div className="flex items-center gap-4" role="status">
            <span className="hq-stamp inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-ink text-brand-ink">
              <Check className="size-6" aria-hidden />
            </span>
            <p className="break-all font-mono text-sm text-muted">{w.address}</p>
          </div>
        )}

        {view === "pick" && !plain && (
          <More label="New to wallets?">
            <p>A wallet holds the keys to your account. Tessera never sees them: every payment, stake or claim opens in the wallet and waits for you to approve it.</p>
            <p>This is a test network. Any wallet works, and the money on it is test money you can get for free.</p>
          </More>
        )}
      </div>
    </section>
  );
}

/** One wallet row: a button for an installed wallet, a link out for one to install. */
function Row({ onClick, href, mark, name, note, noteTone, install }: { onClick?: () => void; href?: string; mark: ReactNode; name: string; note: string; noteTone?: "ok"; install?: boolean }) {
  const cls = cx(
    "group flex w-full items-center gap-4 border px-4 py-3 text-left transition-colors duration-150 ease-out",
    install ? "border-dashed border-rule hover:border-rule-strong hover:bg-hover" : "border-rule bg-raised hover:border-rule-strong hover:bg-hover",
  );
  const inner = (
    <>
      {mark}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx("text-sm", install ? "text-muted group-hover:text-ink" : "text-ink")}>{name}</span>
        <span className={cx("text-xs", noteTone === "ok" ? "text-ok" : "text-subtle")}>{note}</span>
      </span>
      {install
        ? <Download className="size-4 text-subtle transition-transform duration-150 ease-out group-hover:translate-y-0.5 group-hover:text-ink" aria-hidden />
        : <ArrowUpRight className="size-4 text-subtle transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />}
    </>
  );
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}<span className="sr-only"> (opens the install page)</span></a>
    : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

/** The wallet's own icon from its announcement; otherwise a mono initial on a dark tile. */
function WalletMark({ icon, name, large }: { icon: string | null; name: string; large?: boolean }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center bg-brand-ink text-mosaic", large ? "size-16 rounded-xl" : "size-10 rounded-md")}>
      {icon
        ? <img src={icon} alt="" className={large ? "size-9" : "size-6"} />
        : name === "Wallet" ? <Wallet className="size-5" strokeWidth={1.5} aria-hidden />
        : <span aria-hidden className={cx("font-mono font-medium", large ? "text-xl" : "text-sm")}>{name[0]}</span>}
    </span>
  );
}

/** Phones have no extensions: a wallet app's own browser is the way in. */
function PhoneHint() {
  const [here, setHere] = useState("");
  useEffect(() => setHere(window.location.host + window.location.pathname + window.location.search), []);
  return (
    <div className="flex flex-col gap-2">
      <a href={`https://metamask.app.link/dapp/${here}`} className="inline-flex items-center gap-2 self-start text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-ink">
        <Smartphone className="size-4" aria-hidden /> On a phone? Open this page in MetaMask
      </a>
      <p className="text-xs text-subtle">After installing a wallet, reload this page and it shows up at the top.</p>
    </div>
  );
}

const HEAD: Record<Exclude<View, "pick">, string> = {
  approve: "Approve in your wallet", pending: "Finish in your wallet", rejected: "The request was closed",
  failed: "The wallet didn't connect", network: "Switch network", ready: "Wallet connected",
};
const NONE_LEDE = "Tessera works with any browser wallet. Install one, then come back. Your wallet is your login, so there's no account to make.";

const LEDE: Record<View, (choice: WalletInfo | null, net: string) => string> = {
  pick: () => "It pays, stakes and collects. Nothing moves without your approval.",
  approve: (c) => `Open ${c?.name ?? "your wallet"} and approve the request. Tessera sees your address and nothing else.`,
  pending: (c) => `${c?.name ?? "Your wallet"} already has a request open for this site. Click its icon in your browser's toolbar to finish it.`,
  rejected: () => "Nothing was shared. Try again, or pick a different wallet.",
  failed: (c) => `${c?.name ?? "Your wallet"} answered with an error. Trying again usually works; if it doesn't, unlock the wallet first.`,
  network: (_c, net) => `Your wallet is on another network. Everything here runs on ${net}.`,
  ready: (_c, net) => `You're on ${net}. Taking you to the next step.`,
};

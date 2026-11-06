"use client";
// Wallet connect as a short modal, one decision per screen: pick one of the wallets installed in this browser (found through EIP-6963), approve in it, land on the app's network. It closes itself once the wallet is ready. Any button that needs a wallet opens it through openConnect().
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowUpRight, Check, Smartphone, Wallet, X } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { demoOutcome } from "@/lib/tx";
import { isDemo } from "@/lib/api/client";
import { GET_WALLETS, networkName, subscribeWallets, walletsServerSnapshot, walletsSnapshot, type WalletInfo } from "@/lib/chain/discover";
import { Button, cx, TileBusy } from "./primitives";
import { More } from "./flow";

let isOpen = false;
const subs = new Set<() => void>();
const emit = (v: boolean) => { isOpen = v; subs.forEach((f) => f()); };
export const openConnect = () => emit(true);
const closeConnect = () => emit(false);

/** Demo mode has no extensions to find, so it lists the usual three and walks the same screens. */
const DEMO_WALLETS: WalletInfo[] = [
  { id: "demo-mm", name: "MetaMask", icon: null, rdns: "io.metamask" },
  { id: "demo-cb", name: "Coinbase Wallet", icon: null, rdns: "com.coinbase.wallet" },
  { id: "demo-ph", name: "Phantom", icon: null, rdns: "app.phantom" },
];

type Stage = "pick" | "approve" | "rejected";
type View = Stage | "pending" | "failed" | "network" | "ready" | "none";

function useDiscovery() {
  const live = useSyncExternalStore(isDemo ? noSub : subscribeWallets, isDemo ? demoSnap : walletsSnapshot, walletsServerSnapshot);
  return live;
}
const noSub = () => () => {};
const DEMO_SNAP = { wallets: DEMO_WALLETS, settled: true };
const demoSnap = () => DEMO_SNAP;

export function ConnectDialog() {
  const open = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => isOpen, () => false);
  const ref = useRef<HTMLDialogElement>(null);
  const w = useWallet();
  const found = useDiscovery();
  const [stage, setStage] = useState<Stage>("pick");
  const [choice, setChoice] = useState<WalletInfo | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setStage("pick"); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  // Ready means connected on the right chain; anything short of that keeps the dialog up on the step that is missing.
  useEffect(() => {
    if (open && w.connected && !w.wrongNetwork && stage === "approve") {
      const t = setTimeout(closeConnect, 900);
      return () => clearTimeout(t);
    }
  }, [open, w.connected, w.wrongNetwork, stage]);
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
    : w.connected && stage === "approve" ? "ready"
    : stage === "approve" && err?.kind === "rejected" ? "rejected"
    : stage === "approve" && err?.kind === "pending" ? "pending"
    : stage === "approve" && err ? "failed"
    : stage === "pick" && found.settled && !found.wallets.length ? "none"
    : stage;
  const net = networkName(w.targetChainId);

  return (
    <dialog
      ref={ref}
      aria-labelledby="connect-title"
      onClose={closeConnect}
      onClick={(e) => { if (e.target === e.currentTarget) closeConnect(); }}
      className="connect-dialog m-auto w-dialog rounded-xl border border-rule bg-surface p-0 text-ink shadow-2xl"
    >
      <div key={view} className="animate-step-in flex flex-col gap-8 p-7">
        <div className="flex items-start gap-3">
          {(view === "approve" || view === "rejected" || view === "pending" || view === "failed") && (
            <button type="button" onClick={back} aria-label="Back to wallets" className="-ml-2 inline-flex size-9 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink">
              <ArrowLeft className="size-4" />
            </button>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h2 id="connect-title" className="text-lg font-semibold text-ink">{TITLE[view]}</h2>
            <p className="text-sm leading-relaxed text-muted">{lede(view, shown, net)}</p>
          </div>
          <button type="button" onClick={closeConnect} aria-label="Close" className="-mr-2 inline-flex size-9 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        {view === "pick" && (
          <>
            {found.settled ? (
              <ul className="flex flex-col gap-2" aria-label="Wallets in this browser">
                {found.wallets.map((o, i) => (
                  <li key={o.id} className="animate-step-in" style={{ animationDelay: `${i * 60}ms` }}>
                    <button
                      type="button"
                      onClick={() => pick(o)}
                      className="group flex w-full items-center gap-4 rounded-lg border border-rule bg-raised px-4 py-3.5 text-left transition-colors hover:border-rule-strong hover:bg-hover"
                    >
                      <WalletMark wallet={o} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm text-ink">{o.name}</span>
                        <span className="text-sm text-subtle">{w.walletInfo?.rdns === o.rdns ? "Used last time" : "Installed"}</span>
                      </span>
                      <ArrowUpRight className="size-4 text-subtle transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 py-2 text-sm text-subtle" role="status"><TileBusy /> Looking for wallets in this browser</div>
            )}
            <More label="New to wallets?">
              <p>A wallet holds the keys to your account. Tessera never sees them: every payment, stake or claim opens in the wallet and waits for you to approve it.</p>
              <p>This is a test network. Any wallet works, and the money on it is test money you can get for free.</p>
            </More>
          </>
        )}

        {view === "none" && <GetAWallet />}

        {(view === "approve" || view === "pending") && (
          <div className="flex flex-col items-center gap-6 py-6 text-center">
            <span className="inline-flex size-16 items-center justify-center rounded-xl bg-brand-ink text-mosaic">
              {shown?.icon ? <img src={shown.icon} alt="" className="size-9" /> : <Wallet className="size-7" strokeWidth={1.5} aria-hidden />}
            </span>
            <p className="flex items-center gap-3 text-sm text-subtle" role="status"><TileBusy /> {view === "pending" ? "Still waiting" : "Waiting"} for {shown?.name ?? "your wallet"}</p>
            {view === "pending" && <Button variant="ghost" onClick={() => shown && pick(shown)}>Ask again</Button>}
          </div>
        )}

        {(view === "rejected" || view === "failed") && (
          <div className="flex flex-col gap-4">
            {view === "failed" && err && <p className="rounded-md border border-rule bg-raised px-3 py-2 font-mono text-xs text-muted">{err.message}</p>}
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
          <div className="flex flex-col items-center gap-4 py-6 text-center" role="status">
            <span className="hq-stamp inline-flex size-16 items-center justify-center rounded-xl bg-ink text-brand-ink">
              <Check className="size-7" aria-hidden />
            </span>
            <p className={cx("break-all font-mono text-sm text-muted")}>{w.address}</p>
          </div>
        )}
      </div>
    </dialog>
  );
}

/** The wallet's own icon from its announcement, else a plain tile. */
function WalletMark({ wallet }: { wallet: WalletInfo }) {
  return (
    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-ink text-mosaic">
      {wallet.icon ? <img src={wallet.icon} alt="" className="size-6" /> : <Wallet className="size-5" strokeWidth={1.5} aria-hidden />}
    </span>
  );
}

/** No extension here. On a phone, a wallet app's own browser is the way in; on desktop, install one. */
function GetAWallet() {
  const [here, setHere] = useState("");
  useEffect(() => setHere(window.location.host + window.location.pathname), []);
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-2">
        {GET_WALLETS.map((g) => (
          <li key={g.rdns}>
            <a href={g.href} target="_blank" rel="noreferrer" className="group flex items-center justify-between gap-2 rounded-lg border border-rule bg-raised px-3 py-3 text-sm text-ink transition-colors hover:border-rule-strong hover:bg-hover">
              {g.name}
              <ArrowUpRight className="size-4 text-subtle transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      <a href={`https://metamask.app.link/dapp/${here}`} className="inline-flex items-center gap-2 self-start text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-ink">
        <Smartphone className="size-4" aria-hidden /> On a phone? Open this page in MetaMask
      </a>
      <p className="text-sm text-subtle">After installing, reload this page and it will show up here.</p>
    </div>
  );
}

const TITLE: Record<View, string> = {
  pick: "Connect a wallet", none: "No wallet in this browser", approve: "Approve in your wallet", pending: "Finish in your wallet",
  rejected: "The request was closed", failed: "The wallet didn't connect", network: "Switch network", ready: "Connected",
};

function lede(view: View, choice: WalletInfo | null, net: string) {
  const name = choice?.name ?? "your wallet";
  switch (view) {
    case "pick": return "It pays, stakes and collects. Nothing moves without your approval.";
    case "none": return "Tessera works with any browser wallet. Install one, then come back. Your wallet is your login, so there's no account to make.";
    case "approve": return `Open ${name} and approve the request. Tessera sees your address and nothing else.`;
    case "pending": return `${name} already has a request open for this site. Click its icon in your browser's toolbar to finish it.`;
    case "rejected": return "Nothing was shared. Try again, or pick a different wallet.";
    case "failed": return `${name} answered with an error. Trying again usually works; if it doesn't, unlock the wallet first.`;
    case "network": return `Your wallet is on another network. Everything here runs on ${net}.`;
    case "ready": return `You're on ${net}.`;
  }
}

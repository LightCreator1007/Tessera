"use client";
// Wallet connect as a short modal, one decision per screen: pick a wallet, approve in it, land on Base Sepolia. It closes itself once the wallet is ready. Any button that needs a wallet opens it through openConnect().
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppWindow, ArrowLeft, Check, Loader2, Smartphone, Wallet, X, type LucideIcon } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { demoOutcome } from "@/lib/tx";
import { isDemo } from "@/lib/api/client";
import { Button, cx, TileBusy } from "./primitives";
import { More } from "./flow";

let isOpen = false;
const subs = new Set<() => void>();
const emit = (v: boolean) => { isOpen = v; subs.forEach((f) => f()); };
export const openConnect = () => emit(true);
const closeConnect = () => emit(false);

type Option = { id: string; name: string; note: string; icon: LucideIcon };
const OPTIONS: Option[] = [
  { id: "browser", name: "Browser wallet", note: "MetaMask, Rabby or another extension", icon: AppWindow },
  { id: "coinbase", name: "Coinbase Wallet", note: "The app or the extension", icon: Wallet },
  { id: "walletconnect", name: "Phone wallet", note: "Scan a code with WalletConnect", icon: Smartphone },
];

export function ConnectDialog() {
  const open = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => isOpen, () => false);
  const ref = useRef<HTMLDialogElement>(null);
  const w = useWallet();
  const [stage, setStage] = useState<"pick" | "approve" | "rejected">("pick");
  const [choice, setChoice] = useState<Option | null>(null);
  const [hasExtension, setHasExtension] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setHasExtension(isDemo || "ethereum" in window), []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setStage("pick"); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  // Ready means connected on the right chain; anything short of that keeps the dialog up on the step that is missing.
  useEffect(() => {
    if (open && w.connected && !w.wrongNetwork && stage === "approve") {
      const t = setTimeout(closeConnect, 700);
      return () => clearTimeout(t);
    }
  }, [open, w.connected, w.wrongNetwork, stage]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const pick = (o: Option) => {
    setChoice(o);
    setStage("approve");
    timer.current = setTimeout(() => {
      if (demoOutcome() === "reject") return setStage("rejected");
      w.connect();
    }, 1400);
  };
  const back = () => { if (timer.current) clearTimeout(timer.current); setStage("pick"); };
  const view = w.connected && w.wrongNetwork ? "network" : w.connected && stage === "approve" ? "ready" : stage;

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
          {(view === "approve" || view === "rejected") && (
            <button type="button" onClick={back} aria-label="Back to wallets" className="-ml-2 inline-flex size-9 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink">
              <ArrowLeft className="size-4" />
            </button>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h2 id="connect-title" className="text-lg font-semibold text-ink">{TITLE[view]}</h2>
            <p className="text-sm leading-relaxed text-muted">{lede(view, choice)}</p>
          </div>
          <button type="button" onClick={closeConnect} aria-label="Close" className="-mr-2 inline-flex size-9 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        {view === "pick" && (
          <>
            <ul className="flex flex-col gap-2">
              {OPTIONS.map((o) => {
                const missing = o.id === "browser" && !hasExtension;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={missing}
                      onClick={() => pick(o)}
                      className="flex w-full items-center gap-4 rounded-lg border border-rule bg-raised px-4 py-3.5 text-left transition-colors hover:border-rule-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-ink text-mosaic">
                        <o.icon className="size-5" strokeWidth={1.5} aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm text-ink">{o.name}</span>
                        <span className="text-sm text-subtle">{missing ? "None found in this browser" : o.note}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <More label="New to wallets?">
              <p>A wallet holds the keys to your account. ToD never sees them: every payment, stake or claim opens in the wallet and waits for you to approve it.</p>
              <p>This is a test network. Any wallet works, and the money on it is test money you can get for free.</p>
            </More>
          </>
        )}

        {view === "approve" && (
          <div className="flex flex-col items-center gap-6 py-6 text-center">
            <span className="inline-flex size-16 items-center justify-center rounded-xl bg-brand-ink text-mosaic">
              <TileBusy />
            </span>
            <p className="text-sm text-subtle" role="status">Waiting for {choice?.name ?? "your wallet"}</p>
          </div>
        )}

        {view === "rejected" && (
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => choice && pick(choice)}>Try again</Button>
            <Button variant="ghost" onClick={back}>Pick another wallet</Button>
          </div>
        )}

        {view === "network" && (
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={w.switchNetwork}>Switch to Base Sepolia</Button>
            <Button variant="ghost" onClick={() => { w.disconnect(); setStage("pick"); }}>Disconnect</Button>
          </div>
        )}

        {view === "ready" && (
          <div className="flex flex-col items-center gap-4 py-6 text-center" role="status">
            <span className="inline-flex size-16 items-center justify-center rounded-xl bg-ink text-brand-ink">
              <Check className="size-7" aria-hidden />
            </span>
            <p className={cx("font-mono text-sm text-muted")}>{w.address}</p>
          </div>
        )}
      </div>
    </dialog>
  );
}

const TITLE = { pick: "Connect a wallet", approve: "Approve in your wallet", rejected: "The request was closed", network: "Switch network", ready: "Connected" } as const;

function lede(view: keyof typeof TITLE, choice: Option | null) {
  switch (view) {
    case "pick": return "It pays, stakes and collects. Nothing moves without your approval.";
    case "approve": return `Open ${choice?.name ?? "your wallet"} and approve the request. ToD sees your address and nothing else.`;
    case "rejected": return "Nothing was shared. Try again, or pick a different wallet.";
    case "network": return "Your wallet is on another network. Everything here runs on Base Sepolia, a test network.";
    case "ready": return "You're on Base Sepolia.";
  }
}

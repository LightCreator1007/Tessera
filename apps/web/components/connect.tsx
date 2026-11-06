"use client";
// Sign in as an almost full-screen sheet over the page you're on: pick a wallet, prove you're one person if this wallet hasn't, then the sheet closes and you carry on. Anything that needs a wallet opens it through openConnect().
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { HumanCheck } from "@/components/human/HumanCheck";
import { PosterThumb } from "@/components/mosaic/PosterCard";
import { coverById } from "@/components/mosaic/figures";
import { TileScanner } from "@/components/mosaic/widgets";
import { Stepper } from "@/components/stepper";
import { WalletPicker } from "@/components/wallet/WalletPicker";
import { useHuman } from "@/lib/identity";
import { useWallet } from "@/lib/wallet";

let isOpen = false;
const subs = new Set<() => void>();
const emit = (v: boolean) => { isOpen = v; subs.forEach((f) => f()); };
export const openConnect = () => emit(true);
const closeConnect = () => emit(false);

const STEPS = [
  { key: "wallet", word: "Wallet", label: "Connect a wallet" },
  { key: "human", word: "One person", label: "Prove you're one person" },
] as const;

/** Mounted once in the shell. */
export function SignInSheet() {
  const open = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => isOpen, () => false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="signin-title"
      onClose={closeConnect}
      className="sheet-dialog m-auto size-sheet overflow-hidden rounded-xl border border-rule bg-surface p-0 text-ink shadow-2xl"
    >
      {/* Remounted per opening, so each sign-in starts from the wallet step. */}
      {open && <SignInFlow />}
    </dialog>
  );
}

function SignInFlow() {
  const w = useWallet();
  const h = useHuman();
  const ready = w.connected && !w.wrongNetwork;
  const [sealed, setSealed] = useState(false);
  const step = !ready || (h.owner && h.loading) ? 0 : 1;

  // A wallet that is already one verified person: show the connected stamp for a beat, then close.
  useEffect(() => {
    if (!ready || h.loading || !h.verified || sealed) return;
    const t = setTimeout(closeConnect, 900);
    return () => clearTimeout(t);
  }, [ready, h.loading, h.verified, sealed]);
  // Just verified here: let the seal land, then close.
  useEffect(() => {
    if (!sealed) return;
    const t = setTimeout(closeConnect, 2600);
    return () => clearTimeout(t);
  }, [sealed]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-rule px-5 py-4 md:px-8">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-xs uppercase tracking-wide text-mosaic">Sign in</span>
          <h2 id="signin-title" className="truncate text-lg font-medium tracking-tight text-ink">{step === 0 ? "Connect your wallet" : "Prove you're one person"}</h2>
        </div>
        <div className="mx-auto hidden w-full max-w-md md:block"><Stepper steps={STEPS} current={step} label="Sign-in progress" /></div>
        <button type="button" onClick={closeConnect} aria-label="Close" className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink md:ml-0">
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div key={step} className="animate-step-in mx-auto flex h-full w-full max-w-5xl flex-col gap-6 px-5 py-6 md:justify-center md:px-8 md:py-8">
          <div className="md:hidden"><Stepper steps={STEPS} current={step} label="Sign-in progress" /></div>
          {step === 0 ? (
            <div className="grid gap-6 md:grid-cols-2 md:items-stretch">
              <div className="relative hidden overflow-hidden border border-rule bg-sunken md:block">
                <PosterThumb cover={coverById("crow")} live label="Cawing Crow poster" cell={7} className="absolute inset-0" />
                <p aria-hidden className="pointer-events-none absolute left-5 top-4 select-none text-2xl font-medium leading-none tracking-tight text-field">Sign<br />in.</p>
                <dl className="absolute bottom-4 left-5 flex flex-col font-mono text-xs uppercase leading-relaxed tracking-wide text-ink">
                  {["NO PASSWORD", "NO EMAIL", "ONE PERSON"].map((m, i) => (
                    <dd key={m} className="animate-step-in" style={{ animationDelay: `${i * 70}ms` }}><span className={i === 0 ? "bg-surface px-1" : "bg-surface/60 px-1"}>{m}</span></dd>
                  ))}
                </dl>
              </div>
              {h.owner && h.loading ? (
                <div className="flex flex-col justify-center gap-3 border border-rule bg-card p-6" role="status">
                  <TileScanner label="Looking up this wallet" count={20} />
                  <span className="text-sm text-subtle">Looking up this wallet</span>
                </div>
              ) : (
                <WalletPicker title="Connect your wallet" lede="Pick the wallet you use here. New wallets sign up in the same two steps; there's no password or email." />
              )}
            </div>
          ) : (
            <HumanCheck onVerified={() => setSealed(true)} />
          )}
        </div>
      </div>
    </div>
  );
}

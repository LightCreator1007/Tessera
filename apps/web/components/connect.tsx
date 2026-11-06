"use client";
// Sign in as an almost full-screen sheet over the page you're on: pick a wallet, prove you're one person if this wallet hasn't, then the sheet closes and you carry on. Anything that needs a wallet opens it through openConnect().
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
      aria-label="Sign in"
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

  const top = (
    <div className="flex items-center gap-6">
      <div className="min-w-0 flex-1"><Stepper steps={STEPS} current={step} label="Sign-in progress" /></div>
      <button type="button" onClick={closeConnect} aria-label="Close" className="-mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-subtle transition-colors duration-150 ease-out hover:bg-hover hover:text-ink">
        <X className="size-4" />
      </button>
    </div>
  );

  if (step === 1) {
    return (
      <HumanCheck
        onVerified={() => setSealed(true)}
        split={(art, body) => <Split step={step} left={art} top={top} foot="World ID gives Tessera one number that proves you haven't joined before. No name, no face, no address.">{body}</Split>}
      />
    );
  }
  return (
    <Split step={step} top={top} foot="Tessera never sees your keys. Every payment, stake or claim opens in your wallet and waits for you."
      left={
        <>
          <PosterThumb cover={coverById("crow")} live label="Cawing Crow poster" cell={7} className="absolute inset-0" />
          <p aria-hidden className="pointer-events-none absolute left-8 top-7 select-none text-2xl font-medium leading-none tracking-tight text-field">Sign<br />in.</p>
          <dl className="absolute bottom-7 left-8 flex flex-col font-mono text-xs uppercase leading-relaxed tracking-wide text-ink">
            {["NO PASSWORD", "NO EMAIL", "ONE PERSON"].map((m, i) => (
              <dd key={m} className="animate-step-in" style={{ animationDelay: `${i * 70}ms` }}><span className={i === 0 ? "bg-surface px-1" : "bg-surface/60 px-1"}>{m}</span></dd>
            ))}
          </dl>
        </>
      }
    >
      {h.owner && h.loading ? (
        <div className="flex flex-col gap-3" role="status">
          <TileScanner label="Looking up this wallet" count={20} />
          <span className="text-sm text-subtle">Looking up this wallet</span>
        </div>
      ) : (
        <WalletPicker plain eyebrow="Sign in" title="Connect your wallet" lede="Pick the wallet you use here. A new wallet signs up in the same two steps, with no password or email." />
      )}
    </Split>
  );
}

/** The sheet's two halves: art bleeding to the edges on the left; progress, the step and a footnote on the right. */
function Split({ step, left, top, foot, children }: { step: number; left: ReactNode; top: ReactNode; foot: string; children: ReactNode }) {
  return (
    <div className="grid h-full md:grid-cols-2">
      <div className="relative hidden overflow-hidden border-r border-rule bg-sunken md:block">{left}</div>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="px-6 pt-5 md:px-12 md:pt-8">{top}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div key={step} className="animate-step-in flex min-h-full flex-col justify-center px-6 py-8 md:px-12">{children}</div>
        </div>
        <p className="border-t border-rule px-6 py-4 text-xs leading-relaxed text-subtle md:px-12">{foot}</p>
      </div>
    </div>
  );
}

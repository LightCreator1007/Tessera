"use client";
// Sign up and sign in, one page per step: /join (wallet), /join/verify (World ID), /join/done (pick a start), and /signin for a returning wallet. Each page checks where the person really is and sends them to the right step, and ?next= returns them to the page that asked.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { HumanCheck } from "@/components/human/HumanCheck";
import { Stepper } from "@/components/stepper";
import { TileScanner, TileToast } from "@/components/mosaic/widgets";
import { Identicon, Pill, short } from "@/components/primitives";
import { WalletPicker } from "@/components/wallet/WalletPicker";
import { ROLE_KEY, ROLES, RoleArt } from "@/features/start/RolePicker";
import { CREDENTIAL_LABEL, useHuman } from "@/lib/identity";
import { safeNext } from "@/lib/safe-next";
import { useWallet } from "@/lib/wallet";


const STEPS = [
  { key: "wallet", word: "Wallet", label: "Connect a wallet", href: "/join" },
  { key: "human", word: "One person", label: "Prove you're one person", href: "/join/verify" },
  { key: "start", word: "Start", label: "Pick what you'll do", href: "/join/done" },
] as const;

const noSub = () => () => {};
/** False during hydration (the server's render), true after: guards must not act on the server's empty wallet. */
const useHydrated = () => useSyncExternalStore(noSub, () => true, () => false);

/** Where the person stands, and whether it's safe to act on yet (wallet restored, chain read, identity looked up). */
function useFlow() {
  const w = useWallet();
  const h = useHuman();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const hydrated = useHydrated();
  const settled = hydrated && !w.restoring && !w.connecting && !(h.owner && h.loading);
  const ready = w.connected && !w.wrongNetwork;
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  return { w, h, router, next, settled, ready, q };
}

export function JoinWallet({ signin }: { signin?: boolean }) {
  const { w, h, router, next, settled, ready, q } = useFlow();
  // Already connected when the page settled: move on at once. Connected here: let the check land first.
  const arrivedReady = useRef<boolean | null>(null);
  if (settled && arrivedReady.current === null) arrivedReady.current = ready;
  useEffect(() => {
    if (!settled || !ready) return;
    const go = () => (h.verified ? router.replace(next ?? (signin ? "/" : "/join/done")) : router.push(`/join/verify${q}`));
    const t = setTimeout(go, arrivedReady.current ? 0 : 900);
    return () => clearTimeout(t);
  }, [settled, ready, h.verified, next, q, signin, router]);

  return (
    <JoinFrame step={0} eyebrow={signin ? "Sign in" : "Sign up · about 2 minutes"} title={signin ? <>Welcome back.<br /><span className="text-field">Connect your wallet.</span></> : undefined}
      lede={signin ? "Your wallet is your login. Connect the one you signed up with; there's no password." : undefined}>
      {!settled ? <Waiting label={w.restoring ? "Reconnecting your wallet" : "Reading your wallet"} /> : (
        <WalletPicker
          title={signin ? "Connect your wallet" : "Start with your wallet"}
          lede={signin ? "Pick the wallet you used before." : "It holds your money and signs for you. Next time, connecting the same wallet is how you sign in."}
        />
      )}
      {!signin && <p className="text-sm text-muted">Signed up before? <Link href={`/signin${q}`} className="text-ink underline decoration-subtle underline-offset-4 hover:decoration-ink">Sign in</Link></p>}
      {signin && <p className="text-sm text-muted">New here? <Link href={`/join${q}`} className="text-ink underline decoration-subtle underline-offset-4 hover:decoration-ink">Sign up, about 2 minutes</Link></p>}
    </JoinFrame>
  );
}

export function JoinVerify() {
  const { w, h, router, next, settled, ready, q } = useFlow();
  // Verified on arrival is a returning person; verified here just signed up and gets the seal moment first.
  const arrived = useRef<"new" | "returning" | null>(null);
  if (settled && ready && arrived.current === null) arrived.current = h.verified ? "returning" : "new";
  const [sealed, setSealed] = useState(false);

  useEffect(() => {
    if (!settled) return;
    if (!ready) return void router.replace(`/join${q}`);
    if (arrived.current === "returning") return void router.replace(next ?? "/join/done");
  }, [settled, ready, next, q, router]);
  useEffect(() => {
    if (!sealed) return;
    const t = setTimeout(() => router.push(next ?? `/join/done?fresh=1`), 2600);
    return () => clearTimeout(t);
  }, [sealed, next, router]);

  return (
    <JoinFrame step={1} eyebrow="Sign up · step 2 of 3">
      {!settled || !ready || arrived.current === "returning" ? (
        <Waiting label={`Looking up ${w.address ? short(w.address) : "this wallet"}`} />
      ) : (
        <HumanCheck onVerified={() => setSealed(true)} />
      )}
      <Link href="/join" className="self-start text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-ink">Use a different wallet</Link>
    </JoinFrame>
  );
}

export function JoinDone() {
  const { h, router, settled, ready, q } = useFlow();
  const fresh = useSearchParams().get("fresh") === "1";
  useEffect(() => {
    if (!settled) return;
    if (!ready) router.replace(`/join${q}`);
    else if (!h.verified) router.replace(`/join/verify${q}`);
  }, [settled, ready, h.verified, q, router]);

  if (!settled || !ready || !h.verified) return <JoinFrame step={2}><Waiting label="Checking your account" /></JoinFrame>;
  return (
    <JoinFrame step={2} eyebrow={fresh ? "Signed up" : "Signed in"} title={fresh ? undefined : <>Welcome back.</>}>
      <section aria-label="Pick what you'll do" className="animate-step-in flex flex-col gap-8">
        <Account fresh={fresh} />
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-medium tracking-tight text-ink">What do you want to do first?</h2>
          <p className="text-sm text-muted">Every path is open to you now. This only picks where to start.</p>
        </div>
        <ul className="grid gap-3 md:grid-cols-3">
          {ROLES.map((r, i) => (
            <li key={r.key} className="flex animate-step-in" style={{ animationDelay: `${120 + i * 80}ms` }}>
              <Link
                href={r.then.href}
                onClick={() => { try { localStorage.setItem(ROLE_KEY, r.key); } catch { /* Not remembered in private mode; the link still works. */ } }}
                className="group flex flex-1 flex-col overflow-hidden border border-rule bg-card transition-colors duration-150 ease-out hover:border-rule-strong hover:bg-band"
              >
                <RoleArt word={r.word} on />
                <span className="flex flex-1 flex-col gap-1.5 px-4 pb-4 pt-3">
                  <span className="flex items-center gap-2 font-mono text-xs text-mosaic"><r.icon className="size-3.5" strokeWidth={1.5} aria-hidden />{r.word.toLowerCase()}</span>
                  <span className="text-xl font-medium tracking-tight text-ink">{r.title}</span>
                  <span className="text-sm text-muted">{r.promise}</span>
                  <span className="mt-auto flex items-center gap-1.5 pt-3 text-sm text-ink">
                    {r.then.label}
                    <ArrowRight className="size-4 transition-transform duration-150 ease-out group-hover:translate-x-1" aria-hidden />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/" className="self-start text-sm text-muted underline decoration-subtle underline-offset-4 hover:text-ink">Just look around first</Link>
      </section>
    </JoinFrame>
  );
}

function JoinFrame({ step, eyebrow = "Sign up · about 2 minutes", title, lede, children }: { step: number; eyebrow?: string; title?: ReactNode; lede?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-24 pt-8 md:px-6 md:pt-12">
      <header className="flex flex-col gap-3">
        <span className="font-mono text-xs uppercase tracking-wide text-mosaic">{eyebrow}</span>
        <h1 className="text-balance text-2xl font-medium tracking-tight text-ink">
          {title ?? <>One wallet. One person.<br /><span className="text-field">No account to make.</span></>}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          {lede ?? "Your wallet is your login. World ID proves once that you're a single real person, so pay and prizes go to people, not to bots. That's the whole sign-up."}
        </p>
      </header>
      <div className="max-w-xl"><Stepper steps={STEPS} current={step} label="Sign-up progress" /></div>
      <div key={step} className="animate-step-in flex flex-col gap-6">{children}</div>
    </div>
  );
}

function Waiting({ label }: { label: string }) {
  return (
    <div className="flex max-w-md flex-col gap-3 border border-rule bg-card p-6" role="status">
      <TileScanner label={label} count={20} />
      <span className="text-sm text-subtle">{label}</span>
    </div>
  );
}

/** What the account is, in one strip: the wallet, the proof, and how to come back. */
function Account({ fresh }: { fresh: boolean }) {
  const w = useWallet();
  const h = useHuman();
  const cred = h.status?.credential;
  return (
    <div className="flex flex-col gap-4">
      {fresh && <TileToast text="YOU'RE IN. ONE PERSON, ONE WALLET." play={1} />}
      <div className="grid gap-px overflow-hidden border border-rule bg-rule sm:grid-cols-3">
        <Cell label="Sign in with">
          <span className="flex items-center gap-2">
            {w.address && <Identicon value={w.address} className="size-5" />}
            <span className="font-mono text-sm text-ink">{w.address ? short(w.address) : ""}</span>
          </span>
        </Cell>
        <Cell label="Proof">
          <span className="flex flex-wrap items-center gap-2"><Pill tone="ok">one person</Pill>{cred && <span className="font-mono text-xs text-muted">{CREDENTIAL_LABEL[cred]}</span>}</span>
        </Cell>
        <Cell label="Next time">
          <span className="text-sm text-muted">Connect this wallet. No password, no email.</span>
        </Cell>
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 bg-card px-4 py-3">
      <span className="font-mono text-xs uppercase tracking-wide text-subtle">{label}</span>
      {children}
    </div>
  );
}


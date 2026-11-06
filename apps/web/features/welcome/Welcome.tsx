"use client";
// /welcome: sign up in three steps (a wallet, one proof that you're one person, then what you came to do). Signing in later is connecting the same wallet. A wallet that is already verified lands on the last step, and ?next= sends you back to the page that asked.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { HumanCheck } from "@/components/human/HumanCheck";
import { ConnectGate } from "@/components/mosaic/ConnectGate";
import { TileScanner, TileToast } from "@/components/mosaic/widgets";
import { ButtonLink, Identicon, Pill, cx, short } from "@/components/primitives";
import { ROLE_KEY, ROLES, RoleArt } from "@/features/start/RolePicker";
import { CREDENTIAL_LABEL, useHuman } from "@/lib/identity";
import { useWallet } from "@/lib/wallet";

/** Only paths on this site, so ?next= can't bounce someone to another origin. */
export function safeNext(v: string | null): string | null {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : null;
}

const STEPS = [
  { key: "wallet", word: "Wallet", label: "Connect a wallet" },
  { key: "human", word: "One person", label: "Prove you're one person" },
  { key: "start", word: "Start", label: "Pick what you'll do" },
] as const;

export function Welcome() {
  const w = useWallet();
  const h = useHuman();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  // Who arrived already verified is a returning person; who verified here just signed up.
  const arrived = useRef<"new" | "returning" | null>(null);
  if (arrived.current === null && !h.loading && h.owner) arrived.current = h.verified ? "returning" : "new";
  if (!h.owner) arrived.current = null;
  const justVerified = arrived.current === "new" && h.verified;
  // The seal lands before the page moves on: the verified panel holds for one beat, then the next step (or ?next=).
  const [released, setReleased] = useState(false);
  const sealing = justVerified && !released;
  const step = !w.connected || w.wrongNetwork ? 0 : !h.verified || sealing ? 1 : 2;

  useEffect(() => {
    if (!sealing) return;
    const t = setTimeout(() => (next ? router.push(next) : setReleased(true)), 2600);
    return () => clearTimeout(t);
  }, [sealing, next, router]);

  const returning = arrived.current === "returning";
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-24 pt-8 md:px-6 md:pt-12">
      <header className="flex flex-col gap-3">
        <span className="font-mono text-xs uppercase tracking-wide text-mosaic">{returning ? "Signed in" : "Sign up · about 2 minutes"}</span>
        <h1 className="text-balance text-2xl font-medium tracking-tight text-ink">
          {returning ? <>Welcome back.</> : <>One wallet. One person.<br /><span className="text-field">No account to make.</span></>}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          {returning
            ? "This wallet is already verified, so there's nothing to sign. Pick up where you want."
            : "Your wallet is your login. World ID proves once that you're a single real person, so pay and prizes go to people, not to bots. That's the whole sign-up."}
        </p>
      </header>

      <StepTiles step={step} />

      {step === 0 && (
        <ConnectGate key="wallet" title="Start with your wallet" className="animate-step-in" signUp={false}>
          It holds your money and signs for you. Next time, connecting the same wallet is how you sign in.
        </ConnectGate>
      )}

      {step === 1 && (h.loading ? (
        <div className="flex max-w-md flex-col gap-3 border border-rule bg-card p-6">
          <TileScanner label="Looking up this wallet" count={20} />
          <span className="text-sm text-subtle">Looking up {w.address ? short(w.address) : "this wallet"}</span>
        </div>
      ) : (
        <div key="human" className="animate-step-in">
          <HumanCheck />
        </div>
      ))}

      {step === 2 && (
        <section key="start" aria-label="Pick what you'll do" className="animate-step-in flex flex-col gap-8">
          <Account justVerified={justVerified} next={next} />
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
      )}
    </div>
  );
}

/** Three tiles: done ones turn to ink, the current one carries the caret. */
function StepTiles({ step }: { step: number }) {
  return (
    <nav aria-label="Sign-up progress">
      <ol className="grid grid-cols-3 gap-1.5">
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "current" : "todo";
          return (
            <li key={s.key} aria-current={state === "current" ? "step" : undefined} aria-label={`${s.label}, ${state === "done" ? "done" : state === "current" ? "current step" : "not yet"}`}>
              <div
                key={state}
                className={cx(
                  "flex h-16 flex-col justify-between border px-3 py-2 font-mono text-xs uppercase tracking-wide",
                  state === "done" && "animate-tx-glint border-ink bg-ink text-brand-ink",
                  state === "current" && "border-mosaic bg-surface text-ink",
                  state === "todo" && "border-rule text-subtle",
                )}
              >
                <span className="flex items-center justify-between tabular">
                  {String(i + 1).padStart(2, "0")}
                  {state === "done" && <Check className="size-3.5" strokeWidth={2.5} aria-hidden />}
                </span>
                <span className="truncate">{s.word}{state === "current" && <> <span className="hq-caret" aria-hidden /></>}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** What the account is, in one strip: the wallet, the proof, and how to come back. */
function Account({ justVerified, next }: { justVerified: boolean; next: string | null }) {
  const w = useWallet();
  const h = useHuman();
  const cred = h.status?.credential;
  return (
    <div className="flex flex-col gap-4">
      {justVerified && <TileToast text="YOU'RE IN. ONE PERSON, ONE WALLET." play={1} />}
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
      {next && (
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink variant="primary" icon={ArrowRight} href={next}>Continue where you were</ButtonLink>
        </div>
      )}
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 bg-card px-4 py-3">
      <span className="font-mono text-xs uppercase tracking-wide text-subtle">{label}</span>
      {children}
    </div>
  );
}

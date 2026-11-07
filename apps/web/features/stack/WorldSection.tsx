"use client";
// World ID in Tessera: one person binds one wallet, a second wallet is refused, a confirmed cheat stays out. Plus a live lookup.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check, ScanFace, Search, User, Wallet, X } from "lucide-react";
import { useOwnerIdentity } from "@/lib/api/hooks";
import { isDemo } from "@/lib/api/client";
import { CREDENTIAL_LABEL, useIdentityConfig, type Credential } from "@/lib/identity";
import { useWallet } from "@/lib/wallet";
import { reducedMotion } from "@/lib/prefs";
import { ButtonLink, Card, Eyebrow, Null, Pill, PropRow, Skeleton, cx } from "@/components/primitives";

const STEPS = [
  { key: "prove", title: "Prove", body: "A person scans with World App. The proof carries a nullifier: the same number every time this person proves for Tessera, and nothing else about them." },
  { key: "bind", title: "Bind", body: "The coordinator ties that nullifier to the wallet that asked. The node registry checks it again onchain when the node joins." },
  { key: "refuse", title: "Refuse", body: "The same person with a second wallet brings the same nullifier, so the second wallet is turned away. One person, one seat." },
  { key: "exclude", title: "Exclude", body: "When verifiers confirm a cheat, the nullifier is excluded, not just the wallet. A fresh wallet can't buy its way back in." },
] as const;

const ADDR = /^0x[0-9a-fA-F]{40}$/;

function Story() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || reducedMotion()) return;
    const id = setInterval(() => setI((x) => (x + 1) % STEPS.length), 3800);
    return () => clearInterval(id);
  }, [auto]);
  const s = STEPS[i].key;
  const second = s === "refuse" || s === "exclude";
  return (
    <div className="flex flex-col gap-4">
      <div className="relative flex h-56 items-center justify-between gap-2 overflow-hidden rounded-lg bg-sunken px-4" aria-live="polite">
        {/* Person and their nullifier */}
        <div className="flex flex-col items-center gap-2">
          <span className={cx("flex size-14 items-center justify-center rounded-full border transition-colors duration-300", s === "exclude" ? "border-danger text-danger" : "border-rule-strong text-ink")}>
            <User className="size-6" strokeWidth={1.5} aria-hidden />
          </span>
          <span className="font-mono text-xs text-muted">one person</span>
          <span className={cx("rounded-xs px-1.5 py-0.5 font-mono text-xs transition-all duration-500", s === "exclude" ? "bg-danger-bg text-danger line-through" : "bg-band text-ink", s === "prove" && "animate-pop-in")}>
            nullifier 0x7c3e…a91f
          </span>
        </div>
        {/* The links */}
        <svg width="80" height="160" viewBox="0 0 80 160" aria-hidden className="overflow-visible">
          <path d="M0 80 C 40 80, 40 40, 80 40" fill="none" stroke={s === "exclude" ? "var(--danger)" : "var(--ok)"} strokeWidth="1.5" strokeDasharray="4 4" className={cx("transition-opacity duration-300", s === "prove" ? "opacity-0" : "opacity-100")} />
          <path d="M0 80 C 40 80, 40 120, 80 120" fill="none" stroke="var(--danger)" strokeWidth="1.5" strokeDasharray="4 4" className={cx("transition-opacity duration-300", second ? "opacity-100" : "opacity-0")} />
        </svg>
        {/* Wallets */}
        <div className="flex flex-col gap-6">
          <WalletRow label="wallet A" state={s === "prove" ? "idle" : s === "exclude" ? "out" : "ok"} note={s === "exclude" ? "excluded" : s === "prove" ? "waiting" : "bound"} />
          <WalletRow label="wallet B" state={second ? (s === "exclude" ? "out" : "no") : "hidden"} note={s === "exclude" ? "still refused" : "409 already linked"} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1" role="tablist" aria-label="How World ID gates a seat">
        {STEPS.map((st, k) => (
          <button
            key={st.key}
            role="tab"
            aria-selected={k === i}
            onClick={() => {
              setI(k);
              setAuto(false);
            }}
            className={cx("flex flex-col gap-1 border-t-2 pt-2 text-left text-xs transition-colors", k === i ? "border-ink text-ink" : "border-rule text-muted hover:text-ink")}
          >
            <span className="font-mono uppercase tracking-wide">{k + 1} {st.title}</span>
          </button>
        ))}
      </div>
      <p className="min-h-16 text-sm text-muted">{STEPS[i].body}</p>
    </div>
  );
}

function WalletRow({ label, state, note }: { label: string; state: "idle" | "ok" | "no" | "out" | "hidden"; note: string }) {
  const tone = state === "ok" ? "text-ok border-ok" : state === "idle" ? "text-muted border-rule-strong" : "text-danger border-danger";
  const Icon = state === "ok" ? Check : state === "out" ? Ban : state === "no" ? X : Wallet;
  return (
    <div className={cx("flex items-center gap-2 transition-opacity duration-300", state === "hidden" ? "opacity-0" : "opacity-100")}>
      <span className={cx("flex size-9 items-center justify-center rounded-md border", tone)}>
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="flex flex-col">
        <span className="font-mono text-xs text-ink">{label}</span>
        <span className={cx("font-mono text-xs", state === "ok" ? "text-ok" : state === "idle" ? "text-muted" : "text-danger")}>{note}</span>
      </span>
    </div>
  );
}

/** Mirrors the matcher: jobs under 500 TOD take Selfie Check or better, from 500 TOD they need an Orb. */
function CredentialBar() {
  const [budget, setBudget] = useState(250);
  const orb = budget >= 500;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Job budget</Eyebrow>
        <span className="font-mono text-sm tabular text-ink">{budget.toLocaleString()} TOD</span>
      </div>
      <input type="range" min={0} max={2000} step={50} value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-label="Job budget in TOD" className="w-full accent-red-5" />
      <div className="grid grid-cols-2 gap-2">
        {(["selfie", "orb"] as const).map((c) => {
          const ok = c === "orb" || !orb;
          return (
            <div key={c} className={cx("flex items-center gap-2 rounded-md border p-2.5 transition-colors duration-200", ok ? "border-ok/50 bg-ok-bg" : "border-rule bg-sunken")}>
              <ScanFace className={cx("size-4", ok ? "text-ok" : "text-subtle")} strokeWidth={1.75} aria-hidden />
              <span className="flex flex-col">
                <span className={cx("text-sm", ok ? "text-ink" : "text-subtle line-through")}>{CREDENTIAL_LABEL[c]}</span>
                <span className="font-mono text-xs text-muted">{ok ? "can take a seat" : "not enough here"}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">Bigger jobs ask for stronger proof. The matcher won&apos;t seat a node whose owner&apos;s credential is below the job&apos;s bar, and the job page says so instead of waiting silently.</p>
    </div>
  );
}

function Lookup() {
  const w = useWallet();
  const mine = w.connected ? w.address : null;
  const [text, setText] = useState("");
  const addr = ADDR.test(text.trim()) ? text.trim() : mine;
  const id = useOwnerIdentity(addr ?? null);
  const d = id.data?.data;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex h-9 items-center gap-2 rounded-md border border-field bg-surface px-2">
        <Search className="size-4 text-subtle" aria-hidden />
        <span className="sr-only">Look up an address</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={mine ? "Your wallet, or paste any 0x address" : "Paste any 0x address"} className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none" spellCheck={false} />
      </label>
      {!addr ? (
        <p className="text-xs text-muted">{text && !ADDR.test(text.trim()) ? "That isn't a full address yet." : "Connect a wallet or paste an address to see what the coordinator knows about the person behind it."}</p>
      ) : id.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : id.isError ? (
        <p className="text-xs text-danger">The coordinator didn&apos;t answer the identity lookup.</p>
      ) : (
        <div className="flex flex-col">
          <PropRow label="Address"><span className="font-mono text-xs">{addr.slice(0, 8)}…{addr.slice(-6)}{addr === mine ? " (you)" : ""}</span></PropRow>
          <PropRow label="One person">{d?.verified ? <Pill tone="ok">verified</Pill> : <Pill tone="neutral">not yet</Pill>}</PropRow>
          <PropRow label="Credential">{d?.credential ? CREDENTIAL_LABEL[d.credential as Credential] ?? d.credential : <Null>None</Null>}</PropRow>
          <PropRow label="Runs a node">{d?.joined ? "Yes" : "No"}</PropRow>
          <PropRow label="Excluded">{d?.excluded ? <span className="text-danger">{d.excluded.reason}</span> : "No"}</PropRow>
          {isDemo && <p className="pt-2 text-xs text-trust-demo">Demo data: no coordinator is connected.</p>}
          {addr === mine && !d?.verified && <div className="pt-3"><ButtonLink href="/join/verify" variant="primary">Prove you&apos;re one person</ButtonLink></div>}
        </div>
      )}
    </div>
  );
}

export function WorldSection() {
  const cfg = useIdentityConfig();
  const mode = cfg.data?.mode;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="p-4 md:p-5 lg:col-span-3"><Story /></Card>
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card className="flex flex-col gap-3 p-4 md:p-5">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow>Look up a person</Eyebrow>
            {mode && <Pill tone={mode === "worldid" ? "ok" : mode === "demo" ? "neutral" : "warn"}>{mode === "worldid" ? `World ID ${cfg.data?.environment ?? ""}`.trim() : mode === "dev" ? "dev identities" : mode === "wallet" ? "wallet only" : "demo"}</Pill>}
          </div>
          <Lookup />
        </Card>
        <Card className="p-4 md:p-5"><CredentialBar /></Card>
        <p className="px-1 text-xs text-muted">World ID gates three things here: joining the node pool, entering a competition, and staying out after a confirmed cheat. <Link href="/docs/node" className="text-ink underline underline-offset-4">How joining works</Link></p>
      </div>
    </div>
  );
}
